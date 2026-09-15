/**
 * Staunton chess piece geometry, generated entirely in code.
 *
 * The pawn, rook, bishop, queen and king are surfaces of revolution, so each is
 * a `LatheGeometry` driven by a hand-tuned profile: a sequence of [radius,
 * height] points tracing the silhouette from the base to the finial. Building
 * them this way (rather than from stacked primitives) is what gives the pieces
 * the continuous, sculpted curves a real Staunton set has.
 *
 * The knight is the exception. A horse's head is not a solid of revolution — the
 * muzzle projects forward of the skull — so it is a SWEPT solid: an elliptical
 * cross-section carried along a curved spine that runs up the neck, over the poll
 * and down the face, with the radii varied station by station to give it a cheek,
 * a tapering muzzle and a neck that narrows below the head. The ears are cones
 * seated on the poll and the mane is a crest of beads down the back of the neck.
 *
 * Two properties of the knight are asserted by tests/geometry.test.mjs because
 * they are easy to break and invisible to a bounding box:
 *   - every part winds OUTWARD. An earlier version wound the head inward, so
 *     back-face culling hid it: the piece rendered headless while every
 *     bounding-box assertion still passed.
 *   - the parts are merged INDEXED so normals average across shared vertices.
 *     Merging them non-indexed gave per-face normals, making the knight the only
 *     flat-shaded, faceted piece on the board.
 *
 * All dimensions are in world units where one board square is 1.0 wide, so a
 * piece profile ending at height 1.62 stands 1.62 squares tall.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../engine/chess.js';

/** Board-relative height of each piece, in square units. */
export const PIECE_HEIGHT = {
  [PAWN]: 0.86,
  [KNIGHT]: 1.06,
  [BISHOP]: 1.24,
  [ROOK]: 1.00,
  [QUEEN]: 1.42,
  [KING]: 1.62,
};

const TWO_PI = Math.PI * 2;
/** Segments around the axis of revolution; 64 keeps silhouettes clean. */
const RADIAL_SEGMENTS = 64;

/**
 * Build a lathe geometry from a [radius, height] profile with smooth normals.
 * Latitude/Longitude UVs come free with LatheGeometry, which we need so these
 * merge cleanly with the other primitives.
 */
function lathe(profile, segments = RADIAL_SEGMENTS) {
  const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  const geo = new THREE.LatheGeometry(points, segments);
  geo.computeVertexNormals();
  return geo;
}

/** Radius/height pairs describing the turned pedestal foot every piece shares. */
function pedestal(scale) {
  return [
    [0.00, 0.000], [0.215, 0.000], [0.258, 0.020], [0.285, 0.052],
    [0.290, 0.074], [0.258, 0.092], [0.222, 0.100],
  ].map(([r, y]) => [r * scale, y * scale]);
}

/* ------------------------------------------------------------------ pawn -- */

function pawnGeo() {
  const s = 0.62;
  const profile = [
    ...pedestal(s),
    // Concave stem sweeping up to the collar.
    [0.168, 0.238], [0.150, 0.300], [0.133, 0.370], [0.123, 0.430],
    [0.119, 0.482], [0.121, 0.520],
    // Collar disc.
    [0.154, 0.546], [0.152, 0.586], [0.119, 0.606],
    // Flattened spherical head.
    [0.151, 0.662], [0.169, 0.714], [0.166, 0.762], [0.141, 0.805],
    [0.089, 0.840], [0.031, 0.858], [0.000, 0.862],
  ].map(([r, y]) => [r, y * (PIECE_HEIGHT[PAWN] / 0.862)]);
  return { shell: lathe(profile), inlays: [] };
}

/* ------------------------------------------------------------------ rook -- */

