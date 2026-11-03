import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import TicketPage from "./TicketPage.jsx";

const person = (userId, fullName) => ({
  userId,
  userName: fullName.toLowerCase().replace(" ", "."),
  fullName,
});
const REQUESTER = person("u-req", "Rita Requester");
const HOU = person("u-hou", "Hassan Head");

const file = (id, fileName, commentId = null) => ({
  id,
  commentId,
  fileName,
  contentType: "application/pdf",
  sizeBytes: 2048,
  uploadedBy: REQUESTER,
  uploadedAt: "2026-11-03T09:00:00Z",
});

const ticket = (overrides = {}) => ({
  id: "t-1",
  reference: "CP-2026-000001",
  subject: "Balance does not agree",
  departmentCode: "CP",
  categoryName: "Account Reconciliation",
  unitName: "Contribution Matching",
  locationName: "HQ",
  priority: 2,
  status: 1,
  requester: REQUESTER,
  assignee: null,
  createdAt: "2026-11-03T09:00:00Z",
  updatedAt: null,
  departmentId: "d-cp",
  departmentName: "Contribution Processing",
  categoryId: "c-ar",
  unitId: "u-cm",
  locationId: "l-hq",
  requesterDepartment: "Operations",
  raisedBy: REQUESTER,
  descriptionHtml:
    "<p><strong>Bold line</strong></p><table><tbody><tr><th>A</th></tr><tr><td>1</td></tr></tbody></table>",
  cc: [],
  attachments: [file("f-1", "Statement.pdf")],
  comments: [],
  isStaffView: false,
  canComment: true,
  canAddInternalNote: false,
  ...overrides,
});

function renderTicket(routes, route = "/tickets/CP-2026-000001") {
  const queryClient = createTestQueryClient();
  const api = installFakeApi(queryClient, routes);
  renderWithProviders(
    <Routes>
      <Route path="/tickets/:reference" element={<TicketPage />} />
      <Route path="/tickets/id/:id" element={<TicketPage />} />
    </Routes>,
    { route, queryClient },
  );
  return api;
}

afterEach(() => vi.restoreAllMocks());

describe("Ticket page", () => {
  it("a requester sees no internal-note toggle and replies publicly", async () => {
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [200, ticket()],
    });
    expect(
      await screen.findByRole("heading", { name: "Balance does not agree" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Waiting for assignment")).toBeInTheDocument();
    expect(screen.getByText("Bold line").tagName).toBe("STRONG");
    expect(document.querySelector(".rich-text table th")).toHaveTextContent(
      "A",
    );
    expect(
      screen.queryByRole("radiogroup", { name: "Who sees it" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Send reply" }),
    ).toBeInTheDocument();
  });

  it("staff default to Internal note; an internal note shows with the Internal chip", async () => {
    const user = userEvent.setup();
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [
        200,
        ticket({
          isStaffView: true,
          canAddInternalNote: true,
          raisedBy: person("u-sa", "Sade Admin"),
          comments: [
            {
              id: "cm-1",
              author: HOU,
              bodyHtml: "<p>Checked the ledger.</p>",
              isInternal: true,
              createdAt: "2026-11-03T10:00:00Z",
              attachments: [file("f-2", "Ledger.pdf", "cm-1")],
            },
            {
              id: "cm-2",
              author: HOU,
              bodyHtml: "<p>We are on it.</p>",
              isInternal: false,
              createdAt: "2026-11-03T10:05:00Z",
              attachments: [],
            },
          ],
        }),
      ],
    });
    const group = await screen.findByRole("radiogroup", {
      name: "Who sees it",
    });
    expect(
      within(group).getByRole("radio", { name: "Internal note" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      await screen.findByRole("button", { name: "Add internal note" }),
    ).toBeInTheDocument();

    const note = screen.getByTestId("comment-cm-1");
    expect(within(note).getByText("Internal")).toBeInTheDocument();
    expect(note).toHaveAttribute("data-internal", "true");
    expect(
      within(note).getByRole("button", { name: /Download Ledger.pdf/ }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("comment-cm-2")).queryByText("Internal"),
    ).not.toBeInTheDocument();
    // Raised for someone else.
    expect(screen.getByText(/Sade Admin for/)).toBeInTheDocument();

    await user.click(
      within(group).getByRole("radio", { name: "Public reply" }),
    );
    expect(
      screen.getByRole("button", { name: "Send reply" }),
    ).toBeInTheDocument();
  });

  it("a 404 shows the not-found card", async () => {
    renderTicket(
      {
        "GET /api/tickets/by-reference/:reference": () => [
          404,
          { message: "Ticket not found." },
        ],
      },
      "/tickets/CP-2026-999999",
    );
    expect(
      await screen.findByText(
        "Ticket not found, or you do not have access to it.",
      ),
    ).toBeInTheDocument();
  });

  it("downloads through the HTTP client as a blob and saves under the server's file name", async () => {
    const user = userEvent.setup();
    const created = [];
    URL.createObjectURL = vi.fn((blob) => {
      created.push(blob);
      return "blob:file-1";
    });
    URL.revokeObjectURL = vi.fn();
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function click() {
        clicked.push({ href: this.href, download: this.download });
      },
    );
    let downloadConfig;
    renderTicket({
      "GET /api/tickets/by-reference/:reference": () => [200, ticket()],
      "GET /api/tickets/:ticketId/attachments/:attachmentId": (config) => {
        downloadConfig = config;
        return [
          200,
          new Blob(["%PDF-1.7"], { type: "application/pdf" }),
          {
            "content-disposition": 'attachment; filename="Statement final.pdf"',
          },
        ];
      },
    });
    await user.click(
      await screen.findByRole("button", {
        name: "Download Statement.pdf (2 KB)",
      }),
    );
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(downloadConfig.url).toBe("/api/tickets/t-1/attachments/f-1");
    expect(downloadConfig.responseType).toBe("blob");
    expect(downloadConfig.withCredentials).toBe(true);
    expect(created[0]).toBeInstanceOf(Blob);
    expect(clicked[0]).toEqual({
      href: "blob:file-1",
      download: "Statement final.pdf",
    });
  });

  it("loads by id at /tickets/id/:id; a closed ticket takes no replies", async () => {
    renderTicket(
      {
        "GET /api/tickets/:ticketId": () => [
          200,
          ticket({ status: 7, canComment: false }),
        ],
      },
      "/tickets/id/t-1",
    );
    expect(
      await screen.findByText("This ticket is closed."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Reply" }),
    ).not.toBeInTheDocument();
  });
});
