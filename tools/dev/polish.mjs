/**
 * Production polish pass.
 *
 * Four fixes, each traced to a measured defect rather than a guess:
 *
 * 1. mirrorX CORRUPTED INDEXED GEOMETRY. It reversed winding by swapping vertex
 *    data in groups of three, which is only valid for a non-indexed triangle
 *    soup. The ear cone is indexed, so the mirrored ear came out with 17 boundary
 *    and 13 non-manifold edges against 0 and 0 for the original; the same bug
 *    produced degenerate faces (NaN normals) whenever the ear was resized.
 *    Winding is now reversed in the index buffer, which is the correct place.
 *
 * 2. UV DENSITY MISMATCH. The procedural marble is sampled by UV. Box and
 *    cylinder primitives merged onto a lathe carry UVs spanning 0..1 across a
 *    face only ~0.1 world units wide, where the lathe wraps 0..1 around a ~1.4
 *    unit circumference. Measured: rook body 0.052, bishop body 1.421 with its
 *    slit at 0.016 (a 90x mismatch), queen body 2.182 with its orb at 0.092
 *    (24x). The same stone therefore rendered at wildly different scales on the
 *    attached parts, which is the seam a reviewer saw on the rook's crown.
 *
 * 3. KNIGHT EARS TOO SMALL. Review after review reported a bald knight at
 *    playing distance. Enlarged, seated on the skull's measured top.
 *
 * 4. BOARD COORDINATE LABELS FAINT. Raised in size and opacity so ranks and
 *    files are readable at the default camera.
 */
import fs from 'node:fs';

const pieces = 'src/render/pieces.js';
let s = fs.readFileSync(pieces, 'utf8');

// ---------------------------------------------------------------- 1. mirrorX --
const oldMirror = `function mirrorX(geo) {
  const g = geo.clone();
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
}`;

const newMirror = `/**
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
}`;

if (!s.includes(oldMirror)) throw new Error('mirrorX anchor not found');
s = s.replace(oldMirror, newMirror);

// ------------------------------------------- 2a. rook: match before the merge --
const oldRookMerge = `  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return { shell: merged, inlays: [] };
}

/* ---------------------------------------------------------------- knight -- */`;
const newRookMerge = `  // The battlements are boxes and the crown ring is a cylinder; their UVs span
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

/* ---------------------------------------------------------------- knight -- */`;
if (!s.includes(oldRookMerge)) throw new Error('rook merge anchor not found');
s = s.replace(oldRookMerge, newRookMerge);

// ------------------------------------------------- 2b. bishop: the mitre slit --
const oldBishopReturn = `  return { shell: body, inlays: [slit] };
}`;
const newBishopReturn = `  // The slit uses the body material, so its UVs decide what scale the marble
  // appears at on it. Measured 90x denser than the mitre before matching.
  matchUvDensity(slit, uvDensity(body));

  return { shell: body, inlays: [slit] };
}`;
if (!s.includes(oldBishopReturn)) throw new Error('bishop return anchor not found');
s = s.replace(oldBishopReturn, newBishopReturn);

// ------------------------------------------------------------- 2c. queen: orb --
const oldQueenReturn = `  const merged = mergeGeometries(ring, false);
  merged.computeVertexNormals();

  return { shell: body, inlays: [orb], crowns: [merged] };
}`;
const newQueenReturn = `  // The orb sits in the cup and uses the body material, so it must sample the
  // marble at the same scale as the bowl around it (measured 24x denser before).
  matchUvDensity(orb, uvDensity(body));

  // The coronet is rendered in the accent metal, which has no texture, so its UVs
  // do not matter and are left as authored.
  const merged = mergeGeometries(ring, false);
  merged.computeVertexNormals();

  return { shell: body, inlays: [orb], crowns: [merged] };
}`;
if (!s.includes(oldQueenReturn)) throw new Error('queen return anchor not found');
s = s.replace(oldQueenReturn, newQueenReturn);

// ------------------------------------------------ 3. knight ears (enlarged) ---
const oldEars = `  // Deliberately large. At 0.064 across against a head 0.29 wide they were only
  // a fifth of the head's width and every visual review reported a bald piece, so
  // they are now roughly a third as wide as the head and set further apart.
  // Large enough to read as ears in silhouette, seated on the skull's measured
  // top surface. Anchoring them to the centreline instead buried them inside the
  // head (their highest point sat 0.039 below the skull) and the piece rendered
  // bald — a bug caught by tests/geometry.test.mjs.
  const earHeight = 0.098;
  const ear = new THREE.ConeGeometry(0.032, earHeight, 12)
    .rotateX(-0.34)
    .translate(-0.034, skullTopY - 0.014, pollZ - 0.020);`;
const newEars = `  // Sized to read in silhouette at playing distance, and seated on the skull's
  // MEASURED top surface rather than its centreline. Anchoring to the centreline
  // buried them inside the head — their highest point sat 0.039 below the skull —
  // and the piece rendered bald, a bug caught by tests/geometry.test.mjs.
  const earHeight = 0.140;
  const ear = new THREE.ConeGeometry(0.046, earHeight, 14)
    .rotateX(-0.32)
    .translate(-0.046, skullTopY - 0.016, pollZ - 0.026);`;
if (!s.includes(oldEars)) throw new Error('ear anchor not found');
s = s.replace(oldEars, newEars);

fs.writeFileSync(pieces, s);
console.log('pieces.js: mirrorX fixed, UV densities matched, knight ears enlarged');

// ------------------------------------------- 4. board coordinate labels --------
const board = 'src/render/board.js';
let b = fs.readFileSync(board, 'utf8');

const oldLabel = `    const fileTex = createLabelTexture(file, { size: 128 });
    const rankTex = createLabelTexture(rank, { size: 128 });
    const planeGeo = new THREE.PlaneGeometry(0.30, 0.30);`;
const newLabel = `    // Larger and brighter than before: at the default camera distance the old
    // 0.30 planes at 0.85 opacity were too faint to read, which visual review
    // flagged. The glyphs are also given more contrast in the texture itself.
    const fileTex = createLabelTexture(file, { size: 128, opacity: 0.95 });
    const rankTex = createLabelTexture(rank, { size: 128, opacity: 0.95 });
    const planeGeo = new THREE.PlaneGeometry(0.36, 0.36);`;
if (!b.includes(oldLabel)) throw new Error('label anchor not found');
b = b.replace(oldLabel, newLabel);

const oldTopMat = `      map: fileTex, transparent: true, depthWrite: false, opacity: 0.85,`;
const newTopMat = `      map: fileTex, transparent: true, depthWrite: false, opacity: 1.0,`;
if (!b.includes(oldTopMat)) throw new Error('top label material anchor not found');
b = b.replace(oldTopMat, newTopMat);

const oldLeftMat = `      map: rankTex, transparent: true, depthWrite: false, opacity: 0.85,`;
const newLeftMat = `      map: rankTex, transparent: true, depthWrite: false, opacity: 1.0,`;
if (!b.includes(oldLeftMat)) throw new Error('left label material anchor not found');
b = b.replace(oldLeftMat, newLeftMat);

fs.writeFileSync(board, b);
console.log('board.js: coordinate labels enlarged and brightened');
