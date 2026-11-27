import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Browser-storage shim for the test runner only.
 *
 * Node 26 exposes an experimental global `localStorage` whose getter returns
 * `undefined` unless `--localstorage-file` is supplied. Vitest's jsdom
 * environment deliberately does not overwrite globals Node already has, so
 * `window.localStorage` (which Vitest aliases to `globalThis`) stays undefined
 * even though jsdom's own document has a working Storage. Application code is
 * correct; this is a harness defect, so the harness supplies the missing
 * Web Storage API with the same semantics the app relies on.
 */
class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.has(key) ? (this.entries.get(key) as string) : null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value));
  }
}

if (typeof window.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
}

if (typeof window.sessionStorage === "undefined") {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
}

/**
 * jsdom emits a "Not implemented" error for getContext without the optional
 * canvas package. The harness has no GPU, so it reports the honest unsupported
 * case; the component's text fallback is what the tests should exercise.
 */
if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
}

afterEach(() => {
  cleanup();
});
