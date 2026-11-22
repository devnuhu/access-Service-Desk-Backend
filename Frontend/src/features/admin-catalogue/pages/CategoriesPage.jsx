import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, Grid3x3, Plus } from "lucide-react";
import { PriorityChip } from "@/features/catalogue";
import { TemplateEditorDialog } from "@/features/category-templates";
import { useOrgDepartments } from "@/features/org";
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Spinner,
  useToast,
  PageHeader,
} from "@/shared/ui";
import CategoryDialog from "../components/CategoryDialog.jsx";
import CoverBanner from "../components/CoverBanner.jsx";
import {
  useCategories,
  useCoverWarnings,
  useCreateCategory,
  useUpdateCategory,
} from "../hooks/useCatalogueAdmin.js";

/**
 * Groups the department's categories by owning unit: every active unit (even with no categories
 * yet), then any switched-off unit that still owns categories. Categories keep the API's order.
 */
function groupByUnit(categories, units) {
  const groups = units.map((unit) => ({
    unitId: unit.id,
    unitName: unit.name,
    active: true,
    categories: [],
  }));
  for (const category of categories) {
    let group = groups.find((g) => g.unitId === category.unitId);
    if (!group) {
      group = {
        unitId: category.unitId,
        unitName: category.unitName,
        active: false,
        categories: [],
      };
      groups.push(group);
    }
    group.categories.push(category);
  }
  return groups;
}

function Loading({ label }) {
  return (
    <div className="py-10 text-center text-muted">
      <Spinner label={label} />
    </div>
  );
}

