import { useState } from "react";
import { Search, UserPlus } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { SEARCH_DEBOUNCE_MS } from "@/shared/lib/paging";
import { ROLE_ORDER, roleLabel } from "@/shared/lib/roles";
import { formatWat } from "@/shared/lib/time";
import {
  Button,
  Card,
  Chip,
  Pager,
  RoleChips,
  Spinner,
  PageHeader,
} from "@/shared/ui";
import { usePeopleList } from "../hooks/usePeople.js";
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
  const search = useDebouncedValue(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const [role, setRole] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [adding, setAdding] = useState(false);

  // Back to page 1 whenever the search or the filter changes.
  const paging = usePaging(`${search}|${role}`);
  const { page, setPage } = paging;

  const list = usePeopleList({ page, search, role });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  useLastPageClamp(paging, list.data?.total);

  return (
    <div className="space-y-4">
      <PageHeader
        title="People and roles"
        description="Give or take away roles, and block or allow access."
      />

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
                className="h-10 w-full rounded-lg border border-line pr-3 pl-9 text-sm text-ink"
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
              className="mt-1 h-10 rounded-lg border border-line bg-white px-2 text-sm text-ink"
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
              <thead className="border-b border-line bg-page/60 text-[12px] font-semibold tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="px-5 py-4">
                    Name
                  </th>
                  <th scope="col" className="px-5 py-4">
                    Department
                  </th>
                  <th scope="col" className="px-5 py-4">
                    Roles
                  </th>
                  <th scope="col" className="px-5 py-4">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-4">
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

        {total > 0 && (
          <div className="border-t border-line px-5 py-3">
            <Pager total={total} page={page} onPage={setPage} />
          </div>
        )}
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
