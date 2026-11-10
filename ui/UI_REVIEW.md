# UI Review — Milestone 0 & Milestone 0.5 (M0.5) — Ready State & Engagement Setup Wizard

## Screens
- `/` (Ready State Home) — TopBar, ResumeBanner, EngagementsSection (Card Grid & Compact Table), RecentActivity, EnvironmentPanel, Footer.
- `/engagements/new` (Progressive 6-Step Setup Wizard) — Name & Folder, Scope Classification, Auth Profiles, Scan Phases, Model Roles & Provider Gate, Review & Create.
- Accessible Modals: `OpenFolderModal` (native picker integration), `ImportModal`, `RemoveProjectModal` (typed confirmation), `KeyboardShortcutsModal`.
- Placeholders: `/projects/:projectId`, `/sessions/:sessionId`, `/settings`, `/models`, `/tools`, `/auth-profiles`.

## Implemented
- **P0.1 Real API & WebSocket Client:** `src/api/client.ts` (`fetchJson<T>` with `X-Request-Id`, `ApiError` normalization, `VITE_API_BASE_URL`) and `src/api/events.ts` (WebSocket stream with exponential backoff and sequence catch-up `afterSeq`). Mock mode is cleanly gated behind `VITE_USE_MOCKS=true`.
- **P0.2 Replaced Placeholders:** Zero `alert()` or `prompt()` calls remain. All primary actions navigate via `react-router-dom` or execute real API mutations that invalidate queries.
- **P0.3 Progressive Route Wizard:** Created `/engagements/new` as a 6-step progressive wizard with full state retention.
- **P0.4 Native Folder Picker:** `src/lib/nativeDialog.ts` supporting Tauri native dialogs with browser fallback.
- **P0.5 Dev-Gated State Simulator:** State simulator in `TopBar.tsx` wrapped in `import.meta.env.DEV && import.meta.env.VITE_UI_STATE_SWITCHER !== 'false'`.
- **P0.6 Client Routing:** `react-router-dom` configured with routes for `/`, `/engagements/new`, and all major section placeholders.
- **P0.7 Header Policy/Scope Clean-up:** Removed hardcoded text in `TopMenuBar.tsx`; bound to real settings links.
- **P1.1 Type Safety:** Zero `any` types; `ApiError` and `isApiError` type guards implemented.
- **P1.2 Contract Types Aligned:** `ScopeStatus` aligned to `'ok' | 'empty' | 'invalid'`.
- **P1.5 Modal Accessibility:** Accessible `Dialog` component with `role="dialog"`, `aria-modal="true"`, focus trap, and Esc key listeners.
- **P1.6 Error Boundary:** Top-level `ErrorBoundary` with request ID and reload button.
- **M0.5 Feature Deliverables:**
  - Real-time scope classifier (`scopeClassifier.ts`) with FQDN, URL, wildcard, IP, and CIDR parsing, duplicate stripping, and conflict detection.
  - Auth profile manager with persistence mode selector: **Don't save / Save session only / Save credentials**, login browser triggers, and zero secrets rendered.
  - Provider gate: locks Step 5 Next button if zero providers are connected, linking to `/models`.
  - Dynamic model role assignment with `Solo preset` and `Same as orchestrator` shortcuts.
  - Review step before creating engagement via `POST /projects`.

## API Used
- `GET /home`
- `GET /projects`
- `POST /projects`
- `POST /projects/open`
- `GET /providers`
- WebSocket `/api/v1/stream`

## States
- **Loading:** Yes — Matching layout skeletons (`ReadyStateSkeleton`).
- **Empty:** Yes — Guided first-run onboarding screen.
- **Error:** Yes — Persistent alert with code, message, request ID, and retry action.
- **Partial:** Yes — Renders available projects while surfacing inline warning for failed subsystems.
- **Disconnected:** Yes — Top offline reconnection banner with countdown and mutation lock.

## Security
- **Redaction checked:** Yes — No raw cookies, passwords, or tokens rendered in DOM/console.
- **Persistence mode enforced:** Profiles explicitly define persistence boundary (*Don't save / Save session only / Save credentials*).
- **Scope inviolability:** Conflicts between in-scope and out-of-scope targets are hard-blocked during wizard Step 2.

## Tests
- 18 Vitest unit and integration tests passing (100% success rate):
  - 7 contract and mock mutation tests (`src/test/contract.test.ts`).
  - 4 full wizard flow, scope classifier, and provider gate tests (`src/test/EngagementWizard.test.tsx`).
  - 7 Ready State component and interaction tests (`src/test/ReadyState.test.tsx`).

## Build
- Production build passes cleanly: 1660 modules transformed, 0 TypeScript errors, 377 kB JS (111 kB gzipped), 22 kB CSS (4.7 kB gzipped).
