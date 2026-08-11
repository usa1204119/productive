import { logger } from "../../logger.js";
import type { MailProvider, WorkspaceInvitationMail } from "./types.js";

export class ConsoleMailProvider implements MailProvider {
  async sendWorkspaceInvitation(message: WorkspaceInvitationMail): Promise<void> {
    // Deliberately excludes inviteUrl: logs must never contain raw tokens.
    logger.info(
      { recipientDomain: message.to.split("@")[1], workspaceName: message.workspaceName },
      "Development invitation email accepted by console provider",
    );
  }
}
