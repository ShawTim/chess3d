/**
 * Objective mesh audit for the knight.
 *
 * The bounding-box tests in tests/geometry.test.mjs cannot see two classes of
 * defect that visual review reported:
 *
 *   - INVERTED WINDING: if a surface's triangles wind the wrong way its faces
 *     point inward, get back-face culled, and the viewer sees straight through
 *     the piece to the board behind it. Bounding boxes are unaffected.
 *   - OPEN SURFACES: a shell with a missing cap looks hollow from some angles.
 *
 * Both are measured here from the actual triangles, so the question "is the
 * knight a solid closed volume?" gets a numeric answer instead of an opinion.
 *
 * Method
 *   signed volume  Sum of tetrahedron volumes. Positive for a closed surface with
 *                  outward-facing triangles; negative if the winding is inverted.
 *   boundary edges Edges referenced by exactly one triangle. Any non-zero count
 *                  means the surface has a hole (or a seam where vertices are
 *                  duplicated rather than shared, which is reported separately).
 *   non-manifold   Edges shared by more than two triangles.
 */
import * as THREE from 'three';
import { knightParts, getPieceGeometry } from '../src/render/pieces.js';
import { KNIGHT, PAWN, BISHOP, ROOK, QUEEN, KING } from '../src/engine/chess.js';

/**
 * Signed volume of a triangle soup. Positive means outward winding.
 *
 * Computed on the non-indexed triangle list so it works regardless of how the
 * geometry is stored.
 */
function signedVolume(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const gi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, gi(t, 0));
    b.fromBufferAttribute(pos, gi(t, 1));
    c.fromBufferAttribute(pos, gi(t, 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  return vol;
}

/**
 * Edge topology counts, using quantised vertex positions so that duplicated
 * vertices at a shared location still count as the same edge.
 */
function edgeAudit(geo) {
  const pos = geo.attributes.position;
  const key = (i) => {
    const q = 1e5;
    return `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
  };
  const edges = new Map();
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const vi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < triCount; t++) {
    const k = [key(vi(t, 0)), key(vi(t, 1)), key(vi(t, 2))];
    for (let e = 0; e < 3; e++) {
      const u = k[e];
      const v = k[(e + 1) % 3];
      const id = u < v ? `${u}|${v}` : `${v}|${u}`;
      edges.set(id, (edges.get(id) ?? 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const n of edges.values()) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
  }
  return { edges: edges.size, boundary, nonManifold };
}

function box(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  return `x[${b.min.x.toFixed(3)},${b.max.x.toFixed(3)}] y[${b.min.y.toFixed(3)},${b.max.y.toFixed(3)}] z[${b.min.z.toFixed(3)},${b.max.z.toFixed(3)}]`;
}

console.log('=== Knight sub-parts ===');
const parts = knightParts();
const named = {
  base: parts.base,
  head: parts.head,
  ear: parts.ear,
  ear2: parts.ear2,
};
parts.mane.forEach((g, i) => { named[`mane[${i}]`] = g; });

for (const [name, geo] of Object.entries(named)) {
  const v = signedVolume(geo);
  const e = edgeAudit(geo);
  console.log(
    `${name.padEnd(9)} vol=${v.toFixed(5).padStart(9)} ` +
    `${v > 0 ? 'OUTWARD' : '*** INWARD (will be culled) ***'}  ` +
    `boundaryEdges=${String(e.boundary).padStart(4)} nonManifold=${e.nonManifold}`,
  );
}

console.log('\n=== Merged piece (what actually renders) ===');
for (const [type, name] of [[KNIGHT, 'knight'], [PAWN, 'pawn'], [ROOK, 'rook'], [BISHOP, 'bishop'], [QUEEN, 'queen'], [KING, 'king']]) {
  const { shell } = getPieceGeometry(type);
  const v = signedVolume(shell);
  const e = edgeAudit(shell);
  console.log(
    `${name.padEnd(7)} vol=${v.toFixed(5).padStart(9)} ` +
    `${v > 0 ? 'OUTWARD ok' : '*** INWARD (culled!) ***'}  ` +
    `boundary=${String(e.boundary).padStart(5)} nonManifold=${e.nonManifold}  ${box(shell)}`,
  );
}
