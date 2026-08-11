import { expect, type APIResponse, type Page } from "@playwright/test";

export async function data<T>(response: APIResponse): Promise<T> {
  const body = await response.json() as { success: boolean; data?: T; error?: { code: string; message: string } };
  expect(body.success, body.error?.message).toBe(true);
  return body.data as T;
}

export async function reset(page: Page): Promise<void> {
  await data(await page.request.post("/__e2e/reset"));
}

export async function login(page: Page, email: string, name?: string): Promise<void> {
  await data(await page.request.post("/__e2e/login", { data: { email, name } }));
  await page.goto("/");
  await expect(page.getByText("My workspace", { exact: true })).toBeVisible();
}

export async function firstWorkspace(page: Page): Promise<{ id: string; name: string }> {
  const workspaces = await data<Array<{ id: string; name: string }>>(await page.request.get("/workspaces"));
  return workspaces[0]!;
}

export async function invite(page: Page, workspaceId: string, email: string, role: "EDITOR" | "VIEWER") {
  await data(await page.request.post(`/workspaces/${workspaceId}/invitations`, { data: { email, role } }));
  const mailbox = await data<Array<{ to: string; inviteUrl: string }>>(await page.request.get("/__e2e/mailbox"));
  const message = mailbox.find((entry) => entry.to === email)!;
  return new URL(message.inviteUrl).pathname.split("/").at(-1)!;
}
