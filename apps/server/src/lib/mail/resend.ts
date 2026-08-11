import { AppError } from "../../errors.js";
import type { MailProvider, WorkspaceInvitationMail } from "./types.js";

export class ResendMailProvider implements MailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendWorkspaceInvitation(message: WorkspaceInvitationMail): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: `${message.inviterName} invited you to ${message.workspaceName}`,
        text: [
          `${message.inviterName} invited you to join ${message.workspaceName} as ${message.role.toLowerCase()}.`,
          `Accept the invitation: ${message.inviteUrl}`,
          `This link expires at ${message.expiresAt.toISOString()}.`,
        ].join("\n\n"),
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new AppError(502, "MAIL_DELIVERY_FAILED", "Invitation email could not be delivered");
    });

    if (!response.ok) {
      throw new AppError(502, "MAIL_DELIVERY_FAILED", "Invitation email could not be delivered");
    }
  }
}
