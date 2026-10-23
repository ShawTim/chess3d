#!/usr/bin/env node
/**
 * Input-layer tests: what counts as a tap on the board.
 *
 * Both cases here are defects that shipped, and both of them read to a player as
 * "the board sometimes will not let me move":
 *
 *   - a press held longer than 700 ms (900 ms on touch) was discarded. Pressing a
 *     piece, holding it while deciding and releasing is still a tap, and that is
 *     exactly the moment a player is unsure whether a capture is available.
 *   - a missed `pointerup` — released off the canvas, or swallowed by the
 *     browser — left the previous gesture pending, and the next `pointerdown` was
 *     thrown away while clearing it. The first click after that did nothing.
 *
 * `TapGesture` is pure logic over pointer coordinates, so it can be tested here
 * without a browser; `src/main.js` is only wiring.
 */
import { TapGesture } from '../src/game/tap.js';

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

console.log('--- A press that stays put is a tap ---');
{
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 100, 100);
  expect(tap.end(1), 'press and release in place');
}
{
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 100, 100);
  tap.move(1, 103, 104);
  expect(tap.end(1), 'a few pixels of wander is still a tap');
}
{
  // The regression: holding a piece while deciding must not cancel the click.
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 100, 100);
  const started = Date.now();
  while (Date.now() - started < 750) { /* hold the piece, as a player does */ }
  expect(tap.end(1), 'a press held for 750 ms is still a tap',
    `${Date.now() - started}ms`);
}

console.log('\n--- A drag is not a tap ---');
{
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 100, 100);
  tap.move(1, 140, 100);
  expect(!tap.end(1), 'a 40 px drag is rejected');
}
{
  // Orbiting the camera can end where it began; the furthest point decides.
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 100, 100);
  tap.move(1, 160, 100);
  tap.move(1, 100, 100);
  expect(!tap.end(1), 'a drag that returns to its start is still a drag');
}
{
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 100, 100);
  tap.move(2, 300, 300);
  expect(tap.end(1), 'movement from another pointer is ignored');
}

console.log('\n--- Pinch, cancellation and stale gestures ---');
{
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 10, 10);
  expect(!tap.start(2, 20, 20, false), 'a second finger does not start a tap');
  expect(!tap.end(1), 'the first finger stops counting once a pinch starts');
}
{
  // Regression: a pointerup lost off-canvas used to eat the next click.
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 100, 100);
  // No matching end(): the player released outside the canvas.
  tap.start(1, 100, 100);
  expect(tap.end(1), 'the next press after a missed pointerup still works');
}
{
  const tap = new TapGesture({ slopPx: 6 });
  tap.start(1, 100, 100);
  tap.cancel();
  expect(!tap.end(1), 'a cancelled gesture is not a tap');
}
{
  // Slop follows the pointer type and is re-read per gesture.
  let coarse = false;
  const tap = new TapGesture({ slopPx: () => (coarse ? 14 : 6) });
  tap.start(1, 0, 0);
  tap.move(1, 10, 0);
  expect(!tap.end(1), 'mouse slop rejects a 10 px wobble');
  coarse = true;
  tap.start(1, 0, 0);
  tap.move(1, 10, 0);
  expect(tap.end(1), 'touch slop accepts the same 10 px wobble');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
