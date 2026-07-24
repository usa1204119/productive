# Build Prompt — "Plane and Curves" (Whiteboard + Tasks + Documents Workspace App)

> Paste this into Claude Code (or a new chat) as the opening message.
> Adjust the **Stack** and **Engineering conventions** sections if your choices differ.

---

## Context

I am building a web app called **Plane and Curves**. Core idea: a user plans something visually on a whiteboard, converts that plan into real to-do tasks, and keeps related files alongside it — all inside one workspace.

Each workspace has three tabs: **Whiteboard**, **To do tasks**, **Documents**.

You are helping me build this from scratch. Work incrementally, explain decisions briefly, and ask me before making any architectural choice that is expensive to reverse. Do not invent requirements that are not in this document — if something is unspecified, ask me.

## Stack

- Frontend: React + Vite + TypeScript, Tailwind CSS
- Whiteboard: `@excalidraw/excalidraw` package (do not build a canvas from scratch)
- Backend: Node + **Express** + TypeScript (do not substitute Fastify, Hono, Nest, or Next.js API routes)
- Database: PostgreSQL with Prisma
- Auth: Google Sign-In (OAuth 2.0), session in an httpOnly cookie
- File storage: the user's own Google Drive via the Drive API — I do not host files myself
- Deployment target: single server, Docker-friendly

## Engineering conventions (follow these throughout)

**Folder structure** — a monorepo with npm workspaces:

```
apps/
  web/        # React + Vite frontend
  server/     # Express backend
packages/
  shared/     # Zod schemas and shared TypeScript types
```

Do not reorganise this layout without asking.

**IDs** — use `String @id @default(cuid())` for all primary keys.

**API style** — REST endpoints returning JSON. Do not introduce GraphQL or tRPC.

**Error format** — every API error response uses exactly this shape:

```json
{ "success": false, "error": { "code": "WORKSPACE_NOT_FOUND", "message": "Workspace not found" } }
```

Use a central error-handling middleware. Never leak stack traces or Prisma errors to the client.

**Validation** — Zod on both frontend and backend. Define schemas once in `packages/shared` and import them on both sides. Every request body, query param and route param is validated before it reaches business logic.

**State management** — TanStack Query for all server state. React Context only for authentication and current-workspace selection. Do not add Redux, Zustand, MobX, or Recoil.

**Environment variables** — never hardcode secrets, URLs, or keys. All configuration comes from environment variables. Whenever you introduce a new variable, update `.env.example` in the same change.

**Migrations** — every schema change ships with a Prisma migration. Never edit an applied migration.

**Testing** — do not write tests unless I explicitly ask. If I ask, use Vitest for unit tests only.

**Logging** — structured logging on the server (pino). No stray `console.log` in committed code.

**TypeScript** — strict mode on. No `any`, no `@ts-ignore`. Keep files small and single-purpose.

**Libraries** — use exactly these, do not substitute alternatives:
- Drag and drop: `@dnd-kit/core` + `@dnd-kit/sortable`
- Dates: `date-fns` (no Moment, no Day.js, no Luxon)
- Icons: `lucide-react`
- Google auth/API: the official `google-auth-library` and `googleapis`
- Token encryption: Node's built-in `crypto` with AES-256-GCM and a key from `ENCRYPTION_KEY`

**Limits** — max upload size 100 MB per file. Max 50 workspaces per user. Reject oversize uploads before streaming to Drive.

## Security (non-negotiable)

- Every workspace-scoped endpoint verifies that the authenticated user owns the workspace before doing anything.
- Never trust a `workspaceId`, `boardId`, `taskId` or `documentId` from the client without an ownership check.
- Every database query is scoped to the authenticated user — no unscoped `findMany`.
- Ownership checks live in shared middleware, not copy-pasted into each route.

## Auth

**Google Sign-In is the only real login.** There is no email/password and no email OTP.

1. Sign in with Google. On first sign-in request **only** `openid`, `email`, `profile`. Do not request any Drive scope here.
2. Create the User, create a Session, set an httpOnly cookie. Sessions last 30 days.
3. **Guest login**: one click creates a User with `isGuest: true` and no email, plus a session. A guest gets a real workspace and can use Whiteboard and Tasks fully. The Documents tab is locked for guests with a "Sign in with Google to use Documents" prompt.
4. **Guest conversion** (build this, do not skip it): a guest can sign in with Google, and their existing workspaces, boards and tasks carry over to the real account. This is the main funnel — a guest must never lose their work.

## Google Drive integration

**Absolute constraint: use only the `https://www.googleapis.com/auth/drive.file` scope. Never request `drive`, `drive.readonly`, `drive.metadata`, or any broader Drive scope under any circumstance, for any reason, even if it would simplify a feature.** Broader scopes are restricted and would force me through a paid annual third-party security assessment. If a feature seems to need a wider scope, stop and ask me instead of widening it.

`drive.file` lets the app access only files it creates itself, plus files the user explicitly picks through the Google Picker. That is sufficient: users upload through my app, so my app is the creator and retains access. Any file type is allowed.

**Incremental authorization** — do not ask for Drive permission at sign-in. Request it the first time the user opens the Documents tab, with a short explanation of what it is for. If the user declines, the rest of the app must keep working normally.

Implementation notes:
- Store the refresh token **encrypted at rest**. Access tokens expire in ~1 hour; refresh transparently.
- Handle revoked or invalid tokens gracefully: show a "Reconnect Google Drive" state, never a crash or raw error.
- On first Drive use, create a root folder `Plane and Curves` in the user's Drive, and a subfolder per workspace named after the workspace. Store both folder IDs.
- Uploads go through my backend to Drive (resumable upload for large files). Show upload progress.
- Opens use the Drive `webViewLink` — do not proxy file bytes through my server unnecessarily.
- A file deleted by the user directly in Drive leaves a dead reference. When listing documents, mark unreachable files as "Missing from Drive" with an option to remove the record. This must never throw.

