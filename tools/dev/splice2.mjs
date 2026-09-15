/**
 * Splice the knight section (tools/knight_section.txt) into src/render/pieces.js,
 * between the knight and bishop section headers.
 *
 * Done as a script rather than a manual edit because the section is long, and
 * hand-editing a large block is how the bishop/queen/king functions were lost
 * earlier.
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

const section = fs.readFileSync('tools/knight_section.txt', 'utf8');
const out = src.slice(0, start) + section + src.slice(end);
fs.writeFileSync(target, out);

// Refuse to leave the file in a state that has lost other pieces.
const expected = [
  'pawnGeo', 'rookGeo', 'knightGeo', 'bishopGeo', 'queenGeo', 'kingGeo',
  'knightHeadGeo', 'knightParts', 'getPieceGeometry', 'disposePieceGeometry',
  'lathe', 'pedestal', 'mirrorX', 'maneBead', 'spineAt', 'spineTangent',
];
const missing = expected.filter((f) => !new RegExp(`(function|const)\\s+${f}`).test(out));
console.log('lines:', out.split('\n').length);
console.log('missing:', missing.length ? missing.join(', ') : 'none');
