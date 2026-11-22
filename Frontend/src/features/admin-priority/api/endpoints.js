import { z } from "zod";
import { priorityMatrixSchema } from "../../catalogue/api/endpoints.js";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/**
 * Super Admin: change the cells sent (each impact and urgency pair at most once). A cell sent at
 * its built-in default goes back to "not edited". Answers the whole matrix. Affects tickets raised
 * from now on. 400 a bad cell; 403 not Super Admin.
 */
export const savePriorityMatrix = defineEndpoint({
  method: "PUT",
  path: "/api/admin/priority-matrix",
  body: z.object({
    cells: z
      .array(
        z.object({
          impact: z.number().int().min(1).max(4),
          urgency: z.number().int().min(1).max(4),
          priority: z.number().int().min(1).max(4),
        }),
      )
      .min(1),
  }),
  response: priorityMatrixSchema,
});
