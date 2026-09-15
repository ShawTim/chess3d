import { KNIGHT_PROFILE } from '../src/render/pieces.js';

// Border-only plot: draws the outline, which is far easier to judge than a
// filled grid (filling hides the concavities that make a silhouette readable).
export function plotOutline(P, { height = 40 } = {}) {
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cell = (maxY - minY) / height;
  const W = Math.round((maxX - minX) / cell) + 1;
  const H = height;
  const g = Array.from({length:H}, () => new Array(W).fill(' '));
  const put = (x,y,ch) => {
    const c = Math.round((x-minX)/cell), r = Math.round((y-minY)/cell);
    if (c>=0&&c<W&&r>=0&&r<H) g[H-1-r][c] = ch;
  };
  for (let i=0;i<P.length;i++){
    const a=P[i], b=P[(i+1)%P.length];
    const steps = Math.max(2, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1]) / (cell*0.4)));
    for (let k=0;k<=steps;k++){
      const t=k/steps;
      put(a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1]), '#');
    }
  }
  // Mark the muzzle (max x) and the neck root (first/last points).
  put(maxX, P[P.findIndex(p=>p[0]===maxX)][1], 'M');
  put(P[0][0], P[0][1], 'N');
  return g.map(r=>r.join('')).join('\n');
}

if (process.argv[1].endsWith('outline.mjs')) {
  console.log(plotOutline(KNIGHT_PROFILE, { height: 40 }));
  console.log('\n# = outline   M = muzzle (frontmost)   N = neck root');
}
