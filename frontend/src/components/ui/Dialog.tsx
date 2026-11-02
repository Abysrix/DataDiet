import { useEffect, useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "../icons";
import { IconButton } from "./IconButton";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Where the cursor should land. Defaults to the first control in the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  width?: "sm" | "md" | "lg";
  /** Backdrop click closes by default; a dialog that must not be dismissed passes `false`. */
  dismissOnBackdrop?: boolean;
}

const WIDTHS: Record<NonNullable<DialogProps["width"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-3xl",
};

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * A modal dialog built on the native `role="dialog"` + `aria-modal` contract.
 *
 * Escape and Tab are handled on a document listener rather than on the panel:
 * if focus ever escapes the panel, the trap still works, and Escape still closes
 * the dialog. Focus is moved into the panel when it opens and returned to
 * whatever had it before when it closes, because a keyboard user who tabs into a
 * dialog and closes it must not be dropped at the top of the page.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  initialFocusRef,
  width = "md",
  dismissOnBackdrop = true,
}: DialogProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = `${uid}-description`;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const target = initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    target?.focus();
    return () => {
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const atStart = active === null || active === panel || active === first;
      if (event.shiftKey && atStart) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {dismissOnBackdrop ? (
        <div className="absolute inset-0 bg-overlay" aria-hidden="true" onClick={onClose} />
      ) : (
        <div className="absolute inset-0 bg-overlay" aria-hidden="true" />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative w-full rounded-overlay border border-line bg-surface shadow-overlay animate-overlay-in ${
          WIDTHS[width]
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-card-x py-card-y">
          <h2 id={titleId} className="text-section font-semibold text-ink">
            {title}
          </h2>
          <IconButton aria-label="Close" size="sm" onClick={onClose}>
            <IconClose className="h-4 w-4" />
          </IconButton>
        </header>
        {description ? (
          <p
            id={descriptionId}
            className="border-b border-line px-card-x py-card-y text-supporting text-ink-muted"
          >
            {description}
          </p>
        ) : null}
        <div className="px-card-x py-card-y text-body text-ink-secondary">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-card-x py-card-y">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
