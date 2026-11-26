import { Link } from "react-router-dom";
import type { Permission } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { FOCUS_RING } from "../components/ui/control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../components/ui/Table";
import { IconChevronRight, IconReports } from "../components/icons";

const LINK_CLASS = `inline-flex items-center gap-1 rounded-control font-medium text-accent-ink transition-colors hover:text-accent hover:underline ${FOCUS_RING}`;

interface Destination {
  need: string;
  to: string;
  label: string;
  permission: Permission;
  limit: string;
}

/** Existing, permission-aware views — never presented as generated reports. */
const DESTINATIONS: Destination[] = [
  {
    need: "What records the platform holds",
    to: "/inventory",
    label: "Data Inventory",
    permission: "inventory:read",
    limit: "Stored asset metadata, not a signed inventory certificate.",
  },
  {
    need: "Why a record is flagged",
    to: "/risk",
    label: "Risk Analysis",
    permission: "inventory:read",
    limit: "Rule-set results over synthetic fixtures, not an institutional risk register.",
  },
  {
    need: "What a human decided",
    to: "/recommendations",
    label: "Review Queue",
    permission: "retention:read",
    limit: "Advisory decisions with history, not an exported audit log.",
  },
  {
    need: "Which legal holds applied",
    to: "/holds",
    label: "Retention Holds",
    permission: "retention:read",
    limit: "Current hold records, not a compliance attestation.",
  },
];

const UNAVAILABLE = [
  {
    title: "Immutable audit log browsing",
    detail: "No audit-event query or export endpoint is connected to this UI.",
  },
  {
    title: "Inventory and retention certificates",
    detail: "No signing service or certificate format is implemented.",
  },
  {
    title: "Privacy posture trends over time",
    detail: "No historical reporting dataset is exposed by the API.",
  },
  {
    title: "Scheduled delivery by email",
    detail: "No mail provider or delivery integration exists.",
  },
];

/**
 * Reports is explicitly honest: there is nothing to download and nothing is
 * synthesized into a report. The table below only points to views whose data
 * the account can already read; each row states the limit a real report would
 * have to address.
 */
export default function Reports() {
  const { has } = useAuth();
  const available = DESTINATIONS.filter((destination) => has(destination.permission));

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Evidence you can inspect in existing views. This UI does not generate, export, sign, or schedule reports, and it does not turn synthetic demo data into a compliance artefact."
        actions={<Badge tone="neutral">No report generation</Badge>}
      />

      <div className="space-y-gutter">
        <Card>
          <CardHeader
            title="Reporting state"
            description="Read this before looking for a download button."
            action={<Badge tone="warning">Not implemented</Badge>}
          />
          <CardBody>
            <EmptyState
              title="No reports are generated in this UI"
              message="There is no report endpoint, audit-event export, inventory certificate, or scheduled delivery integration. Nothing is fabricated from the synthetic demo data, so there is no file to download here."
            />
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-gutter xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader
              title="What you can inspect today"
              description="Views with real navigation, each with the limit a report would need to make explicit."
            />
            {available.length === 0 ? (
              <CardBody>
                <EmptyState
                  title="No reporting-related views available"
                  message="Your server-verified permissions do not include any of the views listed here. No request was made and no link is offered for a destination the server would refuse."
                />
              </CardBody>
            ) : (
              <CardBody className="p-0">
                <Table caption="Available views that can inform a report, with their limits">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell scope="col">Question</TableHeaderCell>
                      <TableHeaderCell scope="col">Where to look</TableHeaderCell>
                      <TableHeaderCell scope="col">Limit</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {available.map((destination) => (
                      <TableRow key={destination.to}>
                        <TableCell className="font-medium text-ink">{destination.need}</TableCell>
                        <TableCell>
                          <Link to={destination.to} className={LINK_CLASS}>
                            {destination.label}
                            <IconChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </TableCell>
                        <TableCell>{destination.limit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            )}
            <CardBody className="border-t border-line text-meta text-ink-muted">
              Links are permission-aware usability aids. The backend re-checks every read; no
              report is assembled from these views.
            </CardBody>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader
              title="Still unavailable"
              description="Planned capabilities, not wired to a backend or provider."
            />
            <CardBody className="p-0">
              <ul className="divide-y divide-line">
                {UNAVAILABLE.map((item) => (
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

        <Card>
          <CardHeader
            title="Evidence boundary"
            description="What the existing views do and do not prove."
          />
          <CardBody>
            <div className="flex flex-wrap items-start gap-3">
              <IconReports className="h-5 w-5 shrink-0 text-ink-secondary" />
              <p className="min-w-0 flex-1 text-supporting text-ink-secondary">
                Risk figures are rule-set results over <span className="font-mono">SYNTH-</span>{" "}
                fixtures; inventory rows are stored asset metadata. Neither is a signed report.
                Audit events require authenticated actors and an export endpoint, neither of which
                is exposed by this UI.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
