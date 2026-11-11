import { PageHeader } from "./PageHeader";
import { Badge } from "./ui/Badge";
import { Card, CardBody, CardHeader } from "./ui/Card";

export interface PlaceholderPageProps {
  title: string;
  description: string;
  /** Planned work, stated explicitly so nothing looks implemented. */
  planned: string[];
  plannedPhase: string;
}

/**
 * Honest placeholder for capabilities that are not built yet. It deliberately
 * shows no mock workflow: no buttons that pretend to scan, archive, or delete.
 */
export function PlaceholderPage({
  title,
  description,
  planned,
  plannedPhase,
}: PlaceholderPageProps) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <Card>
        <CardHeader
          title="Not implemented in this build"
          description={`Backend services, database access, and integrations for this area are planned for ${plannedPhase}.`}
        />
        <CardBody className="space-y-5">
          {/* The state is the finding, so it is labelled in the same role the
              status vocabulary uses for work that is designed but not built. */}
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="warning">Planned, not operational</Badge>
            <p className="text-supporting text-ink-muted">
              This screen exists so the navigation and information architecture are reviewable.
            </p>
          </div>
          <p className="max-w-3xl text-body text-ink-secondary">
            No scanning, archiving, retrieval, or deletion runs anywhere in the platform yet, and
            this page performs no data operations.
          </p>
          <div className="rounded-control border border-line bg-surface-sunken px-card-x py-card-y">
            <h2 className="text-eyebrow font-semibold uppercase text-ink-muted">
              Planned capabilities
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-ink-secondary">
              {planned.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
