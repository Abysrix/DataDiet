/**
 * Sign-in (Phase 7, ADR-0014; Clerk mode added by Phase 6.0, ADR-0025).
 *
 * The page reports what this deployment *actually* has, straight from the
 * public `GET /auth/config` endpoint, and never pretends otherwise:
 *
 * - `development`       — a local development sign-in that creates or reuses
 *                         a synthetic account. The server refuses it in
 *                         production, so it can never become production auth.
 * - `clerk`             — sign-in is Clerk's, rendered by Clerk's own
 *                         component when this build was given a publishable
 *                         key. There is no DataDiet form and no pasted token,
 *                         because a token minted elsewhere would not be what
 *                         this server verifies.
 * - `bearer_boundary`   — tokens are verified but no identity provider or
 *                         browser sign-in is wired up. A token issued
 *                         elsewhere can be pasted in.
 * - `unconfigured`      — nothing is set up; every protected endpoint answers
 *                         503 until an operator configures the signing
 *                         secret. There is nothing to sign in with.
 *
 * ADR-0027 simplifies the development path to one card: two primary fields,
 * optional operator controls behind an explicit disclosure, and the pasted-token
 * route behind a link. DataDiet stores no passwords at all — identity is proven
 * by a signed bearer token that the server verifies on every request.
 */

import { useState, type FormEvent } from "react";
import { fetchAuthConfig } from "../api/auth";
import type { AuthConfig, DevLoginRequest, RoleValue } from "../api/types";
import { useApiQuery } from "../hooks/useApiQuery";
import { ClerkSignInForm } from "../auth/ClerkBoundary";
import { useExternalSessionSnapshot } from "../auth/externalSession";
import type { ExternalSessionSnapshot } from "../auth/externalSession";
import { useAuth } from "../auth/AuthContext";
import { toErrorMessage } from "../api/client";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";
import { Textarea } from "../components/ui/Textarea";
import { IconChevronDown, IconChevronUp } from "../components/icons";

const ROLE_OPTIONS: Array<{ value: RoleValue; label: string }> = [
  { value: "viewer", label: "Viewer — read-only" },
  { value: "reviewer", label: "Reviewer — assess and decide" },
  { value: "admin", label: "Admin — manage policies, sources, and assets" },
];

/** The `SYNTH-` prefix keeps the default account unmistakably non-production. */
const DEFAULT_EMAIL = "SYNTH-demo@datadiet.local";

export default function SignIn() {
  const { data: config, loading, error, refetch } = useApiQuery(fetchAuthConfig, []);
  const { sessionExpired, anonymousReason, signOut } = useAuth();
  const external = useExternalSessionSnapshot();

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10 text-ink">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-card bg-accent text-body font-bold text-on-accent shadow-card"
          >
            DD
          </span>
          <p className="mt-3 text-eyebrow font-semibold uppercase tracking-[0.12em] text-ink-muted">
            DataDiet
          </p>
          <h1 className="mt-1 text-display font-semibold text-ink">Sign in to continue</h1>
          <p className="mt-1 text-supporting text-ink-muted">Data lifecycle &amp; privacy management</p>
        </div>

        <Card className="shadow-raised">
          {sessionExpired ? <SessionExpiredNotice /> : null}
          {loading ? (
            <CardBody>
              <Spinner label="Checking sign-in options..." />
            </CardBody>
          ) : null}
          {error ? (
            <CardBody>
              <ErrorState title="Sign-in configuration unavailable" message={error} onRetry={refetch} />
            </CardBody>
          ) : null}
          {config !== null && !loading ? (
            config.authentication === "unconfigured" ? (
              <UnconfiguredPanel description={config.description} />
            ) : config.authentication === "clerk" ? (
              <ClerkPanel
                externalState={external.state}
                reason={anonymousReason}
                description={config.description}
                onEndSession={signOut}
              />
            ) : (
              <LocalAuthPanel config={config} />
            )
          ) : null}
        </Card>

        <p className="mt-4 text-center text-meta text-ink-muted">
          No passwords stored. Every request is verified by the DataDiet API.
        </p>
      </div>
    </main>
  );
}

function SessionExpiredNotice() {
  return (
    <div
      role="status"
      className="border-b border-warning-line bg-warning-surface px-card-x py-card-y text-supporting text-warning-ink"
    >
      Your session has ended because the server no longer accepts your token. Sign in again to
      continue.
    </div>
  );
}

/* --------------------------- local auth modes ------------------------------ */

/**
 * Development shows the short synthetic form first. The token route is a link,
 * not a second card competing for attention; in bearer-boundary mode it is the
 * only route, so it is shown immediately.
 */
