/**
 * Measure whether each piece is shaded smoothly or flat.
 *
 * `computeVertexNormals()` behaves differently depending on how a geometry is
 * stored: on an INDEXED geometry it averages the face normals of every triangle
 * sharing a vertex, giving smooth shading; on a NON-INDEXED geometry every vertex
 * belongs to exactly one triangle, so it can only produce per-face normals — flat
 * shading, and it silently overwrites whatever normals the geometry already had.
 *
 * The knight's parts are converted to non-indexed before merging (so the mixture
 * of lathes and primitives can be combined), and knightGeo then calls
 * computeVertexNormals on the result. That discards the smooth normals the lathes
 * were built with, which is why the knight's pedestal shows facets while every
 * other piece's is smooth.
 *
 * The measure used here is the mean angle between a vertex's normal and the face
 * normal of its own triangle. Flat shading forces it to ~0; smooth shading gives
 * a distinctly larger value where the surface curves.
 */
import * as THREE from 'three';
import { getPieceGeometry } from '../src/render/pieces.js';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../src/engine/chess.js';

function meanNormalDeviation(geo) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  if (!nrm) return null;

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const fn = new THREE.Vector3(), vn = new THREE.Vector3();
  let sum = 0, n = 0;

  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const gi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < triCount; t++) {
    const i0 = gi(t, 0), i1 = gi(t, 1), i2 = gi(t, 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    fn.copy(b).sub(a).cross(new THREE.Vector3().copy(c).sub(a));
    if (fn.lengthSq() < 1e-20) continue;  // degenerate: skip, it has no normal
    fn.normalize();
    for (const ii of [i0, i1, i2]) {
      vn.fromBufferAttribute(nrm, ii);
      const dot = Math.min(1, Math.max(-1, vn.dot(fn)));
      sum += Math.acos(dot);
      n++;
    }
  }
  return n ? (sum / n) * 180 / Math.PI : null;
}

console.log('mean angle between vertex normal and face normal (degrees)');
console.log('  0 deg  = flat shading (every vertex normal equals its face normal)');
console.log('  >1 deg = smooth shading\n');

for (const [type, name] of [
  [PAWN, 'pawn'], [KNIGHT, 'knight'], [BISHOP, 'bishop'],
  [ROOK, 'rook'], [QUEEN, 'queen'], [KING, 'king'],
]) {
  const { shell } = getPieceGeometry(type);
  const dev = meanNormalDeviation(shell);
  const indexed = !!shell.index;
  const verdict = dev === null ? 'no normals'
    : dev < 0.05 ? '*** FLAT (faceted) ***'
      : 'smooth';
  console.log(
    `${name.padEnd(7)} ${dev === null ? '   n/a' : dev.toFixed(3).padStart(6)} deg   ` +
    `indexed=${indexed ? 'yes' : 'no '}   ${verdict}`,
  );
}
