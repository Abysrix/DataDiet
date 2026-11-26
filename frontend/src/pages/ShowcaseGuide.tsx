import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { FOCUS_RING } from "../components/ui/control";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;

const STEPS = [
  {
    title: "Dashboard",
    to: "/",
    detail: "Counts and posture come from real database rows, not a canned figure.",
  },
  {
    title: "Sources & Scans",
    to: "/sources",
    detail: "Validate the synthetic source and run a scan; the server stores the job and its results.",
  },
  {
    title: "Data Inventory",
    to: "/inventory",
    detail: "Filter and page the records stored in Azure SQL; create or edit one through the asset API.",
  },
  {
    title: "Risk Analysis",
    to: "/risk",
    detail: "Read explainable score bands and the indicators behind each band.",
  },
  {
    title: "Classification",
    to: "/classification",
    detail: "Run the rule-based classifier and inspect evidence, conflicts and data quality.",
  },
  {
    title: "Retention Policies",
    to: "/retention",
    detail: "Show versioned policies, then activate a reviewed version.",
  },
  {
    title: "Retention Holds",
    to: "/holds",
    detail: "Create and release a hold; the review queue then reflects the block.",
  },
  {
    title: "Review Queue",
    to: "/recommendations",
    detail: "Record a human decision against an assessment and see supersession handled.",
  },
  {
    title: "User Management",
    to: "/users",
    detail: "Inspect the verified identity and its permissions; manage local accounts and memberships.",
  },
];

const DEFERRED = [
  {
    title: "Archive execution",
    detail: "No storage provider, manifest, checksum verification, move or deletion is wired.",
  },
  {
    title: "Retrieval fulfilment",
    detail: "No restore workflow exists; the request area does not pretend to fulfil one.",
  },
  {
    title: "Report export",
    detail: "Evidence views are read-only; there is no signed export or scheduled report.",
  },
  {
    title: "Password signup",
    detail: "This prototype uses the documented development sign-in path, not local passwords.",
  },
  {
    title: "Private workspaces",
    detail: "Tenant isolation and owner oversight are planned for the next module, not shipped here.",
  },
];

/**
 * A presentation script, not a capability claim. Every linked screen reads or
 * writes Azure SQL through the real API. Deferred items stay in the open.
 */
export default function ShowcaseGuide() {
  return (
    <div>
      <PageHeader
        title="Showcase guide"
        description="A short walkthrough of what this prototype really does, and what it deliberately does not."
        actions={<Badge tone="warning">Prototype only</Badge>}
      />

      <div className="space-y-gutter">
        <Card>
          <CardHeader
            title="Read this first"
            description="The honesty boundary for today's demonstration."
          />
          <CardBody>
            <p className="text-supporting text-ink-secondary">
              All records shown here are fictional sample data written to Azure SQL by a reviewed
              operator script and read back through the real API. They are not real institutional
              records and contain no real personal data. This is a time-boxed showcase build
              (ADR-0032), not the production-ready multi-tenant release.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Demonstration path"
            description="Follow these links in order; each one exercises a real workflow."
          />
          <CardBody className="p-0">
            <ol className="divide-y divide-line">
              {STEPS.map((step, index) => (
                <li key={step.title} className="px-card-x py-card-y">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-meta font-semibold tabular-nums text-ink-subtle">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-body font-medium text-ink">{step.title}</h3>
                  </div>
                  <p className="mt-1 text-meta text-ink-muted">{step.detail}</p>
                  <Link to={step.to} className={`mt-2 text-meta ${LINK_CLASS}`}>
                    Open {step.title}
                  </Link>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Not implemented in this prototype"
            description="These items are shown as roadmap, never as working features."
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {DEFERRED.map((item) => (
                <li key={item.title} className="px-card-x py-card-y">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-body font-medium text-ink">{item.title}</h3>
                    <Badge tone="warning">Not implemented</Badge>
                  </div>
                  <p className="mt-1 text-meta text-ink-muted">{item.detail}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
