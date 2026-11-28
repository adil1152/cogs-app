import { GetCurrentAuthUserResponse } from "@workspace/api-zod";
import type { Response } from "express";

export const INVALID_PROFILE_MESSAGE =
  "Your account details need administrator attention. Contact your administrator to review your profile, then retry. You can also sign out and use another account.";

// Validate without exposing stored values or changing legacy account data.
export function validateAuthProfile(user: unknown, res: Response) {
  const parsed = GetCurrentAuthUserResponse.safeParse({ user });
  if (!parsed.success) {
    res.status(409).json({ error: INVALID_PROFILE_MESSAGE });
    return null;
  }
  return parsed.data;
}