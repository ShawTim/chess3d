/**
 * Fix the knight's flat shading.
 *
 * Root cause: the knight was assembled from NON-INDEXED parts, and
 * computeVertexNormals() on a non-indexed geometry can only produce per-face
 * normals — every vertex belongs to exactly one triangle, so there is nothing to
 * average. That overwrote the smooth normals the lathes were built with and made
 * the knight the only faceted piece on the board.
 *
 * Measured by tools/shading_audit.mjs:
 *   pawn 15.4 deg   bishop 14.5 deg   rook 10.7 deg   queen 14.0 deg   king 12.6 deg
 *   knight 0.004 deg  <-- flat
 *
 * Fix: merge the parts with their indices intact so shared vertices are welded,
 * compute the normals once on the indexed result (which averages across the
 * surface), and only then convert to non-indexed for the renderer. The normals
 * survive that final conversion, because it copies them onto every split vertex.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

// 1. Stop forcing every part through toNonIndexed() in knightGeo/knightParts, and
//    instead normalise everything to INDEXED so the merge can weld vertices.
const oldGeo = `function knightGeo() {
  const p = knightParts();
  const parts = [p.base, p.head, p.ear, p.ear2, ...p.mane];
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return { shell: merged, inlays: [] };
}`;

const newGeo = `function knightGeo() {
  const p = knightParts();
  const parts = [p.base, p.head, p.ear, p.ear2, ...p.mane];

  // Merge with indices intact, then compute normals on the indexed result.
  //
  // This is the difference between smooth and flat shading. On an indexed
  // geometry, computeVertexNormals() averages the normals of every triangle that
  // shares a vertex; on a non-indexed one each vertex belongs to a single
  // triangle, so it can only produce per-face normals. The knight's parts were
  // non-indexed (so the lathes could be combined with the primitives), which made
  // it the only faceted piece on the board — measured at 0.004 degrees of normal
  // deviation against 10-15 degrees for every other piece.
  const merged = mergeGeometries(parts.map(toIndexed), false);
  merged.computeVertexNormals();

  // Back to non-indexed for the renderer: the smooth normals computed above are
  // copied onto each split vertex, so the shading is preserved.
  return { shell: merged.toNonIndexed(), inlays: [] };
}

/**
 * Return an indexed copy of a geometry.
 *
 * mergeGeometries requires every input to agree on whether it is indexed, and
 * these parts arrive in both forms: LatheGeometry and the extrude/sweep output
 * are indexed, while primitives that were converted with toNonIndexed() and the
 * spheres used for the mane are not.
 */
function toIndexed(geo) {
  if (geo.index) return geo;
  const count = geo.attributes.position.count;
  const index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = i;
  const g = geo.clone();
  g.setIndex(new THREE.BufferAttribute(index, 1));
  return g;
}`;

if (!s.includes(oldGeo)) throw new Error('knightGeo anchor not found');
s = s.replace(oldGeo, newGeo);

// 2. The parts must stop calling toNonIndexed() so their indices survive.
s = s.replace(
  `  const head = knightHeadGeo().toNonIndexed();`,
  `  const head = knightHeadGeo();`
);
s = s.replace(
  `  ].map(([r, y]) => [r, y * (baseTop / 0.506)])).toNonIndexed();`,
  `  ].map(([r, y]) => [r, y * (baseTop / 0.506)]));`
);
s = s.replace(
  `  const ear = new THREE.ConeGeometry(0.030, earHeight, 12)
    .rotateX(-0.30)
    .translate(-0.032, pollY + earHeight * 0.30, pollZ - 0.030)
    .toNonIndexed();`,
  `  const ear = new THREE.ConeGeometry(0.030, earHeight, 12)
    .rotateX(-0.30)
    .translate(-0.032, pollY + earHeight * 0.30, pollZ - 0.030);`
);
s = s.replace(
  `  const maneGeos = KNIGHT_MANE.map((t) => maneBead(t).toNonIndexed());`,
  `  const maneGeos = KNIGHT_MANE.map((t) => maneBead(t));`
);

// mirrorX already clones for indexed input; keep that behaviour but stop
// forcing non-indexed conversion there too.
s = s.replace(
  `function mirrorX(geo) {\n  const g = geo.index ? geo.toNonIndexed() : geo.clone();`,
  `function mirrorX(geo) {\n  const g = geo.clone();`
);

fs.writeFileSync(target, s);
console.log('knight shading fix applied; lines =', s.split('\n').length);
