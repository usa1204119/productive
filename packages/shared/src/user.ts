import { z } from "zod";

/** The authenticated user as exposed to the client. Never includes tokens. */
export const userDtoSchema = z.object({
  id: z.string(),
  email: z.string().email().nullable(),
  name: z.string(),
  avatarUrl: z.string().url().nullable(),
  isGuest: z.boolean(),
  driveConnected: z.boolean(),
});

export type UserDto = z.infer<typeof userDtoSchema>;
