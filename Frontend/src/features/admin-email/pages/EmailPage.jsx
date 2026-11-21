import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { CircleAlert, CircleCheck, Send } from "lucide-react";
import { applyFieldErrors, request } from "@/shared/lib/http";
import { zodResolver } from "@/shared/lib/zodResolver";
import { Button, Card, CardHeader, Spinner, PageHeader } from "@/shared/ui";
import { getEmailStatus, sendTestEmail } from "../api/endpoints.js";

const testSchema = z.object({
  to: z
    .string()
    .trim()
    .min(1, "Enter an email address")
    .email("Enter a valid email address"),
});

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{children || "—"}</dd>
    </div>
  );
}

function StatusCard() {
  const status = useQuery({
    queryKey: ["admin-email", "status"],
    queryFn: () => request(getEmailStatus),
  });
  const data = status.data;
  const sender =
    data?.provider === "Smtp"
      ? { name: null, email: data.smtp.senderEmail }
      : { name: data?.infobip.senderName, email: data?.infobip.senderEmail };

  return (
    <Card>
      <CardHeader
        title="Status"
        description="Which provider sends Access Service Desk email, and whether it is ready."
      />
      <div className="px-5 py-3">
        {status.isLoading ? (
          <Spinner label="Loading…" />
        ) : status.isError ? (
          <p role="alert" className="text-sm text-danger">
            {status.error.message}
          </p>
        ) : (
          <dl className="divide-y divide-line">
            <Row label="Provider">{data.provider}</Row>
            <Row label="Ready">
              {data.ready ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-brand-green-ink">
                  <CircleCheck aria-hidden="true" size={16} /> Ready
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-brand-orange-ink">
                  <CircleAlert aria-hidden="true" size={16} /> Not ready:
                  settings are missing
                </span>
              )}
            </Row>
            {sender.name !== null && (
              <Row label="Sender name">{sender.name}</Row>
            )}
            <Row label="Sender address">{sender.email}</Row>
            {data.provider !== "Smtp" && (
              <Row label="API key set">
                {data.infobip.apiKeyConfigured ? "Yes" : "No"}
              </Row>
            )}
            <Row label="Notification emails">
              {data.notificationEmails ? "On" : "Off"}
            </Row>
          </dl>
        )}
      </div>
    </Card>
  );
}

function TestCard() {
  const [result, setResult] = useState(null);
  const send = useMutation({
    mutationFn: (values) => request(sendTestEmail, { body: values }),
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(testSchema), defaultValues: { to: "" } });

  const onSubmit = async (values) => {
    setResult(null);
    try {
      setResult(await send.mutateAsync(values));
    } catch (error) {
      applyFieldErrors(error, setError, ["to"]);
      setResult({ success: false, message: error.message });
    }
  };

  return (
    <Card>
      <CardHeader
        title="Send a test email"
        description="Sends one message with the Access Service Desk layout."
      />
      <form
        className="space-y-3 px-5 py-4"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        <div>
          <label
            htmlFor="test-to"
            className="block text-sm font-semibold text-ink"
          >
            Email address
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="test-to"
              type="email"
              autoComplete="email"
              aria-invalid={errors.to ? "true" : undefined}
              aria-describedby={errors.to ? "test-to-error" : undefined}
              className={`h-10 min-w-56 flex-1 rounded-lg border px-3 text-sm text-ink ${errors.to ? "border-danger" : "border-line"}`}
              {...register("to")}
            />
            <Button type="submit" busy={send.isPending} busyText="Sending…">
              <Send aria-hidden="true" size={16} />
              Send test
            </Button>
          </div>
          {errors.to && (
            <p
              id="test-to-error"
              className="mt-1 text-xs font-medium text-danger"
            >
              {errors.to.message}
            </p>
          )}
        </div>
        <div aria-live="polite">
          {result && (
            <p
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                result.success
                  ? "border-brand-green/50 bg-brand-green-light text-brand-green-ink"
                  : "border-danger/30 bg-danger-light text-danger"
              }`}
            >
              {result.success ? (
                <CircleCheck
                  aria-hidden="true"
                  size={16}
                  className="mt-0.5 shrink-0"
                />
              ) : (
                <CircleAlert
                  aria-hidden="true"
                  size={16}
                  className="mt-0.5 shrink-0"
                />
              )}
              {result.message || (result.success ? "Sent." : "Not sent.")}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}

export default function EmailPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Email"
        description="Check that Access Service Desk can send email."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <StatusCard />
        <TestCard />
      </div>
    </div>
  );
}
