import { KNIGHT_PROFILE } from '../src/render/pieces.js';

// Back edge (leftmost x) and front edge (rightmost x) of the profile at height y.
function edgesAt(y) {
  const cross = [];
  for (let i = 0; i < KNIGHT_PROFILE.length; i++) {
    const a = KNIGHT_PROFILE[i], b = KNIGHT_PROFILE[(i + 1) % KNIGHT_PROFILE.length];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
      const t = (y - a[1]) / (b[1] - a[1]);
      cross.push(a[0] + t * (b[0] - a[0]));
    }
  }
  cross.sort((p, q) => p - q);
  return { back: cross[0], front: cross[cross.length - 1] };
}

console.log('height   backEdge  frontEdge   (mane points currently used)');
const manePoints = [[-0.075,0.760],[-0.165,0.620],[-0.198,0.450],[-0.168,0.280],[-0.120,0.120]];
for (const y of [0.12, 0.28, 0.45, 0.55, 0.62, 0.68, 0.76]) {
  const e = edgesAt(y);
  const near = manePoints.find(m => Math.abs(m[1] - y) < 0.03);
  const gap = near ? (near[0] - e.back) : null;
  console.log(
    `  ${y.toFixed(2)}    ${e.back.toFixed(3)}    ${e.front.toFixed(3)}` +
    (near ? `    mane x=${near[0].toFixed(3)}  offset from back edge = ${gap.toFixed(3)}` : ''),
  );
}
