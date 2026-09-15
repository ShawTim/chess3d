/**
 * Probe the built knight mesh and report its forward profile.
 *
 * Prints the forward-most z at each height band of the head, so the real
 * undercut (where the jaw sits back from the muzzle) can be located by
 * measurement rather than guessed at. Also reports the balance of the head over
 * the pedestal, whose cylindrical body has a radius of about 0.185.
 */
import { knightParts, KNIGHT_PROFILE, PIECE_HEIGHT } from '../src/render/pieces.js';

const p = knightParts();
const pos = p.head.attributes.position;

let minY = Infinity, maxY = -Infinity;
for (let i = 0; i < pos.count; i++) {
  const y = pos.getY(i);
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
const height = maxY - minY;

const forwardAt = (lo, hi) => {
  let best = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const f = (pos.getY(i) - minY) / height;
    if (f < lo || f > hi) continue;
    if (pos.getZ(i) > best) best = pos.getZ(i);
  }
  return best;
};
const backAt = (lo, hi) => {
  let best = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const f = (pos.getY(i) - minY) / height;
    if (f < lo || f > hi) continue;
    if (pos.getZ(i) < best) best = pos.getZ(i);
  }
  return best;
};

console.log('head y range:', minY.toFixed(3), '..', maxY.toFixed(3));
console.log('\n  band      fwd z     back z    width');
for (let lo = 0.0; lo < 1.0; lo += 0.1) {
  const hi = Math.min(1.0, lo + 0.1);
  const f = forwardAt(lo, hi);
  const b = backAt(lo, hi);
  console.log(
    `  ${lo.toFixed(1)}-${hi.toFixed(1)}   ${f.toFixed(3).padStart(7)}   ${b.toFixed(3).padStart(7)}   ${(f - b).toFixed(3)}`,
  );
}

const muzzle = forwardAt(0.52, 0.70);
const crown = forwardAt(0.84, 0.97);
const chin = forwardAt(0.34, 0.48);
console.log('\nmuzzle', muzzle.toFixed(3), ' crown', crown.toFixed(3), ' chin', chin.toFixed(3));
console.log('undercut (muzzle - chin):', (muzzle - chin).toFixed(3), ' (want >= 0.08)');
console.log('muzzle - crown          :', (muzzle - crown).toFixed(3), ' (want >= 0.05)');

// Balance over the pedestal.
let minZ = Infinity, maxZ = -Infinity;
for (let i = 0; i < pos.count; i++) {
  const z = pos.getZ(i);
  if (z < minZ) minZ = z;
  if (z > maxZ) maxZ = z;
}
const BASE_RADIUS = 0.185;
console.log('\nhead z range:', minZ.toFixed(3), '..', maxZ.toFixed(3));
console.log('nose overhang past pedestal body:', (maxZ - BASE_RADIUS).toFixed(3), '(want <= ~0.03)');
console.log('knights declared height:', PIECE_HEIGHT[2]);
console.log('profile points:', KNIGHT_PROFILE.length);
