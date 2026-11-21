import { beforeAll, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installFakeApi } from "@/test/fakeApi";
import { createTestQueryClient, renderWithProviders } from "@/test/render";
import SharedRepliesPage from "./pages/SharedRepliesPage.jsx";

// The editor is a lazy chunk; load it before the first test so findBy does not wait on it.
beforeAll(() => import("@/shared/ui/RichTextEditorCore.jsx"), 60_000);

describe("Shared library", () => {
  it("shows a 409 (title already used) on the title field", async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const sent = [];
    installFakeApi(queryClient, {
      "GET /api/admin/canned-replies": () => [200, []],
      "GET /api/canned-replies/placeholders": () => [
        200,
        [
          {
            token: "{{requester.name}}",
            description: "The person the ticket is for",
          },
        ],
      ],
      "POST /api/admin/canned-replies": (config) => {
        sent.push(config.body);
        return [409, { message: "A reply called Thank you already exists." }];
      },
    });
    renderWithProviders(<SharedRepliesPage />, { queryClient });
    expect(await screen.findByText("No saved replies yet")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Add reply" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add reply" });
    await user.type(within(dialog).getByLabelText("Title"), "Thank you");
    const body = await waitFor(() => {
      const element = document.getElementById("reply-library-body");
      expect(element).not.toBeNull();
      return element;
    });
    // A placeholder goes in at the cursor (here: the empty reply).
    await user.click(
      within(dialog).getByRole("button", { name: /\{\{requester\.name\}\}/ }),
    );
    await waitFor(() => expect(body).toHaveTextContent("{{requester.name}}"));

    await user.click(within(dialog).getByRole("button", { name: "Add reply" }));
    const title = within(dialog).getByLabelText("Title");
    await waitFor(() => expect(title).toHaveAttribute("aria-invalid", "true"));
    expect(title).toHaveAccessibleDescription(
      "A reply called Thank you already exists.",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("Thank you");
    expect(sent[0].bodyHtml).toContain("{{requester.name}}");
  });
});
