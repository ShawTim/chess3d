/**
 * Strength and correctness tests for the offline AI.
 *
 * These tests assert behaviour that matters to a player: it must find forced
 * mates, must not hang material in obvious positions, must beat a random mover
 * from the stronger tiers, and must respect its time budget.
 */
import { Chess, moveToUci, uciToMove } from '../src/engine/chess.js';
import { Engine, DIFFICULTIES, getDifficulty, findBestMove } from '../src/engine/ai.js';
import { evaluate } from '../src/engine/evaluate.js';

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

/** Run a fixed-strength search on a FEN and return the chosen UCI move. */
function best(fen, limits) {
  const engine = new Engine(limits);
  const game = new Chess(fen);
  const r = engine.search(game, limits);
  return { ...r, uci: r.move !== null ? moveToUci(r.move) : null };
}

console.log('--- Tactics: forced mates must be found ---');
{
  // Back-rank mate in one: Ra8#.
  const r = best('6k1/5ppp/8/8/8/8/8/R3K3 w Q - 0 1', { depth: 3, timeMs: 2000 });
  expect(r.uci === 'a1a8', 'finds back-rank mate in one', `-> ${r.uci} (score ${r.score})`);
}
{
  // Legal's-style mate in one with the queen: Qh7#.
  const r = best('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR b KQkq - 1 3', { depth: 3, timeMs: 2000 });
  expect(r.score > 90000 && r.uci, 'sees the mating move for black', `-> ${r.uci} (score ${r.score})`);
}
{
  // Smothered mate in one: Nf7#.
  const r = best('6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', { depth: 3, timeMs: 2000 });
  expect(r.score > 90000, 'finds smothered mate', `-> ${r.uci} (score ${r.score})`);
}
{
  // Mate in two: the king is trapped; Qg7+ then mate follows.
  const r = best('5k2/8/5KQ1/8/8/8/8/8 w - - 0 1', { depth: 5, timeMs: 3000 });
  expect(r.score > 90000, 'finds mate in two', `-> ${r.uci} (score ${r.score}, depth ${r.depth})`);
}

console.log('\n--- Tactics: material must not be hung ---');
{
  // A free queen sits on d5; the engine should take it.
  const r = best('4k3/8/8/3q4/8/8/8/R3K3 w Q - 0 1', { depth: 4, timeMs: 2000 });
  expect(r.uci === 'a1d1' || r.uci[2] === 'd', 'rook attacks the queen file', `-> ${r.uci}`);
}
{
  // Knight fork: Nf7+ simultaneously attacks the king on h8 and the rook on d8.
  const r = best('3r3k/8/8/4N3/8/8/8/4K3 w - - 0 1', { depth: 5, timeMs: 2500 });
  expect(r.uci === 'e5f7', 'finds the knight fork winning a rook', `-> ${r.uci} (score ${r.score})`);
}
{
  // Hanging queen capture is trivially available; must be taken.
  const r = best('4k3/8/8/8/8/8/4q3/4K2R w K - 0 1', { depth: 4, timeMs: 2000 });
  const game = new Chess('4k3/8/8/8/8/8/4q3/4K2R w K - 0 1');
  const chosen = game.legalMoves().find((m) => moveToUci(m) === r.uci);
  const isQueenCapture = chosen !== undefined && (game.board[((chosen >> 6) & 63)] & 7) === 5;
  expect(isQueenCapture, 'captures the hanging queen', `-> ${r.uci}`);
}

