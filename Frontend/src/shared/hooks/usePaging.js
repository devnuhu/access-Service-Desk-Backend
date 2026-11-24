import { useEffect, useState } from "react";
import { pageCount } from "@/shared/lib/paging";

/**
 * The page of a server-paged list. `resetKey` is the search and filters as one string: when it
 * changes the list goes back to page 1. Give `total` (the server's count, once known) so that a page
 * that no longer exists (the last row of the last page was deleted) moves to the last one that does.
 *
 *   const paging = usePaging(`${search}|${status}`);
 *   const list = useList({ ..., page: paging.page, pageSize: LIST_PAGE_SIZE });
 *   useLastPageClamp(paging, list.data?.total);
 */
export default function usePaging(resetKey) {
  const [state, setState] = useState({ page: 1, key: resetKey });
  const page = state.key === resetKey ? state.page : 1;
  const setPage = (next) =>
    setState({ page: Math.max(1, next), key: resetKey });
  return { page, setPage };
}

/** Moves to the last page when the server says the current one is past the end. */
export function useLastPageClamp({ page, setPage }, total, pageSize) {
  const last = total == null ? null : pageCount(total, pageSize);
  useEffect(() => {
    if (last != null && page > last) setPage(last);
    // setPage is a new function each render; page and last decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, last]);
}
