import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShowcaseBanner } from "./ShowcaseBanner";

afterEach(() => {
  vi.unstubAllEnvs();
});

function renderBanner() {
  return render(
    <MemoryRouter>
      <ShowcaseBanner />
    </MemoryRouter>,
  );
}

describe("ShowcaseBanner", () => {
  it("renders an unmistakable prototype notice when the build opts in", () => {
    vi.stubEnv("VITE_SHOWCASE_MODE", "true");
    renderBanner();

    const notice = screen.getByRole("note", { name: /prototype data notice/i });
    expect(notice).toHaveTextContent("Prototype mode");
    expect(notice).toHaveTextContent("fictional sample data");
    expect(notice).toHaveTextContent("Azure SQL");
    expect(screen.getByRole("link", { name: /showcase guide/i })).toHaveAttribute(
      "href",
      "/showcase",
    );
  });

  it("renders nothing in a normal build", () => {
    vi.stubEnv("VITE_SHOWCASE_MODE", "false");
    expect(renderBanner().container).toBeEmptyDOMElement();
  });
});
