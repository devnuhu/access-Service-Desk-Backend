import { createContext, useContext } from "react";

/**
 * Set by the app layout: `eyebrow` (where the page sits: its menu section, or the menu item a
 * detail page belongs to) and `setHeader` ({ title, trail }: the page's title and, when the menu
 * cannot know it, the trail above it, for the breadcrumbs in the top bar).
 * Null outside the layout (tests, sign-in).
 */
export const PageContext = createContext(null);

export const usePageContext = () => useContext(PageContext);
