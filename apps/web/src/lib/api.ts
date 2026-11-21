import { ApiError, type ApiErrorBody, type LoginResponse } from './types';

/**
 * API client for the KotaLabs CRM backend.
 *
 * - Requests go to the same origin (`/api/...`); Next.js proxies them to the
 *   backend (see next.config.ts rewrites). NEXT_PUBLIC_API_URL can override
 *   this for direct calls.
 * - The access token is kept in memory + localStorage. On a 401 TOKEN_EXPIRED
 *   the client refreshes once (single-flight) and retries the request.
 * - Refresh-token rotation is handled by the backend; the new pair replaces
 *   the stored one.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

const ACCESS_KEY = 'kotalabs.accessToken';
const REFRESH_KEY = 'kotalabs.refreshToken';

let memoryAccessToken: string | null = null;
let memoryRefreshToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable (private mode) — memory copy still works.
  }
}

export function getAccessToken(): string | null {
  return memoryAccessToken ?? readStorage(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return memoryRefreshToken ?? readStorage(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  memoryAccessToken = accessToken;
  memoryRefreshToken = refreshToken;
  writeStorage(ACCESS_KEY, accessToken);
  writeStorage(REFRESH_KEY, refreshToken);
}

export function clearTokens(): void {
  memoryAccessToken = null;
  memoryRefreshToken = null;
  writeStorage(ACCESS_KEY, null);
  writeStorage(REFRESH_KEY, null);
}

export function hasSession(): boolean {
  return Boolean(getRefreshToken());
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  if (body?.error) {
    return new ApiError(response.status, body.error.code, body.error.message, body.error.details);
  }
  return new ApiError(response.status, 'INTERNAL_ERROR', `Request failed (${response.status})`);
}

/** Refresh the access token. Single-flight: concurrent callers share one request. */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        clearTokens();
        return null;
      }
      const data = (await response.json()) as LoginResponse;
      setTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export interface RequestOptions extends RequestInit {
  /** Skip the automatic refresh-and-retry on 401 (used by login/refresh itself). */
  skipAuthRetry?: boolean;
}

async function doFetch(path: string, options: RequestOptions): Promise<Response> {
  const { skipAuthRetry: _skip, headers, ...init } = options;
  const token = getAccessToken();

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
  });

  if (response.status === 401 && !options.skipAuthRetry) {
    // Peek at the error code without consuming the body twice.
    const clone = response.clone();
    let code: string | null = null;
    try {
      const body = (await clone.json()) as ApiErrorBody;
      code = body?.error?.code ?? null;
    } catch {
      code = null;
    }

    if (code === 'TOKEN_EXPIRED') {
      const newToken = await refreshAccessToken();
      if (newToken) {
        return fetch(`${API_BASE}${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
            ...(headers ?? {}),
          },
        });
      }
    }
  }

  return response;
}

/** Authenticated JSON request. Throws ApiError on failure. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await doFetch(path, options);
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function apiDelete(path: string): Promise<void> {
  await apiFetch<undefined>(path, { method: 'DELETE' });
}

/** Download a file (CSV export) with authentication. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await doFetch(path, { method: 'GET' });
  if (!response.ok) throw await parseError(response);

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/** Build a query string from a record, skipping empty values. */
export function toQuery(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
