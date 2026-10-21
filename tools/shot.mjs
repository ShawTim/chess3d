/**
 * Capture the running app as a PNG, for the README hero image and the social
 * card. Drives an already-running headless Chrome over the DevTools Protocol.
 *
 * tools/make-social-images.py turns a captured render into the social card, but
 * nothing in the repository produced the capture itself, so this closes that gap:
 *
 *   # 1. serve the app and start a headless Chrome that exposes CDP
 *   npm run serve
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 \
 *     --user-data-dir=/tmp/chess3d-cdp --window-size=1280,720 about:blank &
 *
 *   # 2. capture, then compose the card
 *   node tools/shot.mjs --out docs/screenshot.png
 *   cp docs/screenshot.png /tmp/hero-render.png
 *   python3 tools/make-social-images.py
 *
 * Why CDP rather than `chrome --screenshot`: one-shot screenshot mode hangs on
 * the WebGL path here, and it cannot tell you whether the page actually rendered.
 * This waits for the controller to report a phase, waits for the camera to stop
 * moving, and fails loudly on console errors — a screenshot of a broken page
 * still looks plausible.
 *
 * Flags: --out PATH, --url URL, --width N, --height N, --port N, --settle MS.
 */
import fs from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const port = Number(arg('port', 9222));
const url = arg('url', 'http://localhost:4173/');
const out = arg('out', 'docs/screenshot.png');
const width = Number(arg('width', 1280));
const height = Number(arg('height', 720));
const settleMs = Number(arg('settle', 4000));

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let nextId = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    problems.push(`${msg.params.type}: ${text}`);
  }
  if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
    problems.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(`exception: ${msg.params.exceptionDetails.text}`);
  }
};

const send = (method, params = {}, sessionId) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });

await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride',
  { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url }, sessionId);

const read = async () => {
  const res = await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.querySelector('canvas');
      const cam = window.__chess?.cameraRig?.camera;
      return JSON.stringify({
        ready: document.readyState,
        phase: window.__chess?.controller?.phase ?? null,
        canvas: canvas ? [canvas.width, canvas.height] : null,
        camera: cam ? cam.position.toArray().map((v) => +v.toFixed(3)) : null,
      });
    })()`,
    returnByValue: true,
  }, sessionId);
  const value = res.result?.result?.value;
  return value ? JSON.parse(value) : null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for the scene to be live, not merely for the document to load.
const deadline = Date.now() + 30000;
let state = null;
while (Date.now() < deadline) {
  state = await read();
  if (state?.phase && state?.canvas) break;
  await sleep(400);
}
if (!state?.phase) {
  console.error('the app never reached a playable phase; nothing written');
  process.exit(1);
}
if (state.canvas[0] !== width || state.canvas[1] !== height) {
  console.error(`canvas is ${state.canvas.join('x')}, expected ${width}x${height}`);
  process.exit(1);
}

// Wait for the camera to settle: the app animates its framing on start-up, and a
// capture taken mid-move is a different composition from the app's resting shot.
await sleep(settleMs);
let previous = state.camera;
for (let i = 0; i < 20; i++) {
  await sleep(400);
  const now = await read();
  if (JSON.stringify(now.camera) === JSON.stringify(previous)) { state = now; break; }
  previous = now.camera;
  state = now;
}
await sleep(800);

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
if (!shot.result?.data) {
  console.error('capture failed:', JSON.stringify(shot).slice(0, 300));
  process.exit(1);
}
const png = Buffer.from(shot.result.data, 'base64');
fs.writeFileSync(out, png);

const meta = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ phase: window.__chess.controller.phase })`,
  returnByValue: true,
}, sessionId);

console.log(`wrote ${out} (${width}x${height}, ${png.length} bytes)`);
console.log(`  state   ${JSON.stringify(state)}`);
console.log(`  runtime ${meta.result?.result?.value}`);
if (problems.length) {
  console.error(`  ${problems.length} console problem(s):`);
  for (const line of problems.slice(0, 10)) console.error('   ', line);
  process.exitCode = 1;
} else {
  console.log('  console clean (no errors or warnings)');
}

await send('Target.closeTarget', { targetId });
ws.close();
