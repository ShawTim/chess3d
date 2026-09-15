/**
 * A complete, dependency-free chess rules engine.
 *
 * Board is a 64-entry array indexed 0..63 where 0 = a8 and 63 = h1, matching
 * the order FEN strings are written in. Pieces are encoded as `type | (color << 3)`
 * so that `piece & 8` tests for black and `piece & 7` yields the piece type.
 *
 * Moves are packed into a single integer so the search can move them around
 * without allocating objects:
 *
 *   bits  0-5   from square
 *   bits  6-11  to square
 *   bits 12-14  promotion piece type (0 when not a promotion)
 *   bits 15-19  flags
 */

export const WHITE = 0;
export const BLACK = 1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const EMPTY = 0;

export const FLAG_CAPTURE = 1;
export const FLAG_DOUBLE = 2;
export const FLAG_EP = 4;
export const FLAG_CASTLE = 8;
export const FLAG_PROMO = 16;

const CASTLE_WK = 1;
const CASTLE_WQ = 2;
const CASTLE_BK = 4;
const CASTLE_BQ = 8;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECE_CHARS = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
const CHAR_PIECES = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

const KNIGHT_DELTAS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_DELTAS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const BISHOP_DELTAS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DELTAS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const ALL_DELTAS = [...BISHOP_DELTAS, ...ROOK_DELTAS];

/** Precomputed destination lists for the non-sliding pieces. */
const KNIGHT_ATTACKS = new Array(64);
const KING_ATTACKS = new Array(64);

function buildStepAttacks(deltas) {
  const table = new Array(64);
  for (let sq = 0; sq < 64; sq++) {
    const list = [];
    const r = sq >> 3;
    const f = sq & 7;
    for (const [dr, df] of deltas) {
      const nr = r + dr;
      const nf = f + df;
      if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
      list.push(nr * 8 + nf);
    }
    table[sq] = list;
  }
  return table;
}

const knightTable = buildStepAttacks(KNIGHT_DELTAS);
const kingTable = buildStepAttacks(KING_DELTAS);
for (let i = 0; i < 64; i++) {
  KNIGHT_ATTACKS[i] = knightTable[i];
  KING_ATTACKS[i] = kingTable[i];
}

const SQUARE_NAMES = [];
for (let sq = 0; sq < 64; sq++) {
  SQUARE_NAMES.push(String.fromCharCode(97 + (sq & 7)) + String(8 - (sq >> 3)));
}

export function squareName(sq) {
  return SQUARE_NAMES[sq];
}

export function squareFromName(name) {
  return SQUARE_NAMES.indexOf(name);
}

/** Zobrist keys, used for transposition table lookups and repetition detection. */
function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}

const ZOBRIST = (() => {
  const rng = makeRng(0x9e3779b9);
  const pieces = new Uint32Array(15 * 64);
  for (let i = 0; i < pieces.length; i++) pieces[i] = rng();
  const castling = new Uint32Array(16);
  for (let i = 0; i < 16; i++) castling[i] = rng();
  const epFile = new Uint32Array(8);
  for (let i = 0; i < 8; i++) epFile[i] = rng();
  return { pieces, castling, epFile, turn: rng() };
})();

export function moveFrom(m) { return m & 63; }
export function moveTo(m) { return (m >> 6) & 63; }
export function movePromo(m) { return (m >> 12) & 7; }
export function moveFlags(m) { return (m >> 15) & 31; }
export function isCapture(m) { return (moveFlags(m) & FLAG_CAPTURE) !== 0; }

export function encodeMove(from, to, promo = 0, flags = 0) {
  return from | (to << 6) | (promo << 12) | (flags << 15);
}

const PROMO_CHARS = { [KNIGHT]: 'n', [BISHOP]: 'b', [ROOK]: 'r', [QUEEN]: 'q' };

export function moveToUci(m) {
  let s = SQUARE_NAMES[moveFrom(m)] + SQUARE_NAMES[moveTo(m)];
  const promo = movePromo(m);
  if (promo) s += PROMO_CHARS[promo];
  return s;
}

export function uciToMove(uci, legalMoves) {
  for (const m of legalMoves) {
    if (moveToUci(m) === uci) return m;
  }
  return null;
}

