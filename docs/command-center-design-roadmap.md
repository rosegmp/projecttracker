# Command Center design migration roadmap

## Implementation status · 2026-10-21

The first live slice is in the React app: Project Hub branding, a desktop sidebar and mobile navigation menu, a saved light/dark theme choice, a data-backed Home dashboard, project selection for project-specific links, an active/inactive project control, and an internal archive with reactivation. Every top-level page, visible project workspace section, and Settings section now navigates through the sidebar; the project and Settings tab strips have been removed. Portal users get a project sidebar on desktop and a Sections drawer on phones. Existing projects default to active. The dashboard omits unsupported trends and percentages. The MapTiler map uses real project addresses when `VITE_MAPTILER_API_KEY` is configured; the user is creating a browser key. Until then, Home shows an address list and a labeled map placeholder.

The archive filter is applied to ordinary client project/task views and Android notification selectors. A Supabase migration to exclude archived projects from portal reads has been written but **has not been applied or verified against a local database** because Docker/Podman is unavailable in this workspace. Apply and test it in a nonproduction database before release. The static Command Center preview remains separate.

Focused Playwright coverage now checks Home counts, hidden archived projects, reactivation into the active dashboard, the dark theme, the project picker, the desktop and mobile navigation, the staff archive, and the dedicated Permits and Reports destinations. A populated fixture also checks normalized task and inspection loading, assigned and completed task rows, the resulting Home counts, and archived records staying out of active views while remaining readable in the archive. Existing customer and subcontractor portal journeys and administrator navigation journeys pass. The desktop project rail has been replaced by a header project switcher so the sidebar is the single navigation column. The production build passes. Visual review has covered Home and all eight top-level screens at desktop width, Home at phone width, the empty states of the project workspace tabs, and populated Tasks, Inspections, Schedule, and Calendar screens at desktop and phone widths. Calendar dark cells and mobile spacing have been corrected. Takeoff now uses dark editor chrome in the dark theme, with its plan canvas kept light for drawing contrast; desktop and phone layouts have been reviewed. The Tasks summary now keeps all five metrics on one desktop row and uses two columns on phones, including readable metric labels in light mode. Populated inspections now use status-accented Project Hub panels. The archive's Tasks tab lists saved tasks without edit controls, and its Inspections tab shows only that project's inspections. The external portal now has a compact Project Hub header and request cards; its light, dark, and phone layouts have been reviewed. Android, other populated workflow states, and remaining light-theme refinements still need review. Permits now shows the saved permit identifiers and related inspections; Reports lists uploaded inspection reports. Archived projects are excluded from Android task/inspection reminders and blocked from live project push delivery.

## Goal

Bring the whole Project Hub into the visual language of the [standalone Command Center preview](../public/command-center.html): dark navy surfaces, clear hierarchy, compact status cards, blue navigation, and consistent color cues. Keep every current workflow, permission rule, and data operation working throughout the migration. Keep the existing light theme and add dark as a user-selectable theme.

The preview is a visual reference with sample content. It is not wired to the tracker data layer. The existing application remains the source of truth until each screen has been migrated and verified.

## Current scope

- Eight top-level tabs in `src/App.jsx`: Home, Projects, Schedule, Calendar, Tasks, People, Certificates, and Settings.
- Sixteen project workspace tabs in `src/utils/projectTabs.js`, including Portal, Inspections, Permits, Reports, Daily Logs, Change Orders, RFIs & Submittals, Budget & Commitments, Warranty & Closeout, Takeoff, Files, and Photos.
- Separate desktop and mobile/Android shell behavior, plus customer and subcontractor portal access.
- Shared styling in `src/design-tokens.css` and a large `src/styles.css`; the current tokens are based on light surfaces. A global color override would affect many unrelated controls.
- Existing home summaries and operational logic in `src/components/NativeHomeView.jsx` and `src/utils/homeView.js`. Navigation, visibility, and offline state live in `src/App.jsx`.

## Confirmed product decisions

