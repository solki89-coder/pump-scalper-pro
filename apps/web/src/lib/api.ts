const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'pump_scalper_token';

/**
 * The dashboard uses Bearer-token auth (token kept in localStorage) rather
 * than the API's httpOnly-cookie + CSRF flow, to keep this reduced-scope
 * frontend simple. That's a real tradeoff — a token in localStorage is
 * readable by any script on the page (XSS risk) where an httpOnly cookie
 * isn't — documented here and in README.md rather than silently glossed
 * over. Phase 14's security audit is where the dashboard would move to the
 * cookie+CSRF flow the API already supports for exactly this reason.
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  // Only set Content-Type when there's an actual body — Fastify's JSON
  // parser rejects a request that declares application/json but sends no
  // bytes (e.g. a bodyless POST like /api/bot/start), so a bodyless
  // action here must not send the header at all.
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  // credentials: 'include' is required for a cross-origin request (web on
  // :3000, API on :4000 in dev) to both send AND store cookies — without
  // it the browser never persists the login response's Set-Cookie header,
  // which is also what the WS handshake authenticates with (see wsUrl()).
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const message = (body as { error?: string } | undefined)?.error ?? `Request failed: ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * The browser can't set an Authorization header on a WebSocket handshake,
 * so the WS connection authenticates via the httpOnly `token` cookie the
 * login route also sets (alongside the Bearer token this client actually
 * uses for REST calls) — the browser attaches it automatically because
 * `localhost:3000` and `localhost:4000` share the same registrable domain
 * (SameSite=Strict allows that; it isn't a cross-site request).
 */
export function wsUrl(): string {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  return url.toString();
}
