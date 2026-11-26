import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { platformAdmin, withAuth } from "../test/auth";
import ShowcaseGuide from "./ShowcaseGuide";

function renderGuide() {
  return render(
    withAuth(
      <MemoryRouter>
        <ShowcaseGuide />
      </MemoryRouter>,
      platformAdmin(),
    ),
  );
}

describe("ShowcaseGuide", () => {
  it("states plainly that the records are fictional and come from Azure SQL", () => {
    renderGuide();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Showcase guide");
    expect(screen.getByText(/fictional sample data/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Azure SQL/i).length).toBeGreaterThan(0);
  });

  it("walks the complete real workflow shown in the prototype", () => {
    renderGuide();

    for (const label of [
      "Dashboard",
      "Sources & Scans",
      "Data Inventory",
      "Risk Analysis",
      "Classification",
      "Retention Policies",
      "Retention Holds",
      "Review Queue",
      "User Management",
    ]) {
      expect(screen.getByText(label, { selector: "h3" })).toBeInTheDocument();
    }
  });

  it("does not claim the deferred capabilities are implemented", () => {
    renderGuide();

    for (const label of [
      "Archive execution",
      "Retrieval fulfilment",
      "Report export",
      "Password signup",
      "Private workspaces",
    ]) {
      expect(screen.getByText(label, { selector: "h3" })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/not implemented/i).length).toBeGreaterThanOrEqual(5);
  });
});
