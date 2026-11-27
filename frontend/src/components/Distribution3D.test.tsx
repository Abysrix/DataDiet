import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Distribution3D } from "./Distribution3D";

const items = [
  { label: "Low", value: 3, tone: "success" as const },
  { label: "Moderate", value: 2, tone: "warning" as const },
  { label: "High", value: 2, tone: "caution" as const },
  { label: "Critical", value: 1, tone: "critical" as const },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Distribution3D", () => {
  it("shows the same API counts as an accessible bar list when WebGL is unavailable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);

    render(<Distribution3D items={items} />);

    expect(await screen.findByText(/3d view unavailable here/i)).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps the counts visible when a canvas context cannot be created", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("context blocked");
    });

    render(<Distribution3D items={items} />);

    expect(await screen.findByText(/3d view unavailable here/i)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
