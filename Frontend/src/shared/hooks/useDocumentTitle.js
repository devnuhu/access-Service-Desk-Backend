import { useEffect } from "react";
import { pageTitle } from "../brand.js";

/** Sets the browser tab: "Access Desk" when `page` is empty, otherwise "<page> · Access Desk". */
export default function useDocumentTitle(page) {
  useEffect(() => {
    document.title = pageTitle(page);
  }, [page]);
}
