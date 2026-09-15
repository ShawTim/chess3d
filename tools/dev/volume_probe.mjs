/**
 * Measure the sculpted width of the knight's head, to confirm it has genuine
 * three-dimensional volume rather than constant-depth extrusion.
 *
 * Reports the piece's x-extent (its width) as a function of position along the
 * length (z), so the taper from a full cheek to a slim muzzle is visible as
 * numbers. A constant-width extrusion would print the same value everywhere.
 */
import { knightParts } from '../src/render/pieces.js';

const p = knightParts();
const pos = p.head.attributes.position;

let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
for (let i = 0; i < pos.count; i++) {
  const z = pos.getZ(i), y = pos.getY(i);
  if (z < minZ) minZ = z;
  if (z > maxZ) maxZ = z;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
const spanZ = maxZ - minZ;
const spanY = maxY - minY;

const widthAt = (zLo, zHi, yLo, yHi) => {
  let w = 0;
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getZ(i) - minZ) / spanZ;
    const v = (pos.getY(i) - minY) / spanY;
    if (u < zLo || u > zHi || v < yLo || v > yHi) continue;
    const ax = Math.abs(pos.getX(i));
    if (ax > w) w = ax;
  }
  return w * 2; // full width
};

console.log('head z:', minZ.toFixed(3), '..', maxZ.toFixed(3));
console.log('\n  length band           half-width x 2   (constant extrusion would be flat)');
for (let lo = 0.0; lo < 1.0; lo += 0.125) {
  const hi = Math.min(1.0, lo + 0.125);
  const w = widthAt(lo, hi, 0.3, 0.9);
  console.log(`  ${lo.toFixed(3)}-${hi.toFixed(3)} (back..nose)     ${w.toFixed(4)}`);
}

const cheek = widthAt(0.45, 0.62, 0.4, 0.75);
const muzzle = widthAt(0.85, 1.0, 0.4, 0.75);
console.log('\ncheek width :', cheek.toFixed(4));
console.log('muzzle width:', muzzle.toFixed(4));
console.log('taper ratio :', (cheek / Math.max(muzzle, 1e-6)).toFixed(2), '(want > 1.15 for visible volume)');
