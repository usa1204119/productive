import type { Response } from "express";
import type { ApiSuccess } from "@plane-and-curves/shared";

/** Send a success payload in the standard { success: true, data } envelope. */
export function ok<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { success: true, data };
  res.status(status).json(body);
}
