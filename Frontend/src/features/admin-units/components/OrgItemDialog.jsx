import { useForm } from "react-hook-form";
import { z } from "zod";
import { applyFieldErrors } from "@/shared/lib/http";
import { zodResolver } from "@/shared/lib/zodResolver";
import { Button, Dialog, useToast } from "@/shared/ui";

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(
      /^[A-Z0-9-]{2,10}$/,
      "Use 2 to 10 capital letters, digits or dashes.",
    ),
  name: z
    .string()
    .trim()
    .min(1, "Enter a name.")
    .max(100, "At most 100 characters."),
});

const inputClass = (invalid) =>
  `mt-1 h-10 w-full rounded-lg border px-3 text-sm text-ink ${invalid ? "border-danger" : "border-line"}`;

/**
 * Code and name, for a new department or unit. The code is upper-cased as it is typed and cannot be
 * changed later. `onSave(values)` returns the mutation promise; its message is shown as a toast and
 * its field errors under the fields.
 */
export default function OrgItemDialog({
  open,
  onClose,
  title,
  codeHint,
  onSave,
}) {
  const toast = useToast();
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { code: "", name: "" },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (values) => {
    try {
      await onSave(values);
      toast.success(`${values.name} added`);
      close();
    } catch (error) {
      applyFieldErrors(error, setError, ["code", "name"]);
      toast.error(error.message);
    }
  };

  // Upper-case the code as it is typed.
  const code = register("code", {
    onChange: (event) => setValue("code", event.target.value.toUpperCase()),
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="org-item-form" busy={isSubmitting}>
            Add
          </Button>
        </>
      }
    >
      <form
        id="org-item-form"
        className="space-y-4"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        <div>
          <label
            htmlFor="org-code"
            className="block text-sm font-semibold text-ink"
          >
            Code
          </label>
          <input
            id="org-code"
            autoComplete="off"
            maxLength={10}
            aria-invalid={errors.code ? "true" : undefined}
            aria-describedby={`org-code-hint${errors.code ? " org-code-error" : ""}`}
            className={`${inputClass(errors.code)} uppercase`}
            {...code}
          />
          <p id="org-code-hint" className="mt-1 text-xs text-muted">
            {codeHint}
          </p>
          {errors.code && (
            <p
              id="org-code-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.code.message}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="org-name"
            className="block text-sm font-semibold text-ink"
          >
            Name
          </label>
          <input
            id="org-name"
            autoComplete="off"
            aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={errors.name ? "org-name-error" : undefined}
            className={inputClass(errors.name)}
            {...register("name")}
          />
          {errors.name && (
            <p
              id="org-name-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.name.message}
            </p>
          )}
        </div>
      </form>
    </Dialog>
  );
}
