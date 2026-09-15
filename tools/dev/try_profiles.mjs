import { renderProfile } from './silhouette.mjs';

// The insight every earlier attempt missed: the neck must be a NARROW COLUMN for
// the bottom third of the piece, and only then does the head branch out. Without
// that narrow column the outline fans out continuously from the base and reads
// as a blob/diamond, which is exactly what three visual reviews reported.
const L = [
  // --- neck column: nearly parallel sides, x in [0.00, 0.24] ---
  [ 0.000, 0.000], [ 0.000, 0.220], [-0.020, 0.420],
  // --- head branches out: back of the skull and the mane line ---
  [-0.075, 0.570], [-0.150, 0.690], [-0.155, 0.800],
  // poll and crown
  [-0.110, 0.900], [-0.010, 0.968], [ 0.100, 0.988],
  // forehead, into the stop
  [ 0.205, 0.962], [ 0.262, 0.900], [ 0.278, 0.828],
  // nose bridge running forward and down
  [ 0.375, 0.760], [ 0.500, 0.700], [ 0.600, 0.635],
  // muzzle tip (forward-most point)
  [ 0.648, 0.572], [ 0.628, 0.522],
  // mouth, chin, jaw
  [ 0.548, 0.498], [ 0.440, 0.472], [ 0.358, 0.438],
  // concave throat dropping back into the neck column
  [ 0.298, 0.376], [ 0.258, 0.280], [ 0.240, 0.160], [ 0.228, 0.060],
  [ 0.220, 0.000],
];

const r = renderProfile(L, { height: 46 });
console.log(r.art);
const xs = L.map(p=>p[0]), ys = L.map(p=>p[1]);
const H = Math.max(...ys)-Math.min(...ys);
console.log(`w/h=${((Math.max(...xs)-Math.min(...xs))/H).toFixed(2)}`);
// Report width at several heights to confirm a narrow neck then a wide head.
const widthAt = (y) => {
  const cross = [];
  for (let i=0;i<L.length;i++){const a=L[i],b=L[(i+1)%L.length];
    if((a[1]<=y&&b[1]>y)||(b[1]<=y&&a[1]>y)){const t=(y-a[1])/(b[1]-a[1]);cross.push(a[0]+t*(b[0]-a[0]));}}
  cross.sort((p,q)=>p-q);
  return cross.length>=2 ? cross[cross.length-1]-cross[0] : 0;
};
for (const y of [0.05,0.2,0.35,0.5,0.6,0.75,0.9]) {
  console.log(`  width @ y=${y.toFixed(2)}: ${widthAt(y).toFixed(3)}`);
}
