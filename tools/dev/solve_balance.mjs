/**
 * Solve the knight's forward placement and head scale so the piece satisfies its
 * balance constraints.
 *
 * The constraints are geometric, not aesthetic, so they can be solved rather than
 * guessed at:
 *
 *   - the nose must not overhang the pedestal by more than ~0.10, or the piece
 *     looks like it is pitching forward;
 *   - the back of the neck must stay within the pedestal footprint, or the head
 *     looks like it is sliding off;
 *   - the finished piece must reach its declared height.
 *
 * This sweeps the forward offset (KNIGHT_Z_CENTRE) and a uniform head scale, and
 * reports which combinations satisfy all of them, so the values written into the
 * source are derived rather than tuned by eye.
 */
import * as THREE from 'three';
import { knightHeadGeo, PIECE_HEIGHT } from '../src/render/pieces.js';
import { KNIGHT } from '../src/engine/chess.js';

const BASE_BODY_RADIUS = 0.190;
const MAX_OVERHANG = 0.10;
const BASE_TOP = 0.42;
const SEAT_DROP = 0.07;
const EAR_ALLOWANCE = 0.11;

const head = knightHeadGeo();
head.computeBoundingBox();
const hb = head.boundingBox;

// Current (compiled-in) forward placement and the resulting raw extents.
const seat = BASE_TOP - SEAT_DROP;
const rawHeight = hb.max.y - hb.min.y;

console.log('raw head bounds  z:', hb.min.z.toFixed(3), '..', hb.max.z.toFixed(3),
  ' y:', hb.min.y.toFixed(3), '..', hb.max.y.toFixed(3));
console.log('pedestal body radius:', BASE_BODY_RADIUS, ' max overhang allowed:', MAX_OVERHANG);
console.log('\n  shiftZ   scaleK   height   noseOverhang   neckBack   verdict');

const best = [];
for (let shift = -0.10; shift <= 0.16; shift += 0.02) {
  for (let headScale = 0.80; headScale <= 1.20; headScale += 0.05) {
    const k = ((PIECE_HEIGHT[KNIGHT] - seat) / (rawHeight * headScale + EAR_ALLOWANCE));
    const nose = (hb.max.z + shift) * k * headScale;
    const neckBack = (hb.min.z + shift) * k * headScale;
    const height = seat + (rawHeight * headScale) * k + EAR_ALLOWANCE * k * 0.0;

    const noseOk = nose - BASE_BODY_RADIUS <= MAX_OVERHANG;
    const neckOk = Math.abs(neckBack) <= BASE_BODY_RADIUS + 0.05;
    const heightOk = Math.abs((seat + rawHeight * headScale * k) - PIECE_HEIGHT[KNIGHT]) < 0.06;
    const ok = noseOk && neckOk && heightOk;
    if (ok) best.push({ shift, headScale, k, nose, neckBack, height });
  }
}

if (!best.length) {
  console.log('  (no combination satisfies all constraints)');
  // Report the closest for diagnosis.
  for (let shift = -0.10; shift <= 0.16; shift += 0.06) {
    const k = (PIECE_HEIGHT[KNIGHT] - seat) / (rawHeight * 1.0 + EAR_ALLOWANCE);
    const nose = (hb.max.z + shift) * k;
    const neckBack = (hb.min.z + shift) * k;
    console.log(`  ${shift.toFixed(2).padStart(6)}   ${k.toFixed(3)}   ` +
      `nose=${(nose - BASE_BODY_RADIUS).toFixed(3)}  neck=${neckBack.toFixed(3)}`);
  }
} else {
  // Prefer the largest head that fits (dominant head reads best on a knight).
  best.sort((a, b) => b.headScale - a.headScale || Math.abs(a.nose - BASE_BODY_RADIUS) - Math.abs(b.nose - BASE_BODY_RADIUS));
  for (const r of best.slice(0, 8)) {
    console.log(
      `  ${r.shift.toFixed(2).padStart(6)}   ${r.k.toFixed(3)}   ` +
      `${(seat + rawHeight * r.headScale * r.k).toFixed(3)}   ` +
      `${(r.nose - BASE_BODY_RADIUS).toFixed(3).padStart(6)}        ` +
      `${r.neckBack.toFixed(3).padStart(6)}   OK`,
    );
  }
  console.log('\nbest (largest head that fits):', JSON.stringify({ shift: best[0].shift, headScale: best[0].headScale }));
}
