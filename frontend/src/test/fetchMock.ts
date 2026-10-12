import { vi } from 'vitest';

type Reply = unknown | Response | ((url: string, init?: RequestInit) => unknown | Response);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function apiError(status: number, error: string, code = '', headers: Record<string, string> = {}) {
  return json({ error, code, requestId: 'req-test' }, status, headers);
}

/**
 * Replaces fetch with a route table: the first "METHOD /path" prefix that matches
 * the request answers. Unmatched requests get a 404 (and are listed in calls).
 */
export function mockFetch(routes: Record<string, Reply>) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const entries = Object.entries(routes);
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown;
    try {
      body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    } catch {
      body = init?.body;
    }
    calls.push({ method, url, body });
    const match = entries.find(([pattern]) => {
      const [m, path] = pattern.split(' ');
      return (
        m === method &&
        (url === path || url.startsWith(`${path}?`) || (path.endsWith('*') && url.startsWith(path.slice(0, -1))))
      );
    });
    if (!match) return apiError(404, `unmocked ${method} ${url}`);
    const reply =
      typeof match[1] === 'function' ? (match[1] as (u: string, i?: RequestInit) => unknown)(url, init) : match[1];
    return reply instanceof Response ? reply : json(reply);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}
