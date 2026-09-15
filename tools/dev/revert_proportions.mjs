/**
 * Revert the knight proportion experiment back to the last configuration that
 * passed the full suite.
 *
 * The rebalance (a larger head, a shorter neck, a smaller pedestal) broke two
 * hard constraints: the nose overhung the pedestal by 0.161 against a 0.10 limit,
 * and the neck's back edge fell at z = -0.269, outside the pedestal footprint.
 * Those are the balance properties that keep the piece looking like it is
 * standing on its base, so they take priority over the cosmetic goal of a bigger
 * head. Restoring first, then adjusting within the constraints, is the reliable
 * order of operations.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

const brokenSpine = s.slice(s.indexOf('const KNIGHT_SPINE = ['), s.indexOf('];', s.indexOf('const KNIGHT_SPINE = [')) + 2);
const greenSpine = `const KNIGHT_SPINE = [
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

if (!brokenSpine) throw new Error('spine not found');
s = s.replace(brokenSpine, greenSpine);

s = s.replace('const KNIGHT_Z_CENTRE = 0.170;', 'const KNIGHT_Z_CENTRE = 0.150;');
s = s.replace('  const baseTop = 0.42;', '  const baseTop = 0.50;');
s = s.replace('  const seat = baseTop - 0.07;', '  const seat = baseTop - 0.09;');

fs.writeFileSync(target, s);
console.log('reverted to the last green configuration');