## Data model

Give me the Prisma schema first and let me review it before you write any application code.

**User** — id, googleId (nullable, unique), email (nullable, unique), name, avatarUrl, isGuest boolean, driveConnected boolean, driveRootFolderId (nullable), createdAt.

**GoogleCredential** — id, userId, encryptedRefreshToken, scopes (string array), connectedAt, revokedAt (nullable).

**Session** — id, userId, tokenHash, expiresAt.

**Workspace** — id, userId, name, driveFolderId (nullable), createdAt, updatedAt.

**Board** — id, workspaceId, name, elements (JSON blob of Excalidraw elements), appState (JSON), updatedAt.

**Task** — id, workspaceId, title, description (nullable), completed (boolean, default false), completedAt (nullable), order (float), dueAt (nullable), sourceBoardId (nullable), sourceElementId (nullable), createdAt, updatedAt.

**Document** — id, workspaceId, taskId (nullable), driveFileId, name, mimeType, sizeBytes, webViewLink, iconLink (nullable), uploadedById, createdAt. No file bytes are ever stored in my database.

Notes:
- `dueAt` is explicitly a **due date/time** — not an estimate, not a scheduled block. Label it "Due" in the UI.
- Task `sourceBoardId` / `sourceElementId` exist only for a "view on board" back-link.
- Document `taskId` lets a file be attached to a specific task.

### Delete behaviour (be exact — do not improvise)

- Deleting a **Workspace** cascades to its Boards, Tasks and Document *records*, and clears its Drive folder metadata. **It never deletes actual files or folders in the user's Google Drive.** Tell the user this in the confirmation dialog.
- Deleting a **Board** does **not** delete Tasks. Tasks that referenced it keep their titles; set `sourceBoardId` and `sourceElementId` to null.
- Deleting a **Task** does not delete its attached Documents — set the Documents' `taskId` to null so they stay in the workspace.
- Deleting a **Document** removes only my record by default. Offer an explicit, separate "also delete from Google Drive" checkbox, unchecked by default.
- Deleting a **User** cascades to everything of theirs in my database and revokes stored Google credentials.

### Task ordering

`order` is a **float**, so inserting between two rows only updates one row (average the neighbours). New tasks are appended at `max(order) + 1000`. If the gap between two neighbours falls below `0.0001`, rebalance that workspace's task orders to multiples of 1000 in a single transaction.

## The whiteboard → task bridge (most important feature)

Implement it as **one-way only**. The board is the planning surface; tasks are the committed record.

Define this interface and make the rest of the app depend only on it:

```ts
interface BoardSelectionProcessor {
  process(selection: ExcalidrawElement[], ctx: { boardId: string; workspaceId: string }): Promise<NewTaskDraft[]>;
}
```

- Current implementation: `TextElementsToTasks` — each selected element containing text becomes one task, that text as the title. Elements with no text are skipped; report how many were skipped.
- Future implementation: an AI-based processor. Nothing outside this module may assume which implementation is in use. No scattered TODO comments — the interface is the seam.
- UI: selecting elements shows a floating toolbar with an **"Add to tasks"** button.
- Created tasks store `sourceBoardId` and `sourceElementId`; they show a small board icon that opens the board and zooms to that element.
- Editing a task never changes the canvas; editing the canvas never changes the task. Build no sync, listeners, or reconciliation.

## Excalidraw handling

- Persist the scene JSON as received. **Preserve unknown fields** — never transform, normalise, or strip Excalidraw data except when following an official Excalidraw migration.
- Autosave debounced at 1 second, and only send a request if the scene actually changed. Use Excalidraw's own scene version (`getSceneVersion`) to detect change — do not deep-compare elements on every keystroke.
- Show a subtle "Saved" indicator. Do not block the canvas while saving.

## UI

Left sidebar: workspace list with a "New WS" button at the bottom. Workspace delete lives in a per-workspace three-dot menu with a confirmation dialog — never a global delete button.

Main area: three tabs per workspace, tab state remembered per workspace on reload.

- **Whiteboard** — Excalidraw fills the area. Board switcher and "New Board" on top.
- **To do tasks** — compact list: checkbox, title, due chip, drag handle. Clicking a row opens a right-hand side panel (not an inline expand, not a modal) with title, description, due date, attached documents, delete, and the board back-link. Completed tasks collapse into a "Done" section. An "Add task" input at the bottom where Enter creates the task and keeps focus for the next one.
- **Documents** — drag-and-drop upload zone; file list with name, type icon, size, date, and actions (open in Drive, attach to task, remove). Locked for guests and for users who have not connected Drive, with a clear connect prompt.

Visual direction: clean and calm, generous whitespace, one accent colour, no heavy borders. It should not look like a Bootstrap template.

## Out of scope for now

Do not build: real-time collaboration, sharing between users, mobile apps, notifications, recurring tasks, subtasks, tags, nested folders inside Documents (a flat list per workspace is fine), or AI features.

## How to proceed

1. Confirm the Prisma schema with me.
2. Scaffold the monorepo; Google Sign-In + guest + guest conversion working end to end.
3. Workspaces CRUD.
4. Whiteboard tab with persistence.
5. Tasks tab: full CRUD, completion, reordering.
6. Drive connection (incremental consent) + Documents tab.
7. The board → tasks bridge last, once the other pieces are solid.

After each step, show me what changed and wait for my go-ahead before continuing.
