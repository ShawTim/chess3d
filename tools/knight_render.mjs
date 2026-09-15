/**
 * Render the assembled knight to an ASCII side elevation, from the real mesh.
 *
 * This is verification that does not depend on a browser: it rasterises the
 * actual triangles of the built geometry, so it reflects exactly what the GPU
 * will draw (extrusion, bevel, welding and all). Used to confirm the silhouette
 * reads as a horse when a browser screenshot is unavailable.
 */
import { knightParts } from '../src/render/pieces.js';

function collectTriangles() {
  const parts = knightParts();
  const tris = [];
  const geos = [parts.base, parts.head, parts.ear, parts.ear2, ...(parts.mane ?? [])];
  for (const geo of geos) {
    const pos = geo.attributes.position;
    const idx = geo.index;
    // Iterate real triangles. Stepping the vertex buffer in threes is only valid
    // for non-indexed geometry; the knight's parts are now indexed (so normals can
    // be averaged across shared vertices), and treating them as a soup drew the
    // piece as a shredded fragment.
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const gi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
    for (let t = 0; t < triCount; t++) {
      const i0 = gi(t, 0);
      const i1 = gi(t, 1);
      const i2 = gi(t, 2);
      tris.push([
        [pos.getZ(i0), pos.getY(i0)],
        [pos.getZ(i1), pos.getY(i1)],
        [pos.getZ(i2), pos.getY(i2)],
      ]);
    }
  }
  return tris;
}

function rasterize(tris, cols) {
  let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tris) for (const [z, y] of t) {
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cell = (maxY - minY) / cols;
  const W = Math.round((maxZ - minZ) / cell);
  const H = cols;
  const grid = Array.from({ length: H }, () => new Array(W).fill(' '));

  const inTri = (p, t) => {
    const [a, b, c] = t;
    const area = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    if (Math.abs(area) < 1e-12) return false;
    const d = (u, v, w) => (v[0]-u[0])*(w[1]-u[1]) - (v[1]-u[1])*(w[0]-u[0]);
    const d1 = d(a, b, p)/area, d2 = d(b, c, p)/area, d3 = d(c, a, p)/area;
    return d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9;
  };

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const z = minZ + (c + 0.5) * cell;
      const y = minY + (r + 0.5) * cell;
      for (const t of tris) if (inTri([z, y], t)) { grid[H-1-r][c] = '#'; break; }
    }
  }
  return { art: grid.map(r => r.join('')).join('\n'), W, H, minZ, maxZ, minY, maxY };
}

const tris = collectTriangles();
const r = rasterize(tris, 46);
console.log('=== ASSEMBLED knight, side elevation (left = tail/back, right = face) ===');
console.log(r.art);
console.log(`z: ${r.minZ.toFixed(3)} .. ${r.maxZ.toFixed(3)}   (forward is +z, to the right)`);
console.log(`y: ${r.minY.toFixed(3)} .. ${r.maxY.toFixed(3)}`);
console.log(`triangles: ${tris.length}`);
