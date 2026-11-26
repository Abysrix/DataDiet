import { afterEach, describe, expect, it, vi } from "vitest";
import { isShowcaseMode } from "./showcase";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("showcase mode detection", () => {
  it("is off unless the build opts in", () => {
    vi.stubEnv("VITE_SHOWCASE_MODE", "");
    expect(isShowcaseMode()).toBe(false);
  });

  it("accepts the truthy spellings a hosted build can supply", () => {
    for (const value of ["1", "true", "yes", "on"]) {
      vi.stubEnv("VITE_SHOWCASE_MODE", value);
      expect(isShowcaseMode()).toBe(true);
    }
  });

  it("treats an explicit false as off", () => {
    vi.stubEnv("VITE_SHOWCASE_MODE", "false");
    expect(isShowcaseMode()).toBe(false);
  });
});
