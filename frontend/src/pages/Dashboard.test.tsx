import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testUser, withAuth } from "../test/auth";
import type { UserProfile } from "../api/types";
import Dashboard from "./Dashboard";

function renderDashboard(user: UserProfile = testUser()): void {
  render(
    withAuth(
      <MemoryRouter initialEntries={["/"]}>
        <Dashboard />
      </MemoryRouter>,
      user,
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dashboard", () => {
  it("makes no data request and states honestly that no live summary is connected", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no data request is expected"));

    renderDashboard();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /no live dashboard data/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
    expect(document.body).not.toHaveTextContent(/synthetic/i);
    expect(document.body).not.toHaveTextContent(/SYNTH-/i);
  });

  it("keeps the next destinations the account can read", () => {
    renderDashboard();

    expect(screen.getByRole("link", { name: /review queue/i })).toHaveAttribute(
      "href",
      "/recommendations",
    );
    expect(screen.getByRole("link", { name: /inspect inventory/i })).toHaveAttribute(
      "href",
      "/inventory",
    );
  });

  it("omits a destination the account cannot open", () => {
    renderDashboard(testUser({ permissions: ["inventory:read"] }));

    expect(screen.queryByRole("link", { name: /review queue/i })).toBeNull();
    expect(screen.getByRole("link", { name: /inspect inventory/i })).toHaveAttribute(
      "href",
      "/inventory",
    );
  });
});
