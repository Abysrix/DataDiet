import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { FOCUS_RING } from "../components/ui/control";
import { IconArrowLeft, IconChevronRight } from "../components/icons";

const PRIMARY_LINK_CLASS = `inline-flex items-center justify-center gap-2 rounded-control bg-accent px-control-x py-control-y text-body font-medium text-on-accent transition-colors hover:bg-accent-hover ${FOCUS_RING}`;
const SECONDARY_LINK_CLASS = `inline-flex items-center gap-2 rounded-control px-control-x py-control-y text-body font-medium text-accent-ink transition-colors hover:bg-accent-surface ${FOCUS_RING}`;

/**
 * A calm recovery screen: one clear primary destination, optional secondary
 * routes the account can actually open, and no silent redirect.
 */
export default function NotFound() {
  const { status, has } = useAuth();
  const signedOut = status === "anonymous";
  const canReadInventory = has("inventory:read");
  const canReadRetention = has("retention:read");

  return (
    <div>
      <PageHeader
        title="Page not found"
        description="That address does not match a DataDiet screen. Nothing was loaded or changed."
        actions={<Badge tone="neutral">404</Badge>}
      />

      <Card>
        <CardHeader
          title="Return to a known view"
          description="Choose a destination your current session can actually open."
        />
        <CardBody>
          <EmptyState
            title="No screen at this address"
            message="Check the URL, or use one of the routes below. Unknown routes are never redirected silently, and no data request was made for this address."
            action={
              <div className="flex flex-wrap justify-center gap-gutter">
                {signedOut ? (
                  <Link to="/signin" className={PRIMARY_LINK_CLASS}>
                    Go to sign in
                    <IconArrowLeft className="h-4 w-4" />
                  </Link>
                ) : null}
                {!signedOut && canReadInventory ? (
                  <Link to="/" className={PRIMARY_LINK_CLASS}>
                    Back to dashboard
                    <IconArrowLeft className="h-4 w-4" />
                  </Link>
                ) : null}
                {!signedOut && canReadInventory ? (
                  <Link to="/inventory" className={SECONDARY_LINK_CLASS}>
                    Open data inventory
                    <IconChevronRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {!signedOut && canReadRetention ? (
                  <Link to="/recommendations" className={SECONDARY_LINK_CLASS}>
                    Open review queue
                    <IconChevronRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            }
          />
          {status === "loading" ? (
            <p className="mt-stack text-center text-meta text-ink-muted">
              Checking your session before offering recovery links…
            </p>
          ) : null}
          {!signedOut && status !== "loading" && !canReadInventory && !canReadRetention ? (
            <p className="mt-stack text-center text-supporting text-ink-muted">
              Your verified account has no routes available here. Sign out and use an account with
              the required permission.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
