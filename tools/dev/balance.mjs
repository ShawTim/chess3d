// Measure how the head sits over the pedestal for different forward references.
// The pedestal's cylindrical body is ~0.19 radius; the muzzle must not project
// far beyond it or the piece looks like it is falling forward.
import { KNIGHT_PROFILE, PIECE_HEIGHT } from '../src/render/pieces.js';

const xs = KNIGHT_PROFILE.map((p) => p[0]);
const minX = Math.min(...xs), maxX = Math.max(...xs);
const neckRootMid = (KNIGHT_PROFILE[0][0] + KNIGHT_PROFILE[KNIGHT_PROFILE.length - 1][0]) / 2;
const bboxMid = (minX + maxX) / 2;

// Assembly geometry (mirrors knightParts): seat + scale factor.
const seat = 0.40;
const EAR_ALLOWANCE = 0.120;
const rawHeight = 0.938;              // profile height, plus a little bevel
const k = (PIECE_HEIGHT[2] - seat - EAR_ALLOWANCE) / rawHeight;
const BASE_RADIUS = 0.185;

console.log(`profile x: ${minX.toFixed(3)} .. ${maxX.toFixed(3)}  (neck mid ${neckRootMid.toFixed(3)}, bbox mid ${bboxMid.toFixed(3)})`);
console.log(`scale k = ${k.toFixed(4)}   base body radius ~= ${BASE_RADIUS}\n`);

for (const [label, zMid] of [['neck-root centred', neckRootMid], ['bbox centred', bboxMid], ['blend (60/40)', neckRootMid * 0.6 + bboxMid * 0.4]]) {
  const neckBack = (KNIGHT_PROFILE[0][0] - zMid) * k;
  const neckFront = (KNIGHT_PROFILE[KNIGHT_PROFILE.length - 1][0] - zMid) * k;
  const muzzle = (maxX - zMid) * k;
  const maneBack = (minX - zMid) * k;
  const overhang = muzzle - BASE_RADIUS;
  const neckInside = Math.max(Math.abs(neckBack), Math.abs(neckFront)) <= BASE_RADIUS;
  console.log(`${label.padEnd(17)} neck z ${neckBack.toFixed(3)}..${neckFront.toFixed(3)}  muzzle z ${muzzle.toFixed(3)}  mane ${maneBack.toFixed(3)}`);
  console.log(`${''.padEnd(17)} muzzle overhang ${overhang >= 0 ? '+' : ''}${overhang.toFixed(3)}   neck within base: ${neckInside}\n`);
}
