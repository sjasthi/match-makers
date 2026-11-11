import express, { type NextFunction, type Request, type Response } from 'express';
import { env } from '@/env';
import { corsMiddleware } from '@/cors';
import { pool, registerTypeParsers } from '@/db';
import { attachRealtime } from '@/realtime';
import { ApiError, toApiError } from '@/errors';
import { authRouter } from '@/routes/auth';
import { feedRouter } from '@/routes/feed';
import { healthRouter } from '@/routes/health';
import { adminRouter } from '@/routes/admin';
import { matchesRouter, messagesRouter } from '@/routes/matches';
import { postsRouter } from '@/routes/posts';
import { profileRouter } from '@/routes/profile';
import { swipesRouter } from '@/routes/swipes';

export const app = express();

/**
 * CORS first, before the body parser and before every route.
 *
 * Order is load-bearing. A preflight (`OPTIONS`) that reaches `requireAuth` or
 * the 404 handler comes back without `Access-Control-Allow-*`, and the browser
 * rejects the real request that would have followed -- which is exactly how
 * login failed before this was added.
 */
app.use(corsMiddleware);

/**
 * `json({ limit })` exists because the app sends base64 data URIs for images on
 * web -- `services/imageImport.ts` inlines them -- and a profile with six of
 * those is a large body. The default 100kb limit would reject it with a
 * `413` and no explanation.
 *
 * It is not a defence against large payloads; it is a ceiling so the server
 * fails predictably rather than accumulating memory. Real image hosting is
 * listed under "Not built yet" in the README, and it is the thing that
 * eventually makes this number moot.
 */
app.use(express.json({ limit: '12mb' }));

/**
 * Routes mounted at the paths the mobile app's HTTP branches already call --
 * `services/api/client.ts` prefixes `API_CONFIG.BASE_URL`, and
 * `EXPO_PUBLIC_API_URL` defaults to `http://localhost:3000/api`.
 *
 * Note the port: this server listens on 3001 and the app's default points at
 * 3000. That is the Nginx gateway's port in the FP2 diagram, so nothing is
 * rewritten -- `EXPO_PUBLIC_API_URL` is the one thing that decides.
 */
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/profile', profileRouter);
app.use('/feed', feedRouter);
app.use('/swipes', swipesRouter);
app.use('/matches', matchesRouter);
app.use('/messages', messagesRouter);
app.use('/posts', postsRouter);
app.use('/admin', adminRouter);

app.use((_req, _res, next: NextFunction) => {
  next(ApiError.notFound('No such endpoint'));
});

/**
 * The error handler.
 *
 * Four arguments, and the unused `next` is what tells Express this is an error
 * handler rather than ordinary middleware -- dropping it silently turns every
 * error into an unhandled rejection.
 *
 * `toApiError` is what decides between "tell the client" and "log it and say
 * nothing". An `ApiError` is an expected outcome with a message written for a
 * person; anything else is a bug, so it gets a full stack in the log and a bare
 * `INTERNAL_ERROR` on the wire. Returning an exception's message to an unknown
 * caller is how stack traces and connection strings end up in responses.
 */
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const apiError = toApiError(error);

  if (apiError.status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, error);
  } else {
    console.warn(
      `[${req.method} ${req.originalUrl}] ${apiError.status} ${apiError.code}: ${apiError.message}`
    );
  }

  // `ApiErrorBody` flat, not nested under an `error` key.
  //
  // `readErrorMessage` in the app's `services/api/client.ts` reads `body.message`
  // off the top level, so wrapping it left every failure reporting axios's
  // generic "Request failed with status code 401" instead of the sentence that
  // was written for the person looking at it.
  res.status(apiError.status).json(apiError.toBody());
});

/**
 * Start listening.
 *
 * Kept separate from the module so tests can import `app` without binding a
 * port. There are no tests yet, which is why `npm test` in this workspace is a
 * placeholder -- but the split costs nothing now and is annoying to add later.
 */
async function main(): Promise<void> {
  // Before `listen`, so the first request cannot arrive before `pg` knows how to
  // read a `date` or a `gender[]`.
  await registerTypeParsers();

  const server = app.listen(env.PORT, () => {
    console.log(`@match-makers/api listening on http://localhost:${env.PORT}`);
  });

  // The WebSocket endpoint rides on the same HTTP server, at `/ws`, so there is
  // one port and one place to proxy.
  void attachRealtime(server).catch((error: unknown) => {
    console.error('[realtime] could not start the database listener:', error);
  });

  /**
   * A failed `listen` is an unhandled 'error' event unless something is
   * listening, and Node's default output for it is a stack trace through
   * `node:net` and `express/lib/application.js` that says nothing about the
   * actual problem. The overwhelmingly common cause is a second copy of this
   * server already running -- `tsx watch` plus `npm start`, or a background one
   * that outlived its terminal -- so that is what it says.
   */
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        [
          '',
          `Port ${env.PORT} is already in use, so this server did not start.`,
          '',
          '  Find and stop whatever is holding it:',
          `    lsof -ti tcp:${env.PORT} | xargs kill`,
          '',
          '  Or start this one somewhere else:',
          `    PORT=3002 npm run dev --workspace=apps/api`,
          '  and set EXPO_PUBLIC_API_URL=http://localhost:3002 in apps/mobile/.env.',
          '',
          '  A second server on another port will NOT serve the app unless the app',
          '  is repointed at it -- two copies on different ports silently disagree.',
        ].join('\n')
      );
    } else if (error.code === 'EACCES') {
      console.error(`Port ${env.PORT} needs elevated privileges. Ports below 1024 do.`);
    } else {
      console.error(`Server failed to start: ${error.message}`);
    }

    process.exit(1);
  });

  // Finish in-flight requests before exiting, so `Ctrl-C` during a write does
  // not leave a transaction half-applied. Postgres rolls that back on its own,
  // but the client gets a clean connection reset instead of a hang.
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, closing.`);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Started on import rather than under a `require.main` check, because `tsx`
// loads ES modules through a loader where that check is not reliable, and this
// module is only imported by `npm start` and `npm run dev` anyway. Tests that
// want the app without a port import from `@/app` -- which does not exist yet,
// and is the first thing to extract when there are tests.
void main();
