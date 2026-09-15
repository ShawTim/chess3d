/**
 * Reshape the knight's head so the muzzle projects horizontally, and enlarge the
 * ears.
 *
 * Every visual review of the swept head made the same two points, and both trace
 * back to the spine I authored:
 *
 *   1. MUZZLE POINTED DOWN. The face descended 0.19 of the profile height between
 *      the poll and the nose while advancing forward, so the head read as an
 *      elephant trunk or a bent pipe. A horse's muzzle projects roughly
 *      horizontally; on a Staunton knight the nose sits only a little below the
 *      top of the skull.
 *
 *   2. EARS TOO SMALL TO SEE. At 0.064 wide against a head 0.29 across they were
 *      about a fifth of the head's width, and review after review reported a bald
 *      piece. They are now substantially larger and set further apart.
 *
 * The forward positions change a lot with this reshape, so KNIGHT_Z_CENTRE is
 * re-solved afterwards with tools/pick_centre.mjs rather than guessed.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

const oldSpine = s.slice(
  s.indexOf('const KNIGHT_SPINE = ['),
  s.indexOf('];', s.indexOf('const KNIGHT_SPINE = [')) + 2,
);
if (!oldSpine) throw new Error('spine not found');

const newSpine = `const KNIGHT_SPINE = [
  // Neck: short and thick, rising almost vertically out of the pedestal.
  [0.000, 0.000, 0.150, 0.155],
  [0.008, 0.100, 0.150, 0.152],
  [0.020, 0.200, 0.152, 0.156],
  [0.040, 0.295, 0.158, 0.168],
  // Jaw and lower head: the undercut forms here.
  [0.075, 0.382, 0.168, 0.186],
  // Cheek: the widest point of the head, which is what gives it mass.
  [0.122, 0.466, 0.178, 0.200],
  [0.182, 0.532, 0.172, 0.192],
  // Poll: the top of the skull, where the ears sit.
  [0.248, 0.568, 0.158, 0.172],
  // Face, running forward and only gently down. A horse's muzzle projects close
  // to horizontally; an earlier spine dropped the nose 0.19 below the poll and
  // the head read as a bent pipe.
  [0.322, 0.556, 0.142, 0.152],
  [0.392, 0.536, 0.128, 0.132],
  [0.456, 0.512, 0.114, 0.114],
  // Muzzle: the forward-most part, tapering to a rounded end.
  [0.512, 0.486, 0.096, 0.096],
  [0.556, 0.454, 0.070, 0.072],
];`;
s = s.replace(oldSpine, newSpine);

// Larger, further-apart ears.
const oldEar = `  const earHeight = 0.098;
  const ear = new THREE.ConeGeometry(0.032, earHeight, 12)
    .rotateX(-0.34)
    // Rooted a little into the skull, with most of the cone above it.
    .translate(-0.034, skullTopY - 0.014, pollZ - 0.020);`;
const newEar = `  // Deliberately large. At 0.064 across against a head 0.29 wide they were only
  // a fifth of the head's width and every visual review reported a bald piece, so
  // they are now roughly a third as wide as the head and set further apart.
  const earHeight = 0.150;
  const ear = new THREE.ConeGeometry(0.048, earHeight, 14)
    .rotateX(-0.30)
    // Rooted a little into the skull, with most of the cone above it.
    .translate(-0.058, skullTopY - 0.020, pollZ - 0.030);`;
if (!s.includes(oldEar)) throw new Error('ear anchor not found');
s = s.replace(oldEar, newEar);

// The mane runs down the back of the neck; rescale its stations to the new spine.
s = s.replace(
  'const KNIGHT_MANE = [0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64];',
  'const KNIGHT_MANE = [0.12, 0.19, 0.26, 0.33, 0.40, 0.47, 0.54];',
);

fs.writeFileSync(target, s);
console.log('knight head reshaped: horizontal muzzle, larger ears');
