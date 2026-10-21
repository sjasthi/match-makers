import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';
import type { ApiEnvelope } from '@match-makers/shared';
import { API_CONFIG } from '@/constants';
import { AuthError } from '@/services/auth/AuthError';
import type { AuthTransport } from '@/services/auth/AuthAdapter';

interface RetriableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let apiClient: AxiosInstance | null = null;
let transport: AuthTransport | null = null;

const sessionExpiredListeners = new Set<() => void>();

/** Endpoints that must never trigger a refresh loop. */
const AUTH_FREE_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

function isAuthFreeRequest(config: RetriableRequest | undefined): boolean {
  if (!config?.url) return false;
  return AUTH_FREE_PATHS.some((path) => config.url?.includes(path));
}

/**
 * Unwraps `{ data, meta }` envelopes on the way back in.
 *
 * The API answers in `ApiEnvelope<T>`, which is the contract `types/api.ts`
 * documents and what `requestWithData` was written for. But every service and
 * adapter reads `response.data.something` directly -- twenty-odd call sites
 * across `feed.ts`, `posts.ts`, `matches.ts`, `profile.ts` and both HTTP auth
 * adapters -- so `requestWithData` had no callers and the envelope, if it had
 * ever arrived, would have broken all of them at once.
 *
 * Unwrapping centrally fixes that for the existing code instead of editing
 * twenty call sites, and it puts the rule in one place: a response body is an
 * envelope or it is not, and every caller should not have to know which.
 *
 * The key check is what keeps this from eating a legitimate payload. It only
 * unwraps a body whose keys are entirely within `{data, meta}` -- so a `User`
 * or a `Post`, which have no `data` field, passes through untouched even if a
 * payload ever grew one.
 */
function isEnvelope(body: unknown): body is ApiEnvelope<unknown> {
  if (typeof body !== 'object' || body === null) return false;
  const keys = Object.keys(body);
  if (!keys.includes('data')) return false;
  return keys.every((key) => key === 'data' || key === 'meta');
}

function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_CONFIG.BASE_URL,
    timeout: API_CONFIG.TIMEOUT,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.response.use((response) => {
    if (isEnvelope(response.data)) {
      response.data = response.data.data;
    }
    return response;
  });

  return client;
}

/**
 * Installs the transport that adds credentials to outgoing requests and
 * handles 401 recovery. Call once during app bootstrap.
 */
export function setAuthTransport(next: AuthTransport): void {
  transport = next;
}

export function getAuthTransport(): AuthTransport | null {
  return transport;
}

/** Notified when credentials are lost and the user must sign in again. */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function emitSessionExpired(): void {
  sessionExpiredListeners.forEach((listener) => listener());
}

export function getApiClient(): AxiosInstance {
  if (apiClient) return apiClient;

  const client = createClient();

  client.interceptors.request.use(async (rawConfig: InternalAxiosRequestConfig) => {
    const config = rawConfig as RetriableRequest;
    if (transport) {
      await transport.applyToRequest(config);
    }
    return config;
  });

  let refreshInFlight: Promise<void> | null = null;

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const request = error.config as RetriableRequest | undefined;
      const status = error.response?.status;

      if (
        status !== 401 ||
        !request ||
        request._retry ||
        !transport ||
        isAuthFreeRequest(request)
      ) {
        return Promise.reject(AuthError.fromStatus(status ?? 0, readErrorMessage(error)));
      }

      request._retry = true;

      // Collapse concurrent 401s into a single refresh call.
      refreshInFlight ??= transport.refresh().finally(() => {
        refreshInFlight = null;
      });

      try {
        await refreshInFlight;
      } catch (refreshError) {
        await transport.clear();
        emitSessionExpired();
        return Promise.reject(AuthError.unknown(refreshError));
      }

      // The refreshed credentials are read straight from storage by the
      // request interceptor, so replaying the original config is enough.
      return client(request);
    }
  );

  apiClient = client;
  return client;
}

function readErrorMessage(error: AxiosError): string {
  const body = error.response?.data as { message?: string } | undefined;
  if (body?.message) return body.message;
  if (error.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

/**
 * Reads a response body.
 *
 * The response interceptor above has already removed the envelope, so this is
 * now just `response.data` -- which is what every other caller does. It is kept
 * because it is the explicit spelling of "give me the payload", and because a
 * caller that uses it will keep working if the unwrapping ever moves back out
 * of the interceptor and into here.
 */
export async function requestWithData<T>(
  config: Parameters<AxiosInstance['request']>[0]
): Promise<T> {
  const response = await getApiClient().request<T>(config);
  return response.data;
}

export function resetApiClient(): void {
  apiClient = null;
  transport = null;
  sessionExpiredListeners.clear();
}
