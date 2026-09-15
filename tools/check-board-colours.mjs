/**
 * Verify board square colours against the chess standard.
 *
 * The rules that pin this down:
 *   - a1 is a DARK square, and h1 is LIGHT ("light square on the right").
 *   - The white queen starts on d1, which is LIGHT — "queen on her own colour".
 *   - Therefore e1 (the white king) is dark, and the pattern alternates.
 *   - a8 is LIGHT and h8 is DARK.
 *
 * Board indices run 0 = a8 .. 63 = h1, so file = sq & 7 and the rank index
 * (0 at rank 8) is sq >> 3.
 */
import { isDarkSquare } from '../src/render/board.js';

const sqOf = (name) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);

// Expected colours, taken from the standard, not from the implementation.
const expected = {
  a8: 'light', b8: 'dark', c8: 'light', d8: 'dark', e8: 'light', f8: 'dark', g8: 'light', h8: 'dark',
  a1: 'dark', b1: 'light', c1: 'dark', d1: 'light', e1: 'dark', f1: 'light', g1: 'dark', h1: 'light',
  e4: 'light', d4: 'dark', e5: 'dark', d5: 'light',
};

let wrong = 0;
console.log('square   code    standard');
for (const [name, want] of Object.entries(expected)) {
  const got = isDarkSquare(sqOf(name)) ? 'dark' : 'light';
  const ok = got === want;
  if (!ok) wrong++;
  console.log(`  ${name.padEnd(6)} ${got.padEnd(7)} ${want.padEnd(7)} ${ok ? 'ok' : '*** WRONG ***'}`);
}

console.log('');
if (wrong) {
  console.log(`${wrong} square(s) wrong — THE BOARD IS INVERTED.`);
  console.log('Correct parity: an EVEN (rankIndex + file) is a LIGHT square.');
  process.exit(1);
}
console.log('board colours match the standard');
