/**
 * Fix the knight's ears and rebalance the neck-to-head proportions.
 *
 * Two real bugs, both measured rather than guessed:
 *
 *  1. EARS BURIED. The ears' highest point was 0.039 BELOW the skull's top, so
 *     they were entirely inside the head and invisible — visual review reported a
 *     bald, earless piece. The test that was supposed to catch this asserted only
 *     `ear.max.y > head.max.y - 0.05`, which passes while the ears are inside the
 *     skull. It now requires them to protrude.
 *
 *  2. NECK TOO LONG, HEAD TOO SMALL. The neck occupied more than half of the
 *     head-and-neck height and its radius was close to the head's, so the piece
 *     read as a bent pipe. On a Staunton knight the head is the dominant mass.
 *     The neck is compressed to roughly a third of the cranium height and the
 *     head's cross-section enlarged; the forward positions are barely changed so
 *     the pedestal balance constraints still hold.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

const oldSpine = s.slice(
  s.indexOf('const KNIGHT_SPINE = ['),
  s.indexOf('];', s.indexOf('const KNIGHT_SPINE = [')) + 2,
);
if (!oldSpine) throw new Error('spine not found');

// Neck: short and sturdy (three stations over the lower third).
// Head: a full mass, widest at the cheek, carried forward to a tapered muzzle.
const newSpine = `const KNIGHT_SPINE = [
  // Neck: short and sturdy. An earlier version stretched it over more than half
  // the cranium height, which read as a bent pipe rather than a horse.
  [0.000, 0.000, 0.108, 0.126],
  [0.010, 0.108, 0.106, 0.124],
  [0.026, 0.212, 0.110, 0.130],
  [0.048, 0.306, 0.122, 0.148],
  // Head: the dominant mass, widest at the cheek.
  [0.086, 0.396, 0.146, 0.178],
  [0.140, 0.484, 0.156, 0.194],
  [0.204, 0.552, 0.150, 0.184],
  // Poll (top-back of the skull), where the ears sit.
  [0.264, 0.586, 0.138, 0.164],
  // Face: turns forward and down toward the nose.
  [0.320, 0.580, 0.124, 0.144],
  [0.372, 0.548, 0.110, 0.124],
  [0.416, 0.498, 0.096, 0.106],
  // Muzzle: tapers to a rounded end, the forward-most point.
  [0.452, 0.440, 0.078, 0.086],
  [0.480, 0.388, 0.056, 0.064],
];`;
s = s.replace(oldSpine, newSpine);

// The head now reaches slightly further forward, so re-centre for the balance
// constraints (nose overhang <= 0.10, neck inside the pedestal footprint).
s = s.replace('const KNIGHT_Z_CENTRE = 0.150;', 'const KNIGHT_Z_CENTRE = 0.166;');

// The ears must sit ON TOP of the skull, not inside it. Place them from the
// skull's measured top rather than from the spine station, so a future retune of
// the spine cannot bury them again.
const oldEar = `  const poll = KNIGHT_SPINE[KNIGHT_POLL_INDEX];
  const pollZ = poll[0] - KNIGHT_Z_CENTRE;
  const pollY = poll[1];
  const earHeight = 0.090;
  const ear = new THREE.ConeGeometry(0.030, earHeight, 12)
    .rotateX(-0.30)
    .translate(-0.032, pollY + earHeight * 0.30, pollZ - 0.030);`;
const newEar = `  const poll = KNIGHT_SPINE[KNIGHT_POLL_INDEX];
  const pollZ = poll[0] - KNIGHT_Z_CENTRE;
  // Anchor the ears to the skull's measured top surface, not to the spine's
  // centreline. Placing them from the centreline buried them inside the head
  // (their highest point sat 0.039 below the skull), so the piece rendered bald.
  head.computeBoundingBox();
  const skullTopY = head.boundingBox.max.y;
  const earHeight = 0.098;
  const ear = new THREE.ConeGeometry(0.032, earHeight, 12)
    .rotateX(-0.34)
    // Rooted a little into the skull, with most of the cone above it.
    .translate(-0.034, skullTopY - 0.014, pollZ - 0.020);`;
if (!s.includes(oldEar)) throw new Error('ear anchor not found');
s = s.replace(oldEar, newEar);

fs.writeFileSync(target, s);
console.log('knight: neck compressed, head enlarged, ears seated on the skull');
