const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Phase 14 security audit: moved off Bearer-token-in-localStorage onto the
 * API's httpOnly-cookie + CSRF flow (the API always supported both; the
 * reduced-scope dashboard from Phase 10 took the simpler localStorage
 * shortcut). The JWT itself now lives only in an httpOnly cookie the
 * server sets on login — no client-side script, including an injected
 * one, can read it. The `csrf_token` cookie the server sets alongside it
 * is deliberately non-httpOnly (the whole point of the double-submit
 * pattern is that JS must be able to read it and echo it back as a
 * header); reading that cookie to log "am I authenticated" is not the
 * same exposure as holding the actual bearer credential.
 */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

export function isAuthenticated(): boolean {
  return readCookie('csrf_token') !== null;
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

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // Only set Content-Type when there's an actual body — Fastify's JSON
  // parser rejects a request that declares application/json but sends no
  // bytes (e.g. a bodyless POST like /api/bot/start), so a bodyless
  // action here must not send the header at all.
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  // Double-submit CSRF: the server requires this header to match the
  // csrf_token cookie on every cookie-authenticated mutating request (see
  // apps/api/src/plugins/auth.ts). /auth/login itself is exempt (it's not
  // authenticated yet), so there's no csrf_token cookie to send on that
  // first request — the check below simply no-ops for it.
  const method = (init.method ?? 'GET').toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = readCookie('csrf_token');
    if (csrfToken) headers.set('x-csrf-token', csrfToken);
  }

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
 * The browser can't set a custom header on a WebSocket handshake, so the
 * WS connection authenticates via the same httpOnly `token` cookie every
 * REST call now also relies on — the browser attaches it automatically
 * because `localhost:3000` and `localhost:4000` share the same
 * registrable domain (SameSite=Strict allows that; it isn't a cross-site
 * request).
 */
export function wsUrl(): string {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  return url.toString();
}
