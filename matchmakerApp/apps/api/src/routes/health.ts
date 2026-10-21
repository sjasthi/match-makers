import { Router } from 'express';
import { pool } from '@/db';
import { asyncHandler, send } from '@/http';

export const healthRouter = Router();

/**
 * Liveness, and proof the database is actually reachable.
 *
 * Not a ping. A server that answers 200 while its database is gone is worse
 * than one that fails to answer, because a load balancer will keep sending
 * traffic to it. `SELECT 1` is the cheapest statement that still goes all the
 * way to Postgres.
 */
healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const startedAt = Date.now();
    await pool.query('SELECT 1');
    send(res, { status: 'ok', database: 'up', latencyMs: Date.now() - startedAt });
  })
);
