/**
 * Checks the frontend API layer against the backend's swagger.json.
 *
 * Usage: node scripts/check-api.js [path/to/swagger.json]
 * Default swagger path: ../Backend/ServiceDesk/docs/swagger.json (the Service Desk docs folder).
 *
 * For every endpoint declared with defineEndpoint in src/features/<feature>/api/endpoints.js:
 * 1. The route and method exist in swagger.json, and the route is not a retired one.
 * 2. Every declared query parameter exists on the operation.
 * 3. Request body: the property names the zod schema sends exist in the swagger schema, and every
 *    property swagger marks required is sent and required in the zod schema. A multipart form
 *    (bodyType "multipart") is read from requestBody.content["multipart/form-data"].schema: each
 *    field is sent under the camelCase of its swagger name, swagger arrays (CcUserIds, Files) are
 *    zod arrays sent as a repeated key, binary fields are files, and no field is a nested object.
 * 4. Response: the property names the zod schema reads exist in the swagger response schema,
 *    nested objects included, and nullable properties accept null. A binary answer
 *    (application/octet-stream, string/binary) must be declared with responseType "blob" and has
 *    no zod schema; a JSON answer must not be declared as a blob.
 *
 * Exits 1 on any mismatch, 2 when swagger.json cannot be read. Warnings (for example an operation
 * whose response has no schema in swagger.json) are printed but do not fail the check.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { POLICIES } from "../src/features/auth/policies.js";
import {
  ACCESS_TABLE,
  DO_NOT_USE,
  describeAccess,
  isAllowed,
} from "./api-access.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.resolve(ROOT, "..", "Backend", "ServiceDesk", "docs");
const DEFAULT_SWAGGER = path.join(DOCS, "swagger.json");
const DEFAULT_INVENTORY = path.join(DOCS, "api", "endpoint-inventory.md");
const ENDPOINT_BRAND = Symbol.for("sd.endpoint");

/** Routes the backend refuses on purpose. The source of each is in "why". None yet. */
export const RETIRED = [];

/** Request properties the frontend must never send, even though swagger still lists them. */
export const NEVER_SEND = [
  ...["/api/Auth/refresh", "/api/Auth/logout"].map((path) => ({
    method: "POST",
    path,
    fields: ["refreshToken"],
    why: "the HttpOnly refresh-token cookie carries it; the web app never holds the token",
  })),
];

/** Response properties the frontend must never read (not returned, or always null). */
export const NEVER_READ = [
  ...["/api/Auth/login", "/api/Auth/refresh"].map((path) => ({
    method: "POST",
    path,
    fields: ["accessToken", "refreshToken"],
    why: "tokens travel in HttpOnly cookies; the web app never reads or stores them",
  })),
];

/**
 * Top-level response properties swagger marks nullable that a success answer always carries, so
 * the zod schema may reject null. Only the sign-in ApiResponse wrapper: its `data` is T? because
 * the same type carries the error answers (People Hub compatibility).
 */
export const PRESENT_ON_SUCCESS = [
  ...[
    ["POST", "/api/Auth/login"],
    ["POST", "/api/Auth/refresh"],
    ["GET", "/api/Auth/me"],
    ["GET", "/api/Auth/csrf"],
  ].map(([method, path]) => ({
    method,
    path,
    fields: ["data"],
    why: "ApiResponse.data is null only on error answers",
  })),
];

function findRule(rules, method, route) {
  return rules.find(
    (rule) =>
      rule.method === method &&
      normalizePath(rule.path) === normalizePath(route),
  );
}

function forbiddenFields(rule, shape) {
  if (!rule || !shape) return [];
  const names = Object.keys(shape).map((name) => name.toLowerCase());
  return rule.fields.filter((field) => names.includes(field.toLowerCase()));
}

/** "/api/Requisitions/{id}/" -> "/api/requisitions/{}" */
export function normalizePath(route) {
  return route
    .toLowerCase()
    .replace(/\{[^}]+\}/g, "{}")
    .replace(/\/+$/, "");
}

function indexPaths(swagger) {
  const index = new Map();
  for (const [route, item] of Object.entries(swagger.paths || {})) {
    index.set(normalizePath(route), { route, item });
  }
  return index;
}

