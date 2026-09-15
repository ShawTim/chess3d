/**
 * Replace the knight section of src/render/pieces.js with the version in
 * tools/new_knight.txt.
 *
 * Kept as a script rather than a manual edit because the section is large and
 * bracket-matching by hand is how the bishop/queen/king functions were
 * accidentally deleted earlier.
 */
import fs from 'node:fs';

const target = 'src/render/pieces.js';
const src = fs.readFileSync(target, 'utf8');

const startMarker = '/* ---------------------------------------------------------------- knight -- */';
const endMarker = '/* ---------------------------------------------------------------- bishop -- */';

const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  throw new Error(`markers not found: start=${start} end=${end}`);
}

const replacement = fs.readFileSync('tools/new_knight.txt', 'utf8');
const out = src.slice(0, start) + replacement + src.slice(end);

fs.writeFileSync(target, out);
fs.writeFileSync('tools/pieces.backup.js', src);

// Verify every expected piece function survived.
const expected = [
  'pawnGeo', 'rookGeo', 'knightGeo', 'bishopGeo', 'queenGeo', 'kingGeo',
  'knightHeadGeo', 'knightParts', 'getPieceGeometry', 'disposePieceGeometry',
  'lathe', 'pedestal', 'mirrorX', 'maneSpike', 'spineAt',
];
const missing = expected.filter((f) => !new RegExp(`(function|const)\\s+${f}`).test(out));
console.log('lines:', out.split('\n').length);
console.log('missing:', missing.length ? missing.join(', ') : 'none');
