import { useEffect } from "react";
import { pageTitle } from "../brand.js";

/** Sets the browser tab: "Servio" when `page` is empty, otherwise "<page> · Servio". */
export default function useDocumentTitle(page) {
  useEffect(() => {
    document.title = pageTitle(page);
  }, [page]);
}
