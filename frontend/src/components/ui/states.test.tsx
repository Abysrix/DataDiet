import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DemoNotice } from "./DemoNotice";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Spinner } from "./Spinner";

describe("state components", () => {
  it("Spinner announces a loading status and marks it busy", () => {
    render(<Spinner label="Loading inventory…" />);
    const status = screen.getByRole("status");

    expect(status).toHaveTextContent("Loading inventory…");
    expect(status).toHaveAttribute("aria-busy", "true");
  });

  it("ErrorState shows the message and a retry action", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Inventory unavailable" message="Request failed" onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Request failed")).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toHaveAttribute("type", "button");
    expect(retry.className).toContain("focus-visible:outline-focus");
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("EmptyState explains what is missing", () => {
    const { container } = render(
      <EmptyState title="No records yet" message="Nothing has been inventoried." />,
    );

    expect(screen.getByText("No records yet")).toBeInTheDocument();
    expect(screen.getByText("Nothing has been inventoried.")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("DemoNotice pairs the synthetic-data label with a status glyph", () => {
    const { container } = render(<DemoNotice notice="SYNTH- assets only." />);

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Synthetic data.");
    expect(note).toHaveTextContent("SYNTH- assets only.");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
