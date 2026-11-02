import { createContext, useContext } from "react";

/** @typedef {"success" | "error" | "info" | "action"} ToastTone */

export const ToastContext = createContext(null);

/**
 * toast.success(text), toast.error(text), toast.info(text, { title }), toast.action(text, { title }).
 */
export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used inside <ToastProvider>.");
  return toast;
}
