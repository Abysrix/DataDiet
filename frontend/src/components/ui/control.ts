import type { AriaAttributes } from "react";

/**
 * The class fragments every text control shares. They live in one place so a
 * control's height, border and disabled treatment cannot drift between input,
 * select and textarea — and so `Field` can lay a label next to a control whose
 * metrics it does not have to re-declare.
 */

/**
 * Explicit focus for light and dark surfaces. The base `:focus-visible` rule in
 * `index.css` is a safety net for controls that forget it; these are what the
 * primitives actually use, and the inverse variant keeps the ring visible on
 * the shell's dark rail.
 */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export const FOCUS_RING_INVERSE =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-inverse";

export const CONTROL_BASE =
  "w-full rounded-control border bg-surface px-control-x py-control-y text-body text-ink " +
  `placeholder:text-ink-subtle transition-colors ${FOCUS_RING}`;

export const CONTROL_RESTING = "border-line-strong";

export const CONTROL_INVALID = "border-critical ring-1 ring-critical-line";

export const CONTROL_DISABLED =
  "disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-disabled disabled:text-ink-disabled";

/**
 * Whether a control should draw the invalid treatment. It reads the same
 * `aria-invalid` state `Field` sets, so the visible error and the announced
 * error are always the same fact instead of two props that can disagree.
 */
export function isInvalidState(
  invalid: boolean | undefined,
  ariaInvalid: AriaAttributes["aria-invalid"],
): boolean {
  return invalid === true || ariaInvalid === true || ariaInvalid === "true";
}
