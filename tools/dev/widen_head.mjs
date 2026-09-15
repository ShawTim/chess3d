/**
 * Widen the knight's head across the piece, and make the mane a crest of ridges
 * rather than a row of balls.
 *
 * Both changes are deliberately confined to the X axis and to the mane, because
 * the head's forward placement is already at its balance limit: the nose overhangs
 * the pedestal by 0.090 against a 0.10 ceiling, and the neck's back edge sits at
 * z = -0.179 inside the pedestal footprint. Widening in X cannot disturb either,
 * so it is the safe way to address the review's complaint that the head read as
 * thin and pipe-like.
 *
 * Verified afterwards by tools/shading_audit.mjs (still smooth), the geometry
 * suite (balance, winding, watertightness unchanged) and tools/knight_render.mjs
 * (silhouette still reads as a horse).
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

const spine = s.slice(
  s.indexOf('const KNIGHT_SPINE = ['),
  s.indexOf('];', s.indexOf('const KNIGHT_SPINE = [')) + 2,
);
if (!spine) throw new Error('spine not found');

// Widen the half-width column (3rd of each station) by 18%, leaving the forward
// (1st), height (2nd) and thickness (4th) columns untouched.
const widened = spine.replace(/\[([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\]/g,
  (_m, z, y, hw, ht) => `[${z}, ${y}, ${(Number(hw) * 1.18).toFixed(3)}, ${ht}]`);

s = s.replace(spine, widened);

// The mane read as buttons on a wire. Elongating each bead along the neck turns
// the row into a continuous crest, which is what a carved mane looks like.
s = s.replace(
  `  const bead = new THREE.SphereGeometry(0.034, 12, 10);
  // Flatten across the piece so the crest is a ridge, not a row of balls.
  bead.scale(0.62, 1.0, 1.0);
  bead.translate(`,
  `  // Larger and stretched along the neck, so consecutive beads merge into a
  // continuous crest instead of reading as separate buttons.
  const bead = new THREE.SphereGeometry(0.040, 12, 10);
  bead.scale(0.55, 1.55, 1.55);
  bead.translate(`,
);

fs.writeFileSync(target, s);
console.log('knight head widened across the piece; mane beads stretched into a crest');