function rookGeo() {
  const s = 0.74;
  const bodyTop = 0.700;
  const profile = [
    ...pedestal(s),
    [0.190, 0.240], [0.186, 0.330], [0.182, 0.420], [0.181, 0.500],
    [0.184, 0.560],
    // Flared crown.
    [0.216, 0.590], [0.252, 0.632], [0.259, 0.672], [0.257, bodyTop],
    // Close the top: without this the crown is an open tube and the interior
    // shows through from above.
    [0.250, bodyTop + 0.014], [0.190, bodyTop + 0.024], [0.110, bodyTop + 0.030],
    [0.000, bodyTop + 0.032],
  ].map(([r, y]) => [r, y * (PIECE_HEIGHT[ROOK] / bodyTop)]);
  const parts = [lathe(profile)];

  // Battlements: a ring of raised blocks. This is what makes a rook read as a
  // tower rather than a plain cylinder from a distance.
  const crownY = PIECE_HEIGHT[ROOK] * 0.994;
  const blockCount = 6;
  for (let i = 0; i < blockCount; i++) {
    const a = (i / blockCount) * TWO_PI;
    const block = new THREE.BoxGeometry(0.104, 0.070, 0.104);
    block.translate(Math.cos(a) * 0.226, crownY + 0.030, Math.sin(a) * 0.226);
    block.rotateY(0);
    parts.push(block);
  }
  const ring = new THREE.CylinderGeometry(0.256, 0.246, 0.034, RADIAL_SEGMENTS, 1, true);
  ring.translate(0, crownY + 0.010, 0);
  parts.push(ring);

  // The battlements are boxes and the crown ring is a cylinder; their UVs span
  // 0..1 across faces only ~0.1-0.25 world units wide, where the lathe wraps 0..1
  // around a ~1.4 unit circumference. Left alone, the marble renders about 14x
  // finer on the battlements than on the tower. Matching densities before the
  // merge is the only chance to do it — afterwards the parts are one geometry.
  const bodyDensity = uvDensity(parts[0]);
  for (let i = 1; i < parts.length; i++) matchUvDensity(parts[i], bodyDensity);

  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return { shell: merged, inlays: [] };
}

