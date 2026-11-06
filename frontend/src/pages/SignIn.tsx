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
 * DataDiet stores no passwords at all: the backend keeps a directory of
 * accounts, and identity is proven by a signed bearer token.
 */

import { useState } from "react";
import { fetchAuthConfig } from "../api/auth";
import type { DevLoginRequest, RoleValue } from "../api/types";
import { useApiQuery } from "../hooks/useApiQuery";
import { ClerkSignInForm } from "../auth/ClerkBoundary";
import { useExternalSessionSnapshot } from "../auth/externalSession";
import type { ExternalSessionSnapshot } from "../auth/externalSession";
import { useAuth } from "../auth/AuthContext";
import { toErrorMessage } from "../api/client";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { ErrorState } from "../components/ui/ErrorState";
import { Spinner } from "../components/ui/Spinner";

const ROLE_OPTIONS: Array<{ value: RoleValue; label: string }> = [
  { value: "viewer", label: "Viewer — read-only" },
  { value: "reviewer", label: "Reviewer — assess and decide" },
  { value: "admin", label: "Admin — manage policies, sources, and assets" },
];

export default function SignIn() {
  const { data: config, loading, error, refetch } = useApiQuery(fetchAuthConfig, []);
  const { sessionExpired, anonymousReason, signOut } = useAuth();
  const external = useExternalSessionSnapshot();

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            DD
          </span>
          <div>
            <h1 className="text-lg font-semibold text-white">DataDiet</h1>
            <p className="text-xs text-slate-400">Data lifecycle &amp; privacy management</p>
          </div>
        </div>

        {sessionExpired ? (
          <div
            role="status"
            className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          >
            Your session has ended because the server no longer accepts your token. Sign in again
            to continue.
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-xl bg-slate-900 p-8">
            <Spinner label="Loading sign-in options..." />
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl bg-slate-900 p-2">
            <ErrorState
              title="Sign-in configuration unavailable"
              message={error}
              onRetry={refetch}
            />
          </div>
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
            <div className="space-y-4">
              {config.authentication === "development" ? (
                <DevSignInCard devLoginEnabled={config.dev_login_enabled} />
              ) : (
                <BearerBoundaryPanel description={config.description} />
              )}
              {/* In the bearer boundary this is the only way in; in development it
                  is the honest alternative to the synthetic account. */}
              <PastedTokenCard />
              <ConfigFootnote
                issuer={config.issuer}
                audience={config.audience}
                ttlSeconds={config.token_ttl_seconds}
              />
            </div>
          )
        ) : null}
      </div>
    </div>
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
      <Card>
        <CardHeader
          title="Clerk sign-in is not configured in this build"
          description="This API verifies Clerk session tokens, but the frontend was built without a Clerk publishable key, so there is no sign-in form to render."
        />
        <CardBody>
          <p className="text-sm text-slate-600">
            Set <code className="font-mono text-xs">VITE_CLERK_PUBLISHABLE_KEY</code> and rebuild
            the frontend. Clerk&apos;s secret key stays on the server and is never used by this
            application — nothing secret belongs in the browser bundle.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (externalState === "loading") {
    return (
      <div className="rounded-xl bg-slate-900 p-8">
        <Spinner label="Connecting to the identity provider..." />
      </div>
    );
  }

  if (externalState === "signed-out") {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader title="Sign in with Clerk" description={description} />
          <CardBody>
            <p className="text-sm text-slate-600">
              DataDiet stores no passwords and issues no tokens. An administrator links a Clerk
              identity to a DataDiet account and grants its institution membership; until then the
              server refuses the session and says why. There is no self-service account creation.
            </p>
          </CardBody>
        </Card>
        <ClerkSignInForm />
        <p className="text-center text-xs text-slate-500">
          Session tokens are minted and refreshed by Clerk. Every request is still verified
          server-side, and this page never decides identity or permissions on its own.
        </p>
      </div>
    );
  }

  // Clerk has an active session that DataDiet refused: show the refusal, do not
  // loop the user back into a sign-in they have already completed.
  return (
    <Card>
      <CardHeader
        title="Clerk has you signed in; DataDiet has not granted a session"
        description="Your identity provider verified you, but this account is not linked, is deactivated, or the server could not reach it."
      />
      <CardBody className="space-y-4">
        <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {reason ?? "The server did not accept this session."}
        </p>
        <p className="text-sm text-slate-600">
          Nothing was granted locally and nothing will appear until an administrator links your
          identity to a DataDiet account.
        </p>
        <button
          type="button"
          onClick={onEndSession}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
        >
          End this session
        </button>
      </CardBody>
    </Card>
  );
}

