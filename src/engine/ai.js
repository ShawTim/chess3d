/**
 * Offline chess AI.
 *
 * Negamax with alpha-beta pruning, a transposition table, iterative deepening
 * and a quiescence search. Everything runs in-process with no network access of
 * any kind, so the whole app stays a static page.
 *
 * Search quality is governed by `SearchLimits`, which lets the difficulty tiers
 * trade thinking time for strength.
 */
import {
  Chess, moveFrom, moveTo, movePromo, moveFlags, moveToUci,
  isCapture, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  FLAG_EP, FLAG_PROMO, EMPTY,
} from './chess.js';
import {
  evaluate, evaluateForSideToMove, PIECE_VALUES, MATE_SCORE, MATE_THRESHOLD,
} from './evaluate.js';

const TT_EXACT = 0;
const TT_LOWER = 1;
const TT_UPPER = 2;
const TT_SIZE = 1 << 20;

/** History heuristic table: [color][from][to]. */
const historyTable = [
  new Int32Array(64 * 64),
  new Int32Array(64 * 64),
];
/** Killer moves, two per ply. */
const killerMoves = new Int32Array(128 * 2);

const MVV_LVA_VALUES = {
  [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 335, [ROOK]: 500, [QUEEN]: 950, [KING]: 20000,
};

// Simple, fast, deterministic PRNG for tie-breaking at equal scores.
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}
const rng = makeRng(0xc0ffee);

class TranspositionTable {
  constructor() {
    this.size = TT_SIZE;
    this.mask = TT_SIZE - 1;
    // Hashes are unsigned 32-bit values; storing them in an Int32Array would
    // truncate to a negative number so that the equality test against
    // game.hash never matched for hashes >= 2^31 (~half of all positions).
    this.keys = new Uint32Array(TT_SIZE);
    this.depth = new Int8Array(TT_SIZE);
    this.score = new Int32Array(TT_SIZE);
    this.flag = new Uint8Array(TT_SIZE);
    this.best = new Int32Array(TT_SIZE);
    this.used = new Uint8Array(TT_SIZE);
  }

  clear() {
    this.used.fill(0);
  }

  probe(hash, hashedLock) {
    const idx = hashedLock & this.mask;
    if (!this.used[idx] || this.keys[idx] !== hash) return null;
    return {
      depth: this.depth[idx],
      score: this.score[idx],
      flag: this.flag[idx],
      best: this.best[idx],
    };
  }

  store(hash, hashedLock, depth, score, flag, best) {
    const idx = hashedLock & this.mask;
    // Prefer deeper results, but always allow overwriting empty slots.
    if (this.used[idx] && this.keys[idx] === hash && this.depth[idx] > depth) return;
    if (this.used[idx] && this.keys[idx] !== hash && this.depth[idx] > depth + 2) return;
    this.keys[idx] = hash;
    this.depth[idx] = depth;
    this.score[idx] = score;
    this.flag[idx] = flag;
    this.best[idx] = best;
    this.used[idx] = 1;
  }

  /** Fill estimate, used to decide whether to keep iterating. */
  hashFull() {
    let n = 0;
    for (let i = 0; i < 1000; i++) if (this.used[i]) n++;
    return Math.round((n / 1000) * 1000);
  }
}

function hashedLock(hash) {
  return hash | 0;
}

/**
 * @typedef {object} SearchLimits
 * @property {number} [depth]        Maximum search depth in plies.
 * @property {number} [timeMs]       Soft wall-clock budget for the whole search.
 * @property {number} [randomness]   Centipawn noise added to root scores.
 * @property {number} [blunderRate]  Probability [0,1] of playing a sub-optimal move.
 */

export class Engine {
  constructor(limits = {}) {
    this.setLimits(limits);
    this.tt = new TranspositionTable();
    this.nodes = 0;
    this.startTime = 0;
    this.timeMs = 0;
    this.stop = false;
    this.abortChecked = 0;
    this.rootHistory = [];
  }

  setLimits(limits) {
    this.depthLimit = limits.depth ?? 3;
    this.timeLimit = limits.timeMs ?? 1000;
    this.randomness = limits.randomness ?? 0;
    this.blunderRate = limits.blunderRate ?? 0;
    return this;
  }

