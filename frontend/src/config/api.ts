/**
 * Central API configuration
 *
 * In development (vite dev):
 *   - Uses VITE_API_URL from .env / environment, defaults to http://localhost:8000
 *
 * In production (containerised / K8s):
 *   - The frontend is served by nginx which also reverse-proxies /api/* to
 *     the backend service. If VITE_API_URL is unset, production builds use
 *     relative paths (e.g. "/api/list-products").
 *   - Alternatively set VITE_API_URL to the full backend URL if the frontend
 *     is served from a different origin.
 *
 * Usage:
 *   import { apiFetch } from '../config/api';
 *   apiFetch('/api/list-products')
 */
const DEFAULT_API_URL = import.meta.env.DEV ? 'http://localhost:8000' : '';

export const API_URL: string =
  import.meta.env.VITE_API_URL ?? DEFAULT_API_URL;

type AccessTokenProvider = () => string | null | Promise<string | null>;

let accessTokenProvider: AccessTokenProvider | null = null;

export function setAccessTokenProvider(provider: AccessTokenProvider | null): void {
  accessTokenProvider = provider;
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = accessTokenProvider ? await accessTokenProvider() : null;
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: init.credentials ?? 'include',
    headers,
  });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('htx:auth-required'));
  }
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => null);
    if (body?.code === 'approval_pending') {
      window.dispatchEvent(new CustomEvent('htx:approval-pending'));
    }
  }
  return response;
}

export async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
