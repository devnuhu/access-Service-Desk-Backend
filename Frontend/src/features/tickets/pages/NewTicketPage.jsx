import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchPeople } from "@/features/admin-people";
import { useSession } from "@/features/auth";
import { PRIORITY, PRIORITY_LABELS, useCatalogue } from "@/features/catalogue";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { fieldError } from "@/shared/lib/http";
import {
  isRichTextEmpty,
  RICH_TEXT_MAX,
  RSA_PIN,
  richTextToText,
} from "@/shared/lib/richText";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";
import {
  Button,
  Card,
  ConfirmDialog,
  FilePicker,
  PersonPicker,
  RichTextEditor,
  Spinner,
  useToast,
} from "@/shared/ui";
import CategoryCombobox from "../components/CategoryCombobox.jsx";
import CcField from "../components/CcField.jsx";
import DuplicateBox from "../components/DuplicateBox.jsx";
import {
  checkForDuplicates,
  useCreateTicket,
  useLocationChoices,
} from "../hooks/useTickets.js";
import { draftKey } from "../ticketText.js";

const SUBJECT_MAX = 200;
const SUBJECT_COUNTER_FROM = 150;

/** Field order on the page: the first one with a problem gets the focus. */
const FIELDS = [
  "categoryId",
  "priority",
  "locationId",
  "subject",
  "descriptionHtml",
  "files",
  "ccUserIds",
  "requesterUserId",
];

const EMPTY = {
  departmentId: "",
  categoryId: "",
  priority: PRIORITY.Medium,
  priorityTouched: false,
  locationId: "",
  locationTouched: false,
  subject: "",
  descriptionHtml: "",
  cc: [],
  raiseFor: false,
  requester: null,
};

function readDraft(key) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function writeDraft(key, form) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(form));
  } catch {
    // Storage full or blocked: the draft is a convenience only.
  }
}

function clearDraft(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Blocked storage has nothing to clear.
  }
}

const inputClass = (invalid) =>
  `mt-1 h-10 w-full rounded-[6px] border bg-white px-3 text-sm text-ink ${invalid ? "border-danger" : "border-line"}`;

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs font-medium text-danger">
      {message}
    </p>
  );
}

/** Raise a ticket (/tickets/new). */
export default function NewTicketPage() {
  const { user } = useSession();
  const catalogue = useCatalogue();

  if (catalogue.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the categories…" />
      </div>
    );
  }
  if (catalogue.isError) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {catalogue.error.message}
      </p>
    );
  }
  return (
    <TicketForm
      key={user.id}
      user={user}
      departments={catalogue.data.filter((d) => d.categories.length)}
    />
  );
}

