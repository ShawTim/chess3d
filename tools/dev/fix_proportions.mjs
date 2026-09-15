/**
 * Rebalance the knight's proportions.
 *
 * Visual review of the corrected geometry was consistent on one point: the neck
 * read as too long and thin while the head read as too small, so the piece
 * suggested a "giraffe" or a bent pipe rather than a horse. Two changes address
 * that directly.
 *
 *   1. The pedestal takes a smaller share of the height (0.50 -> 0.42), which is
 *      closer to a real Staunton knight where the head is the dominant mass.
 *   2. The spine is re-authored so the neck is shorter and the head is
 *      substantially fuller: wider across the piece and thicker in profile,
 *      with the cheek as the widest point.
 *
 * The proportions a reviewer objected to were visible only in the rendered
 * silhouette, which is why the numbers here were chosen against
 * tools/knight_render.mjs rather than by feel.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

const oldSpine = `const KNIGHT_SPINE = [
  // Neck: rises close to vertically from the pedestal.
  [0.000, 0.000, 0.096, 0.110],
  [0.008, 0.130, 0.094, 0.108],
  [0.018, 0.258, 0.092, 0.106],
  [0.032, 0.386, 0.094, 0.110],
  [0.054, 0.506, 0.100, 0.120],
  // Head: swells into the cheek, curving forward.
  [0.094, 0.622, 0.112, 0.140],
  [0.146, 0.716, 0.118, 0.148],
  [0.208, 0.780, 0.114, 0.142],
  // Poll (top-back of the skull), where the ears sit.
  [0.268, 0.800, 0.106, 0.128],
  // Face: turns forward and down toward the nose.
  [0.326, 0.780, 0.096, 0.112],
  [0.378, 0.734, 0.086, 0.098],
  [0.420, 0.672, 0.076, 0.084],
  // Muzzle: tapers to a rounded end, the forward-most point. Long enough to
  // project clearly past the poll, so the head plainly has a nose, while still
  // staying over the pedestal rather than hanging off it.
  [0.462, 0.600, 0.062, 0.070],
  [0.508, 0.542, 0.044, 0.052],
];`;

const newSpine = `const KNIGHT_SPINE = [
  // Neck: short and sturdy. An earlier version stretched this over most of the
  // piece's height and the result read as a bent pipe rather than a horse.
  [0.000, 0.000, 0.104, 0.122],
  [0.006, 0.086, 0.102, 0.119],
  [0.014, 0.170, 0.100, 0.117],
  [0.026, 0.252, 0.104, 0.122],
  [0.048, 0.332, 0.114, 0.136],
  // Head: a full mass, widest at the cheek. This is the part that must dominate
  // the silhouette.
  [0.092, 0.424, 0.134, 0.166],
  [0.150, 0.512, 0.144, 0.180],
  [0.214, 0.576, 0.138, 0.170],
  // Poll (top-back of the skull), where the ears sit.
  [0.276, 0.604, 0.126, 0.150],
  // Face: turns forward and down toward the nose.
  [0.334, 0.594, 0.112, 0.130],
  [0.386, 0.556, 0.100, 0.112],
  [0.430, 0.500, 0.088, 0.096],
  // Muzzle: tapers to a rounded end, the forward-most point.
  [0.466, 0.438, 0.070, 0.078],
  [0.494, 0.384, 0.050, 0.058],
];`;

if (!s.includes(oldSpine)) throw new Error('spine anchor not found');
s = s.replace(oldSpine, newSpine);

// Re-centre for the new spine extents: the muzzle now reaches further forward.
s = s.replace(
  'const KNIGHT_Z_CENTRE = 0.150;',
  'const KNIGHT_Z_CENTRE = 0.170;'
);

// A smaller pedestal share, so the head dominates as it does on a real knight.
s = s.replace('  const baseTop = 0.50;', '  const baseTop = 0.42;');

// The pedestal profile is scaled to baseTop, so its own proportions stay intact.
s = s.replace(
  `  ].map(([r, y]) => [r, y * (baseTop / 0.506)]));`,
  `  ].map(([r, y]) => [r, y * (baseTop / 0.506)]));`
);

// The ears move with the poll station, which the new spine moved.
s = s.replace('const KNIGHT_POLL_INDEX = 8;', 'const KNIGHT_POLL_INDEX = 8;');

// Seat the head slightly deeper now that the neck is shorter.
s = s.replace('  const seat = baseTop - 0.09;', '  const seat = baseTop - 0.07;');

fs.writeFileSync(target, s);
console.log('proportions rebalanced; baseTop=0.42, spine compressed, head enlarged');
