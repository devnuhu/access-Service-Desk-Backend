import { useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert } from "lucide-react";
import usePaging, { useLastPageClamp } from "@/shared/hooks/usePaging";
import { LIST_PAGE_SIZE } from "@/shared/lib/paging";
import { InlineRetry, Pager, Spinner, Switch } from "@/shared/ui";
import { useMyTasks } from "../hooks/useTasks.js";
import { formatTaskDue } from "../tasks.js";
import { personName } from "../ticketText.js";
import { TaskStatusChip } from "./TasksPanel.jsx";

/**
 * The Work queue's "My tasks" tab: tasks given to me on any ticket (GET /api/tasks/mine), soonest
 * due first, 10 a page. "Show finished" adds done, rejected and cancelled ones. A row opens its
 * ticket, where the task can be finished or rejected.
 */
export default function MyTasksPanel() {
  const [finished, setFinished] = useState(false);
  const paging = usePaging(String(finished));
  const { page, setPage } = paging;
  const list = useMyTasks({
    includeFinished: finished || undefined,
    page,
    pageSize: LIST_PAGE_SIZE,
  });
  useLastPageClamp(paging, list.data?.total);
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div data-testid="my-tasks">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-sm text-body">
          Tasks given to you on tickets, soonest due first.
        </p>
        <Switch
          checked={finished}
          onChange={setFinished}
          label="Show finished"
        />
      </div>
      {list.isLoading ? (
        <div className="px-5 py-10 text-center">
          <Spinner label="Loading your tasks…" />
        </div>
      ) : list.isError ? (
        <div className="px-5 py-6">
          <InlineRetry
            testId="my-tasks-error"
            message={list.error.message}
            onRetry={() => list.refetch()}
          />
        </div>
      ) : items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">
          No tasks are waiting for you.
        </p>
      ) : (
        <>
          <ul
            aria-label="My tasks"
            className={`divide-y divide-line ${list.isPlaceholderData ? "opacity-60" : ""}`}
          >
            {items.map((task) => {
              const due = formatTaskDue(task.dueDate);
              return (
                <li key={task.taskId} data-testid={`my-task-${task.taskId}`}>
                  <Link
                    to={`/tickets/${task.ticketReference}`}
                    className="grid gap-x-4 gap-y-1 px-5 py-3 hover:bg-page sm:grid-cols-[minmax(0,1fr)_10rem_7rem_6rem] sm:items-center"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold break-words text-ink">
                        {task.title}
                      </span>
                      <span className="block text-xs break-words text-muted">
                        <span className="font-semibold text-brand-navy">
                          {task.ticketReference}
                        </span>{" "}
                        · {task.ticketSubject}
                      </span>
                    </span>
                    <span
                      data-testid="my-task-given-by"
                      className="text-xs text-body"
                    >
                      {task.givenBy
                        ? `From ${personName(task.givenBy)}`
                        : "From the ticket"}
                    </span>
                    <span data-testid="my-task-due" className="text-xs">
                      {task.isOverdue ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-danger">
                          <CircleAlert aria-hidden="true" size={12} />
                          Overdue{due ? ` · ${due}` : ""}
                        </span>
                      ) : due ? (
                        <span className="text-body">Due {due}</span>
                      ) : (
                        <span className="text-muted">No due date</span>
                      )}
                    </span>
                    <span>
                      <TaskStatusChip status={task.status} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line px-5 py-3">
            <Pager
              total={total}
              page={page}
              pageSize={LIST_PAGE_SIZE}
              onPage={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