function TicketForm({ user, departments }) {
  const navigate = useNavigate();
  const toast = useToast();
  const createTicket = useCreateTicket();
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  const storageKey = draftKey(user.id);
  const formRef = useRef(null);

  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...readDraft(storageKey),
  }));
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [checking, setChecking] = useState(false);
  const [duplicates, setDuplicates] = useState({ key: "", matches: [] });

  // A change clears the errors of the fields it touches (and of any field named in alsoClear).
  const set = (changes, ...alsoClear) => {
    setForm((current) => ({ ...current, ...changes }));
    const touched = [...Object.keys(changes), ...alsoClear].filter(
      (name) => errors[name],
    );
    if (touched.length) {
      setErrors((current) => {
        const next = { ...current };
        touched.forEach((name) => delete next[name]);
        return next;
      });
    }
  };

  // Department: hidden while there is only one (today).
  const department =
    departments.find((d) => d.departmentId === form.departmentId) ??
    (departments.length === 1 ? departments[0] : null);
  const categories = department?.categories ?? [];
  const category = categories.find((c) => c.id === form.categoryId) ?? null;
  const priority = form.priorityTouched
    ? form.priority
    : (category?.defaultPriority ?? PRIORITY.Medium);

  // Location: the person's default (their last ticket) until the user picks one. Raising for someone
  // else reloads the choices with forUserId, so the default is theirs.
  const forUserId =
    isSuperAdmin && form.raiseFor && form.requester
      ? form.requester.id
      : undefined;
  const locations = useLocationChoices(forUserId);
  const locationList = locations.data?.locations ?? [];
  const locationId =
    form.locationTouched &&
    locationList.some((location) => location.id === form.locationId)
      ? form.locationId
      : (locations.data?.defaultLocationId ?? "");

  const hasContent = Boolean(
    form.categoryId ||
    form.subject.trim() ||
    !isRichTextEmpty(form.descriptionHtml) ||
    form.cc.length ||
    form.requester ||
    files.length,
  );

  // Draft (not the files) in session storage while typing.
  useEffect(() => {
    if (hasContent) writeDraft(storageKey, form);
  }, [form, hasContent, storageKey]);

  // Duplicate check: a category and something like PEN + 12 digits, 800 ms after typing stops.
  const descriptionText = richTextToText(form.descriptionHtml);
  const hasPin = RSA_PIN.test(`${form.subject} ${descriptionText}`);
  const checkKey =
    form.categoryId && hasPin
      ? JSON.stringify({
          categoryId: form.categoryId,
          subject: form.subject,
          descriptionHtml: form.descriptionHtml,
        })
      : "";
  const debouncedKey = useDebouncedValue(checkKey, 800);
  useEffect(() => {
    if (!debouncedKey) return undefined;
    let gone = false;
    checkForDuplicates(JSON.parse(debouncedKey))
      .then((result) => {
        if (!gone)
          setDuplicates({ key: debouncedKey, matches: result.matches });
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [debouncedKey]);
  const matches = checkKey ? duplicates.matches : [];

  const focusField = (name) => {
    const wrapper = formRef.current?.querySelector(`[data-field="${name}"]`);
    wrapper?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    wrapper
      ?.querySelector(
        '[contenteditable="true"], input:not([type="file"]), select, button',
      )
      ?.focus({ preventScroll: true });
  };

  const validate = () => {
    const found = {};
    if (!form.categoryId || !category) found.categoryId = "Choose a category.";
    if (!locationId) found.locationId = "Choose a location.";
    const subject = form.subject.trim();
    if (subject.length < 3 || subject.length > SUBJECT_MAX)
      found.subject = `Use 3 to ${SUBJECT_MAX} characters.`;
    if (isRichTextEmpty(form.descriptionHtml))
      found.descriptionHtml = "Describe the request.";
    else if (form.descriptionHtml.length > RICH_TEXT_MAX)
      found.descriptionHtml =
        "The text is too long. Attach large tables as files.";
    if (isSuperAdmin && form.raiseFor && !form.requester)
      found.requesterUserId = "Choose the person this ticket is for.";
    return found;
  };

  const showErrors = (found) => {
    setErrors(found);
    const first = FIELDS.find((name) => found[name]);
    if (first) focusField(first);
  };

  const submit = async (event) => {
    event.preventDefault();
    setFailure(null);
    const found = validate();
    if (Object.keys(found).length) {
      showErrors(found);
      return;
    }

    // Once more before sending: a duplicate the person has not seen yet stops the first click.
    if (checkKey) {
      setChecking(true);
      try {
        const result = await checkForDuplicates(JSON.parse(checkKey));
        setDuplicates({ key: checkKey, matches: result.matches });
        const seen = new Set(matches.map((match) => match.reference));
        if (result.matches.some((match) => !seen.has(match.reference))) {
          formRef.current
            ?.querySelector('[data-testid="duplicate-box"]')
            ?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          return;
        }
      } catch {
        // The check is advice only; raising goes ahead.
      } finally {
        setChecking(false);
      }
    }

    try {
      const created = await createTicket.mutateAsync({
        categoryId: form.categoryId,
        locationId,
        priority,
        subject: form.subject.trim(),
        descriptionHtml: form.descriptionHtml,
        ccUserIds: isSuperAdmin ? form.cc.map((person) => person.id) : [],
        requesterUserId: forUserId,
        files,
      });
      clearDraft(storageKey);
      toast.success(`Ticket ${created.reference} raised.`);
      navigate(`/tickets/${created.reference}`);
    } catch (error) {
      const server = {};
      for (const name of FIELDS) {
        const message = fieldError(error, name);
        if (message) server[name] = message;
      }
      if (Object.keys(server).length) showErrors(server);
      else setFailure(error.message);
    }
  };

  const leave = () => {
    clearDraft(storageKey);
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate("/tickets");
  };

  const busy = checking || createTicket.isPending;
  const subjectLength = form.subject.trim().length;
  const describe = (...ids) => ids.filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Raise a ticket</h1>
        <p className="mt-1 text-sm text-muted">
          Choose a category and describe what you need. You can follow it under
          My requests.
        </p>
      </div>

      <Card className="p-5 sm:p-6">
        <form
          ref={formRef}
          onSubmit={submit}
          noValidate
          aria-label="Raise a ticket"
          className="space-y-5"
        >
          {failure && (
            <p
              role="alert"
              className="rounded-[6px] border border-danger bg-danger-light px-3 py-2 text-sm text-danger"
            >
              {failure}
            </p>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            {departments.length > 1 && (
              <div>
                <label
                  htmlFor="ticket-department"
                  className="block text-sm font-semibold text-ink"
                >
                  Department
                </label>
                <select
                  id="ticket-department"
                  value={department?.departmentId ?? ""}
                  onChange={(event) =>
                    set({ departmentId: event.target.value, categoryId: "" })
                  }
                  className={inputClass(false)}
                >
                  {!department && <option value="">Choose a department</option>}
                  {departments.map((d) => (
                    <option key={d.departmentId} value={d.departmentId}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div
              data-field="categoryId"
              className={departments.length > 1 ? "" : "md:col-span-2"}
            >
              <label
                htmlFor="ticket-category"
                className="block text-sm font-semibold text-ink"
              >
                Category
              </label>
              <CategoryCombobox
                id="ticket-category"
                categories={categories}
                value={form.categoryId}
                onChange={(categoryId) => set({ categoryId })}
                invalid={Boolean(errors.categoryId)}
                describedBy={describe(
                  category?.description && "ticket-category-description",
                  errors.categoryId && "ticket-category-error",
                )}
                disabled={!department}
              />
              {category?.description && (
                <p
                  id="ticket-category-description"
                  className="mt-1 text-xs text-muted"
                >
                  {category.description}
                </p>
              )}
              <FieldError
                id="ticket-category-error"
                message={errors.categoryId}
              />
            </div>

            <div data-field="priority">
              <label
                htmlFor="ticket-priority"
                className="block text-sm font-semibold text-ink"
              >
                Priority
              </label>
              <select
                id="ticket-priority"
                value={priority}
                onChange={(event) =>
                  set({
                    priority: Number(event.target.value),
                    priorityTouched: true,
                  })
                }
                aria-invalid={errors.priority ? "true" : undefined}
                aria-describedby={describe(
                  errors.priority && "ticket-priority-error",
                )}
                className={inputClass(errors.priority)}
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <FieldError
                id="ticket-priority-error"
                message={errors.priority}
              />
            </div>

            <div data-field="locationId">
              <label
                htmlFor="ticket-location"
                className="block text-sm font-semibold text-ink"
              >
                Location
              </label>
              <select
                id="ticket-location"
                value={locationId}
                onChange={(event) =>
                  set({ locationId: event.target.value, locationTouched: true })
                }
                disabled={locations.isLoading}
                aria-invalid={errors.locationId ? "true" : undefined}
                aria-describedby={describe(
                  errors.locationId && "ticket-location-error",
                )}
                className={inputClass(errors.locationId)}
              >
                {!locationId && (
                  <option value="">
                    {locations.isLoading ? "Loading…" : "Choose a location"}
                  </option>
                )}
                {locationList.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
              {locations.isError && (
                <FieldError
                  id="ticket-location-load"
                  message={locations.error.message}
                />
              )}
              <FieldError
                id="ticket-location-error"
                message={errors.locationId}
              />
            </div>
          </div>

          <div data-field="subject">
            <label
              htmlFor="ticket-subject"
              className="block text-sm font-semibold text-ink"
            >
              Subject
            </label>
            <input
              id="ticket-subject"
              value={form.subject}
              onChange={(event) => set({ subject: event.target.value })}
              maxLength={SUBJECT_MAX + 50}
              autoComplete="off"
              aria-invalid={errors.subject ? "true" : undefined}
              aria-describedby={describe(
                subjectLength >= SUBJECT_COUNTER_FROM && "ticket-subject-count",
                errors.subject && "ticket-subject-error",
              )}
              className={inputClass(errors.subject)}
            />
            {subjectLength >= SUBJECT_COUNTER_FROM && (
              <p
                id="ticket-subject-count"
                className={`mt-1 text-right text-xs ${subjectLength > SUBJECT_MAX ? "font-medium text-danger" : "text-muted"}`}
              >
                {subjectLength} of {SUBJECT_MAX} characters
              </p>
            )}
            <FieldError id="ticket-subject-error" message={errors.subject} />
          </div>

          <div data-field="descriptionHtml">
            <p
              id="ticket-description-label"
              className="text-sm font-semibold text-ink"
            >
              Description
            </p>
            <div className="mt-1">
              <RichTextEditor
                id="ticket-description"
                value={form.descriptionHtml}
                onChange={(descriptionHtml) => set({ descriptionHtml })}
                labelledBy="ticket-description-label"
                describedBy={describe(
                  errors.descriptionHtml && "ticket-description-error",
                )}
                invalid={Boolean(errors.descriptionHtml)}
                placeholder="What do you need? Include the RSA PIN, employer and amounts where they matter."
              />
            </div>
            <FieldError
              id="ticket-description-error"
              message={errors.descriptionHtml}
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div data-field="files">
              <FilePicker
                id="ticket-files"
                files={files}
                onChange={(next) => {
                  setFiles(next);
                  if (errors.files)
                    setErrors((e) => ({ ...e, files: undefined }));
                }}
                error={errors.files}
                disabled={busy}
              />
            </div>
            {isSuperAdmin && (
              <div data-field="ccUserIds">
                <CcField
                  people={form.cc}
                  onChange={(cc) => set({ cc }, "ccUserIds")}
                  search={searchPeople}
                  error={errors.ccUserIds}
                  exclude={form.requester ? [form.requester.id] : []}
                />
              </div>
            )}
          </div>

          {isSuperAdmin && (
            <fieldset
              data-field="requesterUserId"
              className="rounded-[6px] border border-line p-4"
            >
              <legend className="px-1 text-sm font-semibold text-ink">
                Super Admin
              </legend>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.raiseFor}
                  onChange={(event) =>
                    set(
                      {
                        raiseFor: event.target.checked,
                        requester: null,
                        locationTouched: false,
                      },
                      "requesterUserId",
                    )
                  }
                  className="h-4 w-4"
                />
                Raise for someone else
              </label>
              {form.raiseFor && (
                <div className="mt-3">
                  {form.requester ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] bg-page px-3 py-2">
                      <div className="text-sm">
                        <span className="font-semibold text-ink">
                          For{" "}
                          {form.requester.fullName || form.requester.userName}
                        </span>
                        <span className="block text-xs text-muted">
                          {[form.requester.userName, form.requester.department]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          set({ requester: null, locationTouched: false })
                        }
                      >
                        Change
                      </Button>
                    </div>
                  ) : (
                    <PersonPicker
                      label="Who is it for?"
                      search={searchPeople}
                      onSelect={(person) =>
                        set(
                          {
                            requester: person,
                            locationTouched: false,
                            cc: form.cc.filter((p) => p.id !== person.id),
                          },
                          "requesterUserId",
                        )
                      }
                      exclude={[user.id]}
                      queryKey={["tickets", "requester-search"]}
                    />
                  )}
                </div>
              )}
              <FieldError
                id="ticket-requester-error"
                message={errors.requesterUserId}
              />
            </fieldset>
          )}

          <DuplicateBox matches={matches} />

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button
              variant="secondary"
              onClick={() => (hasContent ? setConfirmCancel(true) : leave())}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              busy={busy}
              busyText={checking ? "Checking…" : "Raising…"}
            >
              {matches.length ? "Raise anyway" : "Raise ticket"}
            </Button>
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        title="Discard this ticket?"
        message="What you typed and chose will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={leave}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