/** Resolves $ref and merges allOf. Returns { properties, required, items, type } or null. */
function resolveSchema(swagger, schema, depth = 0) {
  if (!schema || depth > 10) return null;
  if (schema.$ref) {
    const name = schema.$ref.replace(/^#\/components\/schemas\//, "");
    return resolveSchema(
      swagger,
      swagger.components?.schemas?.[name],
      depth + 1,
    );
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf
      .map((part) => resolveSchema(swagger, part, depth + 1))
      .filter(Boolean)
      .reduce(
        (merged, part) => ({
          type: merged.type || part.type,
          properties: { ...merged.properties, ...part.properties },
          required: [...merged.required, ...part.required],
          items: merged.items || part.items,
        }),
        { type: schema.type, properties: {}, required: [], items: undefined },
      );
  }
  return {
    type: schema.type,
    properties: schema.properties || {},
    required: schema.required || [],
    items: schema.items,
  };
}

/** The object schema whose properties are compared; for arrays, the element. */
function objectSchema(swagger, schema) {
  const resolved = resolveSchema(swagger, schema);
  if (resolved?.type === "array") return resolveSchema(swagger, resolved.items);
  return resolved;
}

function pickContent(content = {}) {
  for (const type of [
    "application/json",
    "multipart/form-data",
    "text/json",
    "application/*+json",
  ]) {
    if (content[type]) return { type, schema: content[type].schema };
  }
  const [type] = Object.keys(content);
  return type ? { type, schema: content[type].schema } : null;
}

/** "CcUserIds" -> "ccUserIds" (ASP.NET binds form keys case-insensitively; the app sends camelCase). */
export function camelCase(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** True for { type: "string", format: "binary" }, the swagger form of a file. */
function isBinary(schema) {
  return schema?.type === "string" && schema?.format === "binary";
}

/** Unwraps optional/nullable/default/pipe to the zod type underneath (an array stays an array). */
function zodCore(schema) {
  let current = schema;
  for (let i = 0; current?.def && i < 20; i += 1) {
    const { def } = current;
    if (
      ["optional", "nullable", "default", "readonly", "catch"].includes(
        def.type,
      )
    )
      current = def.innerType;
    else if (def.type === "pipe") current = def.in;
    else return current;
  }
  return current;
}

/** Problems of a multipart form: field names, repeated keys, files, flat values. */
function compareFormFields(swagger, shape, schema, report) {
  const byCamel = new Map(
    Object.entries(schema.properties).map(([name, property]) => [
      camelCase(name),
      { name, property },
    ]),
  );
  for (const [sentName, field] of Object.entries(shape)) {
    const match = byCamel.get(sentName);
    if (!match) {
      const nearMiss = [...byCamel.keys()].find(
        (n) => n.toLowerCase() === sentName.toLowerCase(),
      );
      report(
        `form field "${sentName}" is not in the form schema` +
          (nearMiss ? ` (did you mean "${nearMiss}"?)` : ""),
      );
      continue;
    }
    const property = resolveSchema(swagger, match.property);
    const core = zodCore(field);
    const sentAsArray = core?.def?.type === "array";
    const isArray = property?.type === "array";
    if (isArray && !sentAsArray) {
      report(
        `form field "${sentName}" is a list in swagger (${match.name}); declare a zod array so it is sent as a repeated key`,
      );
    } else if (!isArray && sentAsArray) {
      report(
        `form field "${sentName}" is a single value in swagger (${match.name}) but a zod array`,
      );
    }
    const element = sentAsArray ? zodCore(core.def.element) : core;
    if (element?.def?.type === "object") {
      report(`form field "${sentName}" is an object; form fields are flat`);
    }
    const binary = isArray
      ? isBinary(property.items)
      : isBinary(match.property);
    const sendsFile = element?.def?.type === "custom";
    if (binary && !sendsFile) {
      report(
        `form field "${sentName}" holds files in swagger; declare it with z.instanceof(Blob) or z.custom`,
      );
    } else if (!binary && sendsFile) {
      report(`form field "${sentName}" is not a file in swagger`);
    }
  }
}

/** The success answer is a file: application/octet-stream (or any non-JSON type) with string/binary. */
function isBinaryResponse(response) {
  return Boolean(
    response &&
    !/json/i.test(response.type) &&
    response.schema?.type === "string" &&
    response.schema?.format === "binary",
  );
}

function successResponse(operation) {
  const responses = operation.responses || {};
  const status =
    ["200", "201"].find((code) => responses[code]) ||
    Object.keys(responses).find((code) => /^2\d\d$/.test(code));
  return status ? pickContent(responses[status].content) : null;
}

/** Unwraps optional/nullable/default/pipe and arrays to reach a zod object; null if none. */
export function zodObjectShape(schema) {
  let current = schema;
  for (let i = 0; current && i < 20; i += 1) {
    const def = current.def;
    if (!def) return null;
    if (def.type === "object") return current.shape;
    if (def.type === "array") current = def.element;
    else if (
      ["optional", "nullable", "default", "readonly", "catch"].includes(
        def.type,
      )
    )
      current = def.innerType;
    else if (def.type === "pipe") current = def.in;
    else return null;
  }
  return null;
}

function isZodRequired(field) {
  return !field.safeParse(undefined).success;
}

/** Swagger marks a nullable property with nullable: true, also on { allOf: [{ $ref }] } wrappers. */
function isSwaggerNullable(property) {
  return property?.nullable === true;
}

/**
 * Compares a zod response shape with a swagger object schema, nested objects and array items
 * included: every property the app reads must exist, and a property swagger marks nullable must
 * accept null in the zod schema (otherwise a real null answer fails to parse).
 */
function compareResponseShape(
  swagger,
  shape,
  schema,
  at,
  report,
  presentOnSuccess = [],
  depth = 0,
) {
  const names = Object.keys(schema.properties);
  for (const [name, field] of Object.entries(shape)) {
    const where = at ? `${at}.${name}` : name;
    if (!names.includes(name)) {
      const nearMiss = names.find(
        (n) => n.toLowerCase() === name.toLowerCase(),
      );
      report(
        `response property "${where}" is not in the response schema` +
          (nearMiss ? ` (did you mean "${nearMiss}"?)` : ""),
      );
      continue;
    }
    const property = schema.properties[name];
    if (
      isSwaggerNullable(property) &&
      !presentOnSuccess.includes(where) &&
      !field.safeParse(null).success
    ) {
      report(
        `response property "${where}" can be null (swagger) but the zod schema rejects null`,
      );
    }
    const nestedShape = zodObjectShape(field);
    const nestedSchema = nestedShape && objectSchema(swagger, property);
    if (
      nestedSchema &&
      Object.keys(nestedSchema.properties).length &&
      depth < 8
    ) {
      compareResponseShape(
        swagger,
        nestedShape,
        nestedSchema,
        where,
        report,
        [],
        depth + 1,
      );
    }
  }
}

/**
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function checkEndpoint(endpoint, swagger, index = indexPaths(swagger)) {
  const problems = [];
  const warnings = [];
  const { method, path: route } = endpoint;
  const label = `${method} ${route}`;

  const retired = RETIRED.find(
    (entry) =>
      entry.method === method &&
      normalizePath(entry.path) === normalizePath(route),
  );
  if (retired) problems.push(`${label} is retired: ${retired.why}`);

  const neverSend = findRule(NEVER_SEND, method, route);
  for (const field of forbiddenFields(
    neverSend,
    zodObjectShape(endpoint.body),
  )) {
    problems.push(`${label}: must not send "${field}" (${neverSend.why})`);
  }
  const neverRead = findRule(NEVER_READ, method, route);
  for (const field of forbiddenFields(
    neverRead,
    zodObjectShape(endpoint.response),
  )) {
    problems.push(`${label}: must not read "${field}" (${neverRead.why})`);
  }

  const match = index.get(normalizePath(route));
  if (!match) {
    problems.push(`${label}: route not found in swagger.json`);
    return { problems, warnings };
  }
  const operation = match.item[method.toLowerCase()];
  if (!operation) {
    const available = Object.keys(match.item)
      .map((m) => m.toUpperCase())
      .join(", ");
    problems.push(
      `${label}: method not found (swagger ${match.route} has ${available})`,
    );
    return { problems, warnings };
  }
  const where = `swagger ${method} ${match.route}`;

  const queryNames = new Map(
    (operation.parameters || [])
      .filter((parameter) => parameter.in === "query")
      .map((parameter) => [parameter.name.toLowerCase(), parameter.name]),
  );
  for (const name of endpoint.query || []) {
    if (!queryNames.has(name.toLowerCase())) {
      problems.push(
        `${label}: query parameter "${name}" is not accepted (${where})`,
      );
    }
  }

  const request = pickContent(operation.requestBody?.content);
  if (endpoint.body && !request) {
    problems.push(`${label}: sends a body but ${where} has no request body`);
  } else if (!endpoint.body && request && operation.requestBody?.required) {
    problems.push(`${label}: sends no body but ${where} requires one`);
  } else if (endpoint.body && request) {
    const sendsMultipart = endpoint.bodyType === "multipart";
    const expectsMultipart = request.type === "multipart/form-data";
    if (sendsMultipart !== expectsMultipart) {
      problems.push(
        `${label}: sends ${endpoint.bodyType} but ${where} expects ${request.type}`,
      );
    }
    const shape = zodObjectShape(endpoint.body);
    const schema = objectSchema(swagger, request.schema);
    if (sendsMultipart && expectsMultipart && shape && schema) {
      compareFormFields(swagger, shape, schema, (text) =>
        problems.push(`${label}: ${text} (${where})`),
      );
      for (const required of schema.required) {
        const own = shape[camelCase(required)];
        if (!own)
          problems.push(
            `${label}: required form field "${camelCase(required)}" is not sent (${where})`,
          );
        else if (!isZodRequired(own))
          problems.push(
            `${label}: form field "${camelCase(required)}" is required by ${where} but optional in the zod schema`,
          );
      }
    } else if (!shape) {
      warnings.push(
        `${label}: request zod schema is not an object; body not compared`,
      );
    } else if (!schema || !Object.keys(schema.properties).length) {
      warnings.push(
        `${label}: ${where} request schema has no properties; body not compared`,
      );
    } else {
      // ASP.NET binds request properties case-insensitively.
      const swaggerNames = new Map(
        Object.keys(schema.properties).map((n) => [n.toLowerCase(), n]),
      );
      const sent = new Map(
        Object.entries(shape).map(([n, field]) => [
          n.toLowerCase(),
          { n, field },
        ]),
      );
      for (const { n } of sent.values()) {
        if (!swaggerNames.has(n.toLowerCase())) {
          problems.push(
            `${label}: request property "${n}" is not in the request schema (${where})`,
          );
        }
      }
      for (const required of schema.required) {
        const own = sent.get(required.toLowerCase());
        if (!own)
          problems.push(
            `${label}: required request property "${required}" is not sent (${where})`,
          );
        else if (!isZodRequired(own.field)) {
          problems.push(
            `${label}: request property "${own.n}" is required by ${where} but optional in the zod schema`,
          );
        }
      }
    }
  }

  const success = successResponse(operation);
  const downloads = endpoint.responseType === "blob";
  if (isBinaryResponse(success) && !downloads) {
    problems.push(
      `${label}: ${where} answers a file (${success.type}); declare responseType "blob"`,
    );
  } else if (downloads && success && !isBinaryResponse(success)) {
    problems.push(
      `${label}: declared responseType "blob" but ${where} answers ${success.type}`,
    );
  } else if (downloads && endpoint.response) {
    problems.push(
      `${label}: a file download has no zod response schema (it returns the file)`,
    );
  }

  if (endpoint.response && !downloads) {
    // A documented deviation (the real response differs from swagger) is reported, not failed.
    const responseProblems = endpoint.swaggerDeviation ? warnings : problems;
    const response = successResponse(operation);
    const shape = zodObjectShape(endpoint.response);
    const schema = response && objectSchema(swagger, response.schema);
    if (!shape) {
      warnings.push(
        `${label}: response zod schema is not an object; response not compared`,
      );
    } else if (!schema || !Object.keys(schema.properties).length) {
      warnings.push(
        `${label}: ${where} documents no response properties; response not compared`,
      );
    } else {
      compareResponseShape(
        swagger,
        shape,
        schema,
        "",
        (text) =>
          responseProblems.push(
            `${label}: ${text} (${where})` +
              (endpoint.swaggerDeviation
                ? `; known deviation: ${endpoint.swaggerDeviation}`
                : ""),
          ),
        findRule(PRESENT_ON_SUCCESS, method, route)?.fields,
      );
    }
  }

  return { problems, warnings };
}

async function findEndpointFiles() {
  const featuresDir = path.join(ROOT, "src", "features");
  const features = await readdir(featuresDir, { withFileTypes: true });
  const files = [];
  for (const feature of features.filter((entry) => entry.isDirectory())) {
    const file = path.join(featuresDir, feature.name, "api", "endpoints.js");
    try {
      await readFile(file);
      files.push(file);
    } catch {
      // Feature without an API layer yet.
    }
  }
  return files;
}

/** Line of `export const <name>`, else of the first line quoting the route. */
function lineOf(source, name, route) {
  const lines = source.split(/\r?\n/);
  let index = lines.findIndex((line) =>
    new RegExp(`export const ${name}\\b`).test(line),
  );
  if (index < 0) {
    index = lines.findIndex(
      (line) =>
        line.includes(`"${route}"`) ||
        line.includes(`'${route}'`) ||
        line.includes(`\`${route}\``),
    );
  }
  return index >= 0 ? index + 1 : 1;
}

/**
 * "| GET | `/api/x` | Policy: HR_Access | Action | Note |" rows of endpoint-inventory.md.
 * A row may name several routes ("`/api/tickets/{id}`, `/api/tickets/by-reference/{ref}`"), one
 * row each; a later one may name only its last part (`/resume`). A route may show its query
 * ("/api/admin/categories?departmentId="): the path is compared without it. "Same as above" in the access column takes the access of the row above.
 */
export function parseInventory(markdown) {
  const rows = [];
  let previous = null;
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(
      /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*((?:`[^`]+`[\s,]*)+)\|\s*([^|]+?)\s*\|/,
    );
    if (!match) continue;
    const access =
      /^same as above\b/i.test(match[3]) && previous ? previous : match[3];
    previous = access;
    let first = null;
    for (const [, route] of match[2].matchAll(/`([^`]+)`/g)) {
      const full = route.split("?")[0];
      const path = full.startsWith("/api/")
        ? full
        : first.replace(/\/[^/]+$/, full);
      first ??= path;
      rows.push({ method: match[1], path, access });
    }
  }
  return rows;
}

/**
 * Plain-language "Who" phrases of docs/api/endpoint-inventory.md, by role. A phrase such as
 * "unit head or deputy" names the role the server's organisation check is about (Head of Unit).
 */
const WHO_PHRASES = {
  "super admin": "SuperAdmin",
  "head of unit": "HeadOfUnit",
  "unit head or deputy": "HeadOfUnit",
  hod: "HOD",
  "hod of its department": "HOD",
  "case worker": "CaseWorker",
  requester: "Requester",
};

/**
 * Inventory access text to the table's form: a role list, "signedIn" or "anonymous".
 * Understands "Policy: X", "Roles: A, B", and the plain words the Service Desk inventory uses:
 * "anyone ..." (anonymous), "signed in ..." and "same people as above" (any signed-in person,
 * the service checks the rest), role phrases separated by commas ("Super Admin, Head of Unit"), and
 * a record's people ("requester, raiser, people copied, ...", "department staff, Super Admin",
 * "holder and unit head/deputy ...": any signed-in person, the service checks the record).
 */
export function inventoryAccess(text) {
  if (/^anyone who can see\b/i.test(text)) return "signedIn";
  if (/^(anonymous|anyone)\b/i.test(text)) return "anonymous";
  if (/^signed in\b/i.test(text) || /^same people as above$/i.test(text))
    return "signedIn";
  const policy = text.match(/^Policy:\s*(\S+)/);
  if (policy) return POLICIES[policy[1]] ?? `unknown policy ${policy[1]}`;
  const roles = text.match(/^Roles:\s*(.+)$/);
  if (roles)
    return roles[1]
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
  // Notes in brackets or after ";" say what the service checks on top ("(others 404)").
  const phrases = text
    .replace(/\([^)]*\)/g, "")
    .split(";")[0]
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  // The people around a record (the requester among others, the raiser, people copied, department
  // staff, the holder): any signed-in person, the service checks the record. Everyone holds
  // Requester, so "requester" alone stays the role.
  const recordPeople = [
    "raiser",
    "people copied",
    "department staff",
    "holder",
    "the assignee",
    "the requester",
  ];
  if (
    (phrases.includes("requester") && phrases.length > 1) ||
    phrases.some((phrase) => recordPeople.some((word) => phrase.includes(word)))
  )
    return "signedIn";
  if (phrases.every((phrase) => WHO_PHRASES[phrase]))
    return [...new Set(phrases.map((phrase) => WHO_PHRASES[phrase]))];
  return `unrecognised access "${text}"`;
}

function sameAccess(a, b) {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return a.length === b.length && a.every((role) => b.includes(role));
}

/**
 * Static checks of the access table: every route exists in swagger, every declared endpoint has an
 * expected role, no do-not-use route is declared, and the table matches the endpoint inventory.
 * @returns {{ problems: string[], warnings: string[] }}
 */
export function checkAccessTable(swagger, declared, inventoryRows) {
  const problems = [];
  const warnings = [];
  const index = indexPaths(swagger);
  const key = (method, route) => `${method} ${normalizePath(route)}`;
  const table = new Map(
    ACCESS_TABLE.map((entry) => [key(entry.method, entry.path), entry]),
  );

  for (const entry of ACCESS_TABLE) {
    const match = index.get(normalizePath(entry.path));
    if (!match || !match.item[entry.method.toLowerCase()]) {
      problems.push(
        `access table: ${entry.method} ${entry.path} is not in swagger.json`,
      );
    }
  }
  for (const { method, path: route, location } of declared) {
    if (!table.has(key(method, route))) {
      problems.push(
        `${location}  ${method} ${route} has no expected role in scripts/api-access.js`,
      );
    }
    const banned = DO_NOT_USE.find(
      (rule) => key(rule.method, rule.path) === key(method, route),
    );
    if (banned)
      problems.push(
        `${location}  ${method} ${route} must not be used: ${banned.why}`,
      );
  }
  if (!inventoryRows) return { problems, warnings };

  const inventory = new Map(
    inventoryRows.map((row) => [key(row.method, row.path), row]),
  );
  for (const entry of ACCESS_TABLE) {
    const row = inventory.get(key(entry.method, entry.path));
    if (!row) {
      warnings.push(
        `inventory: ${entry.method} ${entry.path} is not listed in endpoint-inventory.md`,
      );
      continue;
    }
    const actual = inventoryAccess(row.access);
    if (!sameAccess(entry.access, actual)) {
      problems.push(
        `inventory: ${entry.method} ${entry.path} expected ${describeAccess(entry.access)}, ` +
          `inventory says ${typeof actual === "string" ? actual : actual.join(", ")} ("${row.access}")`,
      );
    }
  }
  return { problems, warnings };
}

async function loadDeclaredEndpoints() {
  const declared = [];
  for (const file of await findEndpointFiles()) {
    const source = await readFile(file, "utf8");
    const module = await import(pathToFileURL(file).href);
    const relative = path.relative(ROOT, file).replaceAll("\\", "/");
    for (const [name, endpoint] of Object.entries(module).filter(
      ([, value]) => value?.[ENDPOINT_BRAND],
    )) {
      declared.push({
        endpoint,
        method: endpoint.method,
        path: endpoint.path,
        location: `${relative}:${lineOf(source, name, endpoint.path)}`,
        file: relative,
      });
    }
  }
  return declared;
}

async function readInventory() {
  const inventoryPath = path.resolve(
    process.env.SD_ENDPOINT_INVENTORY || DEFAULT_INVENTORY,
  );
  try {
    return {
      inventoryPath,
      rows: parseInventory(await readFile(inventoryPath, "utf8")),
    };
  } catch {
    return { inventoryPath, rows: null };
  }
}

async function main() {
  const swaggerPath = path.resolve(
    process.argv.slice(2).find((arg) => !arg.startsWith("--")) ||
      DEFAULT_SWAGGER,
  );
  let swagger;
  try {
    swagger = JSON.parse(await readFile(swaggerPath, "utf8"));
  } catch (error) {
    console.error(
      `check:api cannot read swagger.json at ${swaggerPath}: ${error.message}`,
    );
    process.exit(2);
  }

  const index = indexPaths(swagger);
  const declared = await loadDeclaredEndpoints();
  const files = new Set(declared.map((item) => item.file));
  let problemCount = 0;
  let warningCount = 0;
  const report = (location, problems, warnings) => {
    problems.forEach((problem) =>
      console.error(`MISMATCH ${location}${problem}`),
    );
    warnings.forEach((warning) =>
      console.warn(`WARN     ${location}${warning}`),
    );
    problemCount += problems.length;
    warningCount += warnings.length;
  };

  for (const { endpoint, location } of declared) {
    const { problems, warnings } = checkEndpoint(endpoint, swagger, index);
    report(`${location}  `, problems, warnings);
  }

  const { inventoryPath, rows } = await readInventory();
  if (!rows) {
    console.warn(
      `WARN     endpoint inventory not found at ${inventoryPath}; access table not compared with it ` +
        "(set SD_ENDPOINT_INVENTORY to its path).",
    );
    warningCount += 1;
  }
  const access = checkAccessTable(swagger, declared, rows);
  report("", access.problems, access.warnings);

  console.log(
    `check:api: ${declared.length} endpoint(s) in ${files.size} file(s), ${ACCESS_TABLE.length} access rule(s), ` +
      `against ${swaggerPath}: ${problemCount} mismatch(es), ${warningCount} warning(s).`,
  );
  process.exit(problemCount ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
// Live run: node scripts/check-api.js --live
// One role per run. Credentials from SD_CHECK_USERNAME / SD_CHECK_PASSWORD or a prompt; never
// stored. API base from SD_API_BASE (default http://localhost:5048). GET requests only.
// This script signs in with the Bearer token from the login body (the API accepts Bearer from
// scripts and skips the CSRF check for it). The web app itself never does this: it uses cookies.
// ---------------------------------------------------------------------------------------------

const DUMMY_ID = "00000000-0000-0000-0000-000000000000";
const WRITE_SKIP =
  "write check: the script never creates, changes or deletes backend data";

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function firstRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data?.data)) return body.data.data;
  return [];
}

/**
 * A real id for an organisation route: the unit or department this person runs, else the first in
 * the list. A role that must be refused then gets its 403 for a real id, not a 404 for a dummy one.
 */
async function realOrgId(scope, fetchJson) {
  const mine = (await fetchJson("/api/org/me", {})).body?.departments ?? [];
  const all = (await fetchJson("/api/org/departments", {})).body ?? [];
  const hod = mine.find((department) => department.isHod);
  if (scope === "department") return hod?.id ?? all[0]?.id;
  const led = mine
    .flatMap((department) => department.units)
    .find((unit) => unit.isHead || unit.isDeputy);
  const department = all.find((d) => d.id === hod?.id) ?? all[0];
  return led?.id ?? department?.units[0]?.id;
}

/** Plans the request for one GET entry, or explains why it is skipped. */
async function planRequest(entry, allowed, fetchJson) {
  const query = { ...(entry.probe ?? {}) };
  // A required query value taken from the first row of another list (for example departmentId).
  if (entry.queryFrom) {
    const { listPath, field, param } = entry.queryFrom;
    if (!allowed) {
      query[param] = DUMMY_ID;
    } else {
      const list = await fetchJson(listPath, {});
      if (list.status < 200 || list.status >= 300) {
        return {
          skip: `needs ${param} from GET ${listPath}, which answered ${list.status}`,
        };
      }
      const value = firstRows(list.body)[0]?.[field];
      if (!value)
        return {
          skip: `needs at least one row in GET ${listPath} (none found)`,
        };
      query[param] = value;
    }
  }
  const hasParams = /\{[^}]+\}/.test(entry.path);
  if (!hasParams) return { path: entry.path, query };
  if (entry.orgScope) {
    const value = await realOrgId(entry.orgScope, fetchJson);
    if (!value) return { skip: "needs a department or unit (none found)" };
    return { path: entry.path.replace(/\{[^}]+\}/, value), query };
  }
  // A role that must be refused is refused before any lookup, so no real data is needed.
  if (!allowed)
    return { path: entry.path.replace(/\{[^}]+\}/g, DUMMY_ID), query };
  if (!entry.idFrom)
    return { skip: entry.skip ?? "needs data for the path parameters" };

  const { listPath, field, listQuery } = entry.idFrom;
  const list = await fetchJson(listPath, listQuery);
  if (list.status < 200 || list.status >= 300) {
    return {
      skip: `needs an id from GET ${listPath}, which answered ${list.status}`,
    };
  }
  const value = firstRows(list.body)[0]?.[field];
  if (!value)
    return { skip: `needs at least one row in GET ${listPath} (none found)` };
  return {
    path: entry.path.replace(/\{[^}]+\}/, encodeURIComponent(value)),
    query,
  };
}

