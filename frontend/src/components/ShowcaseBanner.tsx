import { Link } from "react-router-dom";
import { isShowcaseMode } from "../showcase";
import { FOCUS_RING } from "./ui/control";

/**
 * Unmissable, always-present prototype label (ADR-0032).
 *
 * The data on this deployment is fictional and stored in Azure SQL; the banner
 * exists so nobody mistakes it for real institutional or personal data. It is
 * rendered by the shell, so it follows the user to every protected page.
 */
export function ShowcaseBanner() {
  if (!isShowcaseMode()) {
    return null;
  }

  return (
    <div
      role="note"
      aria-label="Prototype data notice"
      className="sticky top-0 z-40 border-b border-warning-line bg-warning-surface px-4 py-2 text-center text-supporting text-warning-ink"
    >
      <p className="mx-auto flex max-w-[80rem] flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <strong className="font-semibold">Prototype mode</strong>
        <span>
          Every record is fictional sample data stored in Azure SQL and served by the real API —
          not real institutional or personal data.
        </span>
        <Link to="/showcase" className={`font-semibold underline ${FOCUS_RING}`}>
          Showcase guide
        </Link>
      </p>
    </div>
  );
}
