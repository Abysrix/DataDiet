import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RiskAnalysisPage, RiskRecordView, RiskRuleInfo, UserProfile } from "../api/types";
import { envelope } from "../test/fixtures";
import { platformAdmin, testUser, withAuth } from "../test/auth";
import Archive from "./Archive";
import NotFound from "./NotFound";
import Reports from "./Reports";
import RiskAnalysis from "./RiskAnalysis";
import UserManagement from "./UserManagement";

/**
 * `GET /api/v1/demo/risk` returns `DemoEnvelope[RiskAnalysisPage]`: a meta
 * envelope plus `{ rule_set, rules[], records[] }` and nothing else — no
 * aggregates, no totals, no institution parameter. These fixtures mirror that
 * shape exactly, so a test fails if the page starts assuming a field the
 * backend does not send.
 */

const RULES: RiskRuleInfo[] = [
  { code: "personal_data", description: "Record contains personal data.", points: "+30" },
  {
    code: "sensitivity",
    description: "Sensitivity weighting (restricted +30, confidential +20, internal +10).",
    points: "+30 / +20 / +10",
  },
  { code: "duplicate", description: "Near-duplicate of another record.", points: "+10" },
  {
    code: "past_retention_review",
    description: "Retention deadline already reviewed.",
    points: "+20",
  },
  { code: "unmanaged_source", description: "Source is not under governance.", points: "+10" },
];

function indicator(code: string, points: number, label: string, explanation: string) {
  return { code, label, points, explanation };
}

/** Four records, one per band, indicators summing exactly to each score. */
const RECORDS: RiskRecordView[] = [
  {
    record_id: "SYNTH-0001",
    title: "Clinic patient contact list",
    sensitivity: "restricted",
    score: 90,
    band: "critical",
    indicators: [
      indicator("personal_data", 30, "Personal data", "Contains names and phone numbers."),
      indicator("sensitivity", 30, "Sensitivity", "Restricted sensitivity adds 30."),
      indicator("past_retention_review", 20, "Past retention", "Retention deadline passed."),
      indicator("duplicate", 10, "Duplicate", "Matches SYNTH-0007."),
    ],
  },
  {
    record_id: "SYNTH-0002",
    title: "Research participant consents",
    sensitivity: "confidential",
    score: 60,
    band: "high",
    indicators: [
      indicator("personal_data", 30, "Personal data", "Contains signed consent forms."),
      indicator("sensitivity", 20, "Sensitivity", "Confidential sensitivity adds 20."),
      indicator("duplicate", 10, "Duplicate", "Matches SYNTH-0009."),
    ],
  },
  {
    record_id: "SYNTH-0003",
    title: "Departmental shared drive index",
    sensitivity: "internal",
    score: 40,
    band: "moderate",
    indicators: [
      indicator("sensitivity", 10, "Sensitivity", "Internal sensitivity adds 10."),
      indicator("unmanaged_source", 10, "Unmanaged source", "Source has no owner."),
      indicator("past_retention_review", 20, "Past retention", "Archive review overdue."),
    ],
  },
  {
    record_id: "SYNTH-0004",
    title: "Public event programme",
    sensitivity: "public",
    score: 10,
    band: "low",
    indicators: [indicator("sensitivity", 10, "Sensitivity", "Internal sensitivity adds 10.")],
  },
];

function page(overrides: Partial<RiskAnalysisPage> = {}): RiskAnalysisPage {
  return { rule_set: "datadiet-risk-indicators-v1", rules: RULES, records: RECORDS, ...overrides };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Not Found",
    json: async () => payload,
  } as Response;
}

/** A FastAPI `HTTPException` body: `detail` as a plain string. */
function errorResponse(detail: string, status = 404): Response {
  return jsonResponse({ detail }, status);
}

function cardByTitle(name: RegExp): HTMLElement {
  const card = screen.getByRole("heading", { name }).closest("section");
  if (!card) {
    throw new Error("No card section for that heading");
  }
  return card;
}

/** One `<tbody>` row of the named card's table, matched by its first cell. */
function tableRow(card: HTMLElement, firstCellText: RegExp): HTMLTableRowElement {
  const row = [...card.querySelectorAll<HTMLTableRowElement>("tbody tr")].find((tr) =>
    firstCellText.test(tr.cells[0]?.textContent ?? ""),
  );
  if (!row) {
    throw new Error(`No table row matching ${String(firstCellText)}`);
  }
  return row;
}