1. **Brand:** Use **Project Hub** throughout the new interface. Replace the preview's BuildFlow wordmark and sample user before integration.
2. **Themes:** Dark is an additional theme. Preserve light mode and add a theme choice, with both themes sharing the same layout and component behavior.
3. **Map and images:** Project addresses and images exist. Reuse each project's address and selected main image for the live dashboard. The existing project form has an `address` field and a `mainPhotoId` selection. The preview's illustration and repeated sample image must be removed from live screens. The data inspected so far stores addresses, not latitude/longitude; map placement needs a geocoding plan.
4. **Active projects:** Treat every existing project as active initially. Add a separate active/inactive lifecycle field and control. This should be distinct from the current `status` field (`planning`, `active`, `delayed`, `done`), which describes progress/condition and is already used by existing views.
5. **Metrics:** Remove all percentages and trend comparisons unless real records support a defined calculation. Project counts, open-task counts, and inspection counts may be shown from current records. A project's progress percentage can appear only when based on a documented, reliable calculation; no placeholder schedule-health score or month-over-month trend.
6. **Navigation:** Keep the reference's project-specific items in the sidebar, including RFIs, Permits, and Procurement. The user selects a project to enter those sections. Each item must lead to a real project view, and unsupported destinations require a new view before being presented as functional.
7. **Archive:** Inactive projects disappear from normal navigation, the dashboard, map, project picker, and other standard views. They remain available in a dedicated archive view.
8. **Project selection:** When a project-specific sidebar item is opened without a selection, ask the user to choose a project and remember that choice across those sections.
9. **Map placement:** Use a map provider to geocode existing project addresses and position projects on the live map.
10. **Archive reminders:** Stop pending task and inspection reminders for inactive projects. Preserve their history and allow reactivation from the archive.
11. **Provider choice:** There is no preferred map provider or address-sharing restriction. Select a provider during implementation based on reliability, cost, usage terms, and privacy controls.
12. **Archive permissions:** Admins and editors may archive or reactivate projects. The archive view is available to internal staff, including view-only staff; customer and subcontractor portal roles do not see it.

## Remaining implementation choices

- Complete MapTiler key setup and document its cost, terms, address handling, and failure behavior.
- Choose whether the theme preference is stored per account or per device; the initial implementation can preserve the choice locally and add cross-device sync later if desired.

## Phased plan

| Phase | Work | Exit criteria |
| --- | --- | --- |
| 1. Inventory and specification | Capture each desktop, tablet, phone, Android, and portal state; list shared components, interaction states, and accessibility needs. Map every preview panel to real data and actions. | Approved screen inventory, component list, data definitions, and navigation map. |
| 2. Design foundation | Add semantic tokens for both light and dark page, surface, text, border, accent, status, focus, and elevation. Build reusable shell, panel, stat card, badge, filter, table/list, empty state, loading, dialog, and form styles. Add a persistent user theme choice. Use the existing `FluentIcon` system where possible. | Both themes render consistently in isolation; contrast, keyboard focus, and reduced motion are checked. Current screens remain usable. |
| 3. Application shell | Replace the desktop top strip and project rail with the new Project Hub header/sidebar pattern while preserving tab visibility, role permissions, project scope, account controls, sign-out, offline/maintenance banners, and deep links. Keep project-specific sidebar items; prompt for a project when needed and remember the selection across sections. Adapt the layout for tablet, phone, and Android instead of shrinking the desktop sidebar. | Every current tab and project link remains reachable for each role and device. Back/forward, selected-project context, and saved URLs work. |
| 4. Live Home dashboard | Rebuild Home as React components using existing tracker data and `homeView` helpers. Add portfolio cards, project list, today's work, timeline, field operations, activity, and documents only where the underlying data supports them. Use saved project images and geocoded addresses. Add the active/inactive project control and a dedicated staff archive view; only Admin/Edit roles may archive or reactivate. Provide loading, empty, error, and restricted-access states. | All existing projects initially remain active. Inactive projects appear only in the archive, and their pending reminders stop. No sample names, dates, counts, images, unsupported percentages, or invented trends remain. Each card opens the correct destination and respects permissions. |
| 5. Core workspace screens | Migrate Projects, Tasks, Schedule/Calendar, People, Certificates, and Settings to the shared system. Prioritize Projects and Tasks first because dashboard actions lead there. Keep existing forms and mutations intact while updating their layout. | Feature parity for search, filters, sorting, create/edit actions, keyboard operation, and mobile layouts. |
| 6. Project detail and field workflows | Migrate the fourteen project tabs in batches: overview/portal; tasks/calendar/inspections; logs/RFIs/change orders; budget/selections/warranty; files/photos/takeoff. Apply the same panel, form, status, and document patterns. | Existing customer and subcontractor visibility, approvals, uploads, signatures, and project workflows pass their current journeys. |
| 7. Hardening and rollout | Run visual review at standard widths, accessibility checks, regression tests, offline/Android checks, and role-based end-to-end journeys. Roll out behind a reversible UI flag or staged release, then remove duplicate styles and retire the static preview when the live Home matches it. | No critical visual or workflow regressions; old UI can be restored during rollout; redundant CSS is removed after acceptance. |

