/**
 * The offline cache.
 *
 * Chess3D has no server, no API and no build step, but a browser still has to
 * fetch the files before it can run them — so on a plane, or with the network
 * down, the page would not open at all. This worker caches the whole game on
 * first visit and serves it from the cache afterwards, which is also what makes
 * the site installable as an app (the manifest and this file are the two things
 * a PWA needs).
 *
 * Two policies, for two different kinds of request:
 *
 *  - Navigation (the HTML shell) is network-first. The player gets a fresh page
 *    whenever there is a network, and the cached copy only when there is not, so
 *    a deploy is picked up on the next visit instead of being pinned by the
 *    cache for a version.
 *  - Everything else (modules, styles, textures, the worker) is
 *    stale-while-revalidate: the cached copy answers immediately and the network
 *    copy replaces it for next time. Two waits are why the board appears at once
 *    on a second visit.
 *
 * Nothing leaves this origin: cross-origin requests are not intercepted, so
 * "no CDN, no external asset" stays true here too.
 */

/**
 * Bump when a cached file is renamed or removed.
 *
 * Adding or editing a file does not need a bump: the shell is revalidated on
 * every navigation and the assets refresh themselves in the background. A rename
 * does, because the old name is still in the cache and nothing asks for it
 * again. The offline test asserts this string is present and parses.
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `chess3d-${CACHE_VERSION}`;

/**
 * Everything the game needs to boot with no network at all.
 *
 * `./` and not just `./index.html`: a navigation to the directory is answered
 * from that entry, which is what an installed app opens. Kept as a plain list,
 * and checked against the files on disk by `tests/offline.test.mjs` so it cannot
 * silently drift out of date.
 */
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './site.webmanifest',
  './docs/favicon-32.png',
  './docs/apple-touch-icon.png',
  './docs/icon-512.png',
  './src/audio/sfx.js',
  './src/engine/ai.js',
  './src/engine/book.js',
  './src/engine/chess.js',
  './src/engine/evaluate.js',
  './src/game/autosave.js',
  './src/game/controller.js',
  './src/game/share.js',
  './src/game/tap.js',
  './src/main.js',
  './src/render/board.js',
  './src/render/camera.js',
  './src/render/materials.js',
  './src/render/pieceViews.js',
  './src/render/pieces.js',
  './src/render/scene.js',
  './src/render/textures.js',
  './src/ui/glyphs.js',
  './src/ui/hud.js',
  './src/worker/aiWorker.js',
  './vendor/three/addons/controls/OrbitControls.js',
  './vendor/three/addons/environments/RoomEnvironment.js',
  './vendor/three/addons/postprocessing/EffectComposer.js',
  './vendor/three/addons/postprocessing/MaskPass.js',
  './vendor/three/addons/postprocessing/OutputPass.js',
  './vendor/three/addons/postprocessing/Pass.js',
  './vendor/three/addons/postprocessing/RenderPass.js',
  './vendor/three/addons/postprocessing/SMAAPass.js',
  './vendor/three/addons/postprocessing/ShaderPass.js',
  './vendor/three/addons/postprocessing/UnrealBloomPass.js',
  './vendor/three/addons/shaders/CopyShader.js',
  './vendor/three/addons/shaders/LuminosityHighPassShader.js',
  './vendor/three/addons/shaders/OutputShader.js',
  './vendor/three/addons/shaders/SMAAShader.js',
  './vendor/three/addons/utils/BufferGeometryUtils.js',
  './vendor/three/three.module.js',
];

/**
 * The page a navigation falls back to, and what an installed app opens. Resolved
 * against the worker's own URL, so nothing depends on an implicit base.
 */
const SHELL = new URL('./', self.location.href);

/** The directory this worker was installed in; nothing outside it is touched. */
const SCOPE = SHELL.pathname;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // `cache: 'reload'` skips the HTTP cache, so installing a new version cannot
    // pick up a stale copy of a file the visitor already has.
    //
    // One entry at a time rather than `addAll`: a single 404 would reject the
    // whole install and leave the site with no worker at all. A missing file
    // costs that file offline, nothing more.
    await Promise.all(PRECACHE.map(async (path) => {
      try {
        await cache.add(new Request(new URL(path, self.location.href), { cache: 'reload' }));
      } catch { /* see above: one missing file is not fatal */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }
  event.respondWith(assetResponse(request));
});

/**
 * Fresh HTML when the network answers, the cached shell when it does not.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function navigationResponse(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      // Keep the shell current, so "offline tomorrow" means today's page.
      cache.put(SHELL, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await caches.match(SHELL, { ignoreSearch: true });
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Chess3D</title>'
      + '<body style="background:#08090c;color:#e9e6df;font:16px system-ui;padding:2rem">'
      + '<h1>Chess3D</h1><p>Offline, and no cached copy of the game is available yet.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
}

/**
 * Serve from the cache, refresh it in the background.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function assetResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });

  const fromNetwork = fetch(request).then((response) => {
    if (response && response.ok && response.type !== 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  });

  if (cached) {
    // The cached copy is the answer; the network copy is only for next time. Its
    // failure is expected when offline and must not surface as an error.
    fromNetwork.catch(() => {});
    return cached;
  }

  try {
    return await fromNetwork;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