/* ------------------------------ honest panels ----------------------------- */

function UnconfiguredPanel({ description }: { description: string }) {
  return (
    <Card>
      <CardHeader
        title="Authentication is not configured"
        description="This deployment has no signing secret, so every protected API refuses requests (HTTP 503) instead of accepting unverified identity."
      />
      <CardBody>
        <p className="text-sm text-slate-600">{description}</p>
        <p className="mt-3 text-sm text-slate-600">
          An operator must set <code className="font-mono text-xs">AUTH_JWT_SECRET</code> (and
          ideally issuer and audience) in the backend environment — see{" "}
          <code className="font-mono text-xs">.env.example</code> — before anyone can sign in.
          No default or placeholder credential is ever accepted in production.
        </p>
      </CardBody>
    </Card>
  );
}

function BearerBoundaryPanel({ description }: { description: string }) {
  return (
    <Card>
      <CardHeader
        title="Sign in with your organization's token"
        description="This deployment verifies signed bearer tokens, but no identity provider or single sign-on redirect is configured."
      />
      <CardBody>
        <p className="text-sm text-slate-600">{description}</p>
      </CardBody>
    </Card>
  );
}

function ConfigFootnote({
  issuer,
  audience,
  ttlSeconds,
}: {
  issuer: string;
  audience: string;
  ttlSeconds: number;
}) {
  return (
    <p className="text-center text-xs text-slate-500">
      Tokens are issued by <span className="font-mono">{issuer}</span> for{" "}
      <span className="font-mono">{audience}</span> and expire after {ttlSeconds} seconds. Every
      request is verified server-side; this page never decides identity on its own.
    </p>
  );
}

/* ------------------------------ dev sign-in ------------------------------- */

function DevSignInCard({ devLoginEnabled }: { devLoginEnabled: boolean }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [role, setRole] = useState<RoleValue>("viewer");
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes("@")) {
      setError("Enter an email address for the synthetic account.");
      return;
    }
    setSubmitting(true);
    try {
      const request: DevLoginRequest = { email: trimmedEmail, role };
      if (displayName.trim()) request.display_name = displayName.trim();
      if (institutionId.trim()) {
        const id = Number(institutionId);
        if (!Number.isInteger(id) || id <= 0) {
          setError("The institution id must be a positive integer.");
          setSubmitting(false);
          return;
        }
        request.institution_id = id;
      }
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
    <Card>
      <CardHeader
        title="Development sign-in"
        description="Creates or reuses a synthetic local account and signs in with a real, server-verified token. This provider is disabled in production — it is not production authentication."
      />
      <CardBody>
        {!devLoginEnabled ? (
          <p role="alert" className="mb-4 text-sm text-rose-400">
            The development sign-in provider is disabled on this server.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-300">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              placeholder="reviewer@example.org"
              autoComplete="off"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-300">Display name (optional)</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
              placeholder="Synthetic Reviewer"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-300">Institution id (optional)</span>
            <input
              type="number"
              min={1}
              value={institutionId}
              onChange={(e) => setInstitutionId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-300">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleValue)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={platformAdmin}
              onChange={(e) => setPlatformAdmin(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900"
            />
            <span className="font-medium text-slate-300">
              Platform administrator (development only; grants cross-institution access)
            </span>
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={submitting || !devLoginEnabled}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/* ---------------------------- pasted-token sign-in ------------------------ */

function PastedTokenCard() {
  const { signInWithToken } = useAuth();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
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
    <Card>
      <CardHeader
        title="Use an existing token"
        description="Paste a bearer token issued for this deployment (for example by your organization's identity provider). The server verifies it before any access is granted."
      />
      <CardBody>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="font-medium text-slate-300">Bearer token</span>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white focus:border-indigo-500 focus:outline-none"
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            disabled={submitting || token.trim().length === 0}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50"
          >
            {submitting ? "Verifying..." : "Verify token and sign in"}
          </button>
        </form>
      </CardBody>
    </Card>
  );
}
