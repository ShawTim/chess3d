/**
 * Compare UV ranges between a lathe body and its attached box primitives.
 *
 * The procedural marble/marble-normal textures are sampled by UV, so parts whose
 * UVs span a different range render at a different texture scale. The rook's
 * battlements and the bishop's slit are plain BoxGeometry merged onto a lathe,
 * and box UVs run 0..1 per face whereas lathe UVs run 0..1 around the whole
 * revolution — so the two parts show the same marble at visibly different
 * densities.
 */
import * as THREE from 'three';
import { getPieceGeometry } from '../../src/render/pieces.js';
import { ROOK, BISHOP, QUEEN, KING } from '../../src/engine/chess.js';

const uvRange = (geo) => {
  const uv = geo.attributes.uv;
  if (!uv) return null;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  return { u: [minU, maxU], v: [minV, maxV], span: [maxU - minU, maxV - minV] };
};

for (const [type, name] of [[ROOK, 'rook'], [BISHOP, 'bishop'], [QUEEN, 'queen'], [KING, 'king']]) {
  const entry = getPieceGeometry(type);
  const parts = [['shell', entry.shell], ...(entry.inlays ?? []).map((g, i) => [`inlay${i}`, g]), ...(entry.crowns ?? []).map((g, i) => [`crown${i}`, g])];
  console.log('\n' + name + ':');
  for (const [label, g] of parts) {
    const r = uvRange(g);
    console.log(`  ${label.padEnd(7)} u[${r.u[0].toFixed(2)},${r.u[1].toFixed(2)}] v[${r.v[0].toFixed(2)},${r.v[1].toFixed(2)}] span=[${r.span[0].toFixed(2)},${r.span[1].toFixed(2)}] index=${!!g.index}`);
  }
}
