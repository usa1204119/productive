# Feature Prompt — "Ask AI" about a whiteboard selection (Groq vision, streaming chat)

## Goal
Replace the **"Add to tasks"** selection action with **"Ask AI"**. When the user
selects one or more elements on the whiteboard and clicks **Ask AI**, the app
captures a **PNG snapshot of exactly that selection**, opens a beautiful chat
panel, and a **Groq vision model** answers questions about the snapshot (e.g.
"explain this code", "find the bug", "summarize this diagram"). Multi-turn,
streamed token-by-token, with a best-in-class UI/UX.

This is an implementation brief. The `GROQ_API_KEY` will be provided and set as a
server-side env var — it must **never** reach the browser.

---

## 1. Replace "Add to tasks"
- In `apps/web/src/components/WhiteboardTab.tsx` (`BoardCanvas`), the floating
  button shown when `selectedCount > 0` (currently "Add to tasks", handler
  `onAddToTasks`, hook `useCreateTasksFromSelection`) becomes **"Ask AI"**.
- Clicking it: capture the selection snapshot (§4) and open the AI chat panel
  (§5) seeded with that snapshot.
- Remove the add-to-tasks UI + `onAddToTasks` + the `useCreateTasksFromSelection`
  usage. The server-side board→tasks bridge (`lib/bridge`, its route, smoke) can
  be deleted or left dormant — prefer deleting the now-dead client path; leaving
  the backend is harmless. (Keep it available to non-VIEWERs, or allow any member
  — asking about content you can see is fine; see §6 on access.)

---

## 2. Architecture (secrets stay server-side)
```
Excalidraw selection ──exportToBlob──▶ PNG (compressed, capped) ─┐
                                                                 ▼
  Chat panel  ◀── streamed tokens (SSE) ──  POST /workspaces/:id/ai/chat
                                                                 │  (server)
                                                                 ▼
                                          Groq OpenAI-compatible chat completions
                                          (vision model, stream:true, GROQ_API_KEY)
```
- The browser **never** sees `GROQ_API_KEY`. All Groq calls go through our server.
- The snapshot + conversation are posted to our endpoint; the server calls Groq
  and **proxies the stream** back to the client.

---

## 3. Server

### 3.1 Env (`apps/server/src/env.ts`)
- `GROQ_API_KEY: z.string().min(1)` — required only when the feature is enabled.
- `AI_CHAT_ENABLED: booleanString.default("false")` — gate the feature; when true
  in production, `superRefine` should require `GROQ_API_KEY` (mirror the
  SHARING_ENABLED → RESEND pattern already in env.ts).
- `GROQ_MODEL: z.string().default("<current Groq vision model>")` — configurable.
  Groq's model list changes; pick a **current vision-capable** model (e.g. a Llama
  4 Scout/Maverick or Llama 3.2 Vision variant) and make it env-overridable rather
  than hardcoding a value that may be retired. Verify the chosen id against Groq's
  live model list at implementation time.

