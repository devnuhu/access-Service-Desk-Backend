import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { ArrowRight, CircleAlert, Lock, ShieldCheck, User } from "lucide-react";
import { BRAND } from "@/shared/brand";
import useDocumentTitle from "@/shared/hooks/useDocumentTitle";
import { zodResolver } from "@/shared/lib/zodResolver";
import { Button } from "@/shared/ui";
import useSession from "../hooks/useSession.js";
import { safeNext, signIn } from "../session.js";
import { LoginBrandPanel } from "../components/LoginBrand.jsx";

const schema = z.object({
  username: z.string().trim().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

const UNREACHABLE = `${BRAND.name} cannot be reached right now. Try again shortly.`;

function signInError(error) {
  if (error?.kind === "rateLimited") return error.message;
  if (error?.kind === "network" || error?.kind === "server") return UNREACHABLE;
  if (error?.kind === "unauthorized" || error?.kind === "validation")
    return error.message;
  return error?.message || UNREACHABLE;
}

const inputClass =
  "block h-11 w-full rounded-lg border bg-white pr-3 pl-10 text-sm text-ink placeholder:text-muted focus:border-brand-navy focus:outline-2 focus:outline-offset-0 focus:outline-brand-orange";

export default function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const { status } = useSession();
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef(null);

  useDocumentTitle("Sign in");

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  useEffect(() => {
    setFocus("username");
  }, [setFocus]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const onSubmit = async (values) => {
    setError(null);
    try {
      await signIn(queryClient, values);
      navigate(next, { replace: true });
    } catch (caught) {
      setError(signInError(caught));
    }
  };

  if (status === "signedIn" && !isSubmitting)
    return <Navigate to={next} replace />;

  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-white lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <LoginBrandPanel />

      {/* The white form panel lies on top of the brand panel: over its right edge on desktop,
          over its bottom edge on phones. */}
      <main className="relative z-10 -mt-5 flex flex-1 flex-col rounded-t-[20px] bg-white px-6 pt-10 pb-6 shadow-login-panel-up sm:px-10 lg:mt-0 lg:-ml-8 lg:rounded-t-none lg:rounded-l-[32px] lg:px-16 lg:pb-8 lg:shadow-login-panel">
        {/* The form sits a little above the middle; the © line is pinned to the bottom. */}
        <div className="flex flex-1 flex-col justify-start lg:justify-center lg:pb-16">
          <div className="mx-auto w-full max-w-sm">
            <h1 className="text-3xl font-semibold">Welcome back</h1>
            <p className="mt-2 text-sm text-body">
              Sign in with your Access Pensions network account.
            </p>

            <form
              className="mt-8 space-y-5"
              onSubmit={handleSubmit(onSubmit)}
              noValidate
            >
              {error && (
                <div
                  ref={errorRef}
                  role="alert"
                  tabIndex={-1}
                  className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-light px-3 py-2.5 text-sm text-danger"
                >
                  <CircleAlert
                    aria-hidden="true"
                    size={18}
                    className="mt-px shrink-0"
                  />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="username"
                  className="block text-sm font-semibold text-ink"
                >
                  Username
                </label>
                <div className="relative mt-1.5">
                  <User
                    aria-hidden="true"
                    size={18}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
                  />
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    aria-invalid={errors.username ? "true" : undefined}
                    aria-describedby={`username-hint${errors.username ? " username-error" : ""}`}
                    className={`${inputClass} ${errors.username ? "border-danger" : "border-line"}`}
                    {...register("username")}
                  />
                </div>
                <p id="username-hint" className="mt-1.5 text-xs text-muted">
                  The name you use to sign in to your computer, for example
                  Adeyemi.Salisu
                </p>
                {errors.username && (
                  <p
                    id="username-error"
                    className="mt-1 text-xs font-medium text-danger"
                  >
                    {errors.username.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-ink"
                >
                  Password
                </label>
                <div className="relative mt-1.5">
                  <Lock
                    aria-hidden="true"
                    size={18}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
                  />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    aria-invalid={errors.password ? "true" : undefined}
                    aria-describedby={
                      errors.password ? "password-error" : undefined
                    }
                    className={`${inputClass} pr-16 ${errors.password ? "border-danger" : "border-line"}`}
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-pressed={showPassword}
                    aria-controls="password"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-navy-light"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                {errors.password && (
                  <p
                    id="password-error"
                    className="mt-1 text-xs font-medium text-danger"
                  >
                    {errors.password.message}
                  </p>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full"
                busy={isSubmitting}
                busyText="Signing in…"
              >
                Sign in
                <ArrowRight aria-hidden="true" size={18} />
              </Button>

              <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
                <ShieldCheck
                  aria-hidden="true"
                  size={14}
                  className="text-brand-green-ink"
                />
                Secured with your company network account
              </p>
            </form>
          </div>
        </div>

        <footer className="mx-auto mt-10 w-full max-w-sm border-t border-line pt-5 text-xs text-muted">
          <p>© {year} Access ARM Pensions Plc</p>
        </footer>
      </main>
    </div>
  );
}
