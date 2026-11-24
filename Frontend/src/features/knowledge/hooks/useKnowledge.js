import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { request } from "@/shared/lib/http";
import {
  createArticle,
  deleteArticle,
  getArticle,
  getKbOptions,
  listArticles,
  listManagedArticles,
  publishArticle,
  suggestArticles,
  unpublishArticle,
  updateArticle,
  voteArticle,
} from "../api/endpoints.js";

export const KB_PAGE_SIZE = 20;

export const kbKeys = {
  all: ["kb"],
  list: (query) => ["kb", "list", query],
  /** Drafts live only under this key and the article key, fetched only for writers. */
  manage: (query) => ["kb", "manage", query],
  options: ["kb", "options"],
  article: (id) => ["kb", "article", id],
  suggest: (categoryId, text) => ["kb", "suggest", categoryId, text],
};

/** Published articles. */
export function useArticles(query) {
  return useQuery({
    queryKey: kbKeys.list(query),
    queryFn: () => request(listArticles, { query }),
    placeholderData: keepPreviousData,
  });
}

/** The writer's articles, drafts included. Only for people with options (enabled). */
export function useManagedArticles(query, { enabled = true } = {}) {
  return useQuery({
    queryKey: kbKeys.manage(query),
    queryFn: () => request(listManagedArticles, { query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Departments I write for. A failure counts as none: no writing screens, nothing else breaks. */
export function useKbOptions() {
  return useQuery({
    queryKey: kbKeys.options,
    queryFn: () => request(getKbOptions),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** True when I write for at least one department. */
export function useIsKbWriter() {
  const options = useKbOptions();
  return (options.data?.length ?? 0) > 0;
}

export function useArticle(id) {
  return useQuery({
    queryKey: kbKeys.article(id),
    queryFn: () => request(getArticle, { params: { id } }),
    enabled: Boolean(id),
    retry: (count, error) => ![403, 404].includes(error?.status) && count < 2,
  });
}

/**
 * Suggestions for the raise form. Each (category, text) pair is its own query, so an answer that
 * comes back late for older text never shows for the newer text. Errors are silent.
 */
export function useArticleSuggestions(
  categoryId,
  text,
  { enabled = true } = {},
) {
  return useQuery({
    queryKey: kbKeys.suggest(categoryId, text),
    queryFn: () => request(suggestArticles, { query: { categoryId, text } }),
    // The last answer stays on screen while the next loads (no flicker); a late answer for older
    // text lands under its own key, never this one.
    placeholderData: keepPreviousData,
    enabled: enabled && Boolean(categoryId),
    retry: false,
    staleTime: 60 * 1000,
  });
}

/** After a change: the article (from the answer) and every list. */
function useSaved() {
  const queryClient = useQueryClient();
  return (article) => {
    if (article?.id)
      queryClient.setQueryData(kbKeys.article(article.id), article);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["kb", "list"] }),
      queryClient.invalidateQueries({ queryKey: ["kb", "manage"] }),
    ]);
  };
}

/** `mutateAsync({ id?, body })`: creates when there is no id. Resolves the article. */
export function useSaveArticle() {
  const saved = useSaved();
  return useMutation({
    mutationFn: ({ id, body }) =>
      id
        ? request(updateArticle, { params: { id }, body })
        : request(createArticle, { body }),
    onSuccess: saved,
  });
}

/** `mutateAsync({ id, publish })`: publish (true) or back to draft (false). */
export function usePublishArticle() {
  const saved = useSaved();
  return useMutation({
    mutationFn: ({ id, publish }) =>
      request(publish ? publishArticle : unpublishArticle, { params: { id } }),
    onSuccess: saved,
  });
}

export function useDeleteArticle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => request(deleteArticle, { params: { id } }),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: kbKeys.article(id) });
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["kb", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["kb", "manage"] }),
      ]);
    },
  });
}

/** `mutateAsync(helpful)`. The counts shown are always the ones the call returns. */
export function useVote(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (helpful) =>
      request(voteArticle, { params: { id }, body: { helpful } }),
    onSuccess: (counts) =>
      queryClient.setQueryData(kbKeys.article(id), (article) =>
        article ? { ...article, ...counts } : article,
      ),
  });
}
