/**
 * Restore the knight to the last configuration that passed the full suite.
 *
 * Why restore rather than continue: the winding fix (the actual user-reported bug,
 * "the knight has no head") is done and proven by a regression guard, and the flat
 * shading and buried-ears bugs are fixed and guarded too. What followed was
 * aesthetic iteration against noisy visual reviews, and it broke the geometry
 * (NaN positions) without improving the tested properties. Working code beats a
 * half-finished experiment.
 *
 * This restores exactly the spine, ear and mane values that produced
 * ALL PASS (60 / 20 / 50 / 12) with a smooth-shaded, watertight, outward-facing
 * head at the correct height.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

// --- 1. Spine ------------------------------------------------------------------
const spineStart = s.indexOf('const KNIGHT_SPINE = [');
const spineEnd = s.indexOf('];', spineStart) + 2;
if (spineStart < 0 || spineEnd < 2) throw new Error('spine not found');

const spine = `const KNIGHT_SPINE = [
  // Neck: short and, importantly, THICK. An earlier version was half the width of
  // the pawns standing beside it, which made the knight look like a fragile
  // seahorse rather than a piece from the same set.
  [0.000, 0.000, 0.148, 0.150],
  [0.010, 0.108, 0.150, 0.152],
  [0.026, 0.212, 0.152, 0.156],
  [0.048, 0.306, 0.158, 0.166],
  // Head: the dominant mass, widest at the cheek.
  [0.086, 0.396, 0.170, 0.184],
  [0.140, 0.484, 0.176, 0.196],
  [0.204, 0.552, 0.168, 0.186],
  // Poll (top-back of the skull), where the ears sit.
  [0.264, 0.586, 0.152, 0.166],
  // Face: turns forward and down toward the nose.
  [0.320, 0.580, 0.140, 0.150],
  [0.372, 0.548, 0.128, 0.130],
  [0.416, 0.498, 0.112, 0.110],
  // Muzzle: tapers to a rounded end, the forward-most point.
  [0.436, 0.448, 0.088, 0.086],
  [0.462, 0.398, 0.062, 0.064],
];`;
s = s.slice(0, spineStart) + spine + s.slice(spineEnd);

// --- 2. Ears: the size that passed, seated on the measured skull top -----------
const earStart = s.indexOf('  const earHeight = 0.150;');
if (earStart < 0) throw new Error('ear block not found');
const earEnd = s.indexOf('  const ear2 = mirrorX(ear);', earStart);
if (earEnd < 0) throw new Error('ear2 line not found');
const ears = `  // Large enough to read as ears in silhouette, seated on the skull's measured
  // top surface. Anchoring them to the centreline instead buried them inside the
  // head (their highest point sat 0.039 below the skull) and the piece rendered
  // bald — a bug caught by tests/geometry.test.mjs.
  const earHeight = 0.098;
  const ear = new THREE.ConeGeometry(0.032, earHeight, 12)
    .rotateX(-0.34)
    .translate(-0.034, skullTopY - 0.014, pollZ - 0.020);
`;
s = s.slice(0, earStart) + ears + s.slice(earEnd);

// --- 3. Mane stations ----------------------------------------------------------
s = s.replace(
  'const KNIGHT_MANE = [0.12, 0.19, 0.26, 0.33, 0.40, 0.47, 0.54];',
  'const KNIGHT_MANE = [0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64];',
);

// --- 4. Forward centring ------------------------------------------------------
s = s.replace(/const KNIGHT_Z_CENTRE = [^;]+;/, 'const KNIGHT_Z_CENTRE = 0.150;');

fs.writeFileSync(target, s);
console.log('knight restored to the last fully-passing configuration');
