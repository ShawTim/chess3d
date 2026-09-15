import { renderProfile } from './silhouette.mjs';

// --- simple-polygon check -------------------------------------------------
// A self-intersecting outline makes even-odd scanline fill punch holes in the
// silhouette (an earlier jaw line zig-zagged and produced exactly that), and it
// makes ExtrudeGeometry produce a broken solid. So the profile is validated
// before anything is extruded from it.
function segIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const d1 = d(p3,p4,p1), d2 = d(p3,p4,p2), d3 = d(p1,p2,p3), d4 = d(p1,p2,p4);
  return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
}
function isSimple(P) {
  const n = P.length;
  for (let i = 0; i < n; i++) {
    for (let j = i+1; j < n; j++) {
      if (i === j) continue;
      if (j === i+1 || (i === 0 && j === n-1)) continue;  // adjacent
      if (segIntersect(P[i], P[(i+1)%n], P[j], P[(j+1)%n])) return { simple: false, i, j };
    }
  }
  return { simple: true };
}

// --- candidate ------------------------------------------------------------
// Facing +x. Back/mane edge up to the poll, crown forward, a STOP recess, a
// nose bridge out to a low forward muzzle, then the underside running strictly
// down-and-back to the throat (strictly monotonic, which is what keeps the
// polygon simple and the silhouette solid).
const P = [
  // bottom-back, up the mane line
  [-0.100, 0.000], [-0.150, 0.120], [-0.200, 0.290], [-0.225, 0.470],
  [-0.195, 0.620], [-0.120, 0.730],
  // poll and crown
  [-0.030, 0.800], [ 0.060, 0.820],
  // forehead forward
  [ 0.130, 0.798],
  // STOP: the face steps back in before the nose
  [ 0.112, 0.734],
  // nose bridge out to the muzzle tip
  [ 0.205, 0.700], [ 0.310, 0.655], [ 0.400, 0.590],
  // muzzle tip, the forward-most point
  [ 0.452, 0.505],
  // underside: strictly decreasing in x and y, back to the throat
  [ 0.415, 0.452], [ 0.336, 0.418], [ 0.248, 0.394], [ 0.162, 0.362],
  [ 0.092, 0.312], [ 0.038, 0.228], [ 0.008, 0.128], [ 0.000, 0.000],
];

console.log('simple polygon:', JSON.stringify(isSimple(P)));
const r = renderProfile(P, { height: 42 });
console.log(r.art);
const xs = P.map(p=>p[0]), ys = P.map(p=>p[1]);
console.log(`w/h = ${((Math.max(...xs)-Math.min(...xs))/(Math.max(...ys)-Math.min(...ys))).toFixed(2)}  fwd ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}`);
