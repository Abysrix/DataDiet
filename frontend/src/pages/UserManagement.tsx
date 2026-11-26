import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { FOCUS_RING } from "../components/ui/control";
import { Spinner } from "../components/ui/Spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../components/ui/Table";
import { IconChevronRight, IconShield, IconUsers } from "../components/icons";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;

const NOT_IMPLEMENTED = [
  {
    title: "Directory browsing",
    detail: "No account list is loaded by this page; it shows only the current session profile.",
  },
  {
    title: "Role and membership changes",
    detail: "No form here grants, changes, or revokes an institution role.",
  },
  {
    title: "Account lifecycle edits",
    detail: "No create, activate, deactivate, invite, or delete control is exposed.",
  },
  {
    title: "Approval delegation and access-review export",
    detail: "No delegation rules or report are connected to this UI.",
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

/**
 * This page is a read-only explanation of `GET /auth/me`, not a directory
 * client. It makes role and institution scope legible while stating exactly
 * what was verified: a local authorization profile for this token, never an
 * institutional identity record or a person's real-world role.
 */
export default function UserManagement() {
  const { status, user, activeInstitutionId, has } = useAuth();
  const canManage = has("users:manage");

  return (
    <div>
      <PageHeader
        title="User Management"
        description="A read-only view of the authorization profile DataDiet verified for this browser session. No directory is loaded and no account operation is performed here."
        actions={<Badge tone="neutral">Read-only</Badge>}
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
        <div className="space-y-gutter">
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

          <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
            <Card className="xl:col-span-2">
              <CardHeader
                title="Management permission"
                description="Whether this session may call the server's user routes, and what this page does about it."
                action={
                  <Badge tone={canManage ? "info" : "neutral"}>
                    {canManage ? "Permission present" : "Permission absent"}
                  </Badge>
                }
              />
              <CardBody className="space-y-gutter">
                <div className="flex flex-wrap items-start gap-3">
                  <IconUsers className="h-5 w-5 shrink-0 text-ink-secondary" />
                  <p className="min-w-0 flex-1 text-supporting text-ink-secondary">
                    {canManage
                      ? "Your account holds users:manage, but this UI has no client for the directory routes. No account is created, changed, activated, or revoked from here."
                      : "Your account does not hold users:manage. The server would refuse directory-management requests, so none are attempted here."}
                  </p>
                </div>
                <p className="text-meta text-ink-muted">
                  Institution administrators manage policies and sources in their own scope; they
                  do not administer identities. Platform administration is a separate directory
                  flag.
                </p>
              </CardBody>
            </Card>

            <Card className="xl:col-span-3">
              <CardHeader
                title="Not implemented in this UI"
                description="Planned directory work, explicitly not wired to a form or a fake success state."
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
          </div>
        </div>
      )}
    </div>
  );
}