/* ---------------------------------------------------------------- knight -- */

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
  // Neck: short and, importantly, THICK. An earlier version was half the width of
  // the pawns standing beside it, which made the knight look like a fragile
  // seahorse rather than a piece from the same set.
  [0.000, 0.000, 0.148, 0.150],
  [0.010, 0.108, 0.150, 0.152],
  [0.026, 0.212, 0.152, 0.156],
  [0.048, 0.306, 0.158, 0.166],
  // Head: the dominant mass, widest at the cheek.
  [0.086, 0.396, 0.170, 0.184],
  [0.140, 0.484, 0.176, 0.196],
  [0.204, 0.552, 0.168, 0.186],
  // Poll (top-back of the skull), where the ears sit.
  [0.264, 0.586, 0.152, 0.166],
  // Face: turns forward and down toward the nose.
  [0.320, 0.580, 0.140, 0.150],
  [0.372, 0.548, 0.128, 0.130],
  [0.416, 0.498, 0.112, 0.110],
  // Muzzle: tapers to a rounded end. This is the forward-most point of the whole
  // piece, and it must lead the crown by a clear margin or the head reads as a
  // blunt wedge rather than a horse with a nose. Lengthened slightly after the
  // ears were enlarged absorbed some of that margin; the nose-overhang budget
  // still has room (measured 0.034 against a 0.10 limit).
  [0.452, 0.446, 0.086, 0.084],
  [0.482, 0.394, 0.060, 0.062],
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
 * The measurement matters. The neck must be over the pedestal, or the piece looks
 * unbalanced, while the nose should only just clear it, or it looks like it is
 * falling forward. Centring on the neck, and centring on the bounding box, each
 * failed one of those; this offset was solved numerically with
 * tools/knight_probe.mjs.
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

  // Wound so the surface faces OUTWARD.
  //
  // The first version emitted the opposite order, which produced an inward-facing
  // shell: the geometry was all there, but back-face culling hid it and the viewer
  // saw the board straight through the head. It looked like a missing head while
  // every bounding-box test still passed, because those are blind to orientation.
  // tools/mesh_audit.mjs measures the signed volume, which is not.
  for (let i = 0; i < stations - 1; i++) {
    const base = i * KNIGHT_RING_SEGMENTS;
    const next = (i + 1) * KNIGHT_RING_SEGMENTS;
    for (let k = 0; k < KNIGHT_RING_SEGMENTS; k++) {
      const k2 = (k + 1) % KNIGHT_RING_SEGMENTS;
      indices.push(base + k, next + k2, next + k);
      indices.push(base + k, base + k2, next + k2);
    }
  }

  // Close the muzzle with a fan.
  const last = stations - 1;
  const lastBase = last * KNIGHT_RING_SEGMENTS;
  const capCentre = positions.length / 3;
  positions.push(0, KNIGHT_SPINE[last][1], KNIGHT_SPINE[last][0] - KNIGHT_Z_CENTRE);
  uvs.push(0.5, 1);
  for (let k = 0; k < KNIGHT_RING_SEGMENTS; k++) {
    const k2 = (k + 1) % KNIGHT_RING_SEGMENTS;
    indices.push(lastBase + k, capCentre, lastBase + k2);
  }

  // Close the neck base too, so the head is a watertight solid rather than a tube
  // with one open end. Without this the interior would be visible from below.
  const baseCentre = positions.length / 3;
  positions.push(0, KNIGHT_SPINE[0][1], KNIGHT_SPINE[0][0] - KNIGHT_Z_CENTRE);
  uvs.push(0.5, 0);
  for (let k = 0; k < KNIGHT_RING_SEGMENTS; k++) {
    const k2 = (k + 1) % KNIGHT_RING_SEGMENTS;
    indices.push(k, k2, baseCentre);
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

/**
 * Mirror a geometry across X, reversing winding so its faces stay outward.
 *
 * The geometry is cloned first. `toNonIndexed()` returns the *same* object when a
 * geometry is already non-indexed, so without the clone this handed back its own
 * argument — the "mirrored" part was the original one, and anything done to it
 * afterwards was applied twice (which silently pushed the knight's ears above the
 * piece's declared height).
 */
/**
 * Mirror a geometry across X, keeping its faces pointing outward.
 *
 * A reflection reverses handedness, so the triangle winding must be reversed too.
 * Where that reversal happens depends on how the geometry is stored:
 *
 *   - INDEXED geometry: swap the second and third index of each triangle. This is
 *     the correct place, and it costs nothing.
 *   - NON-INDEXED geometry: reverse the vertex records themselves.
 *
 * An earlier version always did the second, swapping vertex data in groups of
 * three. Applied to an indexed mesh that shuffles unrelated vertices into each
 * other's places: the mirrored knight ear came out with 17 boundary and 13
 * non-manifold edges against 0 and 0 for the original, and resizing the ear
 * produced NaN normals. Both were this bug.
 */
function mirrorX(geo) {
  const g = geo.clone();
  // Reflect across x = 0. This also negates the x component of the normals, which
  // is what a mirrored surface should have.
  g.scale(-1, 1, 1);

  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
    return g;
  }

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
 * World surface area per unit of UV area for a geometry.
 *
 * This is the texel density of whatever map the material samples. Two parts with
 * the same UV *range* can differ enormously in density, because the range says
 * nothing about how much surface it covers — which is exactly how a box primitive
 * merged onto a lathe ended up showing the same marble at a 90x different scale.
 */
function uvDensity(geo) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!uv) return 0;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const gi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);

  let worldArea = 0;
  let uvArea = 0;
  for (let t = 0; t < triCount; t++) {
    const a = gi(t, 0), b = gi(t, 1), c = gi(t, 2);
    const p0x = pos.getX(a), p0y = pos.getY(a), p0z = pos.getZ(a);
    const e1x = pos.getX(b) - p0x, e1y = pos.getY(b) - p0y, e1z = pos.getZ(b) - p0z;
    const e2x = pos.getX(c) - p0x, e2y = pos.getY(c) - p0y, e2z = pos.getZ(c) - p0z;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    worldArea += 0.5 * Math.hypot(cx, cy, cz);

    const u0 = uv.getX(a), v0 = uv.getY(a);
    const u1 = uv.getX(b), v1 = uv.getY(b);
    const u2 = uv.getX(c), v2 = uv.getY(c);
    uvArea += 0.5 * Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0));
  }
  return uvArea > 1e-12 ? worldArea / uvArea : 0;
}

