import type { MailProvider, WorkspaceInvitationMail } from "./types.js";

const messages: WorkspaceInvitationMail[] = [];

export class MemoryMailProvider implements MailProvider {
  async sendWorkspaceInvitation(message: WorkspaceInvitationMail): Promise<void> {
    messages.push(structuredClone(message));
  }
}

/** Test-only access; the mailbox route is guarded by NODE_ENV + E2E_TEST_MODE. */
export const memoryMailbox = {
  all: (): readonly WorkspaceInvitationMail[] => messages,
  clear: (): void => {
    messages.length = 0;
  },
};
