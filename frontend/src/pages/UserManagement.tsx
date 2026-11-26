/**
 * User Management: the verified session profile plus the real directory API.
 *
 * The directory section is available only to accounts holding the
 * server-verified `users:manage` permission. It calls the existing user routes:
 * list, create, activate/deactivate, and grant/change an institution role.
 * There is no password, invitation, identity-provider sync, or account deletion
 * here, and no success is shown until the server returns the written row.
 */

import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  createUser,
  listUsers,
  updateUser,
  upsertMembership,
} from "../api/users";
import type {
  DirectoryUser,
  RoleValue,
  UserProfile,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { FOCUS_RING } from "../components/ui/control";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../components/ui/Table";
import { IconChevronRight, IconRefresh, IconShield, IconUsers } from "../components/icons";
import { useApiQuery } from "../hooks/useApiQuery";
import { toErrorMessage } from "../api/client";
import { humanize } from "../lib/format";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;
const ROLES: RoleValue[] = ["viewer", "reviewer", "admin"];

const NOT_IMPLEMENTED = [
  {
    title: "Passwords and local signup",
    detail: "No credential is accepted, stored, or changed by this UI. Password signup is not implemented.",
  },
  {
    title: "Institutional identity synchronization",
    detail: "No external directory is contacted and no real person's identity is imported.",
  },
  {
    title: "Approval delegation and access-review export",
    detail: "No delegation rules or report are connected to this UI.",
  },
  {
    title: "Account deletion",
    detail: "No account is deleted. Deactivation is reversible and is recorded in the audit trail by the API.",
  },
];

function ProfileItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-body font-medium text-ink">{value}</dd>
    </div>
  );
}

interface Notice {
  tone: "success" | "critical";
  text: string;
}

function DirectoryNotice({ notice }: { notice: Notice | null }) {
  if (!notice) {
    return null;
  }
  return (
    <div
      role={notice.tone === "critical" ? "alert" : "status"}
      className={`rounded-card border px-card-x py-card-y text-supporting ${
        notice.tone === "critical"
          ? "border-critical-line bg-critical-surface text-critical-ink"
          : "border-success-line bg-success-surface text-success-ink"
      }`}
    >
      {notice.text}
    </div>
  );
}

function CreateAccountForm({
  onCreated,
}: {
  onCreated: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await createUser({ email, display_name: displayName });
      setEmail("");
      setDisplayName("");
      onCreated(`Created account #${user.id} <${user.email}>.`);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email" required>
        {(control) => (
          <Input
            {...control}
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="reviewer@example.org"
          />
        )}
      </Field>
      <Field label="Display name" required>
        {(control) => (
          <Input
            {...control}
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Reviewer"
          />
        )}
      </Field>
      {error ? <DirectoryNotice notice={{ tone: "critical", text: error }} /> : null}
      <Button type="submit" disabled={busy || !email || !displayName}>
        Create account
      </Button>
    </form>
  );
}

