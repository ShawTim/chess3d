/**
 * Render the knight's authoring profile as an ASCII side elevation.
 *
 * Rasterising the 2D outline is exact and fast, so it is the right tool for
 * iterating on the shape. (Rasterising the merged mesh directly is unreliable:
 * the extruder's bevel emits degenerate triangles that defeat a naive
 * point-in-triangle test, filling the whole grid.) Cells are square so the
 * proportions are true.
 */
import { KNIGHT_PROFILE } from '../src/render/pieces.js';

export function renderProfile(points, { height = 30 } = {}) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX, spanY = maxY - minY;
  // Square cells: derive width from the same cell size as the height.
  const cell = spanY / height;
  const W = Math.max(4, Math.round(spanX / cell));
  const H = height;
  const grid = Array.from({ length: H }, () => new Array(W).fill('.'));

  for (let r = 0; r < H; r++) {
    const y = minY + (r + 0.5) * cell;
    const cross = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        cross.push(a[0] + t * (b[0] - a[0]));
      }
    }
    cross.sort((p, q) => p - q);
    for (let k = 0; k + 1 < cross.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((cross[k] - minX) / cell - 0.5));
      const c1 = Math.min(W - 1, Math.floor((cross[k + 1] - minX) / cell - 0.5));
      for (let c = c0; c <= c1; c++) grid[H - 1 - r][c] = '#';
    }
  }
  return { art: grid.map((row) => row.join('')).join('\n'), W, H, minX, maxX, minY, maxY };
}

if (process.argv[1].endsWith('silhouette.mjs')) {
  const r = renderProfile(KNIGHT_PROFILE, { height: 34 });
  console.log('=== KNIGHT profile  (left = back of neck, right = face/muzzle) ===');
  console.log(r.art);
  console.log(`forward: ${r.minX.toFixed(3)} .. ${r.maxX.toFixed(3)}   height: ${r.minY.toFixed(3)} .. ${r.maxY.toFixed(3)}`);
  console.log(`width:height = ${((r.maxX - r.minX) / (r.maxY - r.minY)).toFixed(2)}`);
}
