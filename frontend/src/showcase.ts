/**
 * Build-time showcase switch (ADR-0032).
 *
 * Read at call time rather than captured in a module constant so tests can
 * stub the environment and so a normal production bundle has no sample-data
 * path at all beyond this harmless flag check.
 */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isShowcaseMode(): boolean {
  const value = import.meta.env.VITE_SHOWCASE_MODE;
  return typeof value === "string" && TRUTHY.has(value.trim().toLowerCase());
}
