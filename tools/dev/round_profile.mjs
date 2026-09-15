// Round the corners of the landmark polygon to produce the final profile.
//
// Sharp vertices triangulate into long slivers, and computeVertexNormals cannot
// smooth across them, so the extruded sides show diagonal faceting. Replacing
// each corner with a short arc fixes the artefact at its source and also makes
// the silhouette look carved rather than laser-cut.
import { KNIGHT_PROFILE } from '../src/render/pieces.js';

/** Round every corner of a closed polygon with a quadratic fillet. */
export function roundPolygon(P, radius = 0.022) {
  const n = P.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = P[(i - 1 + n) % n];
    const cur = P[i];
    const next = P[(i + 1) % n];

    const d1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
    const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
    // Do not consume more than a third of either neighbouring edge.
    const r = Math.min(radius, d1 / 3, d2 / 3);

    const a = [cur[0] + (prev[0] - cur[0]) * (r / d1), cur[1] + (prev[1] - cur[1]) * (r / d1)];
    const b = [cur[0] + (next[0] - cur[0]) * (r / d2), cur[1] + (next[1] - cur[1]) * (r / d2)];

    out.push(a, cur, b);
  }
  return out;
}

if (process.argv[1].endsWith('round_profile.mjs')) {
  const rounded = roundPolygon(KNIGHT_PROFILE, 0.020);
  console.log('const KNIGHT_PROFILE = [');
  for (const [x, y] of rounded) {
    console.log(`  [${x.toFixed(3)}, ${y.toFixed(3)}],`);
  }
  console.log('];');
  console.log(`\n// ${KNIGHT_PROFILE.length} landmark points -> ${rounded.length} after rounding`);
}