  reset() {
    this.tt.clear();
    for (const t of historyTable) t.fill(0);
    killerMoves.fill(0);
    this.nodes = 0;
    this.stop = false;
    this.abortChecked = 0;
  }

  timeUp() {
    // Date.now() is comparatively expensive, so only sample the clock once per
    // 2048 nodes. Between samples we simply replay the last verdict.
    if ((++this.abortChecked & 2047) !== 0) return this.stop;
    if (Date.now() - this.startTime >= this.timeMs) this.stop = true;
    return this.stop;
  }

  /**
   * Search the position and return the best move together with diagnostics.
   *
   * @param {Chess} game
   * @param {SearchLimits} [limits]
   * @returns {{move: number|null, score: number, depth: number, nodes: number, ms: number, pv: string[]}}
   */
  search(game, limits = {}) {
    this.setLimits({ ...(this.currentLimits ?? {}), ...limits });
    this.startTime = Date.now();
    this.timeMs = this.timeLimit;
    this.nodes = 0;
    this.stop = false;
    this.abortChecked = 0;

    const legal = game.legalMoves();
    if (!legal.length) {
      return { move: null, score: game.inCheck(game.turn) ? -MATE_SCORE : 0, depth: 0, nodes: 0, ms: 0, pv: [] };
    }
    if (legal.length === 1) {
      return { move: legal[0], score: 0, depth: 0, nodes: 1, ms: Date.now() - this.startTime, pv: [moveToUci(legal[0])] };
    }

    this.rootMoves = legal;
    let bestMove = null;
    let bestScore = 0;
    let completedDepth = 0;
    let pv = [];

    for (let depth = 1; depth <= this.depthLimit; depth++) {
      const result = this.searchRoot(game, depth);
      if (this.stop && depth > 1) break;
      // A mate found at any depth is final; keep it.
      if (result.move !== null) {
        bestMove = result.move;
        bestScore = result.score;
        pv = result.pv;
        completedDepth = depth;
      }
      if (Math.abs(bestScore) > MATE_THRESHOLD) break;
      if (Date.now() - this.startTime >= this.timeMs) break;
    }

    if (bestMove === null) bestMove = legal[0];

    if (this.blunderRate > 0 && Math.random() < this.blunderRate) {
      const alt = this.pickWeakerMove(game, legal);
      if (alt !== null && alt !== bestMove) bestMove = alt;
    }

    return {
      move: bestMove,
      score: bestScore,
      depth: completedDepth,
      nodes: this.nodes,
      ms: Date.now() - this.startTime,
      pv,
    };
  }