/** Administration > Categories (Super Admin): categories by unit, cover warnings, reorder. */
export default function CategoriesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const departments = useOrgDepartments();
  const [chosenId, setChosenId] = useState("");
  const departmentList = departments.data ?? [];
  const department =
    departmentList.find((d) => d.id === chosenId) ?? departmentList[0];
  const categories = useCategories(department?.id);
  const cover = useCoverWarnings();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const [dialog, setDialog] = useState(null);
  const [moving, setMoving] = useState(false);

  if (departments.isLoading) return <Loading label="Loading…" />;
  if (departments.isError) {
    return (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {departments.error.message}
      </p>
    );
  }

  const units = department?.units ?? [];
  const groups = groupByUnit(categories.data ?? [], units);

  const add = async (body) => {
    const created = await createCategory.mutateAsync(body);
    toast.success(
      `Category ${created.name} created. Map at least two case workers to it.`,
      {
        action: {
          label: "Open skills matrix",
          onClick: () => navigate(`/admin/units/${created.unitId}/skills`),
        },
      },
    );
  };

  const edit = async (body) => {
    const result = await updateCategory.mutateAsync({
      categoryId: dialog.edit.id,
      ...body,
    });
    toast.success(result.message);
  };

  // Swaps the order with the neighbour in the same unit (two PATCHes).
  const move = async (list, index, step) => {
    const current = list[index];
    const neighbour = list[index + step];
    const currentOrder =
      current.sortOrder === neighbour.sortOrder
        ? Math.max(0, neighbour.sortOrder + step)
        : neighbour.sortOrder;
    setMoving(true);
    try {
      await updateCategory.mutateAsync({
        categoryId: current.id,
        sortOrder: currentOrder,
      });
      if (current.sortOrder !== neighbour.sortOrder) {
        await updateCategory.mutateAsync({
          categoryId: neighbour.id,
          sortOrder: current.sortOrder,
        });
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setMoving(false);
    }
  };

  const toggle = dialog?.toggle;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Categories"
          description="What requesters can ask for, the unit that handles each and how many case workers can take it."
        />
        <div className="flex flex-wrap items-end gap-2">
          {departmentList.length > 1 && (
            <div>
              <label
                htmlFor="category-department"
                className="block text-xs font-semibold text-muted uppercase"
              >
                Department
              </label>
              <select
                id="category-department"
                value={department?.id ?? ""}
                onChange={(event) => setChosenId(event.target.value)}
                className="mt-1 h-9 rounded-lg border border-line bg-white px-2 text-sm text-ink"
              >
                {departmentList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            size="sm"
            onClick={() => setDialog("add")}
            disabled={!units.length}
          >
            <Plus aria-hidden="true" size={16} />
            Add category
          </Button>
        </div>
      </div>

      <CoverBanner warnings={cover.data} />

      {!department ? (
        <Card className="px-5 py-8 text-center text-sm text-muted">
          No active departments. Add one in Administration &gt; Units.
        </Card>
      ) : categories.isLoading ? (
        <Loading label="Loading categories…" />
      ) : categories.isError ? (
        <p role="alert" className="py-10 text-center text-sm text-danger">
          {categories.error.message}
        </p>
      ) : (
        <Card>
          <h2 className="border-b border-line px-5 py-3 text-base font-semibold">
            {department.name}
            <span className="ml-2 text-sm font-normal text-muted">
              {categories.data.length} categor
              {categories.data.length === 1 ? "y" : "ies"}
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-line bg-page/60 text-[11px] font-semibold tracking-wider text-muted uppercase">
                <tr>
                  <th scope="col" className="w-28 px-5 py-2.5">
                    Order
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Name
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Default priority
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Case workers
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-4">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody
                  key={group.unitId}
                  data-testid={`unit-group-${group.unitId}`}
                  aria-label={group.unitName}
                  className="divide-y divide-line border-t border-line"
                >
                  <tr className="bg-brand-navy-light/50">
                    <th
                      scope="colgroup"
                      colSpan={6}
                      className="px-5 py-2 text-sm font-semibold text-brand-navy"
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          {group.unitName}
                          <span className="font-normal text-muted">
                            {group.categories.length} categor
                            {group.categories.length === 1 ? "y" : "ies"}
                          </span>
                          {!group.active && <Chip tone="red">Unit off</Chip>}
                        </span>
                        <Link
                          to={`/admin/units/${group.unitId}/skills`}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline"
                        >
                          <Grid3x3 aria-hidden="true" size={15} />
                          Skills matrix{" "}
                          <span className="sr-only">for {group.unitName}</span>
                        </Link>
                      </span>
                    </th>
                  </tr>
                  {group.categories.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-3 text-sm text-muted">
                        No categories yet.
                      </td>
                    </tr>
                  )}
                  {group.categories.map((category, index, list) => (
                    <tr
                      key={category.id}
                      className={category.isActive ? undefined : "bg-page/60"}
                    >
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1">
                          <span className="w-8 text-muted tabular-nums">
                            {category.sortOrder}
                          </span>
                          <button
                            type="button"
                            disabled={index === 0 || moving}
                            onClick={() => move(list, index, -1)}
                            className="rounded p-1 text-muted hover:bg-page hover:text-ink disabled:opacity-30"
                            aria-label={`Move ${category.name} up`}
                          >
                            <ArrowUp aria-hidden="true" size={15} />
                          </button>
                          <button
                            type="button"
                            disabled={index === list.length - 1 || moving}
                            onClick={() => move(list, index, 1)}
                            className="rounded p-1 text-muted hover:bg-page hover:text-ink disabled:opacity-30"
                            aria-label={`Move ${category.name} down`}
                          >
                            <ArrowDown aria-hidden="true" size={15} />
                          </button>
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`font-semibold ${category.isActive ? "text-ink" : "text-muted"}`}
                        >
                          {category.name}
                        </span>
                        {category.description && (
                          <span className="block max-w-md text-xs text-muted">
                            {category.description}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <PriorityChip priority={category.defaultPriority} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2">
                          <span
                            className="tabular-nums"
                            data-testid="eligible-count"
                          >
                            {category.eligibleCount}
                          </span>
                          {category.needsCover && (
                            <Chip tone="orange">Needs cover</Chip>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <Chip tone={category.isActive ? "green" : "grey"}>
                          {category.isActive ? "Active" : "Off"}
                        </Chip>
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDialog({ edit: category })}
                            aria-label={`Edit ${category.name}`}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDialog({ template: category })}
                            aria-label={`Template of ${category.name}`}
                          >
                            Template
                          </Button>
                          <Button
                            size="sm"
                            variant={category.isActive ? "danger" : "secondary"}
                            className="whitespace-nowrap"
                            onClick={() => setDialog({ toggle: category })}
                            aria-label={`${category.isActive ? "Switch off" : "Switch on"} ${category.name}`}
                          >
                            {category.isActive ? "Switch off" : "Switch on"}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </Card>
      )}

      {dialog === "add" && (
        <CategoryDialog
          units={units}
          onClose={() => setDialog(null)}
          onSave={add}
        />
      )}
      {dialog?.template && (
        <TemplateEditorDialog
          category={dialog.template}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.edit && (
        <CategoryDialog
          category={dialog.edit}
          units={units}
          onClose={() => setDialog(null)}
          onSave={edit}
        />
      )}
      <ConfirmDialog
        open={Boolean(toggle)}
        title={
          toggle?.isActive
            ? `Switch off ${toggle?.name}?`
            : `Switch on ${toggle?.name}?`
        }
        message={
          toggle?.isActive
            ? "Requesters will no longer see it. Open tickets are not affected."
            : "Requesters can choose it again."
        }
        confirmLabel={toggle?.isActive ? "Switch off" : "Switch on"}
        danger={toggle?.isActive}
        busy={updateCategory.isPending}
        onConfirm={async () => {
          try {
            const result = await updateCategory.mutateAsync({
              categoryId: toggle.id,
              isActive: !toggle.isActive,
            });
            toast.success(result.message);
          } catch (error) {
            toast.error(error.message);
          }
          setDialog(null);
        }}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
