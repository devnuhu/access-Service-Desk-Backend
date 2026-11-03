import { useState } from "react";
import { Search } from "lucide-react";
import { Button, Dialog, Spinner, useToast } from "@/shared/ui";
import {
  useDirectorySearch,
  useEnsureDirectoryUser,
} from "../hooks/usePeople.js";

/** Search the staff directory and create a local account, so roles can be given before the first sign-in. */
export default function AddFromDirectoryDialog({ open, onClose, onAdded }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const search = useDirectorySearch(query);
  const ensure = useEnsureDirectoryUser();
  const [addingId, setAddingId] = useState(null);

  const close = () => {
    setText("");
    setQuery("");
    onClose();
  };

  const add = async (person) => {
    setAddingId(person.samAccountName);
    try {
      const result = await ensure.mutateAsync(person.samAccountName);
      toast.success(
        result.created ? "Account created" : "Already has an account",
      );
      close();
      onAdded(result.userId, result);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add from directory"
      description="Find a staff member by name, login name or email."
    >
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(text.trim());
        }}
      >
        <label htmlFor="directory-search" className="sr-only">
          Search the directory
        </label>
        <input
          id="directory-search"
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={256}
          placeholder="Name, login name or email"
          className="h-10 flex-1 rounded-[6px] border border-line px-3 text-sm text-ink"
        />
        <Button type="submit" variant="secondary" disabled={!text.trim()}>
          <Search aria-hidden="true" size={16} />
          Search
        </Button>
      </form>

      <div className="mt-4" aria-live="polite">
        {search.isFetching ? (
          <Spinner label="Searching…" />
        ) : search.isError ? (
          <p
            role="alert"
            className="rounded-[6px] border border-brand-orange/40 bg-brand-orange-light px-3 py-2 text-sm text-brand-orange-ink"
          >
            {search.error.message}
          </p>
        ) : search.data?.length === 0 ? (
          <p className="text-sm text-muted">No one matches “{query}”.</p>
        ) : (
          <ul className="divide-y divide-line">
            {(search.data ?? []).map((person) => (
              <li
                key={person.samAccountName ?? person.distinguishedName}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {person.displayName}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[person.samAccountName, person.department, person.jobTitle]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => add(person)}
                  disabled={
                    !person.samAccountName ||
                    (ensure.isPending && addingId !== person.samAccountName)
                  }
                  busy={addingId === person.samAccountName}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
