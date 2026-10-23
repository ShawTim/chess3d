#!/usr/bin/env node
/**
 * Loading-screen regression tests.
 *
 * The loader is the only part of the app a player sees before anything works, so
 * two properties are worth pinning down:
 *
 *   1. The bar reports real progress. It used to be an indeterminate sweep, which
 *      said "something is happening" and nothing else — on a slow phone the same
 *      animation played for six seconds with no sign of moving. Now every boot
 *      stage passes a fraction, so a stage that forgets one, or a fraction that
 *      goes backwards, is a bug the tests should catch rather than a player.
 *
 *   2. The yield between stages must resolve even when no frame is ever painted.
 *      boot() awaits setLoading(), and a page opened in a background tab never
 *      fires requestAnimationFrame — gating the yield on rAF alone would leave the
 *      game permanently unable to finish initialising. The fallback timer is what
 *      prevents that, and it is easy to delete by accident.
 *
 * The second property is tested against the real function: its source is lifted
 * out of main.js and called with fake elements and fake schedulers. Static
 * assertions would pass even if the timing logic were wrong.
 */
import fs from 'node:fs';

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

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const mainSrc = fs.readFileSync('src/main.js', 'utf8');

/* ------------------------------------------------------------- the markup -- */

const barTag = html.match(/<div[^>]*id="loader-bar"[^>]*>/)?.[0] ?? '';
expect(barTag.length > 0, 'the loader has a progress bar element');
expect(/role="progressbar"/.test(barTag), 'the bar is a progressbar, not decoration');
expect(/aria-valuemin="0"/.test(barTag) && /aria-valuemax="100"/.test(barTag),
  'the bar declares its range', barTag.slice(0, 120));
expect(/aria-valuenow="0"/.test(barTag), 'the bar starts at zero');
expect(/aria-label="[^"]{3,}"/.test(barTag), 'the bar has an accessible name');
expect(/aria-valuetext=/.test(barTag), 'the bar can carry the stage as text');

const noteTag = html.match(/<div[^>]*id="loader-note"[^>]*>[^<]*<\/div>/)?.[0] ?? '';
expect(noteTag.length > 0, 'the loader has a note element');
expect(/role="status"/.test(noteTag), 'the note is a live region, so stages are announced');
expect(/>\s*\S[^<]*</.test(noteTag), 'the note has text before any script runs', noteTag);

