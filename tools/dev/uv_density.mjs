/**
 * Measure texel density: world units of surface per unit of UV, per part.
 *
 * UV span alone does not reveal a texture-scale mismatch — every part here spans
 * 0..1. What matters is how much SURFACE each UV unit covers. A lathe ring of
 * radius 0.226 wraps about 1.42 world units around u in [0,1]; a 0.104-wide box
 * face also maps 0..1. Same range, roughly 14x different density, so the marble
 * reads at a visibly different scale on the box parts than on the body they sit
 * on. That is the seam a reviewer noticed on the rook's battlements.
 */
import { getPieceGeometry } from '../../src/render/pieces.js';
import { ROOK, BISHOP, QUEEN, KING } from '../../src/engine/chess.js';

function surfacePerUv(geo) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const gi = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);

  const P = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  const U = (i) => [uv.getX(i), uv.getY(i)];
  let worldArea = 0;
  let uvArea = 0;
  for (let t = 0; t < triCount; t++) {
    const a = gi(t, 0);
    const b = gi(t, 1);
    const c = gi(t, 2);
    const p0 = P(a), p1 = P(b), p2 = P(c);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const cr = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    worldArea += 0.5 * Math.hypot(cr[0], cr[1], cr[2]);

    const u0 = U(a), u1 = U(b), u2 = U(c);
    uvArea += 0.5 * Math.abs(
      (u1[0] - u0[0]) * (u2[1] - u0[1]) - (u2[0] - u0[0]) * (u1[1] - u0[1]),
    );
  }
  return { worldArea, uvArea, density: worldArea / Math.max(uvArea, 1e-9) };
}

for (const [type, name] of [[ROOK, 'rook'], [BISHOP, 'bishop'], [QUEEN, 'queen'], [KING, 'king']]) {
  const e = getPieceGeometry(type);
  const parts = [['shell', e.shell]];
  (e.inlays ?? []).forEach((g, i) => parts.push([`inlay${i}`, g]));
  (e.crowns ?? []).forEach((g, i) => parts.push([`crown${i}`, g]));

  const shellDensity = surfacePerUv(e.shell).density;
  console.log('\n' + name + '   (body density = ' + shellDensity.toFixed(3) + ')');
  // Crowns use the accent metal, which has no map, so their UVs cannot cause a
  // texture-scale seam. Only inlays (body material) are density-checked.
  const inlays = (e.inlays ?? []).map((g, i) => ['inlay' + i, g]);
  const crowns = (e.crowns ?? []).length;
  for (const [label, g] of [['shell', e.shell], ...inlays]) {
    const d = surfacePerUv(g);
    const ratio = d.density / shellDensity;
    const flag = ratio > 2 || ratio < 0.5 ? '  *** MISMATCH ***' : '';
    console.log(`  ${label.padEnd(7)} density=${d.density.toFixed(3)}  vs body x${ratio.toFixed(2)}${flag}`);
  }
  if (crowns) console.log(`  (${crowns} crown part(s) use the untxured accent metal - density not applicable)`);
}
