import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { data, firstWorkspace, invite, login, reset } from "../support/api.js";

test.beforeEach(async ({ page }) => reset(page));

test("guest login creates a starter workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByText("My workspace", { exact: true })).toBeVisible();
  const me = await data<{ isGuest: boolean }>(await page.request.get("/auth/me"));
  expect(me.isGuest).toBe(true);
});

test("workspace and board rename/delete UI", async ({ page }) => {
  await login(page, "owner@example.com", "Owner");
  const workspace = await firstWorkspace(page);
  const board = await data<{ id: string }>(await page.request.post(`/workspaces/${workspace.id}/boards`, { data: { name: "Plan" } }));
  await page.reload();
  await expect(page.getByLabel("Switch board")).toHaveValue(board.id);
  await page.getByRole("button", { name: "Board options" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Board name").fill("Launch board");
  await page.getByRole("button", { name: "Rename", exact: true }).last().click();
  await expect(page.getByLabel("Switch board")).toContainText("Launch board");
  await page.getByRole("button", { name: "Board options" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete board" }).click();
  await expect(page.getByText("No boards yet.")).toBeVisible();
});

test("email invitation enforces account match and RBAC", async ({ browser, page }) => {
  await login(page, "owner@example.com", "Owner");
  const workspace = await firstWorkspace(page);
  const editorToken = await invite(page, workspace.id, "editor@example.com", "EDITOR");

  const wrong = await browser.newPage();
  await login(wrong, "wrong@example.com", "Wrong account");
  const mismatch = await wrong.request.post(`/workspace-invitations/${editorToken}/accept`);
  expect(mismatch.status()).toBe(403);
  expect((await mismatch.json()).error.code).toBe("INVITATION_EMAIL_MISMATCH");
  await wrong.close();

  const editor = await browser.newPage();
  await login(editor, "editor@example.com", "Editor");
  await data(await editor.request.post(`/workspace-invitations/${editorToken}/accept`));
  const created = await editor.request.post(`/workspaces/${workspace.id}/boards`, { data: { name: "Editor board" } });
  expect(created.status()).toBe(201);

  const viewerToken = await invite(page, workspace.id, "viewer@example.com", "VIEWER");
  const viewer = await browser.newPage();
  await login(viewer, "viewer@example.com", "Viewer");
  await data(await viewer.request.post(`/workspace-invitations/${viewerToken}/accept`));
  expect((await viewer.request.get(`/workspaces/${workspace.id}/boards`)).status()).toBe(200);
  const forbidden = await viewer.request.post(`/workspaces/${workspace.id}/boards`, { data: { name: "Nope" } });
  expect(forbidden.status()).toBe(403);
  expect((await forbidden.json()).error.code).toBe("FORBIDDEN");
  await editor.close();
  await viewer.close();
});

test("board revision conflict never silently overwrites", async ({ browser, page }) => {
  await login(page, "owner@example.com", "Owner");
  const workspace = await firstWorkspace(page);
  const token = await invite(page, workspace.id, "editor@example.com", "EDITOR");
  const editor = await browser.newPage();
  await login(editor, "editor@example.com", "Editor");
  await data(await editor.request.post(`/workspace-invitations/${token}/accept`));
  const board = await data<{ id: string; revision: number }>(await page.request.post(`/workspaces/${workspace.id}/boards`, { data: { name: "Concurrent" } }));
  const payload = { baseRevision: board.revision, elements: [{ id: "a" }], appState: {}, files: {} };
  expect((await page.request.put(`/workspaces/${workspace.id}/boards/${board.id}/scene`, { data: payload })).status()).toBe(200);
  const conflict = await editor.request.put(`/workspaces/${workspace.id}/boards/${board.id}/scene`, { data: payload });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).error.code).toBe("BOARD_CONFLICT");
  await editor.close();
});

test("live task invalidation reaches a second browser context", async ({ browser, page }) => {
  await login(page, "owner@example.com", "Owner");
  const workspace = await firstWorkspace(page);
  const token = await invite(page, workspace.id, "viewer@example.com", "VIEWER");
  const viewer = await browser.newPage();
  await login(viewer, "viewer@example.com", "Viewer");
  await data(await viewer.request.post(`/workspace-invitations/${token}/accept`));
  await viewer.goto("/");
  await viewer.getByRole("tab", { name: "To do tasks" }).click();
  await page.getByRole("tab", { name: "To do tasks" }).click();
  await page.getByPlaceholder(/Add task/).fill("Live task");
  await page.getByPlaceholder(/Add task/).press("Enter");
  await expect(viewer.getByText("Live task", { exact: true })).toBeVisible();
  await viewer.close();
});

test("security headers, rate limits, accessibility and mobile overflow", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  for (let index = 0; index < 3; index += 1) expect((await page.request.get("/__e2e/rate-limit")).status()).toBe(200);
  const limited = await page.request.get("/__e2e/rate-limit");
  expect(limited.status()).toBe(429);
  expect((await limited.json()).error.code).toBe("RATE_LIMITED");
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Open sidebar" })).toBeVisible();
});