## Recommended implementation order within each phase

1. Build the shared component and token change in a small slice.
2. Apply it to one screen without altering its data mutations.
3. Verify the screen at desktop, tablet, and phone widths, including keyboard navigation and empty/error states.
4. Run the relevant existing regression and Playwright journeys.
5. Merge that slice before migrating the next screen.

## Dependencies and risks

- **Data accuracy:** The preview's metrics, timeline, focus schedule, map, and recent documents are illustrative. Build selectors from real records and document every calculation before exposing a number. Hide unsupported percentages and trends.
- **Project lifecycle:** The existing `status` field is already used for planning/active/delayed/done. Introduce a distinct active/inactive value so archiving does not silently change progress state or existing workflow behavior. Apply archive filtering consistently to all ordinary views and preserve a dedicated archive route. Pause pending task and inspection reminders for inactive projects; keep records and support reactivation.
- **Map placement:** Addresses exist, but the inspected project model has no stored coordinates. Geocode through a selected provider, cache resulting coordinates, handle failed/ambiguous matches, and limit map pins to projects the user can access.
- **Role security:** The app has Admin, Edit, View Only, Customer, and Subcontractor capabilities. A new navigation item must not reveal data or actions that the current role cannot access.
- **CSS collisions:** `src/styles.css` contains broad selectors and many responsive rules. Scope new classes and migrate component by component; avoid a one-shot global dark override.
- **Mobile and Android:** The current app has distinct mobile app bars, menus, drawers, and notification actions. Preserve touch targets and device behavior while introducing the visual language.
- **Offline behavior:** Existing banners and queued field operations must remain prominent and comprehensible on dark surfaces.
- **Performance:** Keep lazy-loaded screens lazy. Avoid loading a map or all dashboard data before the first useful render.
- **Accessibility:** Status must use text as well as color. Verify contrast, focus visibility, semantic labels, and scroll behavior in dense panels.

## First implementation slice

Start with **phases 1–3 plus the live project summary section of phase 4**: define both theme token sets, create the reusable shell and cards, mount a new Home behind a UI flag, and populate active-project and open-task counts from existing data. Add the separate active/inactive control and default existing projects to active. This produces a reviewable live interface while keeping the rest of the app stable. Then add today's focus, timeline, activity, documents, and map one data source at a time.

## Overall completion checklist

- Every top-level and project workspace screen uses the new shared visual system.
- All existing routes, role restrictions, mutations, approvals, uploads, and offline flows work.
- Dashboard content is derived from real authorized data with clear empty and error states; unsupported percentages and trends are absent.
- Light and dark themes both work on every migrated screen, and the chosen theme persists.
- Desktop, tablet, mobile browser, and Android layouts are reviewed.
- Existing `npm test`, `npm run test:e2e`, and `npm run build` gates pass, with focused tests added for new data selectors and navigation behavior.
- The standalone preview and superseded styles are removed only after the live implementation is accepted.
