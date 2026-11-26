/**
 * Retrieval requests — deliberately not implemented.
 *
 * This route is part of the lifecycle review area, but there is no request
 * intake, approval, restoration or audit endpoint behind it. The page therefore
 * does not fetch data, offer a form, simulate a success state, or connect to an
 * institutional system. It states what is absent and points only to read-only
 * areas the signed-in account is already allowed to see.
 *
 * The four prerequisites below are the ones the original roadmap named; they
 * remain unimplemented work, not a workflow disguised as a list.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Permission } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { IconClassification, IconHold, IconInfoCircle, IconReview } from "../components/icons";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

interface Destination {
  to: string;
  label: string;
  detail: string;
  permission: Permission;
  icon: ReactNode;
}

/** Read-only places that really exist, each gated by its own read permission. */
const DESTINATIONS: Destination[] = [
  {
    to: "/recommendations",
    label: "Review queue",
    detail: "Advisory recommendations and the decisions recorded against them.",
    permission: "retention:read",
    icon: <IconReview className="h-5 w-5" />,
  },
  {
    to: "/holds",
    label: "Retention holds",
    detail: "Active blocks that would have to be checked before any retrieval.",
    permission: "retention:read",
    icon: <IconHold className="h-5 w-5" />,
  },
  {
    to: "/classification",
    label: "Classification evidence",
    detail: "Metadata-only proposals and explainable data-quality findings.",
    permission: "governance:read",
    icon: <IconClassification className="h-5 w-5" />,
  },
];

/** Named prerequisites, not a fictional request process. */
const PREREQUISITES = [
  "Request intake with justification capture and duplicate-request detection",
  "An approver workflow tied to server-verified roles and active holds",
  "Scoped restoration of only the requested objects, never a wholesale restore",
  "A complete audit trail from request through to the objects restored",
];

export default function RetrievalRequests() {
  const { has } = useAuth();
  const destinations = DESTINATIONS.filter((destination) => has(destination.permission));

  return (
    <div className="space-y-gutter">
      <PageHeader
        title="Retrieval Requests"
        description="Review whether an archived record may be retrieved. No retrieval workflow exists yet: this page cannot intake, approve, fulfil or audit a request, and it performs none of those operations."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">Not implemented</Badge>
            {destinations.length > 0 ? (
              <Link
                to="/recommendations"
                className="inline-flex items-center gap-2 rounded-control px-control-x py-control-y text-supporting font-medium text-accent-ink ring-1 ring-inset ring-line-strong hover:bg-surface-hover"
              >
                <IconReview className="h-4 w-4" />
                Read-only review queue
              </Link>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader
          title="Retrieval is not implemented"
          description="There is no backend service, request record or institutional connector behind this area. It is planned for Phase 3 and remains unbuilt."
        />
        <CardBody className="space-y-4">
          <div
            role="note"
            className="flex flex-wrap items-start gap-3 rounded-card border border-info-line bg-info-surface px-card-x py-card-y"
          >
            <IconInfoCircle className="mt-0.5 h-5 w-5 shrink-0 text-info-ink" />
            <div className="min-w-0 space-y-1">
              <p className="text-supporting font-semibold text-info-ink">
                No request workflow is available
              </p>
              <p className="text-supporting text-info-ink">
                This page does not call an API, create a request, contact a source system or restore
                any object. Nothing here reports a request as submitted, approved or fulfilled.
              </p>
            </div>
          </div>
          <EmptyState
            title="No retrieval requests to review"
            message="There is no request endpoint to read from, so there is no list, loading or error state to show. An empty retrieval workflow would be a fabricated state; none is presented here."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What must exist before retrieval can be offered"
          description="These are unimplemented prerequisites. They are listed so a reviewer can tell the difference between a planned capability and one this console can perform."
        />
        <CardBody>
          <ol className="list-decimal space-y-2 pl-stack text-supporting text-ink-secondary">
            {PREREQUISITES.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
          <p className="mt-stack text-meta text-ink-muted">
            All four are absent today. No part of this list is wired to a control on this page.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What you can inspect today"
          description="Read-only lifecycle areas the server already supports, shown only where your account holds the matching read permission."
        />
        <CardBody>
          {destinations.length === 0 ? (
            <p className="text-supporting text-ink-secondary">
              Your account has no read permission for the lifecycle areas below. No destination is
              offered rather than linking to a page the server would refuse.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface">
              {destinations.map((destination) => (
                <li key={destination.to} className="flex flex-wrap items-start gap-3 px-card-x py-row-y">
                  <span className="shrink-0 text-ink-muted">{destination.icon}</span>
                  <div className="min-w-0">
                    <Link
                      to={destination.to}
                      className="text-supporting font-medium text-accent-ink hover:underline"
                    >
                      {destination.label}
                    </Link>
                    <p className="mt-0.5 break-words text-meta text-ink-muted">
                      {destination.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
