import { beforeAll, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import ReplyBox from "./ReplyBox.jsx";

// The editor is a lazy chunk; load it before the first test so findBy does not wait on it.
beforeAll(() => import("@/shared/ui/RichTextEditorCore.jsx"), 60_000);

const TICKET_REPLIES = [
  {
    id: "r-1",
    isShared: false,
    title: "Statement sent",
    bodyHtml: "<p>Dear Ada, your statement for CP-2026-000001 is attached.</p>",
  },
  {
    id: "r-2",
    isShared: true,
    title: "Thank you",
    bodyHtml: "<p>Thank you for your patience.</p>",
  },
];

function renderReplyBox(routes = {}) {
  const queryClient = createTestQueryClient();
  const posted = [];
  installFakeApi(queryClient, {
    "GET /api/tickets/:ticketId/canned-replies": () => [200, TICKET_REPLIES],
    "POST /api/tickets/:ticketId/comments": (config) => {
      posted.push(config);
      return [200, {}];
    },
    ...routes,
  });
  renderWithProviders(
    <ReplyBox
      ticket={{ id: "t-1", isStaffView: true, canAddInternalNote: true }}
    />,
    { queryClient },
  );
  return posted;
}

const editor = () => document.getElementById("reply-body");

describe("Saved replies on a ticket", () => {
  it("fills an empty box with the chosen reply, adds at the cursor after that, and sends nothing", async () => {
    const user = userEvent.setup();
    const posted = renderReplyBox();
    await waitFor(() => expect(editor()).not.toBeNull());

    await user.click(await screen.findByRole("button", { name: "Replies" }));
    const panel = screen.getByRole("dialog", { name: "Saved replies" });
    // Unit replies first, shared after with a tag.
    const items = within(panel).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Statement sent");
    expect(within(items[1]).getByText("Shared")).toBeInTheDocument();

    // Search narrows the list.
    await user.type(
      within(panel).getByLabelText("Search replies"),
      "statement",
    );
    expect(within(panel).getAllByRole("listitem")).toHaveLength(1);
    await user.click(
      within(panel).getByRole("button", { name: /Statement sent/ }),
    );

    await waitFor(() =>
      expect(editor()).toHaveTextContent(
        "Dear Ada, your statement for CP-2026-000001 is attached.",
      ),
    );
    expect(
      screen.queryByRole("dialog", { name: "Saved replies" }),
    ).not.toBeInTheDocument();

    // A second reply goes in as well; the first one stays.
    await user.click(screen.getByRole("button", { name: "Replies" }));
    await user.click(screen.getByRole("button", { name: /Thank you/ }));
    await waitFor(() =>
      expect(editor()).toHaveTextContent("Thank you for your patience."),
    );
    expect(editor()).toHaveTextContent("your statement for CP-2026-000001");
    expect(posted).toEqual([]);
  });

  it("hides Replies when the server says the person is not staff for the ticket (404)", async () => {
    let asked = false;
    renderReplyBox({
      "GET /api/tickets/:ticketId/canned-replies": () => {
        asked = true;
        return [404, { message: "Ticket not found." }];
      },
    });
    await waitFor(() => expect(asked).toBe(true));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Replies" }),
      ).not.toBeInTheDocument(),
    );
  });
});
