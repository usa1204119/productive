# Build Prompt — Slides + Sharing (for Swift Productive)

> Paste this to the coding agent as the opening message for this feature set.
> Read `HANDOFF.md` and `productive-build-prompt.md` first — they define the
> stack, conventions, and non-negotiables. This document only adds two features.

## Context

Swift Productive is a whiteboard → tasks → documents workspace app (monorepo:
`apps/web` React+Vite+TS+Tailwind, `apps/server` Express+TS, `packages/shared`
Zod + types; PostgreSQL/Prisma; Google Sign-In + guest; Drive `drive.file` only;
single-origin in prod). It is live on Render + Neon.

You are adding two features:

1. **Slides** — rebrand the per-workspace "boards" as **slides**, with a
   **left-hand slide switcher** (like a presentation deck) replacing today's
   top-right board dropdown.
2. **Sharing** — let a workspace owner share a **whole workspace** or a **single
   slide** with someone by **email**, with a role (viewer/editor). The invitee
   signs in with that Google account and sees the shared item.

**IMPORTANT — audit first.** Sharing is already partially scaffolded. Before
writing code, read and reconcile with what exists; extend it, do not duplicate:
- Prisma models: `WorkspaceRole` (enum), `WorkspaceMember`, `WorkspaceInvitation`,
  `WorkspaceAuditLog`, `DriveAclSyncJob`.
- Server: `apps/server/src/authorization/`, `collaboration/`,
  `lib/invitations/`, `lib/memberships/`, `lib/mail/`, `lib/driveAcl/`,
  `routes/invitations.ts`, `routes/members.ts`.
- Web: `apps/web/src/components/sharing/`, `components/collaboration/`,
  `lib/collaboration.ts`.
- Env (already in `render.yaml`/`.env.example`): `SHARING_ENABLED`,
  `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`, `INVITE_TTL_HOURS`,
  `REDIS_URL`.
- `DriveClient` already declares optional `findPermission/createPermission/
  updatePermission/deletePermission`.

Produce a short written audit of the current sharing state (what works, what is
stubbed, what is missing) and confirm the plan before large changes.

## Non-negotiable guardrails (from HANDOFF.md — do not break)

- **Drive scope stays `drive.file` ONLY.** Sharing a workspace's Drive folder
  uses Drive **permissions** on folders/files the app already owns (`drive.file`
  covers this). Never request `drive`, `drive.readonly`, or `drive.metadata`.
- **Every workspace/board/slide query stays authorization-scoped.** No unscoped
  `findMany`. Ownership/'access' checks live in shared middleware, never copied
  into routes. Extend the existing `requireWorkspace` (and add a board/slide
  guard) so access = **owner OR an accepted member/share with a sufficient
  role** — and a resource the user cannot access is indistinguishable from a
  missing one (404), never a 403 that leaks existence.
- **Error envelope** stays `{ success:false, error:{ code, message } }` via the
  central middleware; new codes go in `packages/shared`. Zod validation on every
  body/param/query. Strict TS, no `any`. `pino` logs, no `console.log`.
- **Transactions** for multi-row invariants (accepting an invite, revoking a
  share + its Drive permission, deleting a workspace/member).
- **Feature flag:** all sharing endpoints/UI are gated on `SHARING_ENABLED`.
  When off, the app behaves exactly as today (single-user).
- **Tests are required** (see each feature). Follow the existing pattern:
  PGlite in-process smokes (`npm run smoke`), Vitest for pure client logic,
  Playwright in `apps/e2e` for flows. External I/O (Drive, mail) MUST go through
  an injected port with a deterministic fake in tests — never call the network
  in a test.

---

## Feature 1 — Slides + left switcher

### Naming decision (make it, state it)
Keep the Prisma model/table named **`Board`** (a full rename is risky: no
migrations exist yet, and many tests reference it). Rebrand **all user-facing
copy to "Slide"/"Slides"**, and name new UI components/routes with "slide".
(If the team later wants a true rename, do it as a dedicated migration PR.)
Document this mapping (Board == Slide) in a code comment and in HANDOFF.md.

### Data model
- Add `order Float` to `Board` (slide order within a workspace), same float-
  ordering scheme already used by `Task` (append at `max+1000`; insert = average
  of neighbours; rebalance to multiples of 1000 in one transaction when the gap
  drops below `0.0001`). Backfill existing rows deterministically (by
  `createdAt`). Ship the schema change; the container applies it via
  `prisma db push` on deploy (there are still no migration files — keep it that
  way unless you also introduce `prisma migrate`).
- `listBoards` returns slides ordered by `order asc` (still summaries only — no
  scene JSON). Add a reorder endpoint mirroring tasks:
  `POST /workspaces/:workspaceId/boards/:boardId/reorder` with
  `{ prevId, nextId }`, transactional, with rebalance.

