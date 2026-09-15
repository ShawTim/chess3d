/**
 * Board colour tests.
 *
 * These assert the board against the rules of chess rather than against the
 * implementation, because the two diverged for most of this project's life: the
 * parity was inverted, so every square rendered the wrong colour. A chess player
 * spots that instantly (a1 must be dark, h1 light), but no existing test covered
 * it and a rendered board looks plausible either way, so it survived repeated
 * visual reviews.
 *
 * The standard, which fully determines the pattern:
 *   - a1 is DARK and h1 is LIGHT — "light square on the right".
 *   - The white queen starts on d1, which is light — "queen on her own colour".
 *   - a8 is light and h8 is dark.
 */
import { isDarkSquare, squareToWorld } from '../src/render/board.js';
import { Chess, WHITE, QUEEN, KING, BISHOP, KNIGHT } from '../src/engine/chess.js';

let failures = 0;
let checks = 0;

function expect(cond, label, detail = '') {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${label} ${detail}`);
  } else {
    console.log(`ok   ${label} ${detail}`);
  }
}

const sqOf = (name) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);

console.log('--- Square colours match the standard ---');
{
  // The eight back-rank squares of each side, plus a few centre squares. Taken
  // from the rules, NOT read back from the implementation.
  const expected = {
    a8: 'light', b8: 'dark', c8: 'light', d8: 'dark',
    e8: 'light', f8: 'dark', g8: 'light', h8: 'dark',
    a1: 'dark', b1: 'light', c1: 'dark', d1: 'light',
    e1: 'dark', f1: 'light', g1: 'dark', h1: 'light',
    e4: 'light', d4: 'dark', e5: 'dark', d5: 'light',
  };

  let wrong = 0;
  const wrongList = [];
  for (const [name, want] of Object.entries(expected)) {
    const got = isDarkSquare(sqOf(name)) ? 'dark' : 'light';
    if (got !== want) {
      wrong++;
      wrongList.push(`${name}(${got}!=${want})`);
    }
  }
  expect(wrong === 0,
    'every tested square has the standard colour',
    wrong ? `${wrong} wrong: ${wrongList.join(' ')}` : '20 squares');
}

console.log('\n--- The two memorable rules ---');
{
  expect(isDarkSquare(sqOf('a1')), 'a1 is dark (the bishop-pair anchor)');
  expect(!isDarkSquare(sqOf('h1')), 'h1 is light ("light square on the right")');
  expect(!isDarkSquare(sqOf('d1')), 'd1 is light (white queen on her own colour)');
  expect(isDarkSquare(sqOf('e1')), 'e1 is dark (the white king, opposite the queen)');
}

console.log('\n--- Bishops stand on their own colour ---');
{
  // The c1 bishop is dark-squared and the f1 bishop is light-squared, which is
  // the consequence of the corner colours being right.
  expect(isDarkSquare(sqOf('c1')), 'c1 is dark for the dark-squared bishop');
  expect(!isDarkSquare(sqOf('f1')), 'f1 is light for the light-squared bishop');
}

console.log('\n--- Every square is assigned exactly one colour ---');
{
  // Count parity classes over the whole board: a correct 8x8 checkerboard has 32
  // of each. This catches an off-by-one over the full range rather than only at
  // the sampled squares above.
  let dark = 0;
  for (let sq = 0; sq < 64; sq++) if (isDarkSquare(sq)) dark++;
  expect(dark === 32, 'exactly 32 dark and 32 light squares', `dark=${dark}`);
}

console.log('\n--- World placement agrees with the colour map ---');
{
  // a1 must sit in the corner the player sees bottom-left when White is at the
  // bottom: +x for h-file, +z towards White. This guards the mapping the camera
  // and the raycaster both rely on.
  const a1 = squareToWorld(sqOf('a1'));
  const h1 = squareToWorld(sqOf('h1'));
  const a8 = squareToWorld(sqOf('a8'));
  expect(a1.x < h1.x, 'a-file is left of the h-file', `a1.x=${a1.x} h1.x=${h1.x}`);
  expect(a1.z > a8.z, 'White (rank 1) is nearer the camera than Black (rank 8)',
    `a1.z=${a1.z} a8.z=${a8.z}`);
  expect(isDarkSquare(sqOf('a1')), 'the bottom-left corner square a1 is dark');
}

console.log('\n--- The starting position matches the board ---');
{
  // Tie the colour map to the actual opening setup: queens on their own colour.
  const g = new Chess();
  const whiteQueenSq = g.board.findIndex((p) => p && (p & 7) === QUEEN && (p >> 3) === WHITE);
  expect(!isDarkSquare(whiteQueenSq), 'white queen starts on a light square',
    `sq=${whiteQueenSq}`);
  expect(isDarkSquare(g.board.findIndex((p) => p && (p & 7) === KING && (p >> 3) === WHITE)),
    'white king starts on a dark square');
  expect(isDarkSquare(g.board.findIndex((p) => p && (p & 7) === BISHOP && (p >> 3) === WHITE)),
    'the first white bishop stands on a dark square');
  expect(!isDarkSquare(g.board.findIndex((p) => p && (p & 7) === KNIGHT && (p >> 3) === WHITE)),
    'the first white knight stands on a light square');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