function MembershipForm({
  users,
  institutions,
  onChanged,
}: {
  users: DirectoryUser[];
  institutions: number[];
  onChanged: (user: DirectoryUser, message: string) => void;
}) {
  const [userId, setUserId] = useState<number | "">("");
  const [institutionId, setInstitutionId] = useState<number | "">("");
  const [role, setRole] = useState<RoleValue>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (userId === "" || institutionId === "") {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await upsertMembership(userId, {
        institution_id: institutionId,
        role,
        is_active: true,
      });
      onChanged(user, `Set institution #${institutionId} role to ${role}.`);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Account" required>
        {(control) => (
          <Select
            {...control}
            value={userId}
            onChange={(event) =>
              setUserId(event.target.value === "" ? "" : Number(event.target.value))
            }
          >
            <option value="">Select an account</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.display_name} (#{user.id})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Institution" required>
        {(control) => (
          <Select
            {...control}
            value={institutionId}
            onChange={(event) =>
              setInstitutionId(event.target.value === "" ? "" : Number(event.target.value))
            }
          >
            <option value="">Select an institution</option>
            {institutions.map((id) => (
              <option key={id} value={id}>
                Institution #{id}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Role" required>
        {(control) => (
          <Select
            {...control}
            value={role}
            onChange={(event) => setRole(event.target.value as RoleValue)}
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {error ? <DirectoryNotice notice={{ tone: "critical", text: error }} /> : null}
      <Button
        type="submit"
        disabled={busy || userId === "" || institutionId === "" || institutions.length === 0}
      >
        Grant or change role
      </Button>
    </form>
  );
}

function DirectoryManager({ session }: { session: UserProfile }) {
  const { data, loading, error, refetch } = useApiQuery((signal) => listUsers(signal), []);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const users = data ?? [];
  const institutions = Array.from(
    new Set([
      ...session.institutions,
      ...users.flatMap((user) => user.memberships.map((membership) => membership.institution_id)),
    ]),
  ).sort((a, b) => a - b);

  async function toggleActive(user: DirectoryUser): Promise<void> {
    setBusyId(user.id);
    setNotice(null);
    try {
      const updated = await updateUser(user.id, { is_active: !user.is_active });
      setNotice({
        tone: "success",
        text: `${updated.display_name} is now ${updated.is_active ? "active" : "inactive"}.`,
      });
      refetch();
    } catch (cause) {
      setNotice({ tone: "critical", text: toErrorMessage(cause) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-gutter">
      <DirectoryNotice notice={notice} />

      {error ? (
        <ErrorState title="Directory unavailable" message={error} onRetry={refetch} />
      ) : null}
      {loading && data === null ? (
        <Card>
          <CardHeader title="Loading directory" description="Reading accounts from the user API." />
          <CardBody>
            <Spinner label="Loading directory…" />
          </CardBody>
        </Card>
      ) : null}

      {data ? (
        <Card>
          <CardHeader
            title={`Directory accounts (${users.length})`}
            description="Local authorization records returned by the user API. No password or institutional identity is stored here."
            action={
              <Button variant="secondary" onClick={refetch} className="gap-1.5" disabled={loading}>
                <IconRefresh className="h-4 w-4" />
                Refresh
              </Button>
            }
          />
          {users.length === 0 ? (
            <CardBody>
              <EmptyState
                title="No directory accounts"
                message="The API returned no accounts in this deployment."
              />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Directory accounts">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell scope="col">Account</TableHeaderCell>
                    <TableHeaderCell scope="col">State</TableHeaderCell>
                    <TableHeaderCell scope="col">Administration</TableHeaderCell>
                    <TableHeaderCell scope="col">Memberships</TableHeaderCell>
                    <TableHeaderCell scope="col" align="right">
                      Action
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <p className="font-medium text-ink">{user.display_name}</p>
                        <p className="mt-0.5 break-all text-meta text-ink-muted">{user.email}</p>
                      </TableCell>
                      <TableCell>
                        <Badge tone={user.is_active ? "success" : "neutral"}>
                          {user.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.is_platform_admin ? (
                          <Badge tone="info">Platform admin</Badge>
                        ) : (
                          <span className="text-meta text-ink-muted">Institution role only</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.memberships.length === 0 ? (
                          <span className="text-meta text-ink-muted">None</span>
                        ) : (
                          <ul className="space-y-0.5 text-meta text-ink-secondary">
                            {user.memberships.map((membership) => (
                              <li key={membership.id}>
                                #{membership.institution_id} · {humanize(membership.role)} ·{" "}
                                {membership.is_active ? "active" : "inactive"}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyId === user.id}
                          onClick={() => void toggleActive(user)}
                        >
                          {user.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Create an account"
            description="The new local account has no memberships until a role is granted below."
          />
          <CardBody>
            <CreateAccountForm
              onCreated={(message) => {
                setNotice({ tone: "success", text: message });
                refetch();
              }}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Grant or change an institution role"
            description="Writes one membership through the user API; the server records the actor in the audit trail."
          />
          <CardBody>
            {institutions.length === 0 ? (
              <EmptyState
                title="No institution available"
                message="No institution is known from the session or the directory, so no role can be granted."
              />
            ) : (
              <MembershipForm
                users={users}
                institutions={institutions}
                onChanged={(_user, message) => {
                  setNotice({ tone: "success", text: message });
                  refetch();
                }}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/**
 * A session profile is shown to every signed-in account. Directory management
 * is mounted only after the server-verified permission check succeeds, so an
 * account without `users:manage` never provokes a refused request.
 */
export default function UserManagement() {
  const { status, user, activeInstitutionId, has } = useAuth();
  const canManage = has("users:manage");

  return (
    <div className="space-y-gutter">
      <PageHeader
        title="User Management"
        description="A verified view of this session plus the real local directory. Directory operations are available only when the server grants users:manage."
        actions={<Badge tone={canManage ? "info" : "neutral"}>{canManage ? "Directory access" : "Read-only"}</Badge>}
      />

      {status === "loading" ? (
        <Card>
          <CardHeader
            title="Session profile"
            description="Checking the identity the server verified for this session."
          />
          <CardBody>
            <Spinner label="Verifying your session…" />
          </CardBody>
        </Card>
      ) : null}

      {status === "anonymous" || !user ? (
        <Card>
          <CardHeader
            title="Session profile"
            description="No verified identity is available to display."
          />
          <CardBody>
            <EmptyState
              title="No verified session"
              message="User Management cannot show a role or scope without a profile returned by the server. No directory request was made."
              action={
                <Link to="/signin" className={LINK_CLASS}>
                  Go to sign in
                  <IconChevronRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Current session profile"
              description="Returned by GET /auth/me and checked against DataDiet's local directory."
              action={<Badge tone="info">Server-verified</Badge>}
            />
            <CardBody className="space-y-gutter">
              <dl className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
                <ProfileItem label="Display name" value={user.display_name} />
                <ProfileItem label="Email" value={user.email} />
                <ProfileItem label="Institution role" value={user.role ?? "No institution role"} />
                <ProfileItem
                  label="Platform administration"
                  value={user.is_platform_admin ? "Granted" : "Not granted"}
                />
              </dl>
              <dl className="grid grid-cols-1 gap-gutter sm:grid-cols-2">
                <ProfileItem
                  label="Active list scope"
                  value={
                    activeInstitutionId === null
                      ? "All institutions (unscoped)"
                      : `Institution #${activeInstitutionId}`
                  }
                />
                <ProfileItem
                  label="Institution memberships"
                  value={
                    user.institutions.length > 0
                      ? user.institutions.map((id) => `#${id}`).join(", ")
                      : "None"
                  }
                />
              </dl>
              <div className="flex flex-wrap items-start gap-3 rounded-card border border-line bg-surface-sunken px-card-x py-card-y">
                <IconShield className="h-5 w-5 shrink-0 text-ink-secondary" />
                <p className="min-w-0 flex-1 text-supporting text-ink-secondary">
                  This is the local directory record the server verified for this token. It is not
                  an institutional identity record or proof of a person&apos;s role outside this
                  application. Where an external provider is configured, the server performs the
                  binding; this page does not edit identity, role, or scope.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Verified permissions"
              description="The exact permission strings returned by /auth/me for this session."
              action={<Badge tone="neutral">Usability only</Badge>}
            />
            {user.permissions.length === 0 ? (
              <CardBody>
                <EmptyState
                  title="No permissions granted"
                  message="The server returned an empty permission set. Read endpoints will refuse this account; this page does not grant or request access."
                />
              </CardBody>
            ) : (
              <CardBody className="p-0">
                <Table caption="Permissions granted to the current session">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell scope="col">Permission</TableHeaderCell>
                      <TableHeaderCell scope="col" align="right">
                        State
                      </TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {user.permissions.map((permission) => (
                      <TableRow key={permission}>
                        <TableCell className="font-mono text-meta text-ink">{permission}</TableCell>
                        <TableCell align="right">
                          <Badge tone="success">Granted</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            )}
            <CardBody className="border-t border-line text-meta text-ink-muted">
              The directory is authoritative over token claims and the backend rechecks every
              request. This list explains the UI; it never authorizes an action.
            </CardBody>
          </Card>

          {status === "authenticated" && canManage ? (
            <DirectoryManager session={user} />
          ) : (
            <Card>
              <CardHeader
                title="Directory management permission"
                description="Whether this session may call the server's directory routes, and what this page does about it."
                action={<Badge tone="neutral">Permission absent</Badge>}
              />
              <CardBody className="flex items-start gap-3">
                <IconUsers className="h-5 w-5 shrink-0 text-ink-secondary" />
                <p className="text-supporting text-ink-secondary">
                  Your account does not hold users:manage. The server would refuse directory
                  requests, so none are attempted here.
                </p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Not implemented in this UI"
              description="Planned identity work, explicitly not wired to a form or a fake success state."
            />
            <CardBody className="p-0">
              <ul className="divide-y divide-line">
                {NOT_IMPLEMENTED.map((item) => (
                  <li key={item.title} className="px-card-x py-card-y">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-body font-medium text-ink">{item.title}</p>
                      <Badge tone="neutral">Not implemented</Badge>
                    </div>
                    <p className="mt-1 text-meta text-ink-muted">{item.detail}</p>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <p className="text-meta text-ink-muted">
            Directory records were last loaded on this page only; no timestamps are inferred.
            Membership audit events are written by the server, not by this component.
          </p>
        </>
      )}
    </div>
  );
}