  /**
   * Choose a deliberately weaker move for low difficulty tiers, biased towards
   * moves that lose material or waste time without being instantly losing.
   */
  pickWeakerMove(game, legal) {
    const scored = [];
    for (const m of legal) {
      game.makeMove(m);
      const inCheckAfter = game.inCheck(game.turn);
      let s = -evaluate(game, { mobility: false });
      game.undoMove();
      if (inCheckAfter) s -= 40;
      scored.push({ m, s });
    }
    scored.sort((a, b) => b.s - a.s);
    // Pick from the bottom half of the list rather than the worst move outright,
    // so the AI still looks like it is playing chess.
    const poolStart = Math.max(1, Math.floor(scored.length / 2));
    const pool = scored.slice(poolStart);
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)].m;
  }

  searchRoot(game, depth) {
    const us = game.turn;
    let alpha = -Infinity;
    const beta = Infinity;
    let bestMove = null;
    let bestScore = -Infinity;
    let bestPv = [];

    const moves = this.orderMoves(game, this.rootMoves, 0, null);

    for (const m of moves) {
      game.makeMove(m);
      let score;
      if (this.isDrawByHalfmoveOrRepetition(game)) {
        score = 0;
      } else {
        score = -this.negamax(game, depth - 1, -beta, -alpha, 1);
      }
      game.undoMove();

      if (this.stop && depth > 1) break;

      if (this.randomness > 0) score += ((rng() / 0xffffffff) * 2 - 1) * this.randomness;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
      if (score > alpha) {
        alpha = score;
        bestPv = [moveToUci(m)];
      }
    }

    // Collect a nicer PV line by walking the transposition table.
    const line = this.extractPv(game, depth);
    if (line.length) bestPv = line;

    return { move: bestMove, score: bestScore, pv: bestPv };
  }

  extractPv(game, depth) {
    const line = [];
    const made = [];
    let d = depth;
    while (d-- > 0) {
      const entry = this.tt.probe(game.hash, hashedLock(game.hash));
      if (!entry || !entry.best) break;
      const legal = game.legalMoves();
      const move = legal.find((m) => m === entry.best);
      if (!move) break;
      line.push(moveToUci(move));
      game.makeMove(move);
      made.push(move);
      if (this.isDrawByHalfmoveOrRepetition(game)) break;
    }
    while (made.length) {
      game.undoMove();
      made.pop();
    }
    return line;
  }

  isDrawByHalfmoveOrRepetition(game) {
    if (game.halfmove >= 100) return true;
    return false;
  }

  negamax(game, depth, alpha, beta, ply) {
    this.nodes++;
    if (this.timeUp()) return alpha;

    if (ply > 0 && (game.halfmove >= 100 || game.hasInsufficientMaterial())) {
      return 0;
    }

    const alphaOrig = alpha;
    const key = hashedLock(game.hash);
    const entry = this.tt.probe(game.hash, key);
    let ttMove = 0;
    if (entry) {
      ttMove = entry.best;
      if (entry.depth >= depth) {
        if (entry.flag === TT_EXACT) return entry.score;
        if (entry.flag === TT_LOWER && entry.score > alpha) alpha = entry.score;
        else if (entry.flag === TT_UPPER && entry.score < beta) beta = entry.score;
        if (alpha >= beta) return entry.score;
      }
    }

    const inCheck = game.inCheck(game.turn);
    // Extend the search when in check so we do not stop mid-tactic.
    if (inCheck) depth = Math.max(depth, 1);

    if (depth <= 0) {
      return this.quiescence(game, alpha, beta, ply, 0);
    }

    const moves = this.orderMoves(game, game.generatePseudoLegal(false), ply, ttMove);

    let bestScore = -Infinity;
    let bestMove = 0;
    let legalCount = 0;

    for (const m of moves) {
      game.makeMove(m);
      if (game.inCheck(game.turn ^ 1)) {
        game.undoMove();
        continue;
      }
      legalCount++;
      const score = -this.negamax(game, depth - 1, -beta, -alpha, ply + 1);
      game.undoMove();

      if (this.stop) return bestScore > -Infinity ? bestScore : alpha;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
      if (score > alpha) {
        alpha = score;
      }
      if (alpha >= beta) {
        // Move ordering feedback: killers and history for quiet moves.
        if (!isCapture(m)) {
          const k = ply * 2;
          if (killerMoves[k] !== m) {
            killerMoves[k + 1] = killerMoves[k];
            killerMoves[k] = m;
          }
          historyTable[game.turn ^ 1][moveFrom(m) * 64 + moveTo(m)] += depth * depth;
        }
        break;
      }
    }

    if (legalCount === 0) {
      return inCheck ? -MATE_SCORE + ply : 0;
    }

    const flag = bestScore <= alphaOrig ? TT_UPPER
      : bestScore >= beta ? TT_LOWER
        : TT_EXACT;
    this.tt.store(game.hash, key, depth, bestScore, flag, bestMove);

    return bestScore;
  }

  /** Search only forcing moves past the nominal horizon to avoid tactical blindness. */
  quiescence(game, alpha, beta, ply, qdepth) {
    this.nodes++;
    if (this.timeUp()) return alpha;

    const standPat = evaluateForSideToMove(game, { mobility: false });
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qdepth >= 6) return alpha;

    const captures = this.orderMoves(game, game.generatePseudoLegal(true), ply, 0, true);
    for (const m of captures) {
      game.makeMove(m);
      if (game.inCheck(game.turn ^ 1)) {
        game.undoMove();
        continue;
      }
      const score = -this.quiescence(game, -beta, -alpha, ply + 1, qdepth + 1);
      game.undoMove();
      if (this.stop) return alpha;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  /**
   * Order moves by expected value: hash move, then captures by MVV-LVA, then
   * promotions, then killers, then history.
   */
  orderMoves(game, moves, ply, ttMove, capturing = false) {
    const board = game.board;
    const scored = [];
    for (const m of moves) {
      const from = moveFrom(m);
      const to = moveTo(m);
      const flags = moveFlags(m);
      let score = 0;

      if (ttMove && m === ttMove) {
        score += 1_000_000;
      }

      const victim = board[to];
      if (victim) {
        const attacker = board[from];
        score += 1_000_000 + (MVV_LVA_VALUES[victim & 7] * 10) - MVV_LVA_VALUES[attacker & 7];
      } else if (flags & FLAG_EP) {
        score += 1_000_000 + MVV_LVA_VALUES[PAWN] * 10 - MVV_LVA_VALUES[PAWN];
      }

      if (flags & FLAG_PROMO) {
        score += 900_000 + PIECE_VALUES[movePromo(m)] * 10;
      }

      if (!victim && !(flags & (FLAG_PROMO | FLAG_EP))) {
        if (killerMoves[ply * 2] === m) score += 800_000;
        else if (killerMoves[ply * 2 + 1] === m) score += 790_000;
        else {
          score += Math.min(600_000, historyTable[game.turn][from * 64 + to]);
        }
      }

      scored.push({ m, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.m);
  }
}

/**
 * Difficulty presets.
 *
 * Each tier pairs a search budget with a light touch of randomness so the
 * weaker bots feel human rather than merely shallow, while the top tiers play
 * at full strength.
 */
export const DIFFICULTIES = {
  beginner: {
    id: 'beginner',
    name: 'Beginner',
    elo: '~800',
    blurb: 'Sees one move ahead and misses simple tactics.',
    limits: { depth: 1, timeMs: 120, randomness: 90, blunderRate: 0.30 },
  },
  easy: {
    id: 'easy',
    name: 'Easy',
    elo: '~1100',
    blurb: 'Catches free pieces, still leaves some hanging.',
    limits: { depth: 2, timeMs: 250, randomness: 55, blunderRate: 0.16 },
  },
  intermediate: {
    id: 'intermediate',
    name: 'Intermediate',
    elo: '~1400',
    blurb: 'Solid club play with basic tactics.',
    limits: { depth: 3, timeMs: 600, randomness: 28, blunderRate: 0.07 },
  },
  advanced: {
    id: 'advanced',
    name: 'Advanced',
    elo: '~1700',
    blurb: 'Punishes mistakes and builds long plans.',
    limits: { depth: 5, timeMs: 1200, randomness: 12, blunderRate: 0.02 },
  },
  master: {
    id: 'master',
    name: 'Master',
    elo: '~2000',
    blurb: 'Deep tactical search. Expect no gifts.',
    limits: { depth: 7, timeMs: 2500, randomness: 4, blunderRate: 0.0 },
  },
  grandmaster: {
    id: 'grandmaster',
    name: 'Grandmaster',
    elo: '~2200+',
    blurb: 'Maximum strength. Punishes the slightest inaccuracy.',
    limits: { depth: 12, timeMs: 5000, randomness: 0, blunderRate: 0.0 },
  },
};

export const DEFAULT_DIFFICULTY = 'intermediate';

export function getDifficulty(id) {
  return DIFFICULTIES[id] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
}

/**
 * Convenience wrapper: pick a move for the position with the given difficulty.
 *
 * @param {string} fen
 * @param {string} difficultyId
 * @returns {{move: number|null, uci: string|null, score: number, depth: number, nodes: number, ms: number, pv: string[]}}
 */
export function findBestMove(fen, difficultyId = DEFAULT_DIFFICULTY, extra = {}) {
  const diff = getDifficulty(difficultyId);
  const engine = new Engine(diff.limits);
  const game = new Chess(fen);
  const result = engine.search(game, { ...diff.limits, ...extra });
  return {
    ...result,
    uci: result.move !== null ? moveToUci(result.move) : null,
  };
}