### UI — left slide switcher
- Replace the current in-Excalidraw top-right board dropdown (`renderTopRightUI`
  BoardBar) with a **vertical slide rail on the left of the whiteboard area**
  (inside the Whiteboard tab, not the global app sidebar):
  - A scrollable column of slides in order, each a compact card showing the
    slide name (rename inline) and its position; the active slide is highlighted.
  - Optional lightweight thumbnail is a nice-to-have, not required (a numbered
    tile + name is fine). Do NOT render a live Excalidraw per slide.
  - **"+ New slide"** at the bottom (or top) of the rail.
  - **Drag to reorder** with `@dnd-kit` (already a dependency), calling the
    reorder endpoint with optimistic update + rollback (match TasksTab).
  - A per-slide menu (rename, delete). Delete keeps the existing behavior
    (deleting a board nulls `Task.sourceBoardId`/`sourceElementId`; never deletes
    tasks). Keep the "New slide" empty-state.
  - The rail must be collapsible so the canvas can go full width.
- Keep the Excalidraw canvas filling the remaining area; keep the Saved chip and
  "Add to tasks" placement working (they must not overlap the rail).
- Persist the selected slide per workspace (existing `pac.board.<wsId>` key is
  fine) and the rail collapsed/expanded state.

### Tests (Feature 1)
- Server smoke: slide ordering (append/insert/rebalance) mirrors the task
  ordering test; reorder is transactional and scoped; delete still clears task
  back-links. Extend `smoke:boards`.
- Vitest (web): the optimistic reorder reducer (pure) if you extract it.

---

## Feature 2 — Sharing (workspace + single slide) by email

### Access & roles
- `WorkspaceRole` = `OWNER | EDITOR | VIEWER` (align with the existing enum).
  - **VIEWER**: read whiteboard/tasks/documents; cannot mutate.
  - **EDITOR**: read + write whiteboard/tasks/documents; cannot manage members
    or delete the workspace.
  - **OWNER**: everything, incl. managing members and deleting the workspace.
    Exactly one owner (the creator); do not allow removing the last owner.
- Two share **granularities**:
  - **Workspace share** → `WorkspaceMember` (already modeled): access to the
    whole workspace at the given role.
  - **Slide (board) share** → share a single slide. Prefer extending the
    existing invitation/member model with a **nullable `boardId`** (a share with
    `boardId = null` is workspace-wide; with a `boardId` it grants access to just
    that slide, read or edit per role) rather than a whole new subsystem — but if
    the current schema makes a separate `BoardShare` cleaner, do that and justify
    it in the audit. A slide-only viewer sees ONLY that slide (a minimal read
    view), not the rest of the workspace.

### Authorization (security-critical)
- Extend `requireWorkspace` so `req.workspace` resolves when the user is the
  owner **or** has an accepted `WorkspaceMember` row; attach the effective role
  (`req.workspaceRole`). Add a `requireRole('EDITOR')`-style guard for mutating
  routes.
- Add `requireBoardAccess` for slide-scoped routes: access if the user can
  access the parent workspace, OR holds an accepted slide-level share for that
  board. Attach the effective role.
- Guests (`isGuest`) cannot be granted shares and cannot share. Sharing requires
  a real (Google) account on both sides.
- Re-audit EVERY existing workspace/board/task/document route to ensure it now
  authorizes via these guards (not a raw `userId` owner check) and that VIEWERs
  are blocked from mutations. This is the highest-risk part — enumerate the
  routes you changed.

### Invitation flow (email)
- Owner (or EDITOR? — decide: only OWNER may manage members) invites by email +
  role (+ optional boardId). Create a `WorkspaceInvitation` (pending) with a
  cryptographically random token (store only its hash, like sessions), an
  expiry (`INVITE_TTL_HOURS`), and the target (workspaceId, nullable boardId,
  role).
- Send an email via a **`MailProvider` port** (Resend adapter behind
  `MAIL_PROVIDER`/`RESEND_API_KEY`/`MAIL_FROM`) containing an accept link:
  `${WEB_URL}/invite/<token>`. The port has a **fake** used in all tests; if
  `SHARING_ENABLED` is off or mail is unconfigured, fail gracefully (don't crash
  invite creation — surface a clear code) and log.
- Accept: `GET/POST /workspace-invitations/:token` (route prefix already wired
  in `serveWeb`). Recipient must be signed in with Google:
  - If the invitation email matches the signed-in account's email → accept:
    create/activate the `WorkspaceMember` (or slide share) in one transaction,
    mark the invitation accepted, and (for workspace shares that have a Drive
    folder) enqueue/perform the **Drive ACL** grant.
  - If email doesn't match → clear error (`INVITATION_EMAIL_MISMATCH`), tell them
    which account to use.
  - Expired/used/revoked → clear codes, never a 500.
- Idempotent: re-inviting an existing member updates the role; accepting twice
  is a no-op.

