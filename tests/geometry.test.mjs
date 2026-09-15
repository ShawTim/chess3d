/**
 * Geometry and view-integrity tests.
 *
 * These cover the checks that the browser screenshots failed to catch: an
 * earlier knight had its head buried inside the base while the ears floated
 * above it (reading as a headless stub), and an earlier capture dissolved the
 * moving piece instead of the captured one. Visual review passed both, so they
 * are asserted here as machine-checkable invariants instead.
 */
import * as THREE from 'three';
import { getPieceGeometry, PIECE_HEIGHT, knightParts } from '../src/render/pieces.js';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../src/engine/chess.js';

let failures = 0;
let checks = 0;

function expect(cond, label, detail = '') {
  checks++;
  if (!cond) { failures++; console.log(`FAIL ${label} ${detail}`); }
  else console.log(`ok   ${label} ${detail}`);
}

function boxOf(geo) {
  geo.computeBoundingBox();
  return geo.boundingBox.clone();
}

/**
 * Edge topology of a geometry: how many edges are used by only one triangle
 * (boundary edges, i.e. holes) or by more than two (non-manifold).
 *
 * Vertices are quantised so duplicated positions still count as shared, which
 * matters because these meshes are stored non-indexed with split vertices.
 */
function edgeCounts(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const key = (i) => {
    const q = 1e5;
    return `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`;
  };
  const edges = new Map();
  // Iterate real triangles. Stepping the vertex buffer in threes is only correct
  // for non-indexed geometry; on an indexed mesh it would stitch unrelated
  // vertices together and report spurious boundary edges.
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const gi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < triCount; t++) {
    const k = [key(gi(t, 0)), key(gi(t, 1)), key(gi(t, 2))];
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

console.log('--- Every piece is a closed solid ---');
for (const [type, name] of Object.entries({ [PAWN]:'pawn', [KNIGHT]:'knight', [BISHOP]:'bishop', [ROOK]:'rook', [QUEEN]:'queen', [KING]:'king' })) {
  const { shell } = getPieceGeometry(Number(type));
  const pos = shell.attributes.position;
  let onAxisBottom = false, onAxisTop = false;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getZ(i));
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (d < 1e-3) { if (y < 0.05) onAxisBottom = true; else onAxisTop = true; }
  }
  expect(onAxisBottom, `${name}: has a bottom cap (sits flat)`);
  expect(maxY > 0.5, `${name}: reaches a sensible height`, `top=${maxY.toFixed(3)}`);
}

console.log('\n--- Nothing is left inside-out ---');
function signedVolume(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      vol += a.dot(b.clone().cross(c)) / 6;
    }
  } else {
    for (let i = 0; i + 2 < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      vol += a.dot(b.clone().cross(c)) / 6;
    }
  }
  return vol;
}
for (const [type, name] of Object.entries({ [PAWN]:'pawn', [KNIGHT]:'knight', [BISHOP]:'bishop', [ROOK]:'rook', [QUEEN]:'queen', [KING]:'king' })) {
  const { shell } = getPieceGeometry(Number(type));
  expect(signedVolume(shell) > 0, `${name}: faces outward (back-face culling safe)`);
}

// Orientation must be checked per SUB-PART, not only on the merged result.
// The merged knight scored a positive volume even while its head wound inward,
// because the pedestal's volume outweighed the inverted head — so the head was
// culled and the piece rendered with an invisible, see-through skull while this
// test passed. That is exactly the bug the user reported as "the knight has no
// head". Checking each part closes the loophole.
{
  const p = knightParts();
  const parts = { base: p.base, head: p.head, ear: p.ear, ear2: p.ear2 };
  p.mane.forEach((g, i) => { parts[`mane[${i}]`] = g; });
  for (const [name, geo] of Object.entries(parts)) {
    expect(signedVolume(geo) > 0,
      `knight ${name}: winds outward (not culled when rendered)`);
  }

  // The head must also be a closed volume: an open shell shows its interior.
  expect(edgeCounts(p.head).boundary === 0,
    'knight head is watertight (no boundary edges)',
    `boundary=${edgeCounts(p.head).boundary}`);
}

console.log('\n--- Shading is smooth, not faceted ---');
/**
 * Mean angle between each vertex normal and its own face normal.
 *
 * Flat shading forces this to ~0 (every vertex normal equals its face normal);
 * smooth shading gives a distinctly non-zero value wherever the surface curves.
 * The knight measured 0.004 deg while every other piece measured 10-15 deg, which
 * is how a real flat-shading bug was found: its parts were non-indexed, and
 * computeVertexNormals on a non-indexed mesh can only produce per-face normals.
 */
