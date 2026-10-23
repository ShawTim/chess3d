/**
 * A very small opening book.
 *
 * The engine can already find reasonable moves from the start, but it has to
 * search for them, and a search from the initial position is the least
 * interesting one there is: the first few moves of a chess game are known. This
 * file is the known part — a few dozen main lines, written as move sequences
 * from the starting position — and the worker answers from it while the game is
 * still inside the book.
 *
 * Two rules keep it honest:
 *
 *  - It is only a *candidate list*. Every entry is checked against the legal
 *    moves of the position before it is played, so a stale entry, a hand-edited
 *    line, or a caller that passes the wrong move list can never produce an
 *    illegal move. The tests replay every line through the rules engine.
 *  - It is not a script. Several lines pass through the same position, and the
 *    reply is drawn at random, weighted by how many lines choose it: the engine
 *    opens with one of a few systems rather than playing the same twelve moves
 *    every game.
 *
 * Size is the point: the lines themselves are under 2KB of text, which is what
 * "no download" has to mean in a project with no external assets.
 */

/**
 * The lines, in UCI.
 *
 * Grouped by first move: 1.e4 systems, 1.d4 systems, then the flank openings.
 * Six to eight plies each — enough to leave the book in a real middlegame
 * position rather than at move three.
 */
const LINES = [
  // 1.e4 e5 — the open games.
  'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6',
  'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6',
  'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6',
  'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4',
  'e2e4 e7e5 f1c4 g8f6 d2d3 f8c5 g1f3 d7d6',

  // 1.e4 c5 — the Sicilian.
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6',
  'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6',
  'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6',
  'e2e4 c7c5 c2c3 g8f6 e4e5 f6d5 d2d4',
  'e2e4 c7c5 d2d4 c5d4 g1f3 e7e5 c2c3',

  // 1.e4 — the other defences.
  'e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6',
  'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6',
  'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6',
  'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 g1f3 f8g7',
  'e2e4 g8f6 e4e5 f6d5 d2d4 d7d6 g1f3 g7g6',

  // 1.d4 d5 — the closed games.
  'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7',
  'd2d4 d7d5 c2c4 c7c6 b1c3 g8f6 g1f3 d5c4',
  'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6',
  'd2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 f8e7',

  // 1.d4 Nf6 — the Indian defences.
  'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6',
  'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8',
  'd2d4 g8f6 c2c4 e7e6 g1f3 f8b4 c1d2 d8e7',
  'd2d4 g8f6 c2c4 c7c5 d4d5 e7e6 b1c3 e6d5',
  'd2d4 g8f6 c1g5 e7e6 e2e4 h7h6 g5f6 d8f6',

  // 1.d4 — the odd defences.
  'd2d4 f7f5 g2g3 g8f6 f1g2 e7e6 g1f3 f8e7',
  'd2d4 e7e6 c2c4 f8b4 b1c3 g8f6 e2e3 e8g8',

  // Flank openings.
  'c2c4 e7e5 b1c3 g8f6 g2g3 d7d5 c4d5 f6d5',
  'c2c4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7',
  'g1f3 d7d5 d2d4 g8f6 c2c4 e7e6 b1c3 f8e7',
];

/**
 * Weighted index from a position's move prefix to the replies played there.
 *
 * Built once at load: each line contributes every prefix along it, so a reply's
 * weight is simply the number of lines that choose it. A reply shared by several
 * openings — 1.e4 e5, 1... c5 — is therefore drawn more often, which is also how
 * a human opens.
 */
const INDEX = (() => {
  const index = new Map();
  for (const line of LINES) {
    const moves = line.trim().split(/\s+/);
    for (let i = 0; i < moves.length; i += 1) {
      const key = moves.slice(0, i).join(' ');
      let bucket = index.get(key);
      if (!bucket) index.set(key, (bucket = new Map()));
      bucket.set(moves[i], (bucket.get(moves[i]) ?? 0) + 1);
    }
  }
  return index;
})();

/** How deep the book goes. Past this many plies the engine searches. */
export const BOOK_PLIES = 8;

/**
 * Every reply the book knows for a position.
 *
 * @param {string[]} moves UCI moves played so far, from the starting position.
 * @returns {string[]} Candidate replies, empty when the position is not in the book.
 */
export function bookCandidates(moves) {
  const bucket = INDEX.get(Array.from(moves ?? []).join(' '));
  return bucket ? [...bucket.keys()] : [];
}

/**
 * Pick a reply for a position, or null when the book has nothing to say.
 *
 * Weighted, not uniform: a reply that more lines play is drawn more often. The
 * caller must still check that the move is legal — the book is a hint, not an
 * authority — and must not call it past BOOK_PLIES.
 *
 * @param {string[]} moves UCI moves played so far.
 * @param {{random?: () => number}} [options]
 * @returns {string|null}
 */
export function bookMove(moves, { random = Math.random } = {}) {
  const played = Array.from(moves ?? []);
  if (played.length >= BOOK_PLIES) return null;
  const bucket = INDEX.get(played.join(' '));
  if (!bucket || bucket.size === 0) return null;

  let total = 0;
  for (const weight of bucket.values()) total += weight;
  let roll = random() * total;
  let last = null;
  for (const [uci, weight] of bucket) {
    last = uci;
    roll -= weight;
    if (roll < 0) return uci;
  }
  return last;
}

/**
 * Every line the book contains, as arrays of UCI moves.
 *
 * Exported for the tests, which replay each line through the rules engine: a typo
 * would otherwise stay invisible until the engine tried to play it.
 *
 * @returns {string[][]}
 */
export function bookLines() {
  return LINES.map((line) => line.trim().split(/\s+/));
}