### Drive ACL (uses `drive.file` only)
- When a **workspace** with a `driveFolderId` is shared (or the role changes),
  grant the invitee's email the matching Drive **permission** on that folder
  (`reader` for VIEWER, `writer` for EDITOR) via `DriveClient.createPermission`;
  store `WorkspaceMember.drivePermissionId`. On revoke/role-change, update or
  delete the permission. This is why `DriveClient` has permission methods and
  `DriveAclSyncJob` exists — do the grant asynchronously/retryably (a job row +
  a small worker, optionally `REDIS_URL`), so a Drive hiccup never blocks
  accepting an invite. If the sharer hasn't connected Drive, the app-level share
  still works; only the Drive-file access is deferred until Drive is connected.
- A slide-only share grants NO Drive access (slides are DB scene data, not Drive
  files).
- `invalid_grant` → the existing disconnect/reconnect handling; the ACL job
  retries after reconnect. Never widen scope to make this easier.

### Recipient experience
- Shared workspaces appear in the left workspace sidebar with a subtle
  "Shared" badge and the user's role; VIEWERs see read-only affordances
  (disabled inputs, hidden delete/new buttons, whiteboard in view mode).
- A slide-only share opens a focused read/edit view of just that slide.
- The `/invite/<token>` page: if signed in with the right account → one-click
  accept → redirect into the shared item; if signed out → prompt Google
  sign-in first; if wrong account → the mismatch message.

### Owner "Share" UI
- Add a **Share** action on the workspace three-dot menu (Sidebar) and on the
  per-slide menu. It opens a dialog:
  - Input: email + role select (Viewer/Editor). Submit → sends invite,
    optimistic "Invited" state.
  - A list of current members/shares with their role, pending vs accepted,
    change-role, and revoke (with a confirm). Revoking removes access + the
    Drive permission.
  - Copy-link affordance for the pending invite.
- Reuse `components/sharing/` if present; keep the calm visual style, one accent.

### New error codes (packages/shared)
e.g. `SHARING_DISABLED, FORBIDDEN_ROLE, INVITATION_NOT_FOUND,
INVITATION_EXPIRED, INVITATION_EMAIL_MISMATCH, ALREADY_MEMBER,
CANNOT_REMOVE_LAST_OWNER, MAIL_NOT_CONFIGURED, MEMBER_NOT_FOUND`. Align names
with any already used by the scaffolding.

### API (align with existing `routes/members.ts` / `routes/invitations.ts`)
- `GET  /workspaces/:workspaceId/members` — list members + pending invites (owner/editor).
- `POST /workspaces/:workspaceId/invitations` — `{ email, role, boardId? }`.
- `PATCH/DELETE /workspaces/:workspaceId/members/:memberId` — change role / revoke.
- `DELETE /workspaces/:workspaceId/invitations/:id` — cancel a pending invite.
- `GET/POST /workspace-invitations/:token` — view/accept an invite.
All scoped, role-guarded, validated, transactional, `SHARING_ENABLED`-gated.

### Tests (Feature 2) — required
Injected fakes for **mail** and **Drive**; PGlite for DB. Cover at least:
- Invite creates a pending invitation + sends one email (fake) with a hashed
  token; re-invite updates role (no duplicate).
- Accept by the matching account creates an accepted member in one transaction
  and enqueues the Drive ACL grant; accept is idempotent.
- Email mismatch / expired / revoked / already-member → correct codes, no 500.
- Authorization matrix: OWNER/EDITOR/VIEWER/non-member against
  read/mutate/manage on workspace, board, task, document routes — VIEWER cannot
  mutate; non-member gets 404; a slide-only viewer can read only that slide.
- Revoke removes the member AND deletes the Drive permission (fake); role change
  updates the permission.
- Drive ACL job: retries on transient failure; `invalid_grant` marks
  disconnected and retries after reconnect; slide-only share requests no Drive
  permission.
- `SHARING_ENABLED=false` → all sharing endpoints refuse and the UI hides
  sharing; the rest of the app is unchanged.
- Playwright (`apps/e2e`): owner invites → (as a second account) accept → shared
  workspace visible with correct role and read-only enforcement.

---

## Out of scope
Real-time multiplayer editing / presence / cursors, public (no-account) share
links, comment threads, notifications beyond the invite email, org/team
hierarchies, transferring ownership UI (a single owner is fine for now).

## How to proceed (with review gates)
1. **Audit** the existing sharing scaffolding + schema; post findings + a plan;
   wait for go-ahead.
2. **Slides**: schema `order` + reorder API + left switcher UI + tests.
3. **Sharing backend**: finalize models, authorization guards (re-audit all
   routes), invitation + mail port, accept flow, Drive ACL job + `MailProvider`
   fake — with the full test matrix. Keep it behind `SHARING_ENABLED`.
4. **Sharing UI**: Share dialog, member list, invite-accept page, recipient
   read-only/shared affordances.
5. Update `README.md`, `DEPLOY.md` (new env: mail/redis), and `HANDOFF.md`
   (Board==Slide mapping; the new access model).

Definition of done for each step: `npm run typecheck`, `npm run smoke -w
apps/server`, `npm run test -w apps/web`, `npm run build`, and (for sharing)
the Playwright flow — all green — plus a short summary of what changed and the
exact authorization guarantees. Show each step and wait for approval before the
next.
