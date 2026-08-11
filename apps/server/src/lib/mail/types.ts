export interface WorkspaceInvitationMail {
  to: string;
  inviterName: string;
  workspaceName: string;
  role: "EDITOR" | "VIEWER";
  inviteUrl: string;
  expiresAt: Date;
}

export interface MailProvider {
  sendWorkspaceInvitation(message: WorkspaceInvitationMail): Promise<void>;
}
