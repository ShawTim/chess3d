/**
 * Rewrite the knight section of src/render/pieces.js with the final swept
 * geometry.
 *
 * Fixes over the first swept attempt:
 *   - the spine was far too long, so the muzzle overhung the pedestal by 0.27
 *     (more than the pedestal's own radius). The spine is now compact and the
 *     finished head is re-centred on the base by measurement.
 *   - ears were positioned at a hard-coded offset that no longer matched the
 *     spine; they are now anchored to the poll station.
 *   - the mane was built from cones that squashed into fin-like slabs. It is now
 *     a crest of small ellipsoids riding the back of the neck, which reads as
 *     carved hair rather than a heat sink.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

const startMarker = '/* ---------------------------------------------------------------- knight -- */';
const endMarker = '/* ---------------------------------------------------------------- bishop -- */';
const start = s.indexOf(startMarker);
const end = s.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  throw new Error(`markers not found: start=${start} end=${end}`);
}

const section = String.raw`/* ---------------------------------------------------------------- knight -- */

/**
 * The knight's head, neck and mane, built as a swept solid.
 *
 * A knight cannot be a surface of revolution, but it should still look as though
 * it was carved from the same block as the rest of the set. A flat extruded
 * silhouette does not: its constant thickness and straight flanks read as a
 * laser-cut plate, and visual reviews of that build called it a "2.5D cut-out"
 * sitting awkwardly beside the smoothly turned pawns and bishops.
 *
 * So the head is a SWEEP. A curved spine runs up the neck, over the poll and down
 * the face to the muzzle, and an elliptical cross-section is carried along it,
 * reoriented to stay perpendicular to the spine. Varying the two radii at each
 * station gives the volume a real horse has: a full cheek, a neck that narrows
 * below it, and a muzzle that tapers to a rounded end.
 *
 * Stations are [forward z, height y, half-width across the piece, half-thickness
 * in the plane of the profile]. The half-thickness controls the side silhouette;
 * the half-width controls how rounded the head is rather than flat.
 *
 * The muzzle is kept deliberately compact. An earlier, longer spine put the nose
 * 0.27 ahead of the pedestal — further than the pedestal's own radius — and the
 * piece looked like it was pitching forward; visual review flagged it.
 */
const KNIGHT_SPINE = [
  // Neck: rises close to vertically from the pedestal.
  [0.000, 0.000, 0.096, 0.110],
  [0.008, 0.130, 0.094, 0.108],
  [0.018, 0.258, 0.092, 0.106],
  [0.032, 0.386, 0.094, 0.110],
  [0.054, 0.506, 0.100, 0.120],
  // Head: swells into the cheek, curving forward.
  [0.094, 0.622, 0.112, 0.140],
  [0.146, 0.716, 0.118, 0.148],
  [0.208, 0.780, 0.114, 0.142],
  // Poll (top-back of the skull), where the ears sit.
  [0.268, 0.800, 0.106, 0.128],
  // Face: turns forward and down toward the nose.
  [0.326, 0.780, 0.096, 0.112],
  [0.378, 0.734, 0.086, 0.098],
  [0.420, 0.672, 0.076, 0.084],
  // Muzzle: tapers to a rounded end, the forward-most point.
  [0.450, 0.604, 0.062, 0.070],
  [0.470, 0.546, 0.046, 0.054],
];

/** Station index of the poll, used to seat the ears. */
const KNIGHT_POLL_INDEX = 8;

/** Rings around the spine; 28 keeps the surface smooth at close range. */
const KNIGHT_RING_SEGMENTS = 28;

/**
 * Where the mane crest sits along the spine, as fractions from neck base to poll.
 * Concentrated on the neck, as on a real horse.
 */
const KNIGHT_MANE = [0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64];

/** How far the mane beads sink into the neck, so they read as carved in. */
const KNIGHT_MANE_SINK = 0.014;

/**
 * Where the head should sit relative to the pedestal's axis, in profile units
 * before scaling.
 *
 * The measurement matters. The neck must be over the pedestal (or the piece looks
 * unbalanced) while the nose should only just clear it (or it looks like it is
 * falling forward). Centring on the neck, or on the bounding box, each failed one
 * of those; this offset was solved numerically with tools/knight_probe.mjs.
 */
const KNIGHT_Z_CENTRE = 0.150;

/** Interpolate the spine at fractional index t (0..1). */
function spineAt(t) {
  const n = KNIGHT_SPINE.length - 1;
  const x = Math.min(0.9999, Math.max(0, t)) * n;
  const i = Math.floor(x);
  const f = x - i;
  const a = KNIGHT_SPINE[i];
  const b = KNIGHT_SPINE[Math.min(n, i + 1)];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
    a[3] + (b[3] - a[3]) * f,
  ];
}

/** Unit tangent of the spine at station i, in the y-z plane. */
function spineTangent(i) {
  const prev = KNIGHT_SPINE[Math.max(0, i - 1)];
  const next = KNIGHT_SPINE[Math.min(KNIGHT_SPINE.length - 1, i + 1)];
  const tz = next[0] - prev[0];
  const ty = next[1] - prev[1];
  const len = Math.hypot(tz, ty) || 1;
  return [tz / len, ty / len];
}

/**
 * The swept head-and-neck solid in its own space: the neck base sits at y = 0 and
 * the profile is centred on KNIGHT_Z_CENTRE.
 *
 * Because the spine is planar, the frame is simple: the piece's width is always
 * along x, and the in-plane normal is the tangent rotated a quarter turn.
 */
export function knightHeadGeo() {
  const positions = [];
  const uvs = [];
  const indices = [];
  const stations = KNIGHT_SPINE.length;

  const tangents = [];
  for (let i = 0; i < stations; i++) tangents.push(spineTangent(i));

  const ringPoint = (i, a) => {
    const [z, y, hw, ht] = KNIGHT_SPINE[i];
    const [tz, ty] = tangents[i];
    const nz = -ty;
    const ny = tz;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      c * hw,
      y + s * ht * ny,
      (z - KNIGHT_Z_CENTRE) + s * ht * nz,
    ];
  };

  for (let i = 0; i < stations; i++) {
    const v = i / (stations - 1);
    for (let k = 0; k < KNIGHT_RING_SEGMENTS; k++) {
      const a = (k / KNIGHT_RING_SEGMENTS) * TWO_PI;
      const [x, y, z] = ringPoint(i, a);
      positions.push(x, y, z);
      uvs.push(k / KNIGHT_RING_SEGMENTS, v);
    }
  }

  for (let i = 0; i < stations - 1; i++) {
    const base = i * KNIGHT_RING_SEGMENTS;
    const next = (i + 1) * KNIGHT_RING_SEGMENTS;
    for (let k = 0; k < KNIGHT_RING_SEGMENTS; k++) {
      const k2 = (k + 1) % KNIGHT_RING_SEGMENTS;
      indices.push(base + k, next + k, next + k2);
      indices.push(base + k, next + k2, base + k2);
    }
  }

  // Close the muzzle with a fan.
  const last = stations - 1;
  const capCentre = positions.length / 3;
  positions.push(0, KNIGHT_SPINE[last][1], KNIGHT_SPINE[last][0] - KNIGHT_Z_CENTRE);
  uvs.push(0.5, 1);
  const lastBase = last * KNIGHT_RING_SEGMENTS;
  for (let k = 0; k < KNIGHT_RING_SEGMENTS; k++) {
    const k2 = (k + 1) % KNIGHT_RING_SEGMENTS;
    indices.push(lastBase + k, k2 + lastBase, capCentre);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** A bounding box for a geometry, computed in place. */
function geomBox(geo) {
  geo.computeBoundingBox();
  return geo.boundingBox;
}

/** Mirror a geometry across X, reversing winding so its faces stay outward. */
function mirrorX(geo) {
  const g = geo.toNonIndexed();
  g.scale(-1, 1, 1);
  for (const key of ['position', 'uv', 'normal']) {
    const attr = g.attributes[key];
    if (!attr) continue;
    const n = attr.itemSize;
    const arr = attr.array;
    for (let i = 0; i < attr.count; i += 3) {
      for (let c = 0; c < n; c++) {
        const a = (i + 1) * n + c;
        const b = (i + 2) * n + c;
        const t = arr[a];
        arr[a] = arr[b];
        arr[b] = t;
      }
    }
    attr.needsUpdate = true;
  }
  return g;
}

/**
 * One bead of the mane crest.
 *
 * A small ellipsoid sitting on the back of the neck, sunk into the surface so it
 * reads as carved. An earlier mane used cones, which squashed into flat slabs and
 * were read as mechanical cooling fins by visual review.
 */
function maneBead(t) {
  const [z, y, , ht] = spineAt(t);
  const a = spineAt(Math.min(1, t + 0.02));
  const b = spineAt(Math.max(0, t - 0.02));
  let tz = a[0] - b[0];
  let ty = a[1] - b[1];
  const len = Math.hypot(tz, ty) || 1;
  tz /= len;
  ty /= len;
  const nz = -ty;
  const ny = tz;

  const r = 0.034;
  const bead = new THREE.SphereGeometry(r, 12, 10);
  // Flatten across the piece so the crest is a ridge, not a row of balls.
  bead.scale(0.62, 1.0, 1.0);
  bead.translate(
    0,
    y + ny * (ht - KNIGHT_MANE_SINK),
    (z - KNIGHT_Z_CENTRE) + nz * (ht - KNIGHT_MANE_SINK),
  );
  return bead;
}

/**
 * The knight's parts in final board coordinates, seated on the pedestal.
 *
 * Exported so the assembly can be verified rather than trusted: see
 * `tests/geometry.test.mjs`, which asserts that the head overlaps the base, that
 * the ears meet the skull, that the muzzle projects past the crown with an
 * undercut, that the neck is markedly narrower than the head, that the nose does
 * not overhang the pedestal, and that the head carries real 3D volume.
 */
export function knightParts() {
  const baseTop = 0.50;
  const base = lathe([
    ...pedestal(0.76),
    [0.190, 0.230], [0.178, 0.300], [0.170, 0.362], [0.169, 0.420],
    [0.177, 0.452], [0.187, 0.472], [0.170, 0.490], [0.120, 0.500],
    [0.070, 0.506],
  ].map(([r, y]) => [r, y * (baseTop / 0.506)])).toNonIndexed();

  const head = knightHeadGeo().toNonIndexed();

  // Ears: seated on the poll, swept back, and sunk into the skull so they are
  // rooted in it. Anchored to the spine's poll station rather than a hard-coded
  // offset, so they follow the shape if the spine is retuned.
  const poll = KNIGHT_SPINE[KNIGHT_POLL_INDEX];
  const pollZ = poll[0] - KNIGHT_Z_CENTRE;
  const pollY = poll[1];
  const earHeight = 0.090;
  const ear = new THREE.ConeGeometry(0.030, earHeight, 12)
    .rotateX(-0.30)
    .translate(-0.032, pollY + earHeight * 0.30, pollZ - 0.030)
    .toNonIndexed();
  const ear2 = mirrorX(ear);

  // Mane: a crest of beads down the back of the neck.
  const maneGeos = KNIGHT_MANE.map((t) => maneBead(t).toNonIndexed());

  const cranium = [head, ear, ear2, ...maneGeos];

  // Seat the cranium on the pedestal and scale it so the finished piece reaches
  // its declared height. Bounds are taken across the whole cranium, so the ears
  // (the highest feature) set the top.
  const seat = baseTop - 0.09;
  const bounds = new THREE.Box3();
  for (const g of cranium) bounds.union(geomBox(g));
  const rawHeight = Math.max(1e-6, bounds.max.y - bounds.min.y);
  const k = (PIECE_HEIGHT[KNIGHT] - seat) / rawHeight;

  for (const g of cranium) {
    g.scale(k, k, k);
    g.translate(0, seat - bounds.min.y * k, 0);
  }

  return {
    base,
    head: cranium[0],
    ear: cranium[1],
    ear2: cranium[2],
    mane: maneGeos,
    baseTop,
  };
}

function knightGeo() {
  const p = knightParts();
  const parts = [p.base, p.head, p.ear, p.ear2, ...p.mane];
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return { shell: merged, inlays: [] };
}

`;

s = s.slice(0, start) + section + s.slice(end);
fs.writeFileSync(target, s);

const expected = [
  'pawnGeo', 'rookGeo', 'knightGeo', 'bishopGeo', 'queenGeo', 'kingGeo',
  'knightHeadGeo', 'knightParts', 'getPieceGeometry', 'disposePieceGeometry',
  'lathe', 'pedestal', 'mirrorX', 'maneBead', 'spineAt',
];
const missing = expected.filter((f) => !new RegExp(`(function|const)\\s+${f}`).test(s));
console.log('lines:', s.split('\n').length);
console.log('missing:', missing.length ? missing.join(', ') : 'none');
