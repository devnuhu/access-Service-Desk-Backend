import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Dialog,
  Spinner,
  useToast,
  PageHeader,
} from "@/shared/ui";
import {
  useAdminLocations,
  useCreateLocation,
  useUpdateLocation,
} from "../hooks/useLocations.js";

/** Add a location, or rename one (`location` given). */
function NameDialog({ location, onClose, onSave }) {
  const [name, setName] = useState(location?.name ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const save = async (event) => {
    event.preventDefault();
    const value = name.trim();
    if (value.length < 2 || value.length > 100) {
      setError("Use 2 to 100 characters.");
      return;
    }
    if (location && value === location.name) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onSave(value);
      onClose();
    } catch (failure) {
      setError(failure.fieldErrors?.name?.[0] ?? failure.message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={location ? `Rename ${location.name}` : "Add location"}
      description={
        location ? undefined : "People choose a location on every ticket."
      }
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="location-form" busy={busy}>
            {location ? "Save" : "Add location"}
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={save} noValidate>
        <label
          htmlFor="location-name"
          className="block text-sm font-semibold text-ink"
        >
          Name
        </label>
        <input
          ref={inputRef}
          id="location-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "location-name-error" : undefined}
          className={`mt-1 h-10 w-full rounded-lg border px-3 text-sm text-ink ${error ? "border-danger" : "border-line"}`}
        />
        {error && (
          <p
            id="location-name-error"
            className="mt-1 text-xs font-medium text-danger"
          >
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/**
 * Administration > Locations (Super Admin): the list people choose from on the ticket form. At least
 * one location stays on; the API's refusal shows as a toast.
 */
export default function LocationsPage() {
  const toast = useToast();
  const locations = useAdminLocations();
  const createLocation = useCreateLocation();
  const updateLocation = useUpdateLocation();
  const [dialog, setDialog] = useState(null);
  const [moving, setMoving] = useState(false);

  const list = locations.data ?? [];

  const add = async (name) => {
    const created = await createLocation.mutateAsync({ name });
    toast.success(`Location ${created.name} added.`);
  };

  const rename = async (name) => {
    const result = await updateLocation.mutateAsync({
      locationId: dialog.rename.id,
      name,
    });
    toast.success(result.message);
  };

  // Swaps the order with the neighbour (two PATCHes).
  const move = async (index, step) => {
    const current = list[index];
    const neighbour = list[index + step];
    const currentOrder =
      current.sortOrder === neighbour.sortOrder
        ? Math.max(0, neighbour.sortOrder + step)
        : neighbour.sortOrder;
    setMoving(true);
    try {
      await updateLocation.mutateAsync({
        locationId: current.id,
        sortOrder: currentOrder,
      });
      if (current.sortOrder !== neighbour.sortOrder) {
        await updateLocation.mutateAsync({
          locationId: neighbour.id,
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
  const confirmToggle = async () => {
    try {
      const result = await updateLocation.mutateAsync({
        locationId: toggle.id,
        isActive: !toggle.isActive,
      });
      toast.success(result.message);
    } catch (error) {
      toast.error(error.message, {
        title: `${toggle.name} not switched ${toggle.isActive ? "off" : "on"}`,
      });
    } finally {
      setDialog(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Locations"
          description="Where people work. Everyone chooses one on the ticket form; their last one is chosen for them next time."
        />
        <Button onClick={() => setDialog({ add: true })}>
          <Plus aria-hidden="true" size={16} />
          Add location
        </Button>
      </div>

      <Card>
        {locations.isLoading ? (
          <div className="px-5 py-10 text-center text-muted">
            <Spinner label="Loading locations…" />
          </div>
        ) : locations.isError ? (
          <p
            role="alert"
            className="px-5 py-10 text-center text-sm text-danger"
          >
            {locations.error.message}
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
                    Order
                  </th>
                  <th scope="col" className="px-5 py-4">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-4">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((location, index) => (
                  <tr
                    key={location.id}
                    data-testid={`location-${location.name}`}
                  >
                    <td className="px-5 py-3 font-semibold text-ink">
                      {location.name}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <span className="w-8 text-body">
                          {location.sortOrder}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${location.name} up`}
                          disabled={index === 0 || moving}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp aria-hidden="true" size={15} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${location.name} down`}
                          disabled={index === list.length - 1 || moving}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown aria-hidden="true" size={15} />
                        </Button>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {location.isActive ? (
                        <Chip tone="green">On</Chip>
                      ) : (
                        <Chip tone="grey">Off</Chip>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setDialog({ rename: location })}
                        >
                          Rename{" "}
                          <span className="sr-only">{location.name}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant={location.isActive ? "danger" : "secondary"}
                          className="whitespace-nowrap"
                          onClick={() => setDialog({ toggle: location })}
                        >
                          {location.isActive ? "Switch off" : "Switch on"}{" "}
                          <span className="sr-only">{location.name}</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {dialog?.add && (
        <NameDialog onClose={() => setDialog(null)} onSave={add} />
      )}
      {dialog?.rename && (
        <NameDialog
          location={dialog.rename}
          onClose={() => setDialog(null)}
          onSave={rename}
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
            ? "People can no longer choose it on new tickets. Tickets that already use it keep it."
            : "People can choose it on new tickets again."
        }
        confirmLabel={toggle?.isActive ? "Switch off" : "Switch on"}
        danger={Boolean(toggle?.isActive)}
        busy={updateLocation.isPending}
        onConfirm={confirmToggle}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
