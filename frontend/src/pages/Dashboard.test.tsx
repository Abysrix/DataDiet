/**
 * Dashboard tests mock the API module: they fix the contract the page uses and
 * the states it renders, without embedding fixture figures in the page itself.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSummary } from "../api/types";
import { testUser, withAuth } from "../test/auth";
import Dashboard from "./Dashboard";

const getDashboardSummary = vi.fn();

vi.mock("../api/dashboard", () => ({
  getDashboardSummary: (...args: unknown[]) => getDashboardSummary(...args),
}));

function makeSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    institution_id: 1,
    total_assets: 8,
    lifecycle: {
      active: 5,
      under_review: 2,
      archived: 1,
      pending_disposal: 0,
    },
    sensitivity: {
      public: 2,
      internal: 2,
      confidential: 3,
      restricted: 1,
      unknown: 0,
    },
    risk_bands: { low: 3, moderate: 2, high: 2, critical: 1 },
    active_policies: 2,
    active_holds: 1,
    assessments: 6,
    decisions: 4,
    recommendations: {
      RETAIN: 2,
      ARCHIVE_RECOMMENDED: 0,
      REVIEW_REQUIRED: 3,
      DISPOSAL_REVIEW_REQUIRED: 1,
      BLOCKED_BY_HOLD: 0,
      NO_APPLICABLE_POLICY: 0,
    },
    scan_jobs: {
      PENDING: 0,
      RUNNING: 0,
      COMPLETED: 3,
      COMPLETED_WITH_ERRORS: 0,
      FAILED: 0,
      CANCELLED: 0,
    },
    scanned_records: 14,
    ...overrides,
  };
}

async function renderDashboard(user = testUser()): Promise<void> {
  render(
    withAuth(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
      user,
    ),
  );
  await screen.findByText("Assets in scope");
}

beforeEach(() => {
  getDashboardSummary.mockReset();
});

describe("Dashboard data request", () => {
  it("reads the summary for the active institution scope", async () => {
    getDashboardSummary.mockResolvedValue(makeSummary());
    await renderDashboard();

    expect(getDashboardSummary).toHaveBeenCalledWith(1, expect.any(AbortSignal));
  });

  it("leaves the scope unset for an unscoped platform administrator", async () => {
    getDashboardSummary.mockResolvedValue(makeSummary({ institution_id: null }));
    await renderDashboard(testUser({ is_platform_admin: true, institutions: [] }));

    expect(getDashboardSummary).toHaveBeenCalledWith(null, expect.any(AbortSignal));
  });

  it("does not request a summary without inventory:read", () => {
    render(
      withAuth(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>,
        testUser({ permissions: [] }),
      ),
    );

    expect(getDashboardSummary).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /dashboard data is not available to this account/i }),
    ).toBeInTheDocument();
  });

  it("does not request a summary while signed out", () => {
    render(
      withAuth(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>,
        null,
      ),
    );

    expect(getDashboardSummary).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toBeInTheDocument();
  });
});

describe("Dashboard rendering", () => {
  it("keeps the page rhythm with a labelled skeleton while the summary loads", () => {
    getDashboardSummary.mockReturnValue(new Promise(() => {}));
    render(
      withAuth(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>,
      ),
    );

    expect(
      screen.getByRole("status", { name: /loading dashboard summary/i }),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("groups figures into posture, one decision cue and two distributions", async () => {
    getDashboardSummary.mockResolvedValue(makeSummary());
    await renderDashboard();

    expect(screen.getByRole("heading", { name: "Current posture" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review queue" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Risk distribution" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lifecycle mix" })).toBeInTheDocument();
    expect(screen.getByText(/records scanned/i)).toBeInTheDocument();
  });

  it("shows only figures returned by the API", async () => {
    getDashboardSummary.mockResolvedValue(makeSummary());
    await renderDashboard();

    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("High / critical")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 active hold in scope/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review queue/i })).toHaveAttribute(
      "href",
      "/recommendations",
    );
    expect(screen.getByRole("link", { name: /inspect inventory/i })).toHaveAttribute(
      "href",
      "/inventory",
    );
  });

  it("renders an explicit empty state when the API returns zero assets", async () => {
    getDashboardSummary.mockResolvedValue(
      makeSummary({
        total_assets: 0,
        lifecycle: { active: 0, under_review: 0, archived: 0, pending_disposal: 0 },
        sensitivity: { public: 0, internal: 0, confidential: 0, restricted: 0, unknown: 0 },
        risk_bands: { low: 0, moderate: 0, high: 0, critical: 0 },
        scanned_records: 0,
      }),
    );
    await renderDashboard();

    expect(
      screen.getByRole("heading", { name: /no records in this scope/i }),
    ).toBeInTheDocument();
  });

  it("shows a retryable error instead of inventing figures", async () => {
    getDashboardSummary.mockRejectedValue(new Error("summary service unavailable"));
    render(
      withAuth(
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>,
      ),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("summary service unavailable");
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));
  });
});