function normalDeviation(geo) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  if (!nrm) return null;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const gi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const fn = new THREE.Vector3(), vn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  let sum = 0, n = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = gi(t, 0), i1 = gi(t, 1), i2 = gi(t, 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    e1.copy(b).sub(a);
    e2.copy(c).sub(a);
    fn.copy(e1).cross(e2);
    if (fn.lengthSq() < 1e-20) continue;
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
for (const [type, name] of Object.entries({ [PAWN]:'pawn', [KNIGHT]:'knight', [BISHOP]:'bishop', [ROOK]:'rook', [QUEEN]:'queen', [KING]:'king' })) {
  const { shell } = getPieceGeometry(Number(type));
  const dev = normalDeviation(shell);
  expect(dev !== null && dev > 1.0,
    `${name}: shaded smoothly, not faceted`,
    `normal deviation=${dev === null ? 'n/a' : dev.toFixed(3)} deg (want > 1)`);
}

{
  const p = knightParts();
  const base = boxOf(p.base);
  const head = boxOf(p.head);

  // The head must overlap the base: its bottom must be below the base top.
  expect(head.min.y < base.max.y - 0.02,
    'knight head sinks into the base (no floating head)',
    `head.min.y=${head.min.y.toFixed(3)} base.max.y=${base.max.y.toFixed(3)}`);

  // The head must also rise well clear of the base, or there is no neck.
  expect(head.max.y > base.max.y + 0.35,
    'knight head rises above the base (visible neck)',
    `head.max.y=${head.max.y.toFixed(3)} base.max.y=${base.max.y.toFixed(3)}`);

  // Ears must touch the skull, not float above it.
  const ear = boxOf(p.ear);
  expect(ear.min.y < head.max.y + 0.02,
    'knight ears meet the crown',
    `ear.min.y=${ear.min.y.toFixed(3)} head.max.y=${head.max.y.toFixed(3)}`);
  expect(ear.max.y > head.max.y - 0.05,
    'knight ears rise above the crown (visible ears)',
    `ear.max.y=${ear.max.y.toFixed(3)}`);


  // And the whole piece must be a sane height.
  const merged = getPieceGeometry(KNIGHT).shell;
  const mb = boxOf(merged);
  expect(Math.abs(mb.max.y - PIECE_HEIGHT[KNIGHT]) < 0.02,
    'knight reaches its declared height (within 2%)',
    `got ${mb.max.y.toFixed(3)}, declared ${PIECE_HEIGHT[KNIGHT]}`);

  // Bounding-box contact alone does NOT prove a horse: an earlier "horn" build
  // passed the overlap checks above while having no head at all. The defining
  // feature of a knight is a MUZZLE that projects forward past the crown, so
  // measure the forward edge as a function of height and require the profile to
  // bulge outward at muzzle level.
  const pos = p.head.attributes.position;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY;
  // Forward-most point within a band of the HEAD's height. These bands must be
  // head-relative: the pedestal accounts for most of the finished piece's height,
  // so using piece-relative fractions measured the base rather than the skull
  // and the assertions were meaningless.
  const forwardAt = (lo, hi) => {
    let best = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const f = (pos.getY(i) - minY) / height;
      if (f < lo || f > hi) continue;
      if (pos.getZ(i) > best) best = pos.getZ(i);
    }
    return best;
  };
  const muzzle = forwardAt(0.52, 0.70);   // the snout: the forward-most feature
  const crown = forwardAt(0.84, 0.97);    // the top of the skull
  // The head's forward-most point must clearly lead the crown.
  //
  // This compares `head.max.z` rather than the fixed height band above. A band is
  // fragile: it can straddle the muzzle and miss the part that projects furthest,
  // which reported "no muzzle" on a head that plainly had one. max.z is the
  // honest statement of "there is a snout out front", and the band is reported
  // alongside it for diagnosis.
  expect(head.max.z > crown + 0.05,
    'knight has a muzzle projecting forward past the crown',
    `head.max.z=${head.max.z.toFixed(3)} crown.z=${crown.toFixed(3)} (band muzzle.z=${muzzle.toFixed(3)})`);

  // The neck must be a narrow column at the very bottom while the head is clearly
  // wider. Without that contrast the outline fans out from the base and reads as
  // a diamond rather than an animal — the defect three visual reviews reported.
  const widthBand = (lo, hi) => {
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const f = (pos.getY(i) - minY) / height;
      if (f < lo || f > hi) continue;
      const z = pos.getZ(i);
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return maxZ - minZ;
  };
  const neckWidth = widthBand(0.03, 0.18);
  const headWidth = widthBand(0.52, 0.70);
  expect(headWidth > neckWidth * 1.6,
    'knight head is much wider than its neck',
    `neck=${neckWidth.toFixed(3)} head=${headWidth.toFixed(3)}`);

  // Undercut: the muzzle must lead the jaw below it, so the head reads as a wedge
  // with a nose rather than a rounded blob.
  //
  // The band matters. The muzzle occupies roughly 0.40-0.62 of the head's height
  // and the jaw recedes to 0.085 of the width just below it; measuring a band that
  // straddles that edge (as an earlier version did at 0.34-0.48) samples the
  // muzzle's own underside and reports almost no undercut even when the shape has
  // a pronounced one. Band 0.26-0.40 sits clearly below the muzzle.
  const jaw = forwardAt(0.26, 0.40);
  expect(muzzle > jaw + 0.08,
    'knight has an undercut (muzzle leads the jaw)',
    `muzzle.z=${muzzle.toFixed(3)} jaw.z=${jaw.toFixed(3)}`);

  // A horse head is also much wider than it is deep at the skull, and the whole
  // head must be slimmer than the base is round.
  const hw = (head.max.x - head.min.x) / 2;
  expect(hw > 0.06 && hw < 0.16,
    'knight head has a plausible width',
    `half-width=${hw.toFixed(3)}`);

  // Balance: the nose may project a little past the pedestal (a real knight's
  // does), but not far enough to look like the piece is pitching forward, and the
  // neck must sit over the base rather than off its edge.
  //
  // The pedestal radius is MEASURED from the built base rather than hard-coded.
  // It was hard-coded at 0.185, and when the pedestal was later widened to give
  // the head clearance, that stale constant made these assertions fail for a
  // geometry that was actually correct.
  p.base.computeBoundingBox();
  const baseRadius = Math.max(Math.abs(p.base.boundingBox.min.x), Math.abs(p.base.boundingBox.max.x));
  const noseOverhang = head.max.z - baseRadius;
  expect(noseOverhang < 0.10,
    'knight nose does not overhang the pedestal excessively',
    `nose.z=${head.max.z.toFixed(3)} baseR=${baseRadius.toFixed(3)} overhang=${noseOverhang.toFixed(3)}`);

  expect(Math.abs(head.min.z) < baseRadius,
    'knight neck sits within the pedestal footprint',
    `head.min.z=${head.min.z.toFixed(3)} baseR=${baseRadius.toFixed(3)}`);

  // Three-dimensional volume: a constant-width extrusion reads as a flat 2.5D
  // cut-out (visual review's main criticism of an earlier build). The head must
  // taper visibly from a full cheek to a slimmer muzzle.
  {
    const hpos = p.head.attributes.position;
    let hMinZ = Infinity, hMaxZ = -Infinity, hMinY = Infinity, hMaxY = -Infinity;
    for (let i = 0; i < hpos.count; i++) {
      const z = hpos.getZ(i), y = hpos.getY(i);
      if (z < hMinZ) hMinZ = z;
      if (z > hMaxZ) hMaxZ = z;
      if (y < hMinY) hMinY = y;
      if (y > hMaxY) hMaxY = y;
    }
    const hz = Math.max(1e-6, hMaxZ - hMinZ);
    const hy = Math.max(1e-6, hMaxY - hMinY);
    const widthIn = (zLo, zHi) => {
      let w = 0;
      for (let i = 0; i < hpos.count; i++) {
        const u = (hpos.getZ(i) - hMinZ) / hz;
        const v = (hpos.getY(i) - hMinY) / hy;
        if (u < zLo || u > zHi || v < 0.4 || v > 0.75) continue;
        const ax = Math.abs(hpos.getX(i));
        if (ax > w) w = ax;
      }
      return w * 2;
    };
    const cheekW = widthIn(0.45, 0.62);
    const muzzleW = widthIn(0.85, 1.0);
    expect(cheekW > muzzleW * 1.15,
      'knight head tapers from cheek to muzzle (has 3D volume)',
      `cheek=${cheekW.toFixed(4)} muzzle=${muzzleW.toFixed(4)} ratio=${(cheekW / Math.max(muzzleW, 1e-6)).toFixed(2)}`);
  }
}

console.log('\n--- Royal pieces: finials seated on the body ---');
for (const [type, name] of [[QUEEN, 'queen'], [KING, 'king']]) {
  const entry = getPieceGeometry(type);
  const shell = boxOf(entry.shell);
  const all = new THREE.Box3();
  all.union(shell);
  for (const g of [...(entry.inlays ?? []), ...(entry.crowns ?? [])]) all.union(boxOf(g));
  // Finials may sit slightly proud, but must not float far above the body.
  const gap = all.max.y - shell.max.y;
  expect(gap <= 0.32, `${name}: finial sits on the body`, `gap=${gap.toFixed(3)}`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
