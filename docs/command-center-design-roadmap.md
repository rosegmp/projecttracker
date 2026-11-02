# Command Center design migration roadmap

## Implementation status · 2026-11-02

The React app now has Project Hub branding, sidebar navigation, a saved light/dark theme choice, a data-backed Home dashboard, a project picker, active/inactive project controls, and an internal archive with reactivation. Home offers a map/list switch using OpenFreeMap and Leaflet, with geocoded project locations where available. Existing projects default to active. The dashboard omits unsupported trends and percentages. Project sections and Settings sections navigate through the sidebar, and the previous tab strips are removed. Management reporting remains available under Settings.

The archive filter applies to ordinary client project/task views, portal access, and Android notification selectors. The portal authorization migration has passed hosted Supabase authorization tests. It must be applied to production before publishing the new interface. The notification Edge Function also needs deployment so archived projects stop receiving reminders. The static Command Center preview remains separate.

The full 32-test browser suite passes, covering staff, customer, and subcontractor journeys; navigation; archive behavior; offline field work; takeoff; compliance; and dark theme. The hosted authorization tests and Android build also pass. The former Reports and Permits tabs were removed as requested, while management reporting remains under Settings. The desktop project rail is now a header project switcher. Archived records remain readable to internal staff in the archive, and archived projects are excluded from Android task and inspection reminders and live project push delivery.

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
