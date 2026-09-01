import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { withConnectionScope } from '../dal/db.js';

/**
 * Binds one pooled database connection to the whole request.
 *
 * Without this, every `db.query` borrows a connection and hands it straight
 * back, so a request doing ten reads churns ten checkouts. Authorization alone
 * costs three — the permission set, the subordinate closure and the team
 * closure — which is a large share of the 20 ms p95 budget in NF-5 spent on
 * pool bookkeeping rather than on work.
 *
 * The connection is taken on FIRST database use, not here, so a request that
 * never touches the database never holds one (see `ConnectionScope` in the
 * DAL). It is released when the response finishes, whichever way it finishes.
 *
 * Nothing about tenancy changes: each unit of work still opens its own short
 * transaction and still sets `app.organization_id` transaction-locally, so the
 * setting cannot survive onto the next borrower (TN-6, TX-3).
 */
export const connectionScope: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const ctx = req.ctx;
  if (ctx === undefined) {
    next();
    return;
  }

  const finished = new Promise<void>((resolve) => {
    // `finish` fires on a normal response; `close` covers a client that
    // disconnects mid-flight. Without the second one, an aborted request would
    // hold its connection until the process restarted.
    res.once('finish', resolve);
    res.once('close', resolve);
  });

  void withConnectionScope(ctx.organizationId, async () => {
    next();
    await finished;
  }).catch((error: unknown) => {
    // The scope itself failing is a defect, not a request error — `next()` has
    // already been called, so the response is somebody else's to send.
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'connection scope failed',
        requestId: ctx.requestId,
        err: error instanceof Error ? error.message : String(error),
      }),
    );
  });
};