// The loader must leave cleanly: faded out, out of the way, and removed by main.js.
expect(/#loader\.hidden\s*\{[^}]*opacity:\s*0/.test(css), 'the loader fades out');
expect(/#loader\.hidden\s*\{[^}]*visibility:\s*hidden/.test(css),
  'and stops taking space once faded');
expect(/loader\.remove\(\)/.test(mainSrc), 'and is removed from the document afterwards');

/* -------------------------------------------------------------- the styles -- */

const barSpan = css.match(/\.loader-bar span\s*\{[^}]*\}/)?.[0] ?? '';
expect(barSpan.length > 0, 'the bar has a fill');
expect(/width:\s*calc\(var\(--loader-progress/.test(barSpan),
  'the fill is driven by the reported fraction', barSpan.replace(/\s+/g, ' ').slice(0, 120));
expect(/transition:\s*width/.test(barSpan), 'the fill eases between stages');
expect(!/animation:/.test(barSpan), 'the fill no longer animates on its own');
expect(!/@keyframes\s+sweep/.test(css), 'the indeterminate sweep is gone');

// The stylesheet collapses every animation and transition for reduced motion, and
// the progress bar is a width transition — so it must be covered by that rule.
expect(/@media \(prefers-reduced-motion: reduce\)/.test(css), 'reduced motion is honoured');
expect(/prefers-reduced-motion: reduce\)[\s\S]{0,160}transition-duration:\s*0\.01ms/.test(css),
  'including the bar\'s ease-out');

/* ---------------------------------------------------------- the boot stages -- */

// Every stage call in boot() must carry a fraction: one argument means the bar
// silently stops moving at that point.
const calls = [...mainSrc.matchAll(/setLoading\(\s*'([^']*)'\s*(?:,\s*([0-9.]+)\s*)?\)/g)]
  .map((m) => ({ text: m[1], arg: m[2] }));
expect(calls.length >= 5, 'boot reports at least five stages', String(calls.length));
expect(calls.every((c) => c.arg !== undefined), 'every stage passes a fraction',
  calls.filter((c) => c.arg === undefined).map((c) => c.text).join(', ') || 'all do');

const fracs = calls.map((c) => Number(c.arg));
expect(fracs.every((f) => Number.isFinite(f) && f > 0 && f <= 1), 'fractions stay in 0..1',
  fracs.join(' '));
expect(fracs.every((f, i) => i === 0 || f > fracs[i - 1]), 'the bar only ever moves forwards',
  fracs.join(' '));
expect(fracs.at(-1) === 1, 'the last stage is a full bar', String(fracs.at(-1)));
expect(fracs[0] < 0.2, 'the first stage leaves the bar almost empty', String(fracs[0]));
expect(fracs.some((f) => f >= 0.7), 'the last big job is reported late', fracs.join(' '));

const texts = calls.map((c) => c.text);
expect(new Set(texts).size === texts.length, 'no stage repeats another stage\'s text',
  texts.join(' / '));
expect(texts.every((t) => t.length >= 5 && t.length <= 40),
  'stage text fits one line of the note', texts.join(' / '));
expect(texts.some((t) => /engine/i.test(t)), 'the engine start is announced',
  texts.find((t) => /engine/i.test(t)) ?? '');
expect(texts.some((t) => /piece|board/i.test(t)), 'the geometry work is announced',
  texts.filter((t) => /piece|board/i.test(t)).join(', '));
expect(!texts.some((t) => /^loading\.\.\.$/i.test(t)), 'no stage says just "loading"');

/* ----------------------------------------------------- the function itself -- */

const start = mainSrc.indexOf('function setLoading(');
expect(start > 0, 'setLoading is a top-level function');
const end = mainSrc.indexOf('\n}\n', start);
expect(end > start, 'and it can be lifted out for testing');
const fnSrc = mainSrc.slice(start, end + 3);

// Build it with fake collaborators: the module-level element lookups and the two
// schedulers become parameters, so nothing here touches a browser.
const factory = new Function(
  'loaderNote', 'loaderBar', 'requestAnimationFrame', 'setTimeout',
  `${fnSrc}\nreturn setLoading;`,
);

function fakeBar() {
  const record = { props: {}, attrs: {} };
  return {
    style: { setProperty: (name, value) => { record.props[name] = value; } },
    setAttribute: (name, value) => { record.attrs[name] = value; },
    record,
  };
}
const fakeNote = () => ({ textContent: '' });

// rAF that fires, timer that does not: the normal visible-tab path.
{
  const bar = fakeBar();
  const note = fakeNote();
  const setLoading = factory(note, bar, (fn) => fn(), () => {});
  await setLoading('Turning 32 pieces', 0.78);
  expect(note.textContent === 'Turning 32 pieces', 'the note shows the stage', note.textContent);
  expect(bar.record.attrs['aria-valuenow'] === '78', 'the bar reports 78%',
    String(bar.record.attrs['aria-valuenow']));
  expect(bar.record.attrs['aria-valuetext'] === 'Turning 32 pieces',
    'the announced value names the stage', String(bar.record.attrs['aria-valuetext']));
  expect(bar.record.props['--loader-progress'] === '0.78',
    'the fill fraction is what CSS reads', String(bar.record.props['--loader-progress']));
}

// rAF that never fires, timer that does: a background tab, which is the case the
// fallback exists for. If this hangs, the bug is back.
{
  const bar = fakeBar();
  const note = fakeNote();
  let timerCalled = false;
  const setLoading = factory(note, bar, () => {}, (fn) => { timerCalled = true; fn(); });
  await setLoading('Waking the engine', 0.94);
  expect(timerCalled, 'a frame-less tab still advances the boot');
  expect(note.textContent === 'Waking the engine', 'and still names the stage', note.textContent);
}

// Out-of-range fractions are clamped instead of painting a bar off the track.
{
  const bar = fakeBar();
  const setLoading = factory(fakeNote(), bar, (fn) => fn(), () => {});
  await setLoading('Ready', 4);
  expect(bar.record.attrs['aria-valuenow'] === '100', 'over a hundred clamps to 100',
    String(bar.record.attrs['aria-valuenow']));
  await setLoading('Ready', -2);
  expect(bar.record.attrs['aria-valuenow'] === '0', 'below zero clamps to 0',
    String(bar.record.attrs['aria-valuenow']));
}

// The elements are looked up once at module load; if the markup changes, boot()
// must still run rather than throwing before the first frame.
{
  let settled = false;
  const setLoading = factory(null, null, (fn) => fn(), () => {});
  await setLoading('Ready', 1).then(() => { settled = true; });
  expect(settled, 'a missing loader does not break the boot');
}

console.log(failures ? `\n${failures} FAILED (${checks} checks)` : `\nALL PASS (${checks} checks)`);
process.exit(failures ? 1 : 0);