function printTable(rows) {
  const headers = ["Route", "Expected role", "Status", "Result", "Note"];
  const cells = rows.map((row) => [
    row.route,
    row.expected,
    String(row.status),
    row.result,
    row.note,
  ]);
  const widths = headers.map((header, i) =>
    Math.min(
      70,
      Math.max(header.length, ...cells.map((cell) => cell[i].length)),
    ),
  );
  const line = (values) =>
    values.map((value, i) => value.padEnd(widths[i])).join(" | ");
  console.log(line(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("-|-"));
  cells.forEach((cell) => console.log(line(cell)));
}

async function live() {
  const base = (process.env.SD_API_BASE || "http://localhost:5048").replace(
    /\/+$/,
    "",
  );
  const username = process.env.SD_CHECK_USERNAME || (await ask("Username: "));
  const password =
    process.env.SD_CHECK_PASSWORD || (await ask("Password: ", true));
  let token = null;

  // body: JSON; form: FormData (multipart, the browser-style boundary is set by fetch).
  const call = async (method, route, { query = {}, body, form } = {}) => {
    const url = new URL(base + route);
    Object.entries(query).forEach(([name, value]) =>
      url.searchParams.set(name, value),
    );
    const response = await fetch(url, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  };
  const fetchJson = (route, query) => call("GET", route, { query });

  const login = await call("POST", "/api/Auth/login", {
    body: { username, password },
  });
  if (login.status !== 200 || !login.body?.data?.accessToken) {
    console.error(
      `Sign-in failed (${login.status}): ${login.body?.message || login.body?.errors?.join(" ") || "no message"}`,
    );
    process.exit(2);
  }
  token = login.body.data.accessToken;
  const roles = login.body.data.user?.roles ?? [];
  console.log(
    `Signed in as ${username} against ${base}. Role(s) in the login response: ${roles.join(", ") || "none"}`,
  );
  console.log(
    "GET requests only; write checks are skipped. One role per run.\n",
  );

  const rows = [];
  for (const entry of ACCESS_TABLE) {
    const route = `${entry.method} ${entry.path}`;
    const expected = describeAccess(entry.access);
    const allowed = isAllowed(entry.access, roles);
    if (entry.refusedByDesign) {
      // Refused by design before anything is read or written: 400 for allowed roles, 403 otherwise.
      const probe = entry.refusedByDesign;
      let form;
      if (probe.file) {
        form = new FormData();
        form.append(
          probe.file.field,
          new Blob([probe.file.content], { type: probe.file.type }),
          probe.file.name,
        );
      }
      const { status, body } = await call(
        entry.method,
        entry.path.replace(/\{[^}]+\}/g, DUMMY_ID),
        {
          body: probe.file ? undefined : probe.body,
          form,
        },
      );
      const pass = allowed ? status === 400 : status === 403;
      rows.push({
        route,
        expected: `${expected} (expected 400 by design)`,
        status,
        result: pass ? "PASS" : "FAIL",
        note: allowed
          ? pass
            ? `refused: ${body?.message ?? "400"}`
            : "expected 400 (refused by design)"
          : pass
            ? "refused as expected"
            : "expected 403",
      });
      continue;
    }
    if (entry.badRequestProbe) {
      // A request the server must refuse before writing anything: 400 for allowed roles, 403 otherwise.
      // probe.path replaces a path template with concrete values when the route needs them.
      const probePath = entry.badRequestProbe.path ?? entry.path;
      const { status, body } = await call(entry.method, probePath, {
        body: entry.badRequestProbe.body,
        query: entry.badRequestProbe.query,
      });
      const pass = allowed ? status === 400 : status === 403;
      rows.push({
        route: `${route} (${entry.badRequestProbe.why})`,
        expected,
        status,
        result: pass ? "PASS" : "FAIL",
        note: allowed
          ? pass
            ? `refused: ${body?.message ?? "400"}`
            : "expected 400"
          : pass
            ? "refused as expected"
            : "expected 403",
      });
      rows.push({
        route,
        expected,
        status: "-",
        result: "SKIP",
        note: entry.skip ?? WRITE_SKIP,
      });
      continue;
    }
    // skipAlways: the service decides by organisation, not role, so no role can be probed.
    if (
      entry.method !== "GET" ||
      (entry.skip && (allowed || entry.skipAlways))
    ) {
      rows.push({
        route,
        expected,
        status: "-",
        result: "SKIP",
        note: entry.skip ?? "not a GET",
      });
      continue;
    }
    const plan = await planRequest(entry, allowed, fetchJson);
    if (plan.skip) {
      rows.push({
        route,
        expected,
        status: "-",
        result: "SKIP",
        note: plan.skip,
      });
      continue;
    }
    const { status, body } = await call("GET", plan.path, {
      query: plan.query,
    });
    let pass = allowed ? status >= 200 && status < 300 : status === 403;
    let note = allowed
      ? pass
        ? ""
        : "expected 2xx"
      : pass
        ? "refused as expected"
        : "expected 403";
    // Field check: the live answer must pass the schema the frontend uses.
    if (pass && allowed && entry.schema) {
      const parsed = entry.schema.safeParse(body);
      if (parsed.success) {
        note = "fields match the frontend schema";
      } else {
        pass = false;
        note = `fields differ: ${parsed.error.issues
          .slice(0, 3)
          .map(
            (issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`,
          )
          .join("; ")}`;
      }
    }
    rows.push({
      route,
      expected,
      status,
      result: pass ? "PASS" : "FAIL",
      note,
    });
  }

  await call("POST", "/api/Auth/logout");
  printTable(rows);
  const count = (result) => rows.filter((row) => row.result === result).length;
  console.log(
    `\nRole ${roles.join(", ")}: ${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("SKIP")} SKIP.`,
  );
  process.exit(count("FAIL") ? 1 : 0);
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  await (process.argv.includes("--live") ? live() : main());
}
