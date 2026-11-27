# DataDiet UI redesign contract

This contract governs the production-grade frontend pass for the tomorrow demo.
It combines the installed Addy Osmani `frontend-ui-engineering` skill, the
`ui-ux-pro-max` skill, and DataDiet's repository rules.

## Product and visual direction

- Product: institutional data lifecycle and privacy operations console.
- Audience: reviewers, administrators, demo audience. They need to scan state,
  understand why a number or recommendation exists, and know what action is safe.
- Style: Minimalism / Swiss Style. Grid-based, high contrast, spacious but not
  wasteful, geometric, content-first, low motion.
- Trust: explicit synthetic-data labelling, server-verified permissions shown as
  read-only state, and honest "not implemented" wording for disabled lifecycle
  actions. No fake success states.
- Palette: keep the existing semantic tokens in `frontend/src/index.css`
  (`bg-surface`, `text-ink-muted`, `border-line`, status role tokens). Do not
  introduce raw hex values, gradients, or a new brand colour per page.
- Typography: use the existing Inter type scale tokens. One H1 per page from
  `PageHeader`, no skipped heading levels, tabular numerals for data.
- Iconography: use the project's SVG icons in `components/icons.tsx`. Decorative
  icons are `aria-hidden`; icon-only controls have accessible names.

## Required page anatomy

Every routed page must have:

1. A `PageHeader` with a job-focused title, one-sentence description, and a
   small, clearly ranked action cluster. Repeating generic card grids is not
   acceptable.
2. A meaningful loading state (`Spinner` or skeleton) with an accessible label.
3. An error state with a human message and a working retry where the query
   supports it.
4. An empty state that explains what is absent and offers the next legitimate
   action or navigation link.
5. A data state whose hierarchy matches the task: counts first, then the
   decision or detail list, then provenance/caveats.
6. Permission-aware controls. If the server would refuse an action, render it as
   information, not as a live button.
7. No synthetic-data notice or fixture payload exists in the user-facing flow;
   an absent capability is stated as an honest empty state.
8. Responsive behaviour at 375px, 768px, 1024px, and 1440px. No horizontal
   overflow; wide tables use the existing table primitive's scroll container.

## Dashboard-specific shape

The dashboard intentionally renders less than the summary API returns: one
posture band (assets, decisions waiting, high/critical risk), one decision cue
with the active-hold count, and two distributions (risk in 3D, lifecycle as
bars). Sensitivity, recommendation and individual scan-job detail belong on
their own routes, not as extra dashboard tiles.

## Interaction and accessibility

- All controls are native `button`, `a`, `input`, `select`, or existing UI
  primitives. No clickable `div`.
- Visible focus is mandatory. Project-level `:focus-visible` is a safety net, not
  permission to omit primitive focus classes.
- Labels and hints are visible or programmatically associated. Icon-only
  buttons need `aria-label`.
- Status is never conveyed by colour alone: pair tone with text, icon, or both.
- Dialogs and drawers use `Dialog` / `useOverlayBehavior` patterns: Escape, focus
  trap, focus restore, and background scroll lock.
- Motion stays at the project's two named CSS animations plus the one-shot
  dashboard WebGL reveal (ADR-0034) and respects `prefers-reduced-motion`.
- Touch/keyboard targets follow the UI primitives; do not shrink hit areas.

## Engineering constraints

- Do not change API schemas, endpoint behaviour, permissions, or domain rules.
- Do not add destructive actions, bulk disposal, automatic deletion, or
  placeholder integrations.
- Do not add dependencies without a decision record. The one exception is the
  code-split `three` dependency for the dashboard risk panel (ADR-0034).
- Do not create per-component CSS files or arbitrary spacing values.
- Use TypeScript strict mode, functional components, explicit prop interfaces,
  and no `any`.
- Add or update focused Vitest tests for interactive or data-rendering changes.
  Prefer assertions on labels, states, and documented behaviour over snapshots.

## File ownership for parallel agents

Agents must edit only their assigned files. Shared-file changes are integrated
separately after the page passes finish.

| Agent | Owned files |
| --- | --- |
| Shell and primitives | `components/Layout.tsx`, `components/PageHeader.tsx`, `components/nav.ts`, `components/icons.tsx`, `components/HealthIndicator.tsx`, `components/ui/**` (except tests owned by page agents), `index.css` |
| Core overview | `pages/Dashboard.tsx`, `pages/Dashboard.test.tsx`, `pages/DataInventory.tsx`, `pages/DataInventory.test.tsx`, `pages/AssetAssessment.tsx`, `pages/AssetGovernance.tsx` |
| Lifecycle | `pages/Classification.tsx`, `pages/Classification.test.tsx`, `pages/RetentionPolicies.tsx`, `pages/RetentionPolicies.test.tsx`, `pages/retention.test.tsx`, `pages/Recommendations.tsx`, `pages/Recommendations.test.tsx`, `pages/Holds.tsx`, `pages/Holds.test.tsx`, `pages/RetrievalRequests.tsx` |
| Risk and reporting | `pages/RiskAnalysis.tsx`, `pages/RiskAnalysis.test.tsx`, `pages/Reports.tsx`, `pages/UserManagement.tsx`, `pages/Archive.tsx`, `pages/NotFound.tsx` |
| Sign-in | `pages/SignIn.tsx`, `pages/SignIn.test.tsx` (already partly redesigned; finish only if needed) |
| Audit-only agents | No files; produce a findings report |

## Finish gate

After integrating all passes, run the repository gate from the workspace root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

All six stages must pass. Update `docs/architecture.md` when behaviour changes.
