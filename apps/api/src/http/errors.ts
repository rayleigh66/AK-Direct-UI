import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  /**
   * Extra top-level response fields (for example the latest cart on a version
   * conflict, or the affected PENDING orders before a destructive admin action).
   * These are merged next to `error` by the app error handler.
   */
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
