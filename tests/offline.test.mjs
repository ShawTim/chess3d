#!/usr/bin/env node
/**
 * Offline / PWA tests.
 *
 * The promise of the feature is that the game opens with the network switched
 * off, and that installing it does not quietly pin an old build forever. Two
 * halves to that:
 *
 *  - The precache list has to match the files that actually ship. Nothing is
 *    bundled, so a file left out of the list is simply missing offline, and a
 *    file listed but deleted fails the install.
 *  - The fetch policies have to behave. Those are exercised for real: sw.js is
 *    loaded into Node with stand-ins for `self`, `caches` and `fetch`, and its
 *    handlers are driven with the requests a browser would send.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:4173/chess3d/';
const SW_SOURCE = readFileSync(join(ROOT, 'sw.js'), 'utf8');

let failures = 0;
let checks = 0;

function expect(cond, label, detail = '') {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${label} ${detail}`);
  } else {
    console.log(`ok   ${label} ${detail}`);
  }
}

/** Every file under a directory, relative to the repo root. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel.split('\\').join('/'));
  }
  return out;
}

/* ---------------------------------------------------------------- the list -- */

const listMatch = SW_SOURCE.match(/const PRECACHE = \[([\s\S]*?)\n\];/);
const versionMatch = SW_SOURCE.match(/const CACHE_VERSION = '([^']+)';/);
const PRECACHE = listMatch ? new Function(`return [${listMatch[1]}];`)() : null;
const VERSION = versionMatch ? versionMatch[1] : null;

console.log('--- The worker and its list ---');
{
  expect(PRECACHE !== null, 'sw.js declares a PRECACHE list');
  expect(Array.isArray(PRECACHE), 'the list is an array');
  expect(typeof VERSION === 'string' && /^v\d+$/.test(VERSION),
    'the cache version is a bumpable name', String(VERSION));
  expect(/const CACHE_NAME = `chess3d-\$\{CACHE_VERSION\}`/.test(SW_SOURCE),
    'the cache name is derived from the version');
  expect(!PRECACHE.includes('./sw.js'), 'the worker is not cached by itself');
  expect(!PRECACHE.includes('./docs/og-image.png'), 'the social card is not fetched at runtime');
  expect(PRECACHE.every((path) => path.startsWith('./')), 'every entry is a relative path');
  expect(new Set(PRECACHE).size === PRECACHE.length, 'no entry appears twice',
    String(PRECACHE.length));
}

console.log('\n--- The list matches the files on disk ---');
{
  const onDisk = (path) => {
    const target = path === './' ? 'index.html' : path.slice(2);
    try { return statSync(join(ROOT, target)).isFile(); } catch { return false; }
  };

  const missing = PRECACHE.filter((path) => !onDisk(path));
  expect(missing.length === 0, 'every listed file exists', missing.join(', '));

  // Everything a browser fetches to boot: the shell, the styles, the manifest,
  // the icons, every module and every vendored Three.js file.
  const required = [
    'index.html',
    'styles.css',
    'site.webmanifest',
    'docs/favicon-32.png',
    'docs/apple-touch-icon.png',
    'docs/icon-512.png',
    ...walk('src').filter((path) => path.endsWith('.js')),
    ...walk('vendor/three').filter((path) => path.endsWith('.js')),
  ];
  const listed = new Set(PRECACHE.map((path) => (path === './' ? 'index.html' : path.slice(2))));
  const forgotten = required.filter((path) => !listed.has(path));
  expect(forgotten.length === 0, 'nothing needed at runtime is left out', forgotten.join(', '));
  expect(required.length >= 40, 'the list is the whole app', String(required.length));
}

console.log('\n--- Registration ---');
{
  const main = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
  expect(/navigator\.serviceWorker\.register\('\.\/sw\.js'\)/.test(main),
    'main.js registers sw.js from the app root');
  expect(/'serviceWorker' in navigator/.test(main), 'registration is guarded by feature detection');
  expect(/readyState === 'complete'\) register\(\);[\s\S]{0,80}addEventListener\('load', register/
    .test(main), 'it waits for the first frame instead of competing with the boot');
  expect(/\.catch\(\(\) => \{\}\)/.test(main), 'a refused registration is not fatal');
}

