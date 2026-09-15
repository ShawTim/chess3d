/**
 * AI worker.
 *
 * Runs the search off the main thread so the render loop never stutters while
 * the engine is thinking. This is a module worker that imports the engine
 * directly with relative paths — note that an import map declared in the page
 * does *not* apply inside a worker, so nothing here may import the bare
 * specifier `three`. The engine, evaluation and search have no three.js
 * dependency, which is what makes this possible and keeps the app offline.
 *
 * Protocol
 *   in : { id, type: 'search', fen, difficulty, history }
 *   out: { id, type: 'result', uci, score, depth, nodes, ms, pv, ponder }
 *        { id, type: 'error', message }
 *        { type: 'ready', version }
 */
import { Chess, moveToUci } from '../engine/chess.js';
import { Engine, getDifficulty } from '../engine/ai.js';

const VERSION = 3;

/**
 * Per-worker engine instance. The transposition table survives between moves in
 * a game, which measurably speeds up the opening and midgame because positions
 * recur across the search after transpositions.
 */
const engine = new Engine();

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'search') return;

  const { id, fen, difficulty, history = [], limits: overrides } = msg;

  try {
    const game = new Chess(fen);
    const diff = getDifficulty(difficulty);
    const limits = { ...diff.limits, ...(overrides ?? {}) };

    // Repetition awareness: a draw the opponent is steering into should be
    // scored as a draw, not as a winning line.
    const legal = game.legalMoves();
    if (legal.length === 0) {
      postMessage({ id, type: 'result', uci: null, score: game.inCheck(game.turn) ? -99999 : 0, depth: 0, nodes: 0, ms: 0, pv: [] });
      return;
    }

    // Filter out moves that would immediately repeat a position three times when
    // we are already better off, so the engine does not shuffle in a won game.
    const repetitionCounts = new Map();
    for (const key of history) repetitionCounts.set(key, (repetitionCounts.get(key) ?? 0) + 1);

    const result = engine.search(game, limits);

    let chosen = result.move;
    if (chosen === null) chosen = legal[0];

    // Repetition avoidance: in a clearly winning position, prefer a move that
    // does not allow the opponent to claim a threefold draw. If every move
    // repeats, the best move stands and the draw is accepted.
    if (result.score > 150) {
      const repeats = (m) => {
        game.makeMove(m);
        const key = game.positionKey();
        game.undoMove();
        return (repetitionCounts.get(key) ?? 0) >= 2;
      };
      if (repeats(chosen)) {
        const alternative = legal.find((m) => !repeats(m));
        if (alternative !== undefined) chosen = alternative;
      }
    }

    postMessage({
      id,
      type: 'result',
      uci: moveToUci(chosen),
      score: result.score,
      depth: result.depth,
      nodes: result.nodes,
      ms: result.ms,
      pv: result.pv,
    });
  } catch (err) {
    postMessage({ id, type: 'error', message: String(err && err.message ? err.message : err) });
  }
});

postMessage({ type: 'ready', version: VERSION });