/**
 * Rescale a geometry's UVs so its texel density matches a reference.
 *
 * Scaling UVs by k multiplies uvArea by k^2, so density scales by 1/k^2. Solving
 * density / k^2 = reference gives k = sqrt(density / reference).
 *
 * Only meaningful for parts that sample a map: the accent (metal) materials carry
 * no texture, so their UVs are irrelevant and are left as authored.
 */
function matchUvDensity(geo, referenceDensity) {
  if (!referenceDensity) return geo;
  const density = uvDensity(geo);
  if (!density) return geo;
  const k = Math.sqrt(density / referenceDensity);
  if (!Number.isFinite(k) || k === 1) return geo;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  }
  uv.needsUpdate = true;
  return geo;
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

  // Larger and stretched along the neck, so consecutive beads merge into a
  // continuous crest instead of reading as separate buttons.
  const bead = new THREE.SphereGeometry(0.040, 12, 10);
  bead.scale(0.55, 1.55, 1.55);
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
 * tests/geometry.test.mjs, which asserts that the head overlaps the base, that
 * the ears meet the skull, that the muzzle projects past the crown with an
 * undercut, that the neck is markedly narrower than the head, that the nose does
 * not overhang the pedestal, and that the head carries real three-dimensional
 * volume.
 */
export function knightParts() {
  const baseTop = 0.50;
  // The pedestal is deliberately broad (scale 0.90 rather than the 0.76 used
  // before). Measured against its height the old foot was narrower than a real
  // Staunton knight's, which left the head no room to overhang; a wider base both
  // corrects the proportion and gives the head clearance over it.
  const base = lathe([
    ...pedestal(0.90),
    [0.224, 0.230], [0.216, 0.300], [0.212, 0.362], [0.215, 0.420],
    [0.224, 0.452], [0.228, 0.472], [0.214, 0.490], [0.150, 0.500],
    [0.086, 0.506],
  ].map(([r, y]) => [r, y * (baseTop / 0.506)]));

  const head = knightHeadGeo();

  // Ears: seated on the poll, swept back, and sunk into the skull so they are
  // rooted in it. Anchored to the spine's poll station rather than a hard-coded
  // offset, so they follow the shape if the spine is retuned.
  const poll = KNIGHT_SPINE[KNIGHT_POLL_INDEX];
  const pollZ = poll[0] - KNIGHT_Z_CENTRE;
  // Anchor the ears to the skull's measured top surface, not to the spine's
  // centreline. Placing them from the centreline buried them inside the head
  // (their highest point sat 0.039 below the skull), so the piece rendered bald.
  head.computeBoundingBox();
  const skullTopY = head.boundingBox.max.y;
  // Sized to read in silhouette at playing distance, and seated on the skull's
  // MEASURED top surface rather than its centreline. Anchoring to the centreline
  // buried them inside the head — their highest point sat 0.039 below the skull —
  // and the piece rendered bald, a bug caught by tests/geometry.test.mjs.
  const earHeight = 0.140;
  const ear = new THREE.ConeGeometry(0.046, earHeight, 14)
    .rotateX(-0.32)
    .translate(-0.046, skullTopY - 0.016, pollZ - 0.026);
  const ear2 = mirrorX(ear);

  // Mane: a crest of beads down the back of the neck.
  const maneGeos = KNIGHT_MANE.map((t) => maneBead(t));

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
}

