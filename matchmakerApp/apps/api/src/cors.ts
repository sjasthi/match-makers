import cors from 'cors';
import type { RequestHandler } from 'express';
import { corsOrigins } from '@/env';

/**
 * CORS, for the Expo **web** target.
 *
 * Why this file exists: `localhost:8081` (Expo's web dev server) and
 * `localhost:3001` (this API) are different origins, and a browser enforces
 * that. It sends an `OPTIONS` preflight before `POST /auth/login`, and with no
 * CORS headers on the response the browser refuses it -- so login died as
 * `net::ERR_FAILED` with no request ever sent.
 *
 * None of the existing tests could catch that. `curl` does not enforce CORS,
 * and the integration suite in `apps/mobile` runs under Jest, where
 * `XMLHttpRequest` is not the browser's. Both happily talk to an API that a
 * browser cannot reach. Hence `preflightIsAnsweredForTheWebOrigin` in
 * `apiConnection.test.ts`, which asserts the headers exist.
 *
 * **Native (iOS/Android) ignores all of this** -- there is no browser
 * enforcing origins there, so the same bundle works on a phone without any of
 * it. This is web-only paperwork.
 *
 * Must be mounted **before every route**, including the 404 handler. A
 * preflight that reaches `requireAuth` or the catch-all comes back without
 * these headers and the browser rejects it again.
 */
export const corsMiddleware: RequestHandler = cors({
  /**
   * Echo the request's origin back, but only when it is on the list.
   *
   * Returning a fixed string is not an option here: the browser rejects
   * `Access-Control-Allow-Origin: *` on a credentialed request, so the day
   * cookie sessions replace the bearer token, a wildcard would break every
   * request. Echoing the specific origin keeps the allowlist and leaves that
   * door open.
   *
   * A request with no `Origin` (native, curl, server-to-server) gets `undefined`,
   * which `cors` treats as "no CORS headers" -- correct, because nothing is
   * asking.
   */
  origin(origin, callback) {
    if (!origin) {
      callback(null, false);
      return;
    }

    if (corsOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    // `callback(null, false)` rather than throwing: the request continues
    // without CORS headers, and the *browser* blocks it. Throwing would turn a
    // policy decision into a 500 that also arrives as an opaque network error,
    // which is much harder to debug than "blocked by CORS".
    console.warn(`[cors] refused origin: ${origin}`);
    callback(null, false);
  },

  /**
   * No current caller sends credentials -- `JWTAuthAdapter` uses an
   * `Authorization` header -- so this is forward-looking rather than required.
   * It is cheap to set now and impossible to add later without a CORS change
   * and a confusing round of failures, because the browser's error for a
   * missing credentials header looks like a network fault, not a header
   * mistake.
   */
  credentials: true,

  /**
   * The verbs the API actually uses. Spelled out rather than reflecting whatever
   * the preflight asked for, so a compromised origin cannot discover an
   * unlisted endpoint by asking.
   */
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],

  /**
   * `Authorization` is the reason the preflight exists at all: it is not a
   * CORS-safelisted header, so a request carrying it cannot be "simple" and
   * always needs a preflight.
   */
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],

  // Answers the preflight itself. Without this it falls through to the 404
  // handler and the browser sees a failed preflight.
  optionsSuccessStatus: 204,

  // Status codes that may expose a response to the browser. 500 is deliberately
  // excluded: a stack trace or a connection string must not be readable by a
  // page that happens to be allowed to call this API.
  exposedHeaders: [],
});