/* ------------------------------------------------------------ behaviour -- */

console.log('\n--- The handlers, driven for real ---');

const CACHE_VERSION = VERSION;
const CACHE_NAME = `chess3d-${CACHE_VERSION}`;
const SHELL_PATH = '/chess3d/';

/** A fake Cache, with just what sw.js uses. */
function makeCache() {
  const entries = new Map();
  const keyOf = (request) => {
    if (typeof request === 'string') return new URL(request, ORIGIN).pathname;
    if (request instanceof URL) return request.pathname;
    return new URL(request.url).pathname;
  };
  return {
    entries,
    async add(request) {
      const response = await globalThis.fetch(request);
      if (!response.ok) throw new Error(`cannot cache ${keyOf(request)}: ${response.status}`);
      entries.set(keyOf(request), response.clone());
    },
    async put(request, response) {
      entries.set(keyOf(request), response.clone());
    },
    async match(request) {
      const hit = entries.get(keyOf(request));
      return hit ? hit.clone() : undefined;
    },
  };
}

const cacheStore = new Map();
const network = { online: true, mode: 'ok', hang: false, calls: [] };

globalThis.self = {
  location: new URL(`${ORIGIN}sw.js`),
  skipWaiting: async () => { self.skippedWaiting = true; },
  clients: { claim: async () => { self.claimed = true; } },
  addEventListener: (type, fn) => { (self.listeners[type] ||= []).push(fn); },
  listeners: {},
  skippedWaiting: false,
  claimed: false,
};
globalThis.caches = {
  async open(name) {
    if (!cacheStore.has(name)) cacheStore.set(name, makeCache());
    return cacheStore.get(name);
  },
  async keys() { return [...cacheStore.keys()]; },
  async delete(name) { return cacheStore.delete(name); },
  async match(request) {
    for (const cache of cacheStore.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  },
};
globalThis.fetch = async (request) => {
  const url = typeof request === 'string' ? new URL(request, ORIGIN) : new URL(request.url);
  network.calls.push(url.pathname);
  if (network.hang) return new Promise(() => {});
  if (!network.online) throw new TypeError('Failed to fetch');
  if (network.mode === 'missing') return new Response('not found', { status: 404 });
  return new Response(`network:${url.pathname}`, {
    status: 200, headers: { 'content-type': 'text/plain' },
  });
};

await import('../sw.js');

/** Fire a worker event and collect what the handlers did with it. */
async function dispatch(type, init = {}) {
  const waits = [];
  let responded;
  const event = {
    ...init,
    waitUntil: (promise) => { waits.push(promise); },
    respondWith: (promise) => { responded = promise; },
  };
  for (const fn of self.listeners[type] ?? []) fn(event);
  await Promise.all(waits);
  const response = responded === undefined ? undefined : await responded;
  return { response, intercepted: responded !== undefined };
}

{
  // Install: every precached file is fetched once and stored.
  const cache = await caches.open(CACHE_NAME);
  network.online = true;
  network.mode = 'ok';
  network.calls.length = 0;
  await dispatch('install');
  expect(self.skippedWaiting, 'install takes over without waiting for a reload');
  expect(network.calls.length === PRECACHE.length, 'install fetches every listed file',
    `${network.calls.length}/${PRECACHE.length}`);
  expect(cache.entries.has('/chess3d/index.html') && cache.entries.has('/chess3d/src/main.js'),
    'the shell and the modules are in the cache');
  expect(cache.entries.has(SHELL_PATH), 'the directory itself is cached for navigations');
}
{
  // Install tolerance: a missing file must not lose the rest of the cache.
  cacheStore.clear();
  network.mode = 'missing';
  await dispatch('install');
  const cache = await caches.open(CACHE_NAME);
  expect(cache.entries.size === 0, 'a 404 on every file installs an empty cache');

  network.mode = 'ok';
  await dispatch('install');
  expect(cache.entries.size === PRECACHE.length, 'a good install refills it',
    String(cache.entries.size));
}
{
  // Activate: older caches are dropped.
  const stale = await caches.open('chess3d-v0');
  await stale.put('/old.js', new Response('old'));
  await dispatch('activate');
  expect(self.claimed, 'activate claims the open pages');
  expect(!cacheStore.has('chess3d-v0'), 'an older cache version is deleted');
  expect(cacheStore.has(CACHE_NAME), 'the current cache is kept');
}

console.log('\n--- What is intercepted ---');
{
  const crossOrigin = { url: 'https://fonts.example/style.css', method: 'GET', mode: 'cors' };
  const outside = { url: 'http://localhost:4173/other/app.js', method: 'GET', mode: 'cors' };
  const post = { url: `${ORIGIN}src/main.js`, method: 'POST', mode: 'cors' };
  const asset = { url: `${ORIGIN}src/main.js`, method: 'GET', mode: 'cors' };

  expect(!(await dispatch('fetch', { request: crossOrigin })).intercepted,
    'another origin is never intercepted');
  expect(!(await dispatch('fetch', { request: outside })).intercepted,
    'a path outside the app directory is left alone');
  expect(!(await dispatch('fetch', { request: post })).intercepted, 'a POST is left alone');
  expect((await dispatch('fetch', { request: asset })).intercepted, 'a module request is answered');
}

console.log('\n--- Navigation: fresh online, cached offline ---');
{
  const request = { url: `${ORIGIN}`, method: 'GET', mode: 'navigate' };
  network.online = true;
  const online = await dispatch('fetch', { request });
  expect((await online.response.text()) === 'network:/chess3d/', 'a navigation is served from the network');

  // The fresh HTML is kept for the next visit, including any change to it.
  const cache = await caches.open(CACHE_NAME);
  const stored = await cache.match('./');
  expect(stored !== undefined, 'the fresh shell is copied into the cache');

  network.online = false;
  const offline = await dispatch('fetch', { request });
  expect(offline.intercepted, 'an offline navigation is intercepted');
  expect(offline.response.status === 200, 'and answered from the cache', String(offline.response.status));
  expect((await offline.response.text()).startsWith('network:/chess3d/'), 'with the page that was stored');
}
{
  // Nothing cached and nothing reachable: a readable message, not a browser error.
  cacheStore.clear();
  network.online = false;
  const { response } = await dispatch('fetch', {
    request: { url: `${ORIGIN}`, method: 'GET', mode: 'navigate' },
  });
  const body = await response.text();
  expect(response.status === 503, 'a cold offline navigation reports 503', String(response.status));
  expect(/Chess3D/.test(body) && /Offline/.test(body), 'with a human-readable page', body.slice(0, 40));
}

console.log('\n--- Assets: cache first, refreshed behind ---');
{
  cacheStore.clear();
  network.online = true;
  network.calls.length = 0;
  const request = { url: `${ORIGIN}src/engine/chess.js`, method: 'GET', mode: 'cors' };

  const cold = await dispatch('fetch', { request });
  expect((await cold.response.text()) === 'network:/chess3d/src/engine/chess.js',
    'a cold asset comes from the network');
  const cache = await caches.open(CACHE_NAME);
  expect(cache.entries.has('/chess3d/src/engine/chess.js'), 'and is stored for next time');

  // Offline: the stored copy answers.
  network.online = false;
  const warm = await dispatch('fetch', { request });
  expect((await warm.response.text()) === 'network:/chess3d/src/engine/chess.js',
    'a warm asset is served from the cache with no network', String(warm.response.status));

  // Online again: the cache answers immediately, the network copy replaces it
  // afterwards. The response must not wait for the network — so the network is
  // made to hang here and the cached answer has to arrive anyway.
  network.online = true;
  network.hang = true;
  const raced = await Promise.race([
    dispatch('fetch', { request }).then(async (out) => (await out.response.text())),
    new Promise((resolve) => setTimeout(() => resolve('blocked'), 400)),
  ]);
  expect(raced === 'network:/chess3d/src/engine/chess.js',
    'a cached asset is answered without waiting for the network', String(raced));
  network.hang = false;

  // A missing asset with no network is a 504, not a hang.
  network.online = false;
  const missing = await dispatch('fetch', {
    request: { url: `${ORIGIN}src/not-a-file.js`, method: 'GET', mode: 'cors' },
  });
  expect(missing.response.status === 504, 'an uncached asset offline reports 504',
    String(missing.response.status));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
