import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { FOCUS_RING } from "../components/ui/control";
import { IconChevronRight, IconShield } from "../components/icons";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;

function RiskHeader() {
  return (
    <PageHeader
      title="Risk Analysis"
      description="Explainable exposure indicators will appear here when user-entered records are available to assess. No sample scores are shown and nothing is scored automatically."
      actions={<Badge tone="neutral">Not connected yet</Badge>}
    />
  );
}

/**
 * The endpoint this page will use requires `inventory:read`. A client-side gate
 * is usability only — the backend re-checks every request — but it keeps a known
 * refusal from being presented as a retryable data error when no request was
 * ever made. No request is issued until a real assessments endpoint exists.
 */
export default function RiskAnalysis() {
  const { status, has } = useAuth();

  if (status === "loading") {
    return (
      <div>
        <RiskHeader />
        <Card>
          <CardHeader
            title="Risk access"
            description="Checking the permissions the server verified for this session."
          />
          <CardBody>
            <Spinner label="Verifying your session…" />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <div>
        <RiskHeader />
        <Card>
          <CardHeader
            title="Risk access"
            description="This screen needs a verified DataDiet session."
          />
          <CardBody>
            <EmptyState
              title="Sign in to view risk analysis"
              message="No identity has been verified for this browser, so no risk request was made."
              action={
                <Link to="/signin" className={LINK_CLASS}>
                  Go to sign in
                  <IconChevronRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!has("inventory:read")) {
    return (
      <div>
        <RiskHeader />
        <Card>
          <CardHeader
            title="Risk data is not available to this account"
            description="The server-verified permissions for this session do not include inventory:read."
            action={<Badge tone="neutral">Permission required</Badge>}
          />
          <CardBody className="space-y-gutter">
            <div className="flex items-start gap-3 rounded-card border border-line bg-surface-sunken px-card-x py-card-y">
              <IconShield className="h-5 w-5 shrink-0 text-ink-secondary" />
              <p className="text-supporting text-ink-secondary">
                The backend would refuse this request, so no request was made. This is shown as
                information, not as a disabled button or a retryable error.
              </p>
            </div>
            <p className="text-meta text-ink-muted">
              If this is unexpected, the account&apos;s directory permissions need to be reviewed
              outside this app. This page never grants or changes permissions.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <RiskHeader />
      <Card>
        <CardHeader
          title="Risk assessments"
          description="No endpoint is connected to this view yet."
          action={<Badge tone="neutral">Not implemented</Badge>}
        />
        <CardBody>
          <EmptyState
            title="No live risk assessments"
            message="There are no user-entered assessments to distribute, rank or explain. Risk figures will appear here only when records have been entered and assessed by the documented rule set."
          />
        </CardBody>
      </Card>
    </div>
  );
}