/* ---------------------------------------------------------------- bishop -- */

function bishopGeo() {
  const s = 0.70;
  const total = 1.026;
  const profile = [
    ...pedestal(s),
    [0.185, 0.245], [0.172, 0.320], [0.160, 0.400], [0.151, 0.470],
    [0.146, 0.520],
    // Collar disc.
    [0.179, 0.548], [0.181, 0.580], [0.151, 0.600], [0.136, 0.615],
    // Mitre body.
    [0.169, 0.660], [0.181, 0.720], [0.175, 0.790], [0.151, 0.856],
    [0.113, 0.912], [0.071, 0.950],
    // Finial ball.
    [0.062, 0.968], [0.071, 0.988], [0.058, 1.006], [0.036, 1.020], [0.000, total],
  ].map(([r, y]) => [r, y * (PIECE_HEIGHT[BISHOP] / total)]);
  const body = lathe(profile);

  // The mitre's diagonal slit: a wedge of inset geometry that reads as the
  // traditional notch from every angle.
  const slit = new THREE.BoxGeometry(0.028, 0.240, 0.155);
  slit.rotateZ(-0.34);
  slit.rotateY(Math.PI * 0.25);
  slit.translate(0, PIECE_HEIGHT[BISHOP] * 0.772, 0.048);

  // The slit uses the body material, so its UVs decide what scale the marble
  // appears at on it. Measured 90x denser than the mitre before matching.
  matchUvDensity(slit, uvDensity(body));

  return { shell: body, inlays: [slit] };
}

/* ----------------------------------------------------------------- queen -- */

function queenGeo() {
  const s = 0.86;
  // Profile is authored up to y = 1.000; this maps the rim to a real height.
  const PROFILE_TOP = 1.000;
  const BODY_TOP = 1.330;
  const scale = BODY_TOP / PROFILE_TOP;
  const profile = [
    ...pedestal(s),
    [0.205, 0.250], [0.180, 0.330], [0.163, 0.420], [0.153, 0.500],
    [0.151, 0.560],
    [0.191, 0.592], [0.197, 0.616], [0.161, 0.640],
    // Bowl flaring outward to the rim.
    [0.191, 0.690], [0.225, 0.760], [0.247, 0.836], [0.259, 0.898],
    [0.265, 0.936], [0.263, 0.960],
    // Over the rim and back down the inside, to a centre floor: this is what
    // closes the volume and gives the coronet a real lip.
    [0.238, 0.958], [0.220, 0.930], [0.200, 0.890], [0.160, 0.862],
    [0.100, 0.848], [0.045, 0.842], [0.000, 0.840],
  ].map(([r, y]) => [r, y * scale]);
  const body = lathe(profile);

  // The orb nests in the mouth of the cup rather than hovering over a hole.
  const orb = new THREE.SphereGeometry(0.086, 24, 18);
  orb.scale(1, 0.92, 1);
  orb.translate(0, BODY_TOP - 0.055, 0);

  // The coronet: a ring of sphere-topped spikes standing on the rim. This is
  // the detail that makes a queen unmistakable at a glance.
  const ring = [];
  const crownY = 0.966 * scale;
  const spikeR = 0.252;
  const spikeCount = 9;
  for (let i = 0; i < spikeCount; i++) {
    const a = (i / spikeCount) * TWO_PI + 0.12;
    const tip = new THREE.SphereGeometry(0.036, 14, 10);
    tip.translate(Math.cos(a) * spikeR * 0.96, crownY + 0.060, Math.sin(a) * spikeR * 0.96);
    ring.push(tip);
    const stem = new THREE.CylinderGeometry(0.019, 0.038, 0.088, 12);
    stem.translate(Math.cos(a) * spikeR, crownY + 0.026, Math.sin(a) * spikeR);
    ring.push(stem);
  }
  const rim = new THREE.TorusGeometry(spikeR * 0.99, 0.030, 12, RADIAL_SEGMENTS);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, crownY + 0.008, 0);
  ring.push(rim);

  // The orb sits in the cup and uses the body material, so it must sample the
  // marble at the same scale as the bowl around it (measured 24x denser before).
  matchUvDensity(orb, uvDensity(body));

  // The coronet is rendered in the accent metal, which has no texture, so its UVs
  // do not matter and are left as authored.
  const merged = mergeGeometries(ring, false);
  merged.computeVertexNormals();

  return { shell: body, inlays: [orb], crowns: [merged] };
}

