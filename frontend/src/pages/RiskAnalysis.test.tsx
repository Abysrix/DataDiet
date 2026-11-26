import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "../api/types";
import { platformAdmin, testUser, withAuth } from "../test/auth";
import Archive from "./Archive";
import NotFound from "./NotFound";
import Reports from "./Reports";
import RiskAnalysis from "./RiskAnalysis";
import UserManagement from "./UserManagement";

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RiskAnalysis", () => {
  it("makes no data request and states honestly that no live assessments are connected", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no data request is expected"));

    renderRisk();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /no live risk assessments/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
    expect(document.body).not.toHaveTextContent(/synthetic sample/i);
    expect(document.body).not.toHaveTextContent(/SYNTH-/i);
  });

  it("does not request data when inventory:read is absent", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no data request is expected"));

    renderRisk(testUser({ permissions: [] }));

    expect(
      screen.getByRole("heading", { name: /risk data is not available to this account/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/do not include inventory:read/i)).toBeInTheDocument();
    expect(screen.getByText(/no request was made/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers sign-in instead of a data request when unauthenticated", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no data request is expected"));

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

  it("offers no destructive control", () => {
    renderRisk();

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
