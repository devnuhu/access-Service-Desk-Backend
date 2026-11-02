import { useState } from "react";
import { ChevronLeft, ChevronRight, Search, UserPlus } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { ROLE_ORDER, roleLabel } from "@/shared/lib/roles";
import { formatWat } from "@/shared/lib/time";
import { Button, Card, Chip, RoleChips, Spinner } from "@/shared/ui";
import { PAGE_SIZE, usePeopleList } from "../hooks/usePeople.js";
import PersonPanel from "../components/PersonPanel.jsx";
import AddFromDirectoryDialog from "../components/AddFromDirectoryDialog.jsx";

function StatusCell({ person }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <Chip tone={person.isActive ? "green" : "red"}>
        {person.isActive ? "Active" : "Blocked"}
      </Chip>
      {!person.hasSignedIn && (
        <span className="text-xs text-muted">Not signed in yet</span>
      )}
    </span>
  );
}

export default function PeopleRolesPage() {
  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText.trim(), 300);
  const [role, setRole] = useState("");
  const [pageState, setPageState] = useState({ page: 1, search: "", role: "" });
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);

  // Back to page 1 whenever the search or the filter changes.
  const page =
    pageState.search === search && pageState.role === role ? pageState.page : 1;
  const setPage = (next) => setPageState({ page: next, search, role });

  const list = usePeopleList({ page, search, role });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">People and roles</h1>
        <p className="mt-1 text-sm text-muted">
          Give or take away roles, and block or allow access.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4">
          <div className="min-w-56 flex-1">
            <label
              htmlFor="people-search"
              className="block text-xs font-semibold text-ink"
            >
              Search
            </label>
            <div className="relative mt-1">
              <Search
                aria-hidden="true"
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              />
              <input
                id="people-search"
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Name, login name, email or department"
                className="h-10 w-full rounded-[6px] border border-line pr-3 pl-9 text-sm text-ink"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="people-role"
              className="block text-xs font-semibold text-ink"
            >
              Role
            </label>
            <select
              id="people-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="mt-1 h-10 rounded-[6px] border border-line bg-white px-2 text-sm text-ink"
            >
              <option value="">All roles</option>
              {ROLE_ORDER.map((name) => (
                <option key={name} value={name}>
                  {roleLabel(name)}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" size={16} />
            Add from directory
          </Button>
        </div>

        {list.isLoading ? (
          <div className="px-5 py-10 text-center text-muted">
            <Spinner label="Loading people…" />
          </div>
        ) : list.isError ? (
          <p
            role="alert"
            className="px-5 py-10 text-center text-sm text-danger"
          >
            {list.error.message}
          </p>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            No one matches these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-page text-xs font-semibold text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-2.5">
                    Name
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Department
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Roles
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-2.5">
                    Last sign-in
                  </th>
                </tr>
              </thead>
              <tbody
                className={`divide-y divide-line ${list.isPlaceholderData ? "opacity-60" : ""}`}
              >
                {items.map((person) => (
                  <tr
                    key={person.id}
                    onClick={() => setSelectedId(person.id)}
                    className="cursor-pointer hover:bg-page"
                  >
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(person.id);
                        }}
                        className="text-left font-semibold text-brand-navy hover:underline"
                      >
                        {person.fullName || person.userName}
                      </button>
                      <span className="block text-xs text-muted">
                        {person.userName}
                      </span>
                    </td>
                    <td className="px-5 py-3">{person.department || "—"}</td>
                    <td className="px-5 py-3">
                      <RoleChips roles={person.roles} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusCell person={person} />
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-body">
                      {person.lastLoginAt ? formatWat(person.lastLoginAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
          <span className="text-muted">
            {total} {total === 1 ? "person" : "people"}
          </span>
          <nav aria-label="Pages" className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft aria-hidden="true" size={16} />
            </Button>
            <span>
              Page {page} of {pages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPage(page + 1)}
              disabled={page >= pages}
              aria-label="Next page"
            >
              <ChevronRight aria-hidden="true" size={16} />
            </Button>
          </nav>
        </div>
      </Card>

      {selectedId && (
        <PersonPanel userId={selectedId} onClose={() => setSelectedId(null)} />
      )}
      <AddFromDirectoryDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={setSelectedId}
      />
    </div>
  );
}
