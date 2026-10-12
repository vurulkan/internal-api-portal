// Talking to the portal under test from Node (seeding, signing in).
export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18095';
export const UPSTREAM = `http://127.0.0.1:${process.env.UPSTREAM_PORT ?? 18096}`;
export const ADMIN = { username: 'admin', password: 'Granite-Orbit-Lantern-71' };
export const BOOTSTRAP_PASSWORD = 'E2e-Bootstrap-Pw-9001';
export const USER_PASSWORD = 'Quiet-Harbor-Lamp-4242';

/** A cookie-jar client for the portal API (CSRF header included). */
export class Client {
  private cookie = '';

  async request(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Protection': '1',
        Origin: BASE,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const pair = c.split(';')[0];
      if (pair.startsWith('portal_session')) this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    if (!res.ok && res.status !== 502) throw new Error(`${method} ${path}: ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  }
}