async function renderRisk(
  overrides: Partial<RiskAnalysisPage> = {},
  user: UserProfile = testUser(),
): Promise<void> {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(envelope(page(overrides))));
  render(
    withAuth(
      <MemoryRouter initialEntries={["/risk"]}>
        <RiskAnalysis />
      </MemoryRouter>,
      user,
    ),
  );
  await waitFor(() => {
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RiskAnalysis", () => {
  it("requests the demo risk endpoint unchanged, with no invented parameters", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(envelope(page())));

    render(
      withAuth(
        <MemoryRouter initialEntries={["/risk"]}>
          <RiskAnalysis />
        </MemoryRouter>,
      ),
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/v1/demo/risk");
    expect(init).toMatchObject({ method: "GET" });
    expect(String(url)).not.toContain("institution");
  });

  it("shows the envelope's synthetic-data notice", async () => {
    await renderRisk();

    expect(screen.getByRole("note")).toHaveTextContent(/SYNTHETIC DEMO DATA/i);
    expect(screen.getByText(/in-process fixture/i)).toBeInTheDocument();
  });

  it("counts records per band and states the share as text", async () => {
    await renderRisk();

    const card = cardByTitle(/severity distribution/i);
    expect(within(card).getByRole("table")).toHaveAccessibleName(
      /records by risk band/i,
    );
    expect(tableRow(card, /critical/i).cells[2].textContent).toBe("1");
    expect(tableRow(card, /critical/i).cells[3].textContent).toBe("25%");
    expect(tableRow(card, /low/i).cells[3].textContent).toBe("25%");
    expect(card).toHaveTextContent(/share of the 4 assessed records/i);
  });

  it("folds High and Critical into one exposure figure and names each figure's source", async () => {
    await renderRisk();

    const summary = cardByTitle(/risk exposure summary/i);
    expect(summary).toHaveTextContent(
      /records assessed\s*4\s*counted from the returned records/i,
    );
    expect(summary).toHaveTextContent(
      /high or critical\s*2 \(50%\)\s*counted from band fields by the documented rule set/i,
    );
    expect(summary).toHaveTextContent(
      /highest score\s*90\/100\s*rule-set score, capped at 100/i,
    );
    expect(summary).toHaveTextContent(
      /indicator points contributed\s*200\s*sum of the returned indicator points/i,
    );
    expect(summary).toHaveTextContent(/rule set datadiet-risk-indicators-v1/i);
    expect(summary).toHaveTextContent(/counts and shares above are derived only from the returned records/i);
  });

  it("measures category shares against contributed points, not record count", async () => {
    await renderRisk();

    const card = cardByTitle(/risk categories by contribution/i);
    const sensitivity = tableRow(card, /sensitivity weighting/i);
    expect(sensitivity.cells[1].textContent).toContain("4/4");
    expect(sensitivity.cells[2].textContent).toContain("+70");
    expect(sensitivity.cells[2].textContent).toContain("35%");
    expect(card).toHaveTextContent(/of the 200 indicator points contributed/i);
  });

  it("names the largest contributor using the rule catalogue's own wording", async () => {
    await renderRisk();

    expect(cardByTitle(/risk exposure summary/i)).toHaveTextContent(
      /largest single contributor is sensitivity weighting \(restricted \+30, confidential \+20, internal \+10\)\., present on 4 of 4 records and worth 70 points/i,
    );
  });

  it("keeps zero-count bands visible at 0% instead of dropping them", async () => {
    await renderRisk({
      records: [
        { ...RECORDS[0] },
        { ...RECORDS[0], record_id: "SYNTH-0002", title: "Second restricted register" },
      ],
    });

    const card = cardByTitle(/severity distribution/i);
    expect(tableRow(card, /critical/i).cells[2].textContent).toBe("2");
    expect(tableRow(card, /critical/i).cells[3].textContent).toBe("100%");
    expect(tableRow(card, /moderate/i).cells[2].textContent).toBe("0");
    expect(tableRow(card, /moderate/i).cells[3].textContent).toBe("0%");
    // Only the populated band is drawn, so the bar cannot imply an empty split.
    expect(card.querySelectorAll('div[aria-hidden="true"] > div')).toHaveLength(1);
  });

  it("says so when the endpoint returns no records", async () => {
    await renderRisk({ records: [] });

    expect(cardByTitle(/assessed records/i)).toHaveTextContent(
      /no assessments in this sample set/i,
    );
    expect(screen.queryByText(/records assessed/i)).toBeNull();
    // The rule set still explains how a score would be built.
    expect(cardByTitle(/indicator rules/i)).toHaveTextContent(/personal data/i);
  });

  it("says so when a payload has no rule definitions", async () => {
    await renderRisk({ rules: [] });

    expect(cardByTitle(/indicator rules/i)).toHaveTextContent(
      /endpoint returned no rule definitions/i,
    );
  });

  it("announces loading first, then replaces the skeleton with real figures", async () => {
    let resolve: ((value: Response) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );

    render(
      withAuth(
        <MemoryRouter initialEntries={["/risk"]}>
          <RiskAnalysis />
        </MemoryRouter>,
      ),
    );

    expect(screen.getByRole("status")).toHaveTextContent(/loading risk assessments/i);
    expect(screen.queryByText(/records assessed/i)).toBeNull();

    // The request is issued only after the client has resolved its bearer
    // credential (Phase 6.0), which is one microtask after render — so wait for
    // the request to exist before answering it. Loading is still what shows.
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/loading risk assessments/i);
    expect(resolve).toBeDefined();
    resolve!(jsonResponse(envelope(page())));
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
    expect(cardByTitle(/risk exposure summary/i)).toBeInTheDocument();
  });

  it("shows the API detail and retries successfully", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(errorResponse("Synthetic demo endpoints are disabled in this environment."))
      .mockResolvedValue(jsonResponse(envelope(page())));

    render(
      withAuth(
        <MemoryRouter initialEntries={["/risk"]}>
          <RiskAnalysis />
        </MemoryRouter>,
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /synthetic demo endpoints are disabled in this environment/i,
    );

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cardByTitle(/risk exposure summary/i)).toBeInTheDocument();
  });

  it("explains a connectivity failure through the shared client message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

    render(
      withAuth(
        <MemoryRouter initialEntries={["/risk"]}>
          <RiskAnalysis />
        </MemoryRouter>,
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not reach the datadiet api/i);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/is the backend running/i);
  });

  it("fetches once for a multi-institution admin: the endpoint takes no scope", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(envelope(page())));

    render(
      withAuth(
        <MemoryRouter initialEntries={["/risk"]}>
          <RiskAnalysis />
        </MemoryRouter>,
        platformAdmin({ institutions: [1, 2, 3] }),
      ),
    );

    await waitFor(() => {
      expect(cardByTitle(/risk exposure summary/i)).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).not.toMatch(/institution|scope/i);
    expect(cardByTitle(/risk exposure summary/i)).toHaveTextContent(
      /this endpoint is not institution-scoped/i,
    );
  });

  it("states every bar's value as text and hides the bars themselves", async () => {
    await renderRisk();

    const bars = document.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
    expect(bars.length).toBeGreaterThanOrEqual(3);
    bars.forEach((bar) => {
      expect(bar.getAttribute("role")).toBeNull();
      expect(bar.getAttribute("aria-label")).toBeNull();
    });

    // Each hidden bar sits beside the number it represents.
    const severity = cardByTitle(/severity distribution/i);
    expect(within(severity).getByRole("table")).toHaveAccessibleName(
      /records by risk band/i,
    );
    const categories = cardByTitle(/risk categories by contribution/i);
    expect(within(categories).getByRole("table")).toHaveAccessibleName(
      /indicator contribution/i,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Risk Analysis" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("lists elevated records in the order the endpoint returned them", async () => {
    await renderRisk();

    const card = cardByTitle(/where to start/i);
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/clinic patient contact list/i);
    expect(items[0]).toHaveTextContent(/90\/100/i);
    expect(items[0]).toHaveTextContent(/SYNTH-0001/i);
    expect(items[0]).toHaveTextContent(/largest contributor: personal data \(\+30\)/i);
    expect(items[1].textContent).toMatch(/research participant consents/i);
    expect(card).toHaveTextContent(/in the order the endpoint returns them/i);
  });

  it("says so when nothing sits in an elevated band", async () => {
    await renderRisk({
      records: [{ ...RECORDS[3], band: "moderate", score: 30 }],
    });

    expect(cardByTitle(/where to start/i)).toHaveTextContent(
      /no record in this sample set sits in a high or critical band/i,
    );
    expect(cardByTitle(/where to start/i)).toHaveTextContent(/highest score here is 30\/100/i);
  });

  it("expands a record to its indicator breakdown", async () => {
    await renderRisk();

    const row = screen.getByText("SYNTH-0004").closest("li");
    const disclosure = row?.querySelector("details");
    const summary = disclosure?.querySelector("summary");
    if (!disclosure || !summary) {
      throw new Error("Record without indicators has no disclosure");
    }
    expect(summary.textContent).toMatch(/show 1 contributing indicator/i);

    await userEvent.click(summary);

    expect((disclosure as HTMLDetailsElement).open).toBe(true);
    expect(within(disclosure as HTMLElement).getByText("Internal sensitivity adds 10.")).toBeInTheDocument();
    expect(within(disclosure as HTMLElement).getByText("+10")).toBeInTheDocument();
    expect(within(disclosure as HTMLElement).getByText("sensitivity")).toBeInTheDocument();
  });

  it("explains the score of every returned record", async () => {
    await renderRisk();

    const card = cardByTitle(/assessed records/i);
    expect(within(card).getByText("4 records")).toBeInTheDocument();
    expect(within(card).getByText(/show 4 contributing indicators/i)).toBeInTheDocument();
    expect(within(card).getAllByText(/90\/100/i)).toHaveLength(1);
    expect(within(card).getAllByText(/matches synth-0007/i)).toHaveLength(1);
  });

  it("says so when a record carries no indicator", async () => {
    await renderRisk({ records: [{ ...RECORDS[3], indicators: [] }] });

    expect(screen.getByText(/no risk indicator applied to this record/i)).toBeInTheDocument();
  });

  it("links only to the inventory view, never to a fixture record", async () => {
    await renderRisk();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/inventory");
    expect(links[0]).toHaveAccessibleName(/open the inventory view/i);
    expect(cardByTitle(/risk exposure summary/i)).toHaveTextContent(
      /not rows in the inventory database, so no record here opens an asset page/i,
    );
  });

  it("filters returned records by band without recalculating their scores", async () => {
    await renderRisk();

    const card = cardByTitle(/assessed records/i);
    const filter = within(card).getByLabelText(/filter assessed records by band/i);
    expect(filter).toHaveValue("all");
    expect(within(card).getByText(/showing 4 of 4 returned records/i)).toBeInTheDocument();

    await userEvent.selectOptions(filter, "high");
    expect(within(card).getByText(/showing 1 of 4 returned records/i)).toBeInTheDocument();
    expect(within(card).getByText("SYNTH-0002")).toBeInTheDocument();
    expect(within(card).queryByText("SYNTH-0001")).toBeNull();
    expect(within(card).getByText("60/100")).toBeInTheDocument();
    expect(card).toHaveTextContent(/filtering changes only which returned rows are listed/i);
    expect(card).toHaveTextContent(/never recalculates a score/i);

    await userEvent.selectOptions(filter, "all");
    expect(within(card).getByText("SYNTH-0001")).toBeInTheDocument();
  });

  it("offers a reset when a band filter has no returned records", async () => {
    await renderRisk({ records: [{ ...RECORDS[3] }] });

    const card = cardByTitle(/assessed records/i);
    const filter = within(card).getByLabelText(/filter assessed records by band/i);
    await userEvent.selectOptions(filter, "high");

    expect(
      within(card).getByRole("heading", { name: /no returned records in this band/i }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent(/does not create an assessment/i);

    await userEvent.click(within(card).getByRole("button", { name: /show all bands/i }));
    expect(within(card).getByText("SYNTH-0004")).toBeInTheDocument();
    expect(filter).toHaveValue("all");
  });

  it("makes no request when inventory:read is absent", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(envelope(page())));

    render(
      withAuth(
        <MemoryRouter initialEntries={["/risk"]}>
          <RiskAnalysis />
        </MemoryRouter>,
        testUser({ permissions: [] }),
      ),
    );

    expect(
      screen.getByRole("heading", { name: /risk data is not available to this account/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/do not include inventory:read/i)).toBeInTheDocument();
    expect(screen.getByText(/no request was made/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers sign-in instead of a data request when unauthenticated", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(envelope(page())));

    render(
      withAuth(
        <MemoryRouter initialEntries={["/risk"]}>
          <RiskAnalysis />
        </MemoryRouter>,
        null,
      ),
    );

    expect(
      screen.getByRole("heading", { name: /sign in to view risk analysis/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute(
      "href",
      "/signin",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers no destructive control", async () => {
    await renderRisk();

    expect(screen.queryByRole("button", { name: /delete|dispose|archive|purge/i })).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});

describe("Reports", () => {
  it("states that no report is generated and offers only permission-aware views", () => {
    render(
      withAuth(
        <MemoryRouter initialEntries={["/reports"]}>
          <Reports />
        </MemoryRouter>,
      ),
    );

    expect(
      screen.getByRole("heading", { name: /no reports are generated in this ui/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/not implemented/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("table", { name: /available views that can inform a report/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^data inventory$/i })).toHaveAttribute(
      "href",
      "/inventory",
    );
    expect(screen.queryByRole("button", { name: /download|export|generate|schedule/i })).toBeNull();
  });

  it("shows an empty state rather than links the account cannot read", () => {
    render(
      withAuth(
        <MemoryRouter initialEntries={["/reports"]}>
          <Reports />
        </MemoryRouter>,
        testUser({ permissions: [] }),
      ),
    );

    expect(
      screen.getByRole("heading", { name: /no reporting-related views available/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("Archive", () => {
  it("makes the missing capability unmistakable and offers no lifecycle control", () => {
    render(
      withAuth(
        <MemoryRouter initialEntries={["/archive"]}>
          <Archive />
        </MemoryRouter>,
      ),
    );

    expect(
      screen.getByRole("heading", { name: /no archive operations are available/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no storage-provider integration/i)).toBeInTheDocument();
    expect(screen.getByText(/no manifest is created/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /archive|restore|verify|delete|dispose|purge/i }),
    ).toBeNull();
  });
});

describe("UserManagement", () => {
  it("shows the verified role and scope without implying account edits", () => {
    render(
      withAuth(
        <MemoryRouter initialEntries={["/users"]}>
          <UserManagement />
        </MemoryRouter>,
        platformAdmin({ institutions: [1, 2] }),
      ),
    );

    expect(
      screen.getByRole("heading", { name: /current session profile/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Synthetic Platform Admin")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("All institutions (unscoped)")).toBeInTheDocument();
    expect(screen.getByText("#1, #2")).toBeInTheDocument();
    expect(screen.getAllByText("Granted").length).toBeGreaterThan(0);
    expect(screen.getByText(/local directory record the server verified/i)).toBeInTheDocument();
    expect(screen.getByText(/not an institutional identity record/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /create|invite|edit|revoke|deactivate/i }),
    ).toBeNull();
  });

  it("explains a missing users:manage permission without attempting an operation", () => {
    render(
      withAuth(
        <MemoryRouter initialEntries={["/users"]}>
          <UserManagement />
        </MemoryRouter>,
        testUser(),
      ),
    );

    expect(screen.getByText(/does not hold users:manage/i)).toBeInTheDocument();
    expect(screen.getByText(/none are attempted here/i)).toBeInTheDocument();
  });

  it("shows an empty session state instead of inventing a profile", () => {
    render(
      withAuth(
        <MemoryRouter initialEntries={["/users"]}>
          <UserManagement />
        </MemoryRouter>,
        null,
      ),
    );

    expect(screen.getByRole("heading", { name: /no verified session/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute(
      "href",
      "/signin",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("NotFound", () => {
  it("offers a calm, permission-aware recovery path", () => {
    render(
      withAuth(
        <MemoryRouter initialEntries={["/does-not-exist"]}>
          <NotFound />
        </MemoryRouter>,
        testUser(),
      ),
    );

    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /back to dashboard/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /open data inventory/i })).toHaveAttribute(
      "href",
      "/inventory",
    );
    expect(screen.getByRole("link", { name: /open review queue/i })).toHaveAttribute(
      "href",
      "/recommendations",
    );
  });

  it("offers sign-in as the only recovery route when signed out", () => {
    render(
      withAuth(
        <MemoryRouter initialEntries={["/does-not-exist"]}>
          <NotFound />
        </MemoryRouter>,
        null,
      ),
    );

    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute(
      "href",
      "/signin",
    );
    expect(screen.queryByRole("link", { name: /back to dashboard/i })).toBeNull();
  });
});
