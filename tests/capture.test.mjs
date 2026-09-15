/**
 * View-layer test for the capture path.
 *
 * This runs headlessly by stubbing the small slice of the DOM that the piece
 * views need (an offscreen 2D canvas for the dust sprite). It exists because the
 * browser screenshot review passed a build in which a capture dissolved the
 * *capturing* piece instead of the captured one — the mover had already claimed
 * the destination square, so the square lookup returned the mover itself.
 *
 * Regression: given a mover and a victim that end up on the same square, the
 * victim must be the one removed.
 */
import * as THREE from 'three';

// --- Minimal canvas stub, installed before importing the view layer. --------
function make2dContext(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  return {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    getImageData: (x, y, w, h) => ({ data: data.slice(0, w * h * 4), width: w, height: h }),
    clearRect: () => {}, fillRect: () => {}, fillText: () => {}, drawImage: () => {},
    set font(v) {}, set fillStyle(v) {}, set textAlign(v) {}, set textBaseline(v) {}, set globalAlpha(v) {},
  };
}
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element: ' + tag);
    const size = 2;
    return {
      width: size, height: size,
      getContext: () => make2dContext(size),
      addEventListener: () => {},
    };
  },
};

const { PieceViews } = await import('../src/render/pieceViews.js');
const { PAWN, KNIGHT, ROOK, WHITE, BLACK, makePiece } = await import('../src/engine/chess.js');
const { squareToWorld } = await import('../src/render/board.js');

let failures = 0, checks = 0;
function expect(cond, label, detail = '') {
  checks++;
  if (!cond) { failures++; console.log(`FAIL ${label} ${detail}`); }
  else console.log(`ok   ${label} ${detail}`);
}

// A stand-in for the material library: plain materials are all the views touch.
const fakeLib = {
  piece: () => new THREE.MeshBasicMaterial(),
  accent: () => new THREE.MeshBasicMaterial(),
};

console.log('--- Capture removes the VICTIM, not the mover ---');
{
  const scene = new THREE.Scene();
  const views = new PieceViews(scene, fakeLib);

  const from = 52; // e2
  const to = 28;   // e4  (ordinary capture: victim sits on `to`)
  const mover = views.add(from, makePiece(PAWN, WHITE));
  const victim = views.add(to, makePiece(PAWN, BLACK));

  const moverId = mover.userData.id;
  const victimId = victim.userData.id;

  views.animateMove({
    from, to,
    type: PAWN,
    capture: true,
    capturedSq: to,      // the classic case: captured square IS the destination
    castle: false,
  });

  // Advance the animation well past its duration.
  for (let i = 0; i < 60; i++) views.update(1 / 60);

  const aliveIds = new Set([...views.pieces.values()].map((g) => g.userData.id));
  expect(aliveIds.has(moverId), 'the capturing piece survives');
  expect(!aliveIds.has(victimId), 'the captured piece is removed');

  const landedOn = views.at(to);
  expect(landedOn !== null && landedOn.userData.id === moverId,
    'the survivor is the piece now standing on the destination');
}

console.log('\n--- Capture on a different square (en passant) ---');
{
  const scene = new THREE.Scene();
  const views = new PieceViews(scene, fakeLib);

  const from = 28;      // e4
  const to = 19;        // d6 (empty: en-passant destination)
  const victimSq = 27;  // d5 (the pawn actually removed)
  const mover = views.add(from, makePiece(PAWN, WHITE));
  const victim = views.add(victimSq, makePiece(PAWN, BLACK));

  views.animateMove({ from, to, type: PAWN, capture: true, capturedSq: victimSq, castle: false });
  for (let i = 0; i < 60; i++) views.update(1 / 60);

  const aliveIds = new Set([...views.pieces.values()].map((g) => g.userData.id));
  expect(aliveIds.has(mover.userData.id), 'en passant: mover survives');
  expect(!aliveIds.has(victim.userData.id), 'en passant: off-square victim removed');
}

console.log('\n--- Castling moves the rook too ---');
{
  const scene = new THREE.Scene();
  const views = new PieceViews(scene, fakeLib);

  const rank = 56;
  const kingFrom = rank + 4, kingTo = rank + 6;   // e1 -> g1
  const rookFrom = rank + 7, rookTo = rank + 5;   // h1 -> f1
  const king = views.add(kingFrom, makePiece(6, WHITE));
  const rook = views.add(rookFrom, makePiece(ROOK, WHITE));

  views.animateMove({
    from: kingFrom, to: kingTo, type: 6, capture: false,
    castle: true, rookFrom, rookTo,
  });
  for (let i = 0; i < 90; i++) views.update(1 / 60);

  expect(king.userData.square === kingTo, 'king ends on its castled square');
  expect(rook.userData.square === rookTo, 'rook ends on its castled square');
  const kp = king.position, rp = rook.position;
  const kw = squareToWorld(kingTo, 0, new THREE.Vector3());
  const rw = squareToWorld(rookTo, 0, new THREE.Vector3());
  expect(Math.abs(kp.x - kw.x) < 1e-6 && Math.abs(kp.z - kw.z) < 1e-6, 'king mesh landed on g1');
  expect(Math.abs(rp.x - rw.x) < 1e-6 && Math.abs(rp.z - rw.z) < 1e-6, 'rook mesh landed on f1');
}

console.log('\n--- Promotion replaces the pawn with the new piece ---');
{
  const scene = new THREE.Scene();
  const views = new PieceViews(scene, fakeLib);

  const from = 8;   // a7
  const to = 0;     // a8
  const pawn = views.add(from, makePiece(PAWN, WHITE));

  views.animateMove({ from, to, type: PAWN, capture: false, promoType: 5 });
  for (let i = 0; i < 120; i++) views.update(1 / 60);

  const onA8 = views.at(to);
  expect(onA8 !== null, 'a piece stands on the promotion square');
  expect(onA8 && onA8.userData.type === 5, 'it is a queen', `type=${onA8 ? onA8.userData.type : 'none'}`);
  // The original pawn mesh must be gone, leaving exactly one piece.
  expect(views.pieces.size === 1, 'exactly one piece remains', `count=${views.pieces.size}`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
