/**
 * ASCII side elevation of the ASSEMBLED knight (base + head + ears + mane),
 * projected onto the (z, y) plane exactly as a side-on camera sees it.
 *
 * Rendering the composition, not just the authoring profile, is what catches
 * "head floating above the base" and proportion problems. It fills real
 * triangles, so bevels and the extrusion are included.
 */
import { knightParts } from '../src/render/pieces.js';

function tri2D(g) {
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const out = [];
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    out.push([
      [pos.getZ(a), pos.getY(a)],
      [pos.getZ(b), pos.getY(b)],
      [pos.getZ(c), pos.getY(c)],
    ]);
  }
  return out;
}

// 2D even-odd test on a triangle, with a tiny area guard so degenerate slivers
// (which the extruder emits on bevelled corners) cannot claim cells.
function inTri(p, t) {
  const [a, b, c] = t;
  const area = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  if (Math.abs(area) < 1e-9) return false;
  const d = (u, v, w) => (v[0]-u[0])*(w[1]-u[1]) - (v[1]-u[1])*(w[0]-u[0]);
  const d1 = d(a, b, p) / area;
  const d2 = d(b, c, p) / area;
  const d3 = d(c, a, p) / area;
  return d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9;
}

export function renderAssembled({ height = 44 } = {}) {
  const p = knightParts();
  const geos = [p.base, p.head, p.ear, p.ear2, p.mane];
  const tris = geos.flatMap(tri2D);

  let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tris) for (const [z, y] of t) {
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cell = (maxY - minY) / height;
  const W = Math.round((maxZ - minZ) / cell);
  const H = height;
  const grid = Array.from({ length: H }, () => new Array(W).fill('.'));
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const z = minZ + (c + 0.5) * cell;
      const y = minY + (r + 0.5) * cell;
      for (const t of tris) if (inTri([z, y], t)) { grid[H-1-r][c] = '#'; break; }
    }
  }
  return {
    art: grid.map((row) => row.join('')).join('\n'),
    W, H, minZ, maxZ, minY, maxY,
  };
}

if (process.argv[1].endsWith('knight_view.mjs')) {
  const r = renderAssembled({ height: 44 });
  console.log('=== ASSEMBLED knight, side view (left = back, right = front) ===');
  console.log(r.art);
  console.log(`z: ${r.minZ.toFixed(2)} .. ${r.maxZ.toFixed(2)}   y: ${r.minY.toFixed(2)} .. ${r.maxY.toFixed(2)}`);
}
