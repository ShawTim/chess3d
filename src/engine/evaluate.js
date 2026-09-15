/**
 * Static position evaluation.
 *
 * The score is always returned from White's point of view; the search negates
 * as it descends. Values are in centipawns (100 = one pawn).
 *
 * The implementation is deliberately piece-square-table based rather than a
 * hand-written term soup: PSTs are easy to reason about, cheap to evaluate and
 * already encode most of what beginners get wrong (knights on the rim, a
 * sidelined bishop, an uncastled king).
 */
import {
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, EMPTY,
} from './chess.js';

export const PIECE_VALUES = {
  [PAWN]: 100,
  [KNIGHT]: 320,
  [BISHOP]: 335,
  [ROOK]: 500,
  [QUEEN]: 950,
  [KING]: 0,
};

export const MATE_SCORE = 100000;
export const MATE_THRESHOLD = MATE_SCORE - 1000;

/**
 * Piece-square tables, written from White's perspective in FEN order
 * (index 0 = a8 ... index 63 = h1). Tables are mirrored vertically for Black.
 */
const PST = {
  [PAWN]: [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [ROOK]: [
      0,   0,   0,   0,   0,   0,   0,   0,
      5,  10,  10,  10,  10,  10,  10,   5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      0,   0,   0,   5,   5,   0,   0,   0,
  ],
  [QUEEN]: [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
  [KING]: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
  ],
  /**
   * A separate king table for the endgame, where the king should march up the
   * board instead of hiding in the corner.
   */
  [`${KING}_END`]: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10,   0,   0, -10, -20, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -30,   0,   0,   0,   0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

/** Mirror a FEN-order index vertically so Black can reuse White's tables. */
function mirror(sq) {
  return (7 - (sq >> 3)) * 8 + (sq & 7);
}

const PAWN_FILE = [
  0, 0, 5, 10, 10, 5, 0, 0,
];
const PAWN_ISOLATED = -12;
const PAWN_DOUBLED = -10;
const BISHOP_PAIR = 30;
const ROOK_OPEN_FILE = 18;
const ROOK_SEMI_OPEN_FILE = 9;
const MOBILITY_WEIGHT = 2;
const SHIELD_MISSING = -12;

/** True when the position is sparse enough to use the endgame king table. */
function isEndgame(board) {
  let material = 0;
  let queens = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p) continue;
    const type = p & 7;
    if (type === KING) continue;
    material += PIECE_VALUES[type];
    if (type === QUEEN) queens++;
  }
  return material < 1500 || queens === 0;
}

/**
 * Evaluate the position. Positive favours White.
 *
 * `mobility` costs a move generation per side, so callers that need speed can
 * disable it; the search uses it only at the root of the quiescence boundary.
 */
export function evaluate(game, options = {}) {
  const useMobility = options.mobility === true;
  const board = game.board;
  const endgame = isEndgame(board);

  let score = 0;
  let whiteBishops = 0;
  let blackBishops = 0;
  const whitePawnFiles = [0, 0, 0, 0, 0, 0, 0, 0];
  const blackPawnFiles = [0, 0, 0, 0, 0, 0, 0, 0];

  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece) continue;
    const type = piece & 7;
    const color = piece >> 3;
    const value = PIECE_VALUES[type];

    if (color === WHITE) {
      score += value;
      if (type === KING && endgame) score += PST[`${KING}_END`][sq];
      else score += PST[type][sq];
      if (type === BISHOP) whiteBishops++;
      if (type === PAWN) whitePawnFiles[sq & 7]++;
    } else {
      score -= value;
      const m = mirror(sq);
      if (type === KING && endgame) score -= PST[`${KING}_END`][m];
      else score -= PST[type][m];
      if (type === BISHOP) blackBishops++;
      if (type === PAWN) blackPawnFiles[sq & 7]++;
    }
  }

  // Bishop pair is worth more than the sum of its parts.
  if (whiteBishops >= 2) score += BISHOP_PAIR;
  if (blackBishops >= 2) score -= BISHOP_PAIR;

  // Doubled and isolated pawns, plus a small centre bonus for advanced files.
  for (let f = 0; f < 8; f++) {
    const w = whitePawnFiles[f];
    const b = blackPawnFiles[f];
    if (w > 1) score += PAWN_DOUBLED * (w - 1);
    if (b > 1) score -= PAWN_DOUBLED * (b - 1);
    if (w > 0) {
      score += PAWN_FILE[f];
      const left = f > 0 ? whitePawnFiles[f - 1] : 0;
      const right = f < 7 ? whitePawnFiles[f + 1] : 0;
      if (left === 0 && right === 0) score += PAWN_ISOLATED;
    }
    if (b > 0) {
      score -= PAWN_FILE[f];
      const left = f > 0 ? blackPawnFiles[f - 1] : 0;
      const right = f < 7 ? blackPawnFiles[f + 1] : 0;
      if (left === 0 && right === 0) score -= PAWN_ISOLATED;
    }
  }

  // Rooks like open files; the king likes a pawn shield before castling.
  const whiteKingSq = game.kingSq[WHITE];
  const blackKingSq = game.kingSq[BLACK];
  if (whiteKingSq < 56) {
    const file = whiteKingSq & 7;
    const shield = (whitePawnFiles[Math.max(0, file - 1)] ? 1 : 0)
      + (whitePawnFiles[file] ? 1 : 0)
      + (whitePawnFiles[Math.min(7, file + 1)] ? 1 : 0);
    score -= SHIELD_MISSING * (3 - shield);
  }
  if (blackKingSq > 7) {
    const file = blackKingSq & 7;
    const shield = (blackPawnFiles[Math.max(0, file - 1)] ? 1 : 0)
      + (blackPawnFiles[file] ? 1 : 0)
      + (blackPawnFiles[Math.min(7, file + 1)] ? 1 : 0);
    score += SHIELD_MISSING * (3 - shield);
  }

  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece || (piece & 7) !== ROOK) continue;
    const file = sq & 7;
    const own = piece >> 3 === WHITE ? whitePawnFiles[file] : blackPawnFiles[file];
    const enemy = piece >> 3 === WHITE ? blackPawnFiles[file] : whitePawnFiles[file];
    let bonus = 0;
    if (own === 0) bonus = enemy === 0 ? ROOK_OPEN_FILE : ROOK_SEMI_OPEN_FILE;
    if (bonus) score += (piece >> 3) === WHITE ? bonus : -bonus;
  }

  if (useMobility) {
    const sideToMove = game.turn;
    const us = game.legalMoves(true).length;
    score += (sideToMove === WHITE ? 1 : -1) * us * MOBILITY_WEIGHT;
  }

  return score;
}

/** Evaluation from the perspective of the side to move (negamax convention). */
export function evaluateForSideToMove(game, options) {
  const score = evaluate(game, options);
  return game.turn === WHITE ? score : -score;
}