/* ------------------------------------------------------------------ king -- */

function kingGeo() {
  const s = 0.90;
  // Profile is authored up to y = 1.000; the dome closes the volume.
  const PROFILE_TOP = 1.000;
  const BODY_TOP = 1.330;
  const scale = BODY_TOP / PROFILE_TOP;
  const profile = [
    ...pedestal(s),
    [0.215, 0.250], [0.188, 0.330], [0.171, 0.420], [0.161, 0.500],
    [0.159, 0.560],
    [0.197, 0.592], [0.203, 0.616], [0.169, 0.640],
    [0.197, 0.694], [0.227, 0.766], [0.245, 0.842], [0.253, 0.900],
    // Crown shoulder rolling over into a closed dome.
    [0.251, 0.934], [0.236, 0.960], [0.196, 0.979], [0.130, 0.993],
    [0.060, 0.999], [0.000, PROFILE_TOP],
  ].map(([r, y]) => [r, y * scale]);
  const body = lathe(profile);

  // Orb seated on the dome, and the cross rising from the orb: rendered in the
  // accent metal so the king and queen read as a matched royal pair.
  const orb = new THREE.SphereGeometry(0.066, 22, 16);
  orb.scale(1, 0.86, 1);
  orb.translate(0, BODY_TOP + 0.032, 0);

  const rim = new THREE.TorusGeometry(0.222, 0.024, 12, RADIAL_SEGMENTS);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, BODY_TOP - 0.075, 0);

  const crossY = BODY_TOP + 0.168;
  const vert = new THREE.BoxGeometry(0.050, 0.196, 0.050);
  vert.translate(0, crossY, 0);
  const horiz = new THREE.BoxGeometry(0.144, 0.050, 0.050);
  horiz.translate(0, crossY + 0.016, 0);

  return {
    shell: body,
    inlays: [],
    crowns: [orb, rim, vert, horiz],
  };
}

/* ---------------------------------------------------------------- factory -- */

const CACHE = new Map();

/**
 * Geometry for a piece type, cached and shared across every instance.
 * Returns `{ shell, inlays, crowns }`; `inlays` are decorative additions in the
 * same material, `crowns` are separate meshes (kept apart so they can be shaded
 * with a slightly different finish).
 */
export function getPieceGeometry(type) {
  if (CACHE.has(type)) return CACHE.get(type);
  let entry;
  switch (type) {
    case PAWN: entry = pawnGeo(); break;
    case KNIGHT: entry = knightGeo(); break;
    case BISHOP: entry = bishopGeo(); break;
    case ROOK: entry = rookGeo(); break;
    case QUEEN: entry = queenGeo(); break;
    case KING: entry = kingGeo(); break;
    default: throw new Error('Unknown piece type ' + type);
  }
  entry.crowns = entry.crowns ?? [];
  CACHE.set(type, entry);
  return entry;
}

export function disposePieceGeometry() {
  for (const { shell, inlays, crowns } of CACHE.values()) {
    shell.dispose();
    for (const i of inlays) i.dispose();
    for (const c of crowns) c.dispose();
  }
  CACHE.clear();
}
