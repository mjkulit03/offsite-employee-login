// ═══════════════════════════════════════════════════════════════════════════
// Test bootstrap for the localStorage-backed mock API layer (public/data.js).
//
// data.js is a browser IIFE that expects window, localStorage, navigator and
// location to exist. This helper installs minimal stubs for those globals,
// then evaluates data.js from a unique data: URL so every call to freshEnv()
// re-runs the module body (and its seed) from a clean slate. A plain dynamic
// import with a "?load=N" query is NOT enough: Node reuses the cached module
// for file: URLs on Windows.
//
// Requires Node 18+ (for the global Response class and btoa/atob).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const DATA_JS_PATH = new URL('../../public/data.js', import.meta.url);

// Single backing map shared by the localStorage stub. freshEnv() clears it,
// so all storage keys ("at_users", "at_attendance", ...) reset between tests.
const storageMap = new Map();
const localStorageStub = {
  getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
  setItem: (k, v) => { storageMap.set(k, String(v)); },
  removeItem: (k) => { storageMap.delete(k); },
  clear: () => { storageMap.clear(); },
  key: (i) => [...storageMap.keys()][i] ?? null,
  get length() { return storageMap.size; },
};

let globalsInstalled = false;
function installGlobals() {
  if (globalsInstalled) return;

  if (!globalThis.location) {
    globalThis.location = { href: 'http://localhost:3000/' };
  }
  if (!globalThis.window) {
    globalThis.window = globalThis;
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageStub,
    configurable: true,
    writable: true,
  });
  // Node 21+ already provides a real navigator with a userAgent string.
  if (!globalThis.navigator) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'node-test' },
      configurable: true,
    });
  }
  globalsInstalled = true;
}

let loadCount = 0;

/**
 * Reset storage, re-evaluate data.js (re-running its seed), and return a test
 * client whose `api()` calls go through the intercepted window.fetch exactly
 * like app.js does in the browser.
 */
export async function freshEnv() {
  installGlobals();
  storageMap.clear();
  loadCount += 1;

  // A unique data: URL per load guarantees the module body executes again.
  // (Node keys its module cache on the exact URL string, so identical source
  // would be served from cache — hence the loadCount salt appended below.)
  const source = readFileSync(DATA_JS_PATH, 'utf8') + `\n// load=${loadCount}`;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
  await import(dataUrl);

  return {
    /** Call a mock API endpoint, e.g. api('/auth/login', { method: 'POST', body }) */
    async api(endpoint, init = {}) {
      const res = await window.fetch(`/api${endpoint}`, init);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, ok: res.ok, data };
    },
  };
}

/** Login as a seeded user and return { token, user }. */
export async function loginAs(env, username, password) {
  const res = await env.api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `login as "${username}" should succeed`);
  return res.data;
}
