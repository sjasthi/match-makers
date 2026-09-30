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

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: API_CONFIG.BASE_URL,
    timeout: API_CONFIG.TIMEOUT,
    headers: { 'Content-Type': 'application/json' },
  });
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

/** Unwraps `{ data: ... }` envelopes used by the FP2 backend. */
export async function requestWithData<T>(
  config: Parameters<AxiosInstance['request']>[0]
): Promise<T> {
  const response = await getApiClient().request<ApiEnvelope<T>>(config);
  return response.data.data;
}

export function resetApiClient(): void {
  apiClient = null;
  transport = null;
  sessionExpiredListeners.clear();
}
