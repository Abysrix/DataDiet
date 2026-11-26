import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RiskAssessmentList,
  RiskRules,
  UserProfile,
} from "../api/types";
import { testUser, withAuth } from "../test/auth";
import Archive from "./Archive";
import NotFound from "./NotFound";
import Reports from "./Reports";
import RiskAnalysis from "./RiskAnalysis";

const listRiskAssessments = vi.fn();
const getRiskRules = vi.fn();

vi.mock("../api/risk", () => ({
  listRiskAssessments: (...args: unknown[]) => listRiskAssessments(...args),
  getRiskRules: (...args: unknown[]) => getRiskRules(...args),
}));

function makeRules(): RiskRules {
  return {
    rule_set: "documented-risk-v1",
    maximum_score: 100,
    bands: [
      { band: "critical", minimum: 75, maximum: 100 },
      { band: "high", minimum: 50, maximum: 74 },
      { band: "moderate", minimum: 25, maximum: 49 },
      { band: "low", minimum: 0, maximum: 24 },
    ],
    rules: [
      {
        code: "personal_data",
        label: "Personal data present",
        points: 30,
        condition: "record contains personal data",
      },
    ],
  };
}

function makeAssessments(items: RiskAssessmentList["items"] = []): RiskAssessmentList {
  return { items, total: items.length, page: 1, per_page: 20, pages: 1 };
}

const sampleAssessment: RiskAssessmentList["items"][number] = {
  id: 1,
  asset_id: 10,
  asset_title: "Fictional enrolment extract",
  external_id: "SHOWCASE-ASSET-001",
  institution_id: 1,
  rule_set: "documented-risk-v1",
  score: 80,
  band: "critical",
  indicators: [
    {
      code: "personal_data",
      label: "Personal data present",
      points: 30,
      explanation: "Record is flagged as containing personal data (+30).",
    },
  ],
  assessed_at: "2026-11-27T10:00:00",
};

beforeEach(() => {
  listRiskAssessments.mockReset();
  getRiskRules.mockReset();
  getRiskRules.mockResolvedValue(makeRules());
  listRiskAssessments.mockResolvedValue(makeAssessments());
});

function renderRisk(user: UserProfile = testUser()): void {
  render(
    withAuth(
      <MemoryRouter initialEntries={["/risk"]}>
        <RiskAnalysis />
      </MemoryRouter>,
      user,
    ),
  );
}

describe("RiskAnalysis", () => {
  it("reads stored assessments and the documented rule table for the active scope", async () => {
    listRiskAssessments.mockResolvedValue(makeAssessments([sampleAssessment]));

    renderRisk();

    expect(await screen.findByText("Fictional enrolment extract")).toBeInTheDocument();
    expect(listRiskAssessments).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, per_page: 20, institution_id: 1, band: undefined }),
      expect.any(AbortSignal),
    );
    expect(getRiskRules).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(screen.getByText(/documented-risk-v1/)).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("explains a stored score from its indicators", async () => {
    listRiskAssessments.mockResolvedValue(makeAssessments([sampleAssessment]));

    renderRisk();
    await screen.findByText("Fictional enrolment extract");

    await userEvent.click(screen.getByText("Why this score"));
    expect(
      screen.getByText("Record is flagged as containing personal data (+30)."),
    ).toBeInTheDocument();
  });

  it("re-queries when the risk band filter changes", async () => {
    renderRisk();
    await screen.findByRole("heading", { name: /stored assessments/i });

    await userEvent.selectOptions(screen.getByLabelText("Risk band"), "high");

    await waitFor(() => {
      expect(listRiskAssessments).toHaveBeenLastCalledWith(
        expect.objectContaining({ band: "high", page: 1 }),
        expect.any(AbortSignal),
      );
    });
  });

  it("shows an honest empty state when no assessments are stored", async () => {
    renderRisk();

    expect(
      await screen.findByRole("heading", { name: /no stored assessments/i }),
    ).toBeInTheDocument();
  });

  it("shows a retryable error instead of inventing scores", async () => {
    listRiskAssessments.mockRejectedValue(new Error("risk service unavailable"));

    renderRisk();

    expect(await screen.findByRole("alert")).toHaveTextContent("risk service unavailable");
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(listRiskAssessments).toHaveBeenCalledTimes(2));
  });

  it("does not request data when inventory:read is absent", () => {
    renderRisk(testUser({ permissions: [] }));

    expect(
      screen.getByRole("heading", { name: /risk data is not available to this account/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/do not include inventory:read/i)).toBeInTheDocument();
    expect(screen.getByText(/no request was made/i)).toBeInTheDocument();
    expect(listRiskAssessments).not.toHaveBeenCalled();
    expect(getRiskRules).not.toHaveBeenCalled();
  });

  it("offers sign-in instead of a data request when unauthenticated", () => {
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
    expect(listRiskAssessments).not.toHaveBeenCalled();
  });

  it("offers no destructive control", async () => {
    renderRisk();
    await screen.findByRole("heading", { name: /stored assessments/i });

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
    expect(document.body).not.toHaveTextContent(/synthetic/i);
    expect(document.body).not.toHaveTextContent(/SYNTH-/i);
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