export function pieceType(piece) { return piece & 7; }
export function pieceColor(piece) { return piece >> 3; }
export function makePiece(type, color) { return type | (color << 3); }

export class Chess {
  constructor(fen = START_FEN) {
    this.board = new Array(64).fill(EMPTY);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kingSq = [60, 4];
    this.undoStack = [];
    this.hash = 0;
    this.load(fen);
  }

  clone() {
    const c = Object.create(Chess.prototype);
    c.board = this.board.slice();
    c.turn = this.turn;
    c.castling = this.castling;
    c.ep = this.ep;
    c.halfmove = this.halfmove;
    c.fullmove = this.fullmove;
    c.kingSq = this.kingSq.slice();
    c.undoStack = [];
    c.hash = this.hash;
    return c;
  }

  load(fen) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error('Invalid FEN: ' + fen);
    this.board.fill(EMPTY);
    let sq = 0;
    for (const ch of parts[0]) {
      if (ch === '/') continue;
      if (ch >= '1' && ch <= '8') { sq += Number(ch); continue; }
      const lower = ch.toLowerCase();
      const type = CHAR_PIECES[lower];
      if (!type) throw new Error('Invalid FEN piece: ' + ch);
      const color = ch === lower ? BLACK : WHITE;
      const piece = makePiece(type, color);
      this.board[sq] = piece;
      if (type === KING) this.kingSq[color] = sq;
      sq++;
    }
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    this.castling = 0;
    if (parts[2].includes('K')) this.castling |= CASTLE_WK;
    if (parts[2].includes('Q')) this.castling |= CASTLE_WQ;
    if (parts[2].includes('k')) this.castling |= CASTLE_BK;
    if (parts[2].includes('q')) this.castling |= CASTLE_BQ;
    this.ep = parts[3] === '-' ? -1 : squareFromName(parts[3]);
    this.halfmove = parts.length > 4 ? Number(parts[4]) : 0;
    this.fullmove = parts.length > 5 ? Number(parts[5]) : 1;
    this.undoStack = [];
    this.hash = this.computeHash();
    return this;
  }

  computeHash() {
    let h = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (p) h ^= ZOBRIST.pieces[p * 64 + sq];
    }
    h ^= ZOBRIST.castling[this.castling];
    if (this.ep >= 0) h ^= ZOBRIST.epFile[this.ep & 7];
    if (this.turn === BLACK) h ^= ZOBRIST.turn;
    return h >>> 0;
  }

  fen() {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const piece = this.board[r * 8 + f];
        if (!piece) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const ch = PIECE_CHARS[piece & 7];
        out += piece >> 3 === WHITE ? ch : ch.toLowerCase();
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    let cast = '';
    if (this.castling & CASTLE_WK) cast += 'K';
    if (this.castling & CASTLE_WQ) cast += 'Q';
    if (this.castling & CASTLE_BK) cast += 'k';
    if (this.castling & CASTLE_BQ) cast += 'q';
    if (!cast) cast = '-';
    return [
      out,
      this.turn === WHITE ? 'w' : 'b',
      cast,
      this.ep >= 0 ? SQUARE_NAMES[this.ep] : '-',
      this.halfmove,
      this.fullmove,
    ].join(' ');
  }

  /**
   * A repetition-stable key: identical board, side to move, castling rights and
   * en-passant target (only when a capture is actually possible).
   */
  positionKey() {
    let cast = '';
    if (this.castling & CASTLE_WK) cast += 'K';
    if (this.castling & CASTLE_WQ) cast += 'Q';
    if (this.castling & CASTLE_BK) cast += 'k';
    if (this.castling & CASTLE_BQ) cast += 'q';
    let ep = '-';
    if (this.ep >= 0 && this.epCapturePossible()) ep = SQUARE_NAMES[this.ep];
    return this.board.join(',') + '|' + this.turn + '|' + cast + '|' + ep;
  }

  epCapturePossible() {
    const ep = this.ep;
    if (ep < 0) return false;
    const pawn = makePiece(PAWN, this.turn);
    const r = ep >> 3;
    const f = ep & 7;
    // A pawn of the side to move must be able to capture onto `ep`.
    const fromRank = this.turn === WHITE ? r + 1 : r - 1;
    if (fromRank < 0 || fromRank > 7) return false;
    for (const df of [-1, 1]) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      if (this.board[fromRank * 8 + nf] === pawn) return true;
    }
    return false;
  }

  /** True when `sq` is attacked by any piece of `byColor`. */
  isSquareAttacked(sq, byColor) {
    const r = sq >> 3;
    const f = sq & 7;

    // Pawns: a pawn of `byColor` attacks `sq` from the square "behind" it.
    const pawn = makePiece(PAWN, byColor);
    const pawnDr = byColor === WHITE ? 1 : -1;
    const pr = r + pawnDr;
    if (pr >= 0 && pr <= 7) {
      for (const df of [-1, 1]) {
        const pf = f + df;
        if (pf < 0 || pf > 7) continue;
        if (this.board[pr * 8 + pf] === pawn) return true;
      }
    }

    const knight = makePiece(KNIGHT, byColor);
    for (const nsq of KNIGHT_ATTACKS[sq]) {
      if (this.board[nsq] === knight) return true;
    }

    const king = makePiece(KING, byColor);
    for (const ksq of KING_ATTACKS[sq]) {
      if (this.board[ksq] === king) return true;
    }

    const bishop = makePiece(BISHOP, byColor);
    const rook = makePiece(ROOK, byColor);
    const queen = makePiece(QUEEN, byColor);

    for (const [dr, df] of BISHOP_DELTAS) {
      let nr = r + dr;
      let nf = f + df;
      while (nr >= 0 && nr <= 7 && nf >= 0 && nf <= 7) {
        const p = this.board[nr * 8 + nf];
        if (p) {
          if (p === bishop || p === queen) return true;
          break;
        }
        nr += dr;
        nf += df;
      }
    }

    for (const [dr, df] of ROOK_DELTAS) {
      let nr = r + dr;
      let nf = f + df;
      while (nr >= 0 && nr <= 7 && nf >= 0 && nf <= 7) {
        const p = this.board[nr * 8 + nf];
        if (p) {
          if (p === rook || p === queen) return true;
          break;
        }
        nr += dr;
        nf += df;
      }
    }

    return false;
  }

  inCheck(color = this.turn) {
    return this.isSquareAttacked(this.kingSq[color], color ^ 1);
  }

  /** Pseudo-legal moves; the caller filters with make/unmake for full legality. */
  generatePseudoLegal(capturesOnly = false) {
    const moves = [];
    const us = this.turn;
    const them = us ^ 1;
    const board = this.board;

    for (let sq = 0; sq < 64; sq++) {
      const piece = board[sq];
      if (!piece || piece >> 3 !== us) continue;
      const type = piece & 7;
      const r = sq >> 3;
      const f = sq & 7;

      if (type === PAWN) {
        const dir = us === WHITE ? -1 : 1;
        const startRank = us === WHITE ? 6 : 1;
        const promoRank = us === WHITE ? 0 : 7;

        // Pushes (never captures, so skipped in captures-only generation).
        if (!capturesOnly) {
          const one = sq + dir * 8;
          if (one >= 0 && one < 64 && !board[one]) {
            if ((one >> 3) === promoRank) {
              for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
                moves.push(encodeMove(sq, one, promo, FLAG_PROMO));
              }
            } else {
              moves.push(encodeMove(sq, one));
              if (r === startRank) {
                const two = sq + dir * 16;
                if (!board[two]) moves.push(encodeMove(sq, two, 0, FLAG_DOUBLE));
              }
            }
          }
        }

        // Diagonal captures, including en passant.
        for (const df of [-1, 1]) {
          const nf = f + df;
          if (nf < 0 || nf > 7) continue;
          const nr = r + dir;
          if (nr < 0 || nr > 7) continue;
          const dest = nr * 8 + nf;
          const target = board[dest];
          if (target && target >> 3 === them) {
            if (nr === promoRank) {
              for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
                moves.push(encodeMove(sq, dest, promo, FLAG_PROMO | FLAG_CAPTURE));
              }
            } else {
              moves.push(encodeMove(sq, dest, 0, FLAG_CAPTURE));
            }
          } else if (!target && dest === this.ep) {
            moves.push(encodeMove(sq, dest, 0, FLAG_CAPTURE | FLAG_EP));
          }
        }
        continue;
      }

      const deltas = type === KNIGHT ? KNIGHT_DELTAS
        : type === BISHOP ? BISHOP_DELTAS
          : type === ROOK ? ROOK_DELTAS
            : type === QUEEN ? ALL_DELTAS
              : KING_DELTAS;

      for (const [dr, df] of deltas) {
        let nr = r + dr;
        let nf = f + df;
        while (nr >= 0 && nr <= 7 && nf >= 0 && nf <= 7) {
          const dest = nr * 8 + nf;
          const target = board[dest];
          if (target) {
            if (target >> 3 === them) {
              moves.push(encodeMove(sq, dest, 0, FLAG_CAPTURE));
            }
            break;
          }
          if (!capturesOnly) moves.push(encodeMove(sq, dest));
          if (type === KNIGHT || type === KING) break;
          nr += dr;
          nf += df;
        }
      }

      if (type === KING && !capturesOnly) {
        moves.push(...this.generateCastles(us));
      }
    }

    return moves;
  }

  generateCastles(us) {
    const moves = [];
    const them = us ^ 1;
    const homeRank = us === WHITE ? 7 : 0;
    const kingSq = homeRank * 8 + 4;
    const opiece = this.board;

    if (opiece[kingSq] !== makePiece(KING, us)) return moves;
    if (this.isSquareAttacked(kingSq, them)) return moves;

    const kingSide = us === WHITE ? CASTLE_WK : CASTLE_BK;
    const queenSide = us === WHITE ? CASTLE_WQ : CASTLE_BQ;

    if (this.castling & kingSide) {
      const f1 = homeRank * 8 + 5;
      const g1 = homeRank * 8 + 6;
      const h1 = homeRank * 8 + 7;
      if (!opiece[f1] && !opiece[g1] && opiece[h1] === makePiece(ROOK, us)
        && !this.isSquareAttacked(f1, them) && !this.isSquareAttacked(g1, them)) {
        moves.push(encodeMove(kingSq, g1, 0, FLAG_CASTLE));
      }
    }

    if (this.castling & queenSide) {
      const d1 = homeRank * 8 + 3;
      const c1 = homeRank * 8 + 2;
      const b1 = homeRank * 8 + 1;
      const a1 = homeRank * 8;
      if (!opiece[d1] && !opiece[c1] && !opiece[b1] && opiece[a1] === makePiece(ROOK, us)
        && !this.isSquareAttacked(d1, them) && !this.isSquareAttacked(c1, them)) {
        moves.push(encodeMove(kingSq, c1, 0, FLAG_CASTLE));
      }
    }

    return moves;
  }

  /** Fully legal moves for the side to move. */
  legalMoves(capturesOnly = false) {
    const out = [];
    for (const m of this.generatePseudoLegal(capturesOnly)) {
      this.makeMove(m);
      if (!this.inCheck(this.turn ^ 1)) out.push(m);
      this.undoMove();
    }
    return out;
  }

  makeMove(m) {
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const flags = (m >> 15) & 31;
    const us = this.turn;
    const them = us ^ 1;

    const piece = this.board[from];
    const capturedSq = (flags & FLAG_EP) ? (us === WHITE ? to + 8 : to - 8) : to;
    const captured = this.board[capturedSq];

    this.undoStack.push({
      move: m, castling: this.castling, ep: this.ep, halfmove: this.halfmove,
      captured, capturedSq, piece, fullmove: this.fullmove, hash: this.hash,
    });

    this.hash ^= ZOBRIST.pieces[piece * 64 + from];
    if (captured) this.hash ^= ZOBRIST.pieces[captured * 64 + capturedSq];
    this.hash ^= ZOBRIST.castling[this.castling];

    this.board[from] = EMPTY;
    if (captured) this.board[capturedSq] = EMPTY;
    const placed = promo ? makePiece(promo, us) : piece;
    this.board[to] = placed;
    this.hash ^= ZOBRIST.pieces[placed * 64 + to];

    if ((piece & 7) === KING) {
      this.kingSq[us] = to;
      if (flags & FLAG_CASTLE) {
        // Rook hops over the king; `to` already tells us which side.
        const rank = us === WHITE ? 56 : 0;
        if (to === rank + 6) {
          this.board[rank + 5] = this.board[rank + 7];
          this.board[rank + 7] = EMPTY;
          this.hash ^= ZOBRIST.pieces[makePiece(ROOK, us) * 64 + (rank + 7)];
          this.hash ^= ZOBRIST.pieces[makePiece(ROOK, us) * 64 + (rank + 5)];
        } else {
          this.board[rank + 3] = this.board[rank + 0];
          this.board[rank + 0] = EMPTY;
          this.hash ^= ZOBRIST.pieces[makePiece(ROOK, us) * 64 + rank];
          this.hash ^= ZOBRIST.pieces[makePiece(ROOK, us) * 64 + (rank + 3)];
        }
      }
    }

    // Castling rights are lost when a king or a rook leaves its home square, or
    // when a rook is captured on its home square.
    let castling = this.castling;
    if (piece === makePiece(KING, WHITE)) castling &= ~(CASTLE_WK | CASTLE_WQ);
    if (piece === makePiece(KING, BLACK)) castling &= ~(CASTLE_BK | CASTLE_BQ);
    if (from === 63 || to === 63) castling &= ~CASTLE_WK;
    if (from === 56 || to === 56) castling &= ~CASTLE_WQ;
    if (from === 7 || to === 7) castling &= ~CASTLE_BK;
    if (from === 0 || to === 0) castling &= ~CASTLE_BQ;
    this.castling = castling;
    this.hash ^= ZOBRIST.castling[this.castling];

    if (this.ep >= 0) this.hash ^= ZOBRIST.epFile[this.ep & 7];
    if ((flags & FLAG_DOUBLE)) {
      this.ep = (from + to) >> 1;
      this.hash ^= ZOBRIST.epFile[this.ep & 7];
    } else {
      this.ep = -1;
    }

    if ((piece & 7) === PAWN || (flags & FLAG_CAPTURE)) this.halfmove = 0;
    else this.halfmove++;

    if (us === BLACK) this.fullmove++;
    this.turn = them;
    // JS bitwise XOR yields a signed 32-bit value; normalize so the incremental
    // hash stays comparable to computeHash() across make/unmake cycles.
    this.hash = (this.hash ^ ZOBRIST.turn) >>> 0;

    return this;
  }

  undoMove() {
    const rec = this.undoStack.pop();
    if (!rec) return null;
    const m = rec.move;
    const from = m & 63;
    const to = (m >> 6) & 63;
    const flags = (m >> 15) & 31;

    this.turn ^= 1;
    const us = this.turn;

    this.board[from] = rec.piece;
    this.board[to] = EMPTY;
    if (rec.captured) this.board[rec.capturedSq] = rec.captured;

    if ((rec.piece & 7) === KING) {
      this.kingSq[us] = from;
      if (flags & FLAG_CASTLE) {
        const rank = us === WHITE ? 56 : 0;
        if (to === rank + 6) {
          this.board[rank + 7] = this.board[rank + 5];
          this.board[rank + 5] = EMPTY;
        } else {
          this.board[rank + 0] = this.board[rank + 3];
          this.board[rank + 3] = EMPTY;
        }
      }
    }

    this.castling = rec.castling;
    this.ep = rec.ep;
    this.halfmove = rec.halfmove;
    this.fullmove = rec.fullmove;
    this.hash = this.computeHash();
    return m;
  }

  /** Number of leaf nodes at `depth`; used to validate move generation. */
  perft(depth) {
    if (depth === 0) return 1;
    const moves = this.generatePseudoLegal(false);
    let nodes = 0;
    for (const m of moves) {
      this.makeMove(m);
      if (!this.inCheck(this.turn ^ 1)) {
        nodes += depth === 1 ? 1 : this.perft(depth - 1);
      }
      this.undoMove();
    }
    return nodes;
  }

  perftDivide(depth) {
    const result = {};
    const moves = this.generatePseudoLegal(false);
    for (const m of moves) {
      this.makeMove(m);
      if (!this.inCheck(this.turn ^ 1)) {
        const key = moveToUci(m);
        result[key] = depth === 1 ? 1 : this.perft(depth - 1);
      }
      this.undoMove();
    }
    return result;
  }

  hasInsufficientMaterial() {
    const pieces = { [WHITE]: [], [BLACK]: [] };
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (!p) continue;
      const type = p & 7;
      if (type === KING) continue;
      pieces[p >> 3].push({ type, sq });
    }
    const all = [...pieces[WHITE], ...pieces[BLACK]];
    if (all.length === 0) return true;
    // A lone minor piece cannot force mate.
    if (all.length === 1) {
      return all[0].type === BISHOP || all[0].type === KNIGHT;
    }
    // Two bishops on the same colour complex is also a dead draw.
    if (all.length === 2 && all.every((p) => p.type === BISHOP)) {
      const colors = all.map((p) => ((p.sq >> 3) + (p.sq & 7)) & 1);
      if (colors[0] === colors[1]) return true;
    }
    return false;
  }

  /**
   * Game state for the side to move. `history` is a list of positionKey()
   * strings for every position reached so far (including the current one).
   */
  status(history = []) {
    const moves = this.legalMoves();
    const check = this.inCheck(this.turn);
    if (moves.length === 0) {
      return check
        ? { over: true, result: this.turn === WHITE ? 'black' : 'white', reason: 'checkmate' }
        : { over: true, result: 'draw', reason: 'stalemate' };
    }
    if (this.halfmove >= 100) {
      return { over: true, result: 'draw', reason: 'fifty-move rule' };
    }
    if (this.hasInsufficientMaterial()) {
      return { over: true, result: 'draw', reason: 'insufficient material' };
    }
    if (history.length) {
      const key = history[history.length - 1];
      let count = 0;
      for (const h of history) if (h === key) count++;
      if (count >= 3) {
        return { over: true, result: 'draw', reason: 'threefold repetition' };
      }
    }
    return { over: false, check, moves };
  }

  /** Standard Algebraic Notation for a legal move in the current position. */
  moveToSan(m) {
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const flags = (m >> 15) & 31;
    const piece = this.board[from];
    const type = piece & 7;

    if (flags & FLAG_CASTLE) {
      return to === from + 2 ? 'O-O' : 'O-O-O';
    }

    let san = '';
    if (type === PAWN) {
      if (flags & FLAG_CAPTURE) san += SQUARE_NAMES[from][0] + 'x';
      san += SQUARE_NAMES[to];
      if (promo) san += '=' + PIECE_CHARS[promo];
    } else {
      san += PIECE_CHARS[type];
      const legal = this.legalMoves();
      const sameTarget = legal.filter((o) => {
        if (o === m) return false;
        if (((o >> 6) & 63) !== to) return false;
        const op = this.board[o & 63];
        return op && (op & 7) === type && (op >> 3) === (piece >> 3);
      });
      if (sameTarget.length) {
        const sameFile = sameTarget.some((o) => ((o & 63) & 7) === (from & 7));
        const sameRank = sameTarget.some((o) => ((o & 63) >> 3) === (from >> 3));
        if (!sameFile) san += SQUARE_NAMES[from][0];
        else if (!sameRank) san += SQUARE_NAMES[from][1];
        else san += SQUARE_NAMES[from];
      }
      if (flags & FLAG_CAPTURE) san += 'x';
      san += SQUARE_NAMES[to];
    }

    this.makeMove(m);
    const opponentMoves = this.legalMoves();
    const opponentInCheck = this.inCheck(this.turn);
    this.undoMove();

    if (opponentInCheck) san += opponentMoves.length === 0 ? '#' : '+';
    return san;
  }

  /** Resolve a SAN string (with or without check/mate suffix) to a legal move. */
  sanToMove(san) {
    const cleaned = san.replace(/[+#]$/, '').replace(/[!?]+$/, '');
    for (const m of this.legalMoves()) {
      if (this.moveToSan(m) === cleaned || this.moveToSan(m).replace(/[+#]$/, '') === cleaned) {
        return m;
      }
    }
    // Accept long algebraic and coordinate forms as a convenience.
    const lower = cleaned.toLowerCase();
    for (const m of this.legalMoves()) {
      if (moveToUci(m) === lower) return m;
    }
    return null;
  }

  ascii() {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (!p) { row += '.'; continue; }
        const ch = PIECE_CHARS[p & 7];
        row += p >> 3 === WHITE ? ch : ch.toLowerCase();
      }
      rows.push(row);
    }
    return rows.join('\n');
  }
}

export { START_FEN };
export const ENGINE_START_FEN = START_FEN;
export const CASTLING = { CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ };
export { BISHOP_DELTAS, ROOK_DELTAS, KNIGHT_DELTAS, KING_DELTAS, ALL_DELTAS, SQUARE_NAMES };
