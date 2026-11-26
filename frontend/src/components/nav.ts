import type { ComponentType } from "react";
import type { Permission } from "../api/types";
import {
  IconArchive,
  IconClassification,
  IconDashboard,
  IconHold,
  IconInventory,
  IconReports,
  IconRetention,
  IconRetrieval,
  IconReview,
  IconRisk,
  IconUsers,
} from "./icons";

export interface NavItem {
  to: string;
  label: string;
  description: string;
  Icon: ComponentType<{ className?: string }>;
  /**
   * The permission the backend requires for this area's read endpoints.
   *
   * Navigation visibility is a usability convenience only — every API call is
   * authorized server-side regardless of what this menu shows, and a user who
   * navigates to a hidden page directly gets the server's honest answer.
   */
  permission: Permission;
  /** Which sidebar heading the item sits under. Presentation only, never a gate. */
  group: NavGroupId;
}

/** Sidebar headings, in the order the lifecycle story is told. */
export type NavGroupId = "discover" | "govern" | "archive" | "administer";

export const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  discover: "Discover",
  govern: "Retain & review",
  archive: "Archive & report",
  administer: "Administer",
};

const GROUP_ORDER: NavGroupId[] = ["discover", "govern", "archive", "administer"];

/** Primary navigation — one entry per DataDiet capability area. */
export const NAV_ITEMS: NavItem[] = [
  {
    to: "/",
    label: "Dashboard",
    description: "Lifecycle posture at a glance",
    Icon: IconDashboard,
    permission: "inventory:read",
    group: "discover",
  },
  {
    to: "/sources",
    label: "Sources & Scans",
    description: "Synthetic connector and scan history",
    Icon: IconInventory,
    permission: "sources:read",
    group: "discover",
  },
  {
    to: "/inventory",
    label: "Data Inventory",
    description: "Records discovered from sources",
    Icon: IconInventory,
    permission: "inventory:read",
    group: "discover",
  },
  {
    to: "/risk",
    label: "Risk Analysis",
    description: "Explainable sensitivity indicators",
    Icon: IconRisk,
    permission: "inventory:read",
    group: "discover",
  },
  {
    to: "/classification",
    label: "Classification",
    description: "Explainable proposals and data quality",
    Icon: IconClassification,
    permission: "governance:read",
    group: "govern",
  },
  {
    to: "/retention",
    label: "Retention Policies",
    description: "Versioned policies and holds",
    Icon: IconRetention,
    permission: "retention:read",
    group: "govern",
  },
  {
    to: "/holds",
    label: "Retention Holds",
    description: "Legal and administrative holds",
    Icon: IconHold,
    permission: "retention:read",
    group: "govern",
  },
  {
    to: "/recommendations",
    label: "Review Queue",
    description: "Advisory review queue",
    Icon: IconReview,
    permission: "retention:read",
    group: "govern",
  },
  {
    to: "/archive",
    label: "Archive",
    description: "Not implemented — archive prerequisites",
    Icon: IconArchive,
    permission: "sources:read",
    group: "archive",
  },
  {
    to: "/retrieval",
    label: "Retrieval Requests",
    description: "Not implemented — no restore workflow",
    Icon: IconRetrieval,
    permission: "sources:read",
    group: "archive",
  },
  {
    to: "/reports",
    label: "Reports",
    description: "Evidence views — no exports",
    Icon: IconReports,
    permission: "governance:read",
    group: "archive",
  },
  {
    to: "/users",
    label: "User Management",
    description: "Current session profile only",
    Icon: IconUsers,
    permission: "users:manage",
    group: "administer",
  },
];

/** The navigation entries the given permission set may see. */
export function visibleNavItems(has: (permission: Permission) => boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => has(item.permission));
}

/**
 * The same entries, grouped under their sidebar heading.
 *
 * A heading whose items are all filtered out is dropped, so a viewer with a
 * narrow permission set never sees an empty section label.
 */
export function visibleNavGroups(
  has: (permission: Permission) => boolean,
): Array<{ id: NavGroupId; label: string; items: NavItem[] }> {
  const visible = visibleNavItems(has);
  return GROUP_ORDER.map((id) => ({
    id,
    label: NAV_GROUP_LABELS[id],
    items: visible.filter((item) => item.group === id),
  })).filter((group) => group.items.length > 0);
}

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.to === pathname);
}

/**
 * A single-asset screen reached from a list, not from the sidebar.
 *
 * `parent` is the navigation area that leads here, so the shell can keep that
 * area marked current and offer a breadcrumb back to the list the asset came
 * from. Nothing about the entry changes authorization; the parent link is only
 * rendered when the signed-in account may already see that navigation item.
 */
export interface DetailRoute {
  /** Route prefix, including the trailing slash: `/assessments/`. */
  prefix: string;
  /** The navigation area this screen belongs to. */
  parent: string;
  title: string;
  description: string;
}

const DETAIL_ROUTES: DetailRoute[] = [
  {
    prefix: "/inventory/",
    parent: "/inventory",
    title: "Asset Editor",
    description: "Create or edit one inventory record through the real asset API.",
  },
  {
    prefix: "/assessments/",
    parent: "/retention",
    title: "Asset Assessment",
    description: "Findings, evidence, applicable policy version and blocking holds for one asset.",
  },
  {
    prefix: "/governance/assets/",
    parent: "/recommendations",
    title: "Asset Governance",
    description: "Classification, review decision and lifecycle record for one asset.",
  },
];

/** The detail route occupying `pathname`, plus the asset identifier it names. */
export function findDetailRoute(
  pathname: string,
): (DetailRoute & { assetLabel: string }) | undefined {
  const route = DETAIL_ROUTES.find((entry) => pathname.startsWith(entry.prefix));
  if (!route) {
    return undefined;
  }
  const segment = pathname.slice(route.prefix.length).split("/")[0] ?? "";
  return { ...route, assetLabel: segment ? `Asset #${segment}` : "Asset" };
}

/**
 * The navigation area that should read as current for `pathname`.
 *
 * Exact matches win; a detail screen keeps its parent area highlighted, and an
 * unknown path highlights nothing rather than guessing.
 */
export function activeSection(pathname: string): string | null {
  const exact = findNavItem(pathname);
  if (exact) {
    return exact.to;
  }
  const detail = findDetailRoute(pathname);
  return detail ? detail.parent : null;
}
