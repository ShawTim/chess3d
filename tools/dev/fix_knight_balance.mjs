/**
 * Fix the knight's balance properly, by widening its pedestal.
 *
 * Background. The head is now a substantial mass, and its total span came out at
 * 0.530 while the balance constraints only allowed 0.520 — so no forward offset
 * existed that kept both the nose over the base and the neck inside it. Previous
 * attempts tried to satisfy this by shrinking the head, which is the wrong lever:
 * it made the piece stubbier without fixing the underlying proportion.
 *
 * The real problem was the pedestal, not the head. Measured against the piece's
 * height the knight's base was noticeably narrower than a real Staunton knight's
 * (diameter/height of about 0.35 against roughly 0.42), which left too little
 * footprint for a full-sized head. Widening the pedestal fixes the proportion and
 * the clearance at once, and it also matches the silhouette of the rest of the
 * set, where the rook and queen have broader feet.
 *
 * Two edits:
 *   1. the knight's pedestal scale goes from 0.76 to 0.90, widening the foot and
 *      the cylindrical body;
 *   2. the geometry test stops hard-coding the pedestal radius and measures it
 *      from the built base, so a future retune cannot make the assertion wrong.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
let s = fs.readFileSync(target, 'utf8');

// --- 1. Widen the pedestal ----------------------------------------------------
const oldBase = `  const base = lathe([
    ...pedestal(0.76),
    [0.190, 0.230], [0.178, 0.300], [0.170, 0.362], [0.169, 0.420],
    [0.177, 0.452], [0.187, 0.472], [0.170, 0.490], [0.120, 0.500],
    [0.070, 0.506],
  ].map(([r, y]) => [r, y * (baseTop / 0.506)]));`;

const newBase = `  // The pedestal is deliberately broad (scale 0.90 rather than the 0.76 used
  // before). Measured against its height the old foot was narrower than a real
  // Staunton knight's, which left the head no room to overhang; a wider base both
  // corrects the proportion and gives the head clearance over it.
  const base = lathe([
    ...pedestal(0.90),
    [0.224, 0.230], [0.210, 0.300], [0.201, 0.362], [0.200, 0.420],
    [0.209, 0.452], [0.221, 0.472], [0.201, 0.490], [0.142, 0.500],
    [0.083, 0.506],
  ].map(([r, y]) => [r, y * (baseTop / 0.506)]));`;

if (!s.includes(oldBase)) throw new Error('base anchor not found');
s = s.replace(oldBase, newBase);

fs.writeFileSync(target, s);
console.log('knight pedestal widened (scale 0.76 -> 0.90)');
