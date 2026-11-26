import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { FOCUS_RING } from "../components/ui/control";
import { IconChevronRight } from "../components/icons";

const LINK_CLASS = `inline-flex min-h-9 items-center gap-1.5 rounded-control px-control-x py-control-y text-body font-medium transition-colors ${FOCUS_RING}`;
const PRIMARY_LINK = `${LINK_CLASS} bg-accent text-on-accent hover:bg-accent-hover`;
const SECONDARY_LINK = `${LINK_CLASS} bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-hover`;

/**
 * There is no live summary endpoint yet. The page says so instead of rendering
 * fixture figures, and keeps only the destinations the server-verified account
 * can actually open.
 */
export default function Dashboard() {
  const { has } = useAuth();

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="A live inventory and lifecycle summary will appear here when records are entered in the app. Until then this page makes no data request and shows no invented figures."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {has("retention:read") ? (
              <Link to="/recommendations" className={PRIMARY_LINK}>
                Review queue
                <IconChevronRight className="h-4 w-4" />
              </Link>
            ) : null}
            {has("inventory:read") ? (
              <Link to="/inventory" className={SECONDARY_LINK}>
                Inspect inventory
              </Link>
            ) : null}
          </div>
        }
      />

      <EmptyState
        title="No live dashboard data"
        message="No user-entered records are connected to this summary yet. The inventory and review views remain available above for the data the server has actually stored."
      />
    </div>
  );
}