function LocalAuthPanel({ config }: { config: AuthConfig }) {
  const isDevelopment = config.authentication === "development";
  const [showToken, setShowToken] = useState(!isDevelopment);

  if (isDevelopment && !showToken) {
    return (
      <DevSignInCard
        devLoginEnabled={config.dev_login_enabled}
        onUseToken={() => setShowToken(true)}
      />
    );
  }

  return (
    <PastedTokenCard
      title={isDevelopment ? "Use an existing token" : "Sign in with your organization's token"}
      description={
        isDevelopment
          ? "Paste a bearer token issued for this deployment. The server verifies it before granting access."
          : config.description
      }
      onBack={isDevelopment ? () => setShowToken(false) : undefined}
    />
  );
}

function DevSignInCard({
  devLoginEnabled,
  onUseToken,
}: {
  devLoginEnabled: boolean;
  onUseToken: () => void;
}) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState(DEFAULT_EMAIL);
  const [displayName, setDisplayName] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [role, setRole] = useState<RoleValue>("viewer");
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; institution?: string }>({});

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const nextErrors: { email?: string; institution?: string } = {};

    if (!trimmedEmail.includes("@")) {
      nextErrors.email = "Enter an email address for the synthetic account.";
    }
    let parsedInstitution: number | undefined;
    if (institutionId.trim()) {
      parsedInstitution = Number(institutionId);
      if (!Number.isInteger(parsedInstitution) || parsedInstitution <= 0) {
        nextErrors.institution = "The institution id must be a positive integer.";
      }
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setError(null);
    setSubmitting(true);
    try {
      const request: DevLoginRequest = { email: trimmedEmail, role };
      if (displayName.trim()) request.display_name = displayName.trim();
      if (parsedInstitution !== undefined) request.institution_id = parsedInstitution;
      if (platformAdmin) request.platform_admin = true;
      await signIn(request);
      // On success the auth context flips to authenticated and the router
      // moves away from the sign-in screen.
    } catch (cause) {
      setError(toErrorMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <>
      <CardHeader
        title="Development sign-in"
        description="Sign in with a synthetic account. Development only — not production authentication."
        action={<Badge tone="warning">Demo only</Badge>}
      />
      <CardBody>
        {!devLoginEnabled ? (
          <p role="alert" className="mb-4 text-supporting text-critical-ink">
            The development sign-in provider is disabled on this server.
          </p>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-control border border-critical-line bg-critical-surface px-3 py-2 text-supporting text-critical-ink"
          >
            {error}
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field
            label="Email"
            hint="A synthetic account is created or reused."
            error={fieldErrors.email}
            required
          >
            {(control) => (
              <Input
                {...control}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="SYNTH-reviewer@datadiet.local"
                autoComplete="off"
              />
            )}
          </Field>

          <Field label="Role" hint="Permissions are always verified server-side.">
            {(control) => (
              <Select
                {...control}
                value={role}
                onChange={(event) => setRole(event.target.value as RoleValue)}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="space-y-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced((current) => !current)}
              aria-expanded={showAdvanced}
              aria-controls="dev-advanced-options"
            >
              {showAdvanced ? (
                <IconChevronUp className="h-4 w-4" />
              ) : (
                <IconChevronDown className="h-4 w-4" />
              )}
              Advanced options
            </Button>
            <div
              id="dev-advanced-options"
              hidden={!showAdvanced}
              className="space-y-4 rounded-card border border-line bg-surface-sunken p-4"
            >
              <Field label="Display name (optional)">
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Synthetic Reviewer"
                  />
                )}
              </Field>
              <Field
                label="Institution id (optional)"
                hint="Only needed to grant institution-scoped access."
                error={fieldErrors.institution}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={1}
                    value={institutionId}
                    onChange={(event) => setInstitutionId(event.target.value)}
                    placeholder="1"
                  />
                )}
              </Field>
              <label className="flex items-start gap-3 text-supporting text-ink-secondary">
                <input
                  type="checkbox"
                  checked={platformAdmin}
                  onChange={(event) => setPlatformAdmin(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded-control border-line-strong accent-accent"
                />
                <span>
                  Platform administrator
                  <span className="text-ink-muted"> — development only; cross-institution access</span>
                </span>
              </label>
            </div>
          </div>

          <Button type="submit" fullWidth loading={submitting} disabled={!devLoginEnabled}>
            Sign in
          </Button>

          <div className="text-center">
            <Button type="button" variant="ghost" size="sm" onClick={onUseToken}>
              Use a bearer token instead
            </Button>
          </div>
        </form>
      </CardBody>
    </>
  );
}

function PastedTokenCard({
  title,
  description,
  onBack,
}: {
  title: string;
  description: string;
  onBack?: () => void;
}) {
  const { signInWithToken } = useAuth();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithToken(token);
    } catch (cause) {
      setError(toErrorMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <>
      <CardHeader title={title} description={description} />
      <CardBody>
        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-control border border-critical-line bg-critical-surface px-3 py-2 text-supporting text-critical-ink"
          >
            {error}
          </div>
        ) : null}
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Bearer token"
            hint="Paste a token issued for this deployment; nothing is stored on the server."
          >
            {(control) => (
              <Textarea
                {...control}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="font-mono text-meta"
                placeholder="eyJhbGciOiJIUzI1NiIs..."
                autoComplete="off"
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={submitting} disabled={token.trim().length === 0}>
              Verify and sign in
            </Button>
            {onBack ? (
              <Button type="button" variant="ghost" onClick={onBack}>
                Back to demo sign-in
              </Button>
            ) : null}
          </div>
        </form>
      </CardBody>
    </>
  );
}

/* ------------------------------ clerk mode -------------------------------- */

/**
 * Clerk mode, stated honestly for each state the provider can be in.
 *
 * Nothing here decides access. An unlinked identity, a deactivated account, or
 * a DataDiet refusal of any kind stays a refusal — the server's own words are
 * shown instead of a session that was not granted.
 */
function ClerkPanel({
  externalState,
  reason,
  description,
  onEndSession,
}: {
  externalState: ExternalSessionSnapshot["state"];
  reason: string | null;
  description: string;
  onEndSession: () => void;
}) {
  if (externalState === "idle") {
    // The server authenticates through Clerk but this browser build was given no
    // publishable key: there is no sign-in flow to show, and pretending there is
    // one would be the fake integration this project forbids.
    return (
      <>
        <CardHeader
          title="Clerk sign-in is not configured in this build"
          description="This API verifies Clerk session tokens, but the frontend was built without a Clerk publishable key, so there is no sign-in form to render."
        />
        <CardBody>
          <p className="text-supporting text-ink-muted">
            Set <Code>VITE_CLERK_PUBLISHABLE_KEY</Code> and rebuild the frontend. Clerk&apos;s secret
            key stays on the server and is never used by this application — nothing secret belongs
            in the browser bundle.
          </p>
        </CardBody>
      </>
    );
  }

  if (externalState === "loading") {
    return (
      <CardBody>
        <Spinner label="Connecting to the identity provider..." />
      </CardBody>
    );
  }

  if (externalState === "signed-out") {
    return (
      <>
        <CardHeader title="Sign in with Clerk" description={description} />
        <CardBody>
          <p className="text-supporting text-ink-muted">
            DataDiet stores no passwords and issues no tokens. An administrator links a Clerk
            identity to a DataDiet account and grants its institution membership; until then the
            server refuses the session and says why. There is no self-service account creation.
          </p>
        </CardBody>
        <CardBody className="border-t border-line">
          <ClerkSignInForm />
        </CardBody>
        <CardBody className="border-t border-line">
          <p className="text-center text-meta text-ink-muted">
            Session tokens are minted and refreshed by Clerk. Every request is still verified
            server-side, and this page never decides identity or permissions on its own.
          </p>
        </CardBody>
      </>
    );
  }

  // Clerk has an active session that DataDiet refused: show the refusal, do not
  // loop the user back into a sign-in they have already completed.
  return (
    <>
      <CardHeader
        title="Clerk has you signed in; DataDiet has not granted a session"
        description="Your identity provider verified you, but this account is not linked, is deactivated, or the server could not reach it."
      />
      <CardBody className="space-y-4">
        <p role="alert" className="rounded-control bg-critical-surface px-3 py-2 text-supporting text-critical-ink">
          {reason ?? "The server did not accept this session."}
        </p>
        <p className="text-supporting text-ink-muted">
          Nothing was granted locally and nothing will appear until an administrator links your
          identity to a DataDiet account.
        </p>
        <Button variant="secondary" onClick={onEndSession}>
          End this session
        </Button>
      </CardBody>
    </>
  );
}

function UnconfiguredPanel({ description }: { description: string }) {
  return (
    <>
      <CardHeader
        title="Authentication is not configured"
        description="This deployment has no signing secret, so every protected API refuses requests (HTTP 503) instead of accepting unverified identity."
      />
      <CardBody className="space-y-3 text-supporting text-ink-muted">
        <p>{description}</p>
        <p>
          An operator must set <Code>AUTH_JWT_SECRET</Code> (and ideally issuer and audience) in the
          backend environment — see <Code>.env.example</Code> — before anyone can sign in. No
          default or placeholder credential is ever accepted in production.
        </p>
      </CardBody>
    </>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded-control bg-surface-sunken px-1 py-0.5 font-mono text-meta text-ink-secondary">
      {children}
    </code>
  );
}
