/**
 * Solve the knight's forward centring (KNIGHT_Z_CENTRE) from the actual geometry.
 *
 * The head is larger now, so the previously-tuned offset no longer satisfies the
 * two balance constraints, and guessing at it broke them twice. This measures the
 * built head and computes the offset directly.
 *
 *   noseOverhang = (maxZ - C) * k  must be <= BASE_R + 0.10
 *   neckBack     = (minZ - C) * k  must satisfy |neckBack| <= BASE_R + 0.05
 *
 * where k is the seat/scale factor knightParts applies. Reporting the feasible
 * range lets the value be read off instead of searched by trial and error.
 */
import { knightHeadGeo, PIECE_HEIGHT } from '../src/render/pieces.js';
import { KNIGHT } from '../src/engine/chess.js';

const BASE_R = 0.190;
const MAX_OVERHANG = 0.10;
const BASE_TOP = 0.50;
const SEAT_DROP = 0.09;
const EAR_ALLOWANCE = 0.115;

const head = knightHeadGeo();
head.computeBoundingBox();
const b = head.boundingBox;

const seat = BASE_TOP - SEAT_DROP;
const rawHeight = b.max.y - b.min.y;
const k = (PIECE_HEIGHT[KNIGHT] - seat - EAR_ALLOWANCE) / rawHeight;

console.log('head raw bounds  z:', b.min.z.toFixed(4), '..', b.max.z.toFixed(4));
console.log('scale k =', k.toFixed(4), ' base body radius =', BASE_R);
console.log('');
console.log('  C        noseZ     noseOverhang   neckZ      neck|z|   verdict');

let best = null;
// The feasible window can sit below zero (the spine's neck station is at z = 0,
// which is a natural origin for the pedestal axis), so the sweep must include
// negative offsets. An earlier range of 0.10..0.30 reported "no feasible C"
// purely because the answer lay outside the search.
for (let C = -0.12; C <= 0.30; C += 0.005) {
  const noseZ = (b.max.z - C) * k;
  const neckZ = (b.min.z - C) * k;
  const overhang = noseZ - BASE_R;
  const noseOk = overhang <= MAX_OVERHANG;
  const neckOk = Math.abs(neckZ) <= BASE_R + 0.05;
  const ok = noseOk && neckOk;
  if (ok && !best) best = { C, noseZ, neckZ, overhang };
  if (Math.round(C * 1000) % 20 === 0 || ok) {
    console.log(
      `  ${C.toFixed(3)}   ${noseZ.toFixed(4).padStart(7)}   ${overhang.toFixed(4).padStart(9)}   ` +
      `${neckZ.toFixed(4).padStart(7)}   ${Math.abs(neckZ).toFixed(4)}   ${ok ? 'OK' : (noseOk ? 'neck fails' : 'nose fails')}`,
    );
  }
}

console.log('');
if (best) {
  // Prefer the smallest feasible C that still fits, which keeps the piece as
  // upright as possible over its pedestal.
  console.log('recommended KNIGHT_Z_CENTRE =', best.C.toFixed(3));
  console.log('  noseZ =', best.noseZ.toFixed(4), ' overhang =', best.overhang.toFixed(4));
  console.log('  neckZ =', best.neckZ.toFixed(4));
} else {
  console.log('NO feasible C: the head is too long for the pedestal at this scale.');
}