### 3.2 Endpoint
`POST /workspaces/:workspaceId/ai/chat` — `requireAuth` + `requireWorkspaceAccess`
(+ `requireNonGuest`; any member may ask). Body (Zod-validated in
`packages/shared`):
```ts
{
  imageDataUrl?: string,          // data:image/png;base64,… (the selection snapshot)
  messages: { role: "user" | "assistant", content: string }[]  // conversation so far
}
```
- Cap `imageDataUrl` size (e.g. ≤ 4 MB) and `messages` length/among-count.
- Build the Groq request: system prompt (persona: "You analyze a snapshot from a
  whiteboard and help the user…"), then the conversation. Attach the image to the
  **first user turn** as OpenAI-style content parts:
  `[{ type: "text", text }, { type: "image_url", image_url: { url: imageDataUrl } }]`.
- Call Groq: `POST https://api.groq.com/openai/v1/chat/completions`,
  `Authorization: Bearer GROQ_API_KEY`, `stream: true`.
- **Stream to the client** via SSE (`text/event-stream`): forward each delta token
  as it arrives; end with a `done` event. Handle client disconnect (abort the Groq
  request). On Groq error (4xx/5xx/429) emit a structured error event.
- **Rate limit** per user (AI calls cost/are limited): add an `aiRateLimit`
  (e.g. 20/5 min) in `middleware/rateLimit.ts` and mount it on this route.
- Never log the image or full prompt at info level.

### 3.3 A small Groq client port
Add `apps/server/src/lib/ai/groq.ts` with a `streamChat({ model, messages, signal })`
that yields text deltas, plus a **fake** for tests (no network). Keep the provider
behind a port so tests don't hit Groq.

---

## 4. Client — snapshot capture
- Use Excalidraw's `exportToBlob` (from `@excalidraw/excalidraw`) with the
  **selected** elements only:
  - `const api = apiRef.current; const sel = api.getAppState().selectedElementIds;`
  - `const elements = api.getSceneElements().filter(e => sel[e.id]);`
  - `const blob = await exportToBlob({ elements, appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportPadding: 16 }, files: api.getFiles(), mimeType: "image/png" });`
  - Convert to a data URL. **Compress/cap**: if the PNG is large, downscale to a
    max dimension (~1568px, a common vision cap) and/or re-encode, so it fits the
    server cap and the model's limits.
- Pass the data URL into the chat panel as the selection context.

---

## 5. Client — chat panel & streaming
- New `apps/web/src/components/ai/AiChatPanel.tsx` + `apps/web/src/lib/aiChat.ts`
  (the fetch/stream client).
- Consume the SSE stream (fetch + `ReadableStream` reader, or `EventSource` via a
  GET is awkward with a body — use `fetch` POST + manual SSE parse), appending
  tokens to the in-progress assistant message for a live typing effect. Support
  **abort/stop**.
- State is **ephemeral** per open panel (client state); the snapshot is the
  context for the thread. (Persisting threads is a later nice-to-have.)
- Render AI messages as **Markdown** with syntax-highlighted code blocks — the
  whiteboard often holds code screenshots, so this matters. Add `react-markdown`
  + `remark-gfm` + a highlighter (`rehype-highlight` or `shiki`); keep it
  self-contained (no external CDN — the app's CSP is `'self'`). Add a **copy**
  button to code blocks and to whole answers.

---

## 6. UI/UX — make it genuinely nice
Design language: match the app (Tailwind, slate neutrals, the existing `accent`
purple, rounded-2xl, soft shadows). Aim for a calm, modern assistant surface.

- **Surface:** a right-hand **slide-in drawer** (~380–440px, full height,
  `translate-x` transition), NOT a full-screen modal — the user keeps seeing the
  board. On mobile it becomes a bottom sheet. Backdrop is subtle / optional (don't
  block the canvas).
- **Header:** "Ask AI" with a small sparkle icon, the workspace/slide name as a
  subtitle, and a close (✕). A "New chat" / clear action.
- **Snapshot chip:** show the captured selection as a **thumbnail** at the top of
  the thread ("Asking about this selection") with a subtle border and a click-to-
  zoom (lightbox). Make it obvious what the AI can see.
- **Messages:** user bubbles right-aligned (accent tint), assistant left-aligned
  with an AI avatar; generous spacing, `prose` typography for markdown, code
  blocks in a dark rounded panel with language label + copy. Timestamps subtle.
- **Streaming:** a blinking caret / shimmer while tokens arrive; a **Stop**
  button replaces Send during generation; auto-scroll to bottom (but don't yank
  if the user scrolled up).
- **Composer:** rounded multiline input, Enter=send / Shift+Enter=newline, send
  button enabled only with text, character/upload affordances minimal. Disable +
  show a spinner while awaiting the first token.
- **Quick prompts:** when a fresh snapshot opens, show 3–4 chips — "Explain this",
  "Find bugs / improve", "Summarize", "Convert to notes" — one tap to send.
- **States:** empty ("Ask anything about your selection"), loading (skeleton /
  shimmer for first token), error (friendly card with retry — distinguish rate-
  limit "slow down" from generic failure), offline.
- **Micro-interactions:** message fade/slide-in, drawer spring, copy → ✓ toast,
  focus trap + Esc to close + return focus to the board. Fully keyboard
  accessible, `aria-live="polite"` on the streaming message, respects
  `prefers-reduced-motion`.
- **Theme:** light now; keep tokens so a dark mode is a swap later.

---

## 7. Edge cases
- Nothing selected → the button isn't shown (unchanged trigger on `selectedCount`).
- Selection includes images → they're baked into the PNG by `exportToBlob` (uses
  `getFiles()`), so the model sees them.
- Huge selection / huge PNG → downscale before upload; reject > cap with a clear
  message.
- Groq 429 / model busy → surface "try again in a moment", keep the thread.
- User closes the drawer mid-stream → abort the request.
- VIEWER role → allowed to Ask AI (read-only insight); still can't edit the board.
- The snapshot leaves your infra to Groq — note this in the UI once ("Snapshots
  are sent to the AI provider to answer") and/or in docs.

## 8. Testing
- **Server smoke** (`smoke-ai` with the fake Groq port, no network): endpoint
  requires access (member ok, stranger 404, anon 401, guest 403); streams the
  fake tokens; rate limit triggers after N; oversized image rejected; validation
  errors on bad body. Add to the aggregate `npm run smoke`.
- **Web:** a small unit test for the SSE parse/stream-accumulate util; a component
  test that the panel renders streamed markdown + code copy.
- **E2E (optional):** select → Ask AI → panel opens with the snapshot; (mock the
  AI response) asserts a rendered answer.

## 9. Acceptance criteria
1. Selecting elements shows **Ask AI** (Add-to-tasks gone); clicking captures the
   exact selection as a snapshot and opens the chat with it visible.
2. The AI answers **about the snapshot**, streamed live, rendered as markdown with
   highlighted, copyable code.
3. Multi-turn works; Stop aborts; errors/rate-limits are handled gracefully.
4. `GROQ_API_KEY` is only ever used server-side; nothing secret reaches the client.
5. The panel looks polished (drawer, snapshot chip, bubbles, quick prompts,
   animations) and is keyboard/AX friendly.
6. `npm run build` clean; `smoke-ai` + existing smokes + web tests green.

## 10. Env / setup (you provide the key)
- Render env: `AI_CHAT_ENABLED=true`, `GROQ_API_KEY=<key>`, optionally `GROQ_MODEL=<id>`.
- Local `.env` (gitignored): same. Never commit the key.

## 11. Files
- `packages/shared/src/ai.ts` — request/response + message schemas; export.
- `apps/server/src/env.ts` — GROQ_API_KEY / AI_CHAT_ENABLED / GROQ_MODEL.
- `apps/server/src/lib/ai/groq.ts` — Groq streaming port + fake.
- `apps/server/src/routes/ai.ts` — `POST /workspaces/:id/ai/chat` (SSE) + mount in
  `index.ts` (after the specific routers, like boards).
- `apps/server/src/middleware/rateLimit.ts` — `aiRateLimit`.
- `apps/web/src/lib/aiChat.ts` — POST + SSE stream client.
- `apps/web/src/components/ai/AiChatPanel.tsx` (+ message/markdown subcomponents).
- `apps/web/src/components/WhiteboardTab.tsx` — swap the selection button to
  "Ask AI"; snapshot via `exportToBlob`; open the panel.
- `apps/web/package.json` — add `react-markdown`, `remark-gfm`, a highlighter.
- Tests: `apps/server/scripts/smoke-ai.ts`, web unit/component tests.
