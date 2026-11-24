import { describe, expect, it, vi } from "vitest";
import {
  act,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { LIST_PAGE_SIZE, pageCount, pageWindow } from "@/shared/lib/paging";
import Pager from "./Pager.jsx";

describe("paging helpers", () => {
  it("lists show 10 rows a page", () => {
    expect(LIST_PAGE_SIZE).toBe(10);
    expect(pageCount(134)).toBe(14);
    expect(pageCount(10)).toBe(1);
    expect(pageCount(0)).toBe(1);
  });

  it("shows the first, the last and the neighbours of the current page, with gaps", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 5)).toEqual([1, 2, null, 5]);
    expect(pageWindow(5, 14)).toEqual([1, null, 4, 5, 6, null, 14]);
    // A gap of one page shows that page instead of "…".
    expect(pageWindow(3, 14)).toEqual([1, 2, 3, 4, null, 14]);
    expect(pageWindow(14, 14)).toEqual([1, null, 13, 14]);
  });
});

describe("Pager", () => {
  it('says "Showing 1-10 of 134" from the total, with Previous, page numbers and Next', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    render(<Pager total={134} page={1} onPage={onPage} />);
    expect(screen.getByTestId("pager-summary")).toHaveTextContent(
      "Showing 1-10 of 134",
    );
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(
      within(nav)
        .getAllByRole("button", { name: /^Page \d+$/ })
        .map((b) => b.textContent),
    ).toEqual(["1", "2", "14"]);
    expect(within(nav).getByRole("button", { name: "Page 1" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(nav).getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    await user.click(within(nav).getByRole("button", { name: "Next page" }));
    await user.click(within(nav).getByRole("button", { name: "Page 14" }));
    expect(onPage.mock.calls).toEqual([[2], [14]]);
  });

  it("the last page shows its own range, and Next is off", () => {
    render(<Pager total={134} page={14} onPage={() => {}} />);
    expect(screen.getByTestId("pager-summary")).toHaveTextContent(
      "Showing 131-134 of 134",
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("one page: the count only; no rows: nothing", () => {
    const { rerender } = render(<Pager total={7} page={1} onPage={() => {}} />);
    expect(screen.getByTestId("pager-summary")).toHaveTextContent(
      "Showing 1-7 of 7",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    rerender(<Pager total={0} page={1} onPage={() => {}} />);
    expect(screen.queryByTestId("pager")).toBeNull();
  });
});

describe("usePaging", () => {
  it("goes back to page 1 when the search or a filter changes", () => {
    const { result, rerender } = renderHook(({ key }) => usePaging(key), {
      initialProps: { key: "|open" },
    });
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);
    rerender({ key: "refund|open" });
    expect(result.current.page).toBe(1);
  });

  it("moves to the last page that exists when the total shrinks (the last rows were deleted)", () => {
    const { result, rerender } = renderHook(
      ({ total }) => {
        const paging = usePaging("same");
        useLastPageClamp(paging, total);
        return paging;
      },
      { initialProps: { total: 31 } },
    );
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);
    rerender({ total: 30 });
    expect(result.current.page).toBe(3);
    // Unknown total (still loading): the page stays.
    rerender({ total: undefined });
    expect(result.current.page).toBe(3);
    // Nothing left: page 1.
    rerender({ total: 0 });
    expect(result.current.page).toBe(1);
  });
});