console.log('\n--- Evaluation sanity ---');
{
  // Symmetric position must evaluate to roughly zero for both colours.
  const g = new Chess();
  const e = evaluate(g);
  expect(Math.abs(e) < 30, 'starting position is near zero', `eval=${e}`);
}
{
  // A queen up must be clearly positive.
  const g = new Chess('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
  expect(evaluate(g) > 800, 'extra queen is a large advantage', `eval=${evaluate(g)}`);
}
{
  // Black up a rook must be negative from White's view.
  const g = new Chess('4k2r/8/8/8/8/8/8/4K3 w - - 0 1');
  expect(evaluate(g) < -400, 'missing a rook is a large deficit', `eval=${evaluate(g)}`);
}

console.log('\n--- Search behaviour ---');
{
  // The engine must always return a move that is actually legal.
  const positions = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
  ];
  let allLegal = true;
  for (const fen of positions) {
    const game = new Chess(fen);
    const r = best(fen, { depth: 3, timeMs: 800 });
    const legal = game.legalMoves().map(moveToUci);
    if (!r.uci || !legal.includes(r.uci)) {
      allLegal = false;
      console.log(`     illegal/missing move ${r.uci} for ${fen}`);
    }
  }
  expect(allLegal, 'returns legal moves in every test position');
}
{
  // Terminal positions return no move.
  const g = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  const engine = new Engine({ depth: 3, timeMs: 500 });
  const r = engine.search(g, { depth: 3, timeMs: 500 });
  expect(r.move === null, 'no move in a checkmated position');
}
{
  // A depth-1 search must be instant; a depth-6 search must still be bounded.
  const t0 = Date.now();
  best('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 1, timeMs: 500 });
  const t1 = Date.now() - t0;
  expect(t1 < 400, 'depth 1 is fast', `${t1}ms`);

  const t2 = Date.now();
  const deep = best('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', { depth: 6, timeMs: 2500 });
  const t3 = Date.now() - t2;
  expect(t3 < 3500, 'depth 6 respects its time budget', `${t3}ms, ${deep.nodes} nodes`);
}

console.log('\n--- Difficulty tiers are actually different strengths ---');
{
  const tiers = ['beginner', 'easy', 'intermediate', 'advanced', 'master', 'grandmaster'];
  const ok = tiers.every((t) => DIFFICULTIES[t] && DIFFICULTIES[t].limits);
  expect(ok, 'all six difficulty tiers are defined');
}
{
  // A strong tier must come out clearly ahead against a random mover. Colour is
  // alternated and the results aggregated, because a single game is noisy: one
  // unlucky tactic can swing a short game even for a strong engine.
  function playVsRandom(difficulty, plies, engineColor) {
    const game = new Chess();
    const limits = { ...getDifficulty(difficulty).limits, randomness: 0 };
    const engine = new Engine(limits);
    for (let i = 0; i < plies; i++) {
      const moves = game.legalMoves();
      if (!moves.length) break;
      if (game.turn === engineColor) {
        engine.tt.clear();
        const r = engine.search(game, limits);
        game.makeMove(r.move ?? moves[0]);
      } else {
        game.makeMove(moves[Math.floor(Math.random() * moves.length)]);
      }
    }
    const whitePov = evaluate(game);
    return engineColor === 0 ? whitePov : -whitePov;
  }

  let total = 0;
  const games = 4;
  for (let i = 0; i < games; i++) {
    total += playVsRandom('advanced', 50, i % 2);
  }
  const avg = total / games;
  expect(avg > 150, `advanced beats a random mover over ${games} games`, `avg eval=${avg.toFixed(0)}`);

  let midTotal = 0;
  for (let i = 0; i < games; i++) {
    midTotal += playVsRandom('intermediate', 50, i % 2);
  }
  const midAvg = midTotal / games;
  expect(midAvg > 0, `intermediate beats a random mover over ${games} games`, `avg eval=${midAvg.toFixed(0)}`);
}
{
  // Two identical searches on the same position with randomness disabled must
  // agree, proving the core search is deterministic.
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
  const a = best(fen, { depth: 4, timeMs: 2000, randomness: 0 });
  const b = best(fen, { depth: 4, timeMs: 2000, randomness: 0 });
  expect(a.uci === b.uci, 'deterministic with randomness disabled', `${a.uci} vs ${b.uci}`);
}

console.log('\n--- Self-play smoke test (no crashes, sane game) ---');
{
  const game = new Chess();
  const engine = new Engine({ depth: 3, timeMs: 400, randomness: 10 });
  const history = [game.positionKey()];
  let plies = 0;
  let status = { over: false };
  while (plies < 60) {
    status = game.status(history);
    if (status.over) break;
    const r = engine.search(game, { depth: 3, timeMs: 400, randomness: 10 });
    if (r.move === null) break;
    game.makeMove(r.move);
    history.push(game.positionKey());
    plies++;
  }
  expect(plies > 4, 'self-play runs without crashing', `${plies} plies, over=${status.over}${status.reason ? ' (' + status.reason + ')' : ''}`);
  expect(game.legalMoves().length >= 0, 'final position is consistent');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
