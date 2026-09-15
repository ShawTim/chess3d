import { renderProfile } from './silhouette.mjs';

// A right triangle with legs 1:1. A correct rasteriser must produce a shape
// whose filled area is ~half the cells, with the hypotenuse on the diagonal.
const tri = [[0,0],[1,0],[0,1]];
const r = renderProfile(tri, { height: 12 });
console.log('=== triangle (0,0)-(1,0)-(0,1): expect a lower-left right triangle ===');
console.log(r.art);
const filled = (r.art.match(/#/g) || []).length;
const total = r.W * r.H;
console.log(`filled ${filled}/${total} = ${(100*filled/total).toFixed(0)}%  (expect ~50%)`);
