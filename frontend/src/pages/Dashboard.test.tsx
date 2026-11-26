import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSummary, Permission, UserProfile } from "../api/types";
import { DASHBOARD_SUMMARY, envelope } from "../test/fixtures";
import { testUser, withAuth } from "../test/auth";
import Dashboard from "./Dashboard";

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Server Error",
    json: async () => payload,
  } as Response;
}

function mockSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return { ...DASHBOARD_SUMMARY, ...overrides };
}

/** The card whose header carries this title. */
function cardByTitle(name: RegExp): HTMLElement {
  const card = screen.getByRole("heading", { name }).closest("section");
  if (!card) {
    throw new Error("No card section for that heading");
  }
  return card;
}

/** The metrics panel: a named region, so its entries can be read as a set. */
function ledger(): HTMLElement {
  return screen.getByRole("region", { name: "Summary metrics" });
}

/** One ledger entry, so its value and its hint can be read together. */
function metric(label: string): HTMLElement {
  const term = within(ledger()).getByText(label);
  expect(term.tagName).toBe("DT");
  const row = term.parentElement;
  if (!row) {
    throw new Error("Ledger entry is not paired with its value");
  }
  return row;
}

async function renderDashboard(
  summary: DashboardSummary = mockSummary(),
  user: UserProfile = testUser(),
): Promise<void> {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(envelope(summary)));
  render(
    withAuth(
      <MemoryRouter initialEntries={["/"]}>
        <Dashboard />
      </MemoryRouter>,
      user,
    ),
  );
  await waitFor(() => {
    expect(ledger()).toBeInTheDocument();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dashboard", () => {
  it("renders summary figures from the API envelope", async () => {
    await renderDashboard();

    expect(within(metric("Inventory records")).getByText("14")).toBeInTheDocument();
    expect(within(metric("Pending approvals")).getByText("3")).toBeInTheDocument();
    expect(within(ledger()).queryByText("Duplicate candidates")).toBeNull();
    expect(
      screen.getByText("Retention policy v3 draft created (synthetic)."),
    ).toBeInTheDocument();
  });

  it("requests the same dashboard endpoint it did before the redesign", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(envelope(mockSummary())),
    );
    render(
      withAuth(
        <MemoryRouter initialEntries={["/"]}>
          <Dashboard />
        </MemoryRouter>,
      ),
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/v1/demo/dashboard");
  });

  it("labels the data as synthetic", async () => {
    await renderDashboard();

    await waitFor(() => {
      expect(screen.getByRole("note")).toHaveTextContent(/SYNTHETIC DEMO DATA/i);
    });
  });

  it("ranks the next destinations and only offers areas the account can read", async () => {
    await renderDashboard();

    const review = screen.getByRole("link", { name: /review queue/i });
    expect(review).toHaveAttribute("href", "/recommendations");
    expect(screen.getByRole("link", { name: /inspect inventory/i })).toHaveAttribute(
      "href",
      "/inventory",
    );
  });

  it("omits a destination the account cannot open", async () => {
    await renderDashboard(mockSummary(), testUser({ permissions: ["inventory:read"] }));

    expect(screen.queryByRole("link", { name: /review queue/i })).toBeNull();
    expect(screen.getByRole("link", { name: /inspect inventory/i })).toHaveAttribute(
      "href",
      "/inventory",
    );
  });

  it("shows an error state with retry when the API is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    render(
      withAuth(
        <MemoryRouter initialEntries={["/"]}>
          <Dashboard />
        </MemoryRouter>,
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText(/could not reach the datadiet api/i)).toBeInTheDocument();
  });

  it("announces the loading state before the summary arrives", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(() => undefined));

    render(
      withAuth(
        <MemoryRouter initialEntries={["/"]}>
          <Dashboard />
        </MemoryRouter>,
      ),
    );

    expect(screen.getByRole("status")).toHaveTextContent(/loading dashboard summary/i);
  });

  it("keeps the page heading as the only heading level one", async () => {
    await renderDashboard();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("folds the two elevated risk bands into one headline figure", async () => {
    await renderDashboard();

    expect(within(metric("High or Critical risk")).getByText("8")).toBeInTheDocument();
    expect(metric("High or Critical risk")).toHaveTextContent(/of 14 risk-banded records/i);
  });

  it("states risk band counts and shares as text", async () => {
    await renderDashboard();

    const card = cardByTitle(/risk band distribution/i);
    expect(within(card).getByText("Critical (75–100)")).toBeInTheDocument();
    expect(within(card).getByText("21%")).toBeInTheDocument();
    expect(within(card).getAllByText("36%")).toHaveLength(2);
    expect(within(card).getByText("7%")).toBeInTheDocument();
  });

  it("measures each distribution against its own total, not the record count", async () => {
    await renderDashboard(
      mockSummary({
        total_records: 14,
        by_risk_band: { low: 0, moderate: 0, high: 5, critical: 5 },
      }),
    );

    const card = cardByTitle(/risk band distribution/i);
    expect(within(card).getAllByText("50%")).toHaveLength(2);
    expect(card).toHaveTextContent(/shares are of the 10 risk-banded records/i);
  });

  it("hides the decorative risk bar from assistive technology", async () => {
    await renderDashboard(mockSummary({ by_risk_band: { low: 0, moderate: 5, high: 5, critical: 4 } }));

    const card = cardByTitle(/risk band distribution/i);
    const bar = card.querySelector('div[aria-hidden="true"]');
    expect(bar).not.toBeNull();
    expect(bar?.children).toHaveLength(3);
  });

  it("says so when no record is risk-banded", async () => {
    await renderDashboard(mockSummary({ by_risk_band: { low: 0, moderate: 0, high: 0, critical: 0 } }));

    const card = cardByTitle(/risk band distribution/i);
    expect(within(card).getByText(/no records are risk-banded/i)).toBeInTheDocument();
    expect(within(card).getAllByText("—")).toHaveLength(4);
  });

  it("links attention items to the areas the account may already see", async () => {
    await renderDashboard();

    const card = cardByTitle(/attention required/i);
    expect(within(card).getByRole("link", { name: /duplicate candidates/i })).toHaveAttribute(
      "href",
      "/inventory",
    );
    expect(within(card).getByRole("link", { name: /marked for review/i })).toHaveAttribute(
      "href",
      "/recommendations",
    );
    expect(
      within(card).getByRole("link", { name: /retrieval requests \(not implemented\)/i }),
    ).toHaveAttribute("href", "/retrieval");
  });

  it("still reports an outstanding count it cannot link for this account", async () => {
    const inventoryOnly: Permission[] = ["inventory:read"];
    await renderDashboard(mockSummary(), testUser({ permissions: inventoryOnly }));

    const card = cardByTitle(/attention required/i);
    expect(within(card).getByRole("link", { name: /duplicate candidates/i })).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: /marked for review/i })).toBeNull();
    expect(within(card).getByText("Marked for review")).toBeInTheDocument();
    expect(
      within(card).queryByRole("link", { name: /retrieval requests \(not implemented\)/i }),
    ).toBeNull();
    expect(within(card).getByText("5")).toBeInTheDocument();
  });

  it("omits attention rows that have nothing outstanding", async () => {
    await renderDashboard(
      mockSummary({
        duplicate_candidates: 0,
        open_retrieval_requests: 0,
        by_retention_action: { retain: 8, archive: 4, review: 2, eligible_for_disposal: 0 },
      }),
    );

    const card = cardByTitle(/attention required/i);
    expect(within(card).queryByText("Duplicate candidates")).toBeNull();
    expect(within(card).queryByText("Marked eligible for disposal")).toBeNull();
    expect(within(card).queryByText("Retrieval requests (not implemented)")).toBeNull();
    expect(within(card).getByText("Marked for review")).toBeInTheDocument();
  });

  it("says so when nothing at all is outstanding", async () => {
    await renderDashboard(
      mockSummary({
        duplicate_candidates: 0,
        open_retrieval_requests: 0,
        by_retention_action: { retain: 14, archive: 0, review: 0, eligible_for_disposal: 0 },
      }),
    );

    expect(cardByTitle(/attention required/i)).toHaveTextContent(/nothing outstanding/i);
  });

  it("shows the sensitivity and action mixes with their own labels", async () => {
    await renderDashboard();

    const sensitivity = cardByTitle(/sensitivity distribution/i);
    expect(within(sensitivity).getByText("Restricted")).toBeInTheDocument();
    expect(within(sensitivity).getByText("14 records")).toBeInTheDocument();

    const actions = cardByTitle(/recommended action mix/i);
    expect(within(actions).getByText("Eligible for disposal")).toBeInTheDocument();
    expect(actions).toHaveTextContent(/advisory recommendations only/i);
  });

  it("marks activity dates as machine-readable times", async () => {
    await renderDashboard();

    const time = document.querySelector("time[datetime='2026-10-12']");
    expect(time).not.toBeNull();
    expect(time?.textContent).not.toBe("2026-10-12");
    expect(
      within(cardByTitle(/recent activity/i)).getByText("synthetic.user@example.edu"),
    ).toBeInTheDocument();
  });

  it("says so when the sample set has recorded no activity", async () => {
    await renderDashboard(mockSummary({ recent_activity: [] }));

    expect(cardByTitle(/recent activity/i)).toHaveTextContent(/no lifecycle events/i);
  });
});
