import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { FOCUS_RING } from "../components/ui/control";
import { IconArchive, IconChevronRight, IconShield } from "../components/icons";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;

const REASONS = [
  {
    title: "No storage integration",
    detail: "There is no provider-neutral object-store client or local development backend wired here.",
  },
  {
    title: "No approval and audit path",
    detail: "A state-changing lifecycle action needs documented human approval and an auditable actor before it can exist.",
  },
  {
    title: "No manifest or checksum",
    detail: "This UI cannot produce a SHA-256 manifest or verify drift, so it shows no integrity status.",
  },
  {
    title: "No restore path",
    detail: "Retrieval requests remain a separate, advisory area; nothing here can restore an object.",
  },
];

/**
 * Archive is deliberately inert. The wording states the absence rather than
 * hiding it behind disabled controls, and there is no fake manifest, checksum,
 * provider status, or lifecycle action.
 */
export default function Archive() {
  const { has } = useAuth();
  const canReadInventory = has("inventory:read");
  const canReadRetention = has("retention:read");
  const hasDestination = canReadInventory || canReadRetention;

  return (
    <div>
      <PageHeader
        title="Archive"
        description="Cold storage and integrity verification are not implemented in this UI. No object is moved, no manifest is created, no checksum is verified, and no file is deleted here."
        actions={<Badge tone="neutral">No lifecycle action</Badge>}
      />

      <div className="space-y-gutter">
        <Card>
          <CardHeader
            title="Archive state"
            description="The capability is absent, not pending a click."
            action={<Badge tone="warning">Not implemented</Badge>}
          />
          <CardBody>
            <EmptyState
              title="No archive operations are available"
              message="This screen has no storage-provider integration, no manifest, no restore path, and no integrity check. It does not present disabled buttons as if an operation could run, and no placeholder archive rows are shown."
              action={
                hasDestination ? (
                  <div className="flex flex-wrap justify-center gap-gutter">
                    {canReadInventory ? (
                      <Link to="/inventory" className={LINK_CLASS}>
                        View data inventory
                        <IconChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : null}
                    {canReadRetention ? (
                      <Link to="/retention" className={LINK_CLASS}>
                        Review retention rules
                        <IconChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : null}
                  </div>
                ) : undefined
              }
            />
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader
              title="Why this page stays inert"
              description="Each missing piece is a prerequisite for a safe archive workflow."
            />
            <CardBody className="p-0">
              <ol className="divide-y divide-line">
                {REASONS.map((reason, index) => (
                  <li key={reason.title} className="px-card-x py-card-y">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-meta font-semibold tabular-nums text-ink-subtle">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <p className="text-body font-medium text-ink">{reason.title}</p>
                    </div>
                    <p className="mt-1 text-meta text-ink-muted">{reason.detail}</p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader
              title="Related view"
              description="Inventory state is real; archive state does not exist here."
            />
            <CardBody className="space-y-gutter">
              <div className="flex flex-wrap items-start gap-3">
                <IconArchive className="h-5 w-5 shrink-0 text-ink-secondary" />
                <p className="min-w-0 flex-1 text-supporting text-ink-secondary">
                  The inventory list can show an asset&apos;s lifecycle status. That field is
                  metadata, not proof that a file was archived, restored, or disposed of.
                </p>
              </div>
              {canReadInventory ? (
                <Link to="/inventory" className={LINK_CLASS}>
                  Open data inventory
                  <IconChevronRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <p className="text-meta text-ink-muted">
                  Your account does not have <span className="font-mono">inventory:read</span>, so
                  no inventory link is offered.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Safety boundary"
            description="What this page will never do in this phase."
          />
          <CardBody>
            <div className="flex flex-wrap items-start gap-3">
              <IconShield className="h-5 w-5 shrink-0 text-ink-secondary" />
              <p className="min-w-0 flex-1 text-supporting text-ink-secondary">
                There is no automatic deletion, bulk disposal, or irreversible operation here.
                Lifecycle actions require a documented policy evaluation and explicit human
                approval; none of those mechanisms are implemented in this UI.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
