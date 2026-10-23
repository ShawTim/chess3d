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
 * @property {number} [randomness]   Centipawn tolerance when picking between root moves.
 * @property {number} [blunderRate]  Probability [0,1] of playing a sub-optimal move.
 */

export class Engine {
  constructor(limits = {}) {
    // Start from the documented defaults so `search()` can inherit them; merging
    // with `undefined` used to wipe the constructor's limits whenever a caller
    // passed a partial (or empty) limits object.
    this.depthLimit = 3;
    this.timeLimit = 1000;
    this.randomness = 0;
    this.blunderRate = 0;
    this.setLimits(limits);
    this.tt = new TranspositionTable();
    this.nodes = 0;
    this.startTime = 0;
    this.timeMs = 0;
    this.stop = false;
    this.abortChecked = 0;
    this.rootHistory = [];
    this.rootScores = null;
  }

  setLimits(limits) {
    this.depthLimit = limits.depth ?? this.depthLimit;
    this.timeLimit = limits.timeMs ?? this.timeLimit;
    this.randomness = limits.randomness ?? this.randomness;
    this.blunderRate = limits.blunderRate ?? this.blunderRate;
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
    this.setLimits(limits);
    this.startTime = Date.now();
    this.timeMs = this.timeLimit;
    this.nodes = 0;
    this.stop = false;
    this.abortChecked = 0;
    this.rootScores = null;

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
        this.rootScores = result.scores;
      }
      if (Math.abs(bestScore) > MATE_THRESHOLD) break;
      if (Date.now() - this.startTime >= this.timeMs) break;
    }

    if (bestMove === null) bestMove = legal[0];
    bestMove = this.chooseSkillMove(game, legal, bestMove);
    // The skill layer may prefer a different move than the search did, so keep
    // the reported line honest.
    if (pv.length && pv[0] !== moveToUci(bestMove)) pv = [moveToUci(bestMove)];

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
   * Apply the tier's skill settings to the finished search.
   *
   * `randomness` used to be added to the root scores *inside* the alpha-beta
   * loop, which was fatal: once `alpha` held the best score so far, every move
   * that failed low returned `alpha` as its value, so a move half a pawn worse
   * could be promoted by nothing more than a lucky noise sample. Tiers with more
   * candidate moves therefore picked worse moves more often, which is exactly
   * backwards. Instead the tolerance now only widens the *pool* of moves that are
   * considered equally playable, using the exact scores of the last completed
   * iteration.
   */
  chooseSkillMove(game, legal, bestMove) {
    if (this.blunderRate > 0 && Math.random() < this.blunderRate) {
      const alt = this.pickWeakerMove(game, legal);
      if (alt !== null && alt !== bestMove) return alt;
    }
    if (this.randomness <= 0 || !this.rootScores || this.rootScores.size === 0) return bestMove;

    let best = -Infinity;
    for (const score of this.rootScores.values()) if (score > best) best = score;
    if (!Number.isFinite(best)) return bestMove;

    const pool = [];
    for (const [move, score] of this.rootScores) {
      if (score >= best - this.randomness) pool.push(move);
    }
    if (!pool.length) return bestMove;
    return pool[Math.floor(Math.random() * pool.length)];
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
    let bestMove = null;
    let bestScore = -Infinity;
    let bestPv = [];
    /** Exact scores only; bounds never enter this map. */
    const scores = new Map();
    const failed = [];

    const moves = this.orderMoves(game, this.rootMoves, 0, null);
    let alpha = -Infinity;

    for (const m of moves) {
      game.makeMove(m);
      let score;
      if (this.isDrawByHalfmoveOrRepetition(game)) {
        score = 0;
      } else {
        // A move that beats `alpha` is searched without a lower bound, so the
        // value that comes back is exact. A move that fails low only returns the
        // bound, which is why bounds are never treated as scores any more.
        score = -this.negamax(game, depth - 1, -Infinity, -alpha, 1);
      }
      game.undoMove();

      if (this.stop && depth > 1) break;

      if (score > alpha) {
        alpha = score;
        bestScore = score;
        bestMove = m;
        scores.set(m, score);
      } else {
        failed.push({ move: m, bound: score });
      }
    }

    // The skill tolerance widens the pool of playable moves, but a failed-low
    // move only carries an upper bound. Re-search just the candidates whose bound
    // still overlaps the band, with a null window at `threshold`: anything above
    // it is inside the band and comes back exact, and anything at or below it
    // fails low immediately.
    if (this.randomness > 0 && !this.stop && bestMove !== null) {
      const threshold = bestScore - this.randomness;
      for (const { move, bound } of failed) {
        if (bound <= threshold) continue;
        game.makeMove(move);
        const score = this.isDrawByHalfmoveOrRepetition(game)
          ? 0
          : -this.negamax(game, depth - 1, -Infinity, -threshold, 1);
        game.undoMove();
        if (this.stop) break;
        if (score > threshold) scores.set(move, score);
      }
    }

    // Collect a nicer PV line by walking the transposition table, but only trust
    // it when it starts with the move we actually chose: a line that transposes
    // back to the root stores an entry under the root's hash, and reading that
    // one back would report a different first move.
    const line = this.extractPv(game, depth);
    if (bestMove === null) bestPv = line;
    else if (line.length && line[0] === moveToUci(bestMove)) bestPv = line;
    else bestPv = [moveToUci(bestMove)];

    return { move: bestMove, score: bestScore, pv: bestPv, scores };
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
