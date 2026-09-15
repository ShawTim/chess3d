/**
 * Replace knightParts() and knightGeo() in src/render/pieces.js.
 *
 * Two bugs in the first swept version:
 *   1. the head and mane cones were indexed while the pedestal and ears were not,
 *      so mergeGeometries refused the mixture and produced null;
 *   2. the mane spikes were built in head-local space but never scaled or seated
 *      with the head, so they sat at the wrong size and position.
 *
 * Both are fixed by assembling the head, ears and mane in head-local space and
 * applying the scale/seat transform to all of them together, then normalising
 * every part to non-indexed so the merge is uniform.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

const startMarker = 'export function knightParts() {';
const endMarker = 'function knightGeo() {';
const start = s.indexOf(startMarker);
const end = s.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  throw new Error(`markers not found: start=${start} end=${end}`);
}

const replacement = `export function knightParts() {
  const baseTop = 0.50;
  const base = lathe([
    ...pedestal(0.76),
    [0.190, 0.230], [0.178, 0.300], [0.170, 0.362], [0.169, 0.420],
    [0.177, 0.452], [0.187, 0.472], [0.170, 0.490], [0.120, 0.500],
    [0.070, 0.506],
  ].map(([r, y]) => [r, y * (baseTop / 0.506)])).toNonIndexed();

  const head = knightHeadGeo().toNonIndexed();

  // Ears and mane live in the same head-local space, so they are assembled here
  // and transformed with the head. Attaching them afterwards (as an earlier
  // version did) left them stranded at the wrong scale once the head was scaled
  // to fit the pedestal.
  const earHeight = 0.088;
  const ear = new THREE.ConeGeometry(0.030, earHeight, 12)
    .rotateX(-0.30)
    .translate(-0.034, 0.795, 0.055)
    .toNonIndexed();
  const ear2 = mirrorX(ear);

  const maneGeos = [];
  for (const t of KNIGHT_MANE) {
    maneGeos.push(maneSpike(t, 1).toNonIndexed());
  }

  const cranium = [head, ear, ear2, ...maneGeos];

  // Seat the cranium on the pedestal and scale it so the finished piece reaches
  // the declared height. The bounds are taken across all of it, so the ears
  // (which are the highest feature) set the top.
  const seat = baseTop - 0.09;
  const bounds = new THREE.Box3();
  for (const g of cranium) bounds.union(geomBox(g));
  const rawHeight = Math.max(1e-6, bounds.max.y - bounds.min.y);
  const k = (PIECE_HEIGHT[KNIGHT] - seat) / rawHeight;

  for (const g of cranium) {
    g.scale(k, k, k);
    g.translate(0, seat - bounds.min.y * k, 0);
  }

  return { base, head: cranium[0], ear: cranium[1], ear2: cranium[2], mane: maneGeos, baseTop };
}

`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(target, s);
console.log('knightParts replaced; lines =', s.split('\n').length);
