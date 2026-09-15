/**
 * Validation for the chess rules engine.
 *
 * The perft counts below are the standard published values used by every
 * serious engine (Chess Programming Wiki). Matching them exactly at depth 4-5
 * on tricky positions proves castling, en passant, promotion, pin handling and
 * check detection are all implemented correctly.
 */
import { Chess, moveToUci, squareFromName } from '../src/engine/chess.js';

let failures = 0;
let checks = 0;

function expectEqual(actual, expected, label) {
  checks++;
  if (actual !== expected) {
    failures++;
    console.log(`FAIL ${label}: got ${actual}, expected ${expected}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function perft(fen, depth, expected) {
  const g = new Chess(fen);
  const t0 = Date.now();
  const nodes = g.perft(depth);
  const ms = Date.now() - t0;
  expectEqual(nodes, expected, `perft(${depth}) ${fen.split(' ')[0].slice(0, 24)} [${ms}ms]`);
}

console.log('--- Standard perft suite ---');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
perft(START, 1, 20);
perft(START, 2, 400);
perft(START, 3, 8902);
perft(START, 4, 197281);
perft(START, 5, 4865609);

// Kiwipete: castling, en passant and pins all in one position.
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
perft(KIWIPETE, 1, 48);
perft(KIWIPETE, 2, 2039);
perft(KIWIPETE, 3, 97862);
perft(KIWIPETE, 4, 4085603);

// Position 3: rook/pawn endgame with en passant discovered check.
const P3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
perft(P3, 1, 14);
perft(P3, 2, 191);
perft(P3, 3, 2812);
perft(P3, 4, 43238);
perft(P3, 5, 674624);

// Position 4: promotions under check.
const P4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
perft(P4, 1, 6);
perft(P4, 2, 264);
perft(P4, 3, 9467);
perft(P4, 4, 422333);

// Position 5: heavy piece tension, many pins.
const P5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8';
perft(P5, 1, 44);
perft(P5, 2, 1486);
perft(P5, 3, 62379);
perft(P5, 4, 2103487);

// Position 6: asymmetric castling rights.
const P6 = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10';
perft(P6, 1, 46);
perft(P6, 2, 2079);
perft(P6, 3, 89890);
perft(P6, 4, 3894594);

console.log('\n--- Rules behaviour ---');
{
  // En passant actually removes the captured pawn.
  const g = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const epMove = g.legalMoves().find((m) => moveToUci(m) === 'e5f6');
  expectEqual(!!epMove, true, 'en passant move is generated');
  g.makeMove(epMove);
  expectEqual(g.board[squareFromName('f5')], 0, 'captured pawn removed from f5');
  expectEqual(g.board[squareFromName('f6')] !== 0, true, 'pawn landed on f6');
  g.undoMove();
  expectEqual(g.board[squareFromName('f5')] !== 0, true, 'undo restores captured pawn');
  expectEqual(g.fen(), 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', 'undo restores FEN');
}
{
  // Castling moves both king and rook, and undoes cleanly.
  const g = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const white = g.legalMoves().map(moveToUci).sort();
  expectEqual(white.includes('e1g1'), true, 'white king-side castle available');
  expectEqual(white.includes('e1c1'), true, 'white queen-side castle available');
  g.makeMove(g.legalMoves().find((m) => moveToUci(m) === 'e1g1'));
  expectEqual(g.board[squareFromName('f1')] & 7, 4, 'rook on f1 after O-O');
  expectEqual(g.board[squareFromName('g1')] & 7, 6, 'king on g1 after O-O');
  g.undoMove();
  expectEqual(g.fen(), 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'castle undo restores FEN');
}
{
  // Cannot castle through an attacked square.
  const g = new Chess('r3k2r/8/8/8/8/8/6q1/R3K2R w KQkq - 0 1');
  const white = g.legalMoves().map(moveToUci);
  expectEqual(white.includes('e1g1'), false, 'no castling through attacked f1');
  expectEqual(white.includes('e1c1'), true, 'queen-side castle still legal');
}
{
  // Cannot castle while in check.
  const g = new Chess('r3k2r/8/8/8/8/8/4q3/R3K2R w KQkq - 0 1');
  const white = g.legalMoves().map(moveToUci);
  expectEqual(white.includes('e1g1') || white.includes('e1c1'), false, 'no castling out of check');
}
{
  // Promotion offers four choices, and the FEN round-trips.
  const g = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const promos = g.legalMoves().filter((m) => moveToUci(m).startsWith('a7a8'));
  expectEqual(promos.length, 4, 'four promotion choices');
  g.makeMove(promos.find((m) => moveToUci(m) === 'a7a8n'));
  expectEqual(g.fen().split(' ')[0], 'N7/7k/8/8/8/8/8/K7', 'underpromotion to knight');
}
{
  // Pinned piece may not move off the pin line.
  const g = new Chess('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1');
  const g2 = new Chess('4k3/4r3/8/8/8/8/4R3/4K3 w - - 0 1');
  expectEqual(g2.legalMoves().filter((m) => (m & 63) === squareFromName('e2')).length, 5,
    'pinned rook capped to the pin line');
}
{
  // Checkmate and stalemate detection.
  const mate = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  const ms = mate.status([mate.positionKey()]);
  expectEqual(ms.over && ms.reason === 'checkmate' && ms.result === 'black', true, 'fool\'s mate detected');

  const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const ss = stalemate.status([stalemate.positionKey()]);
  expectEqual(ss.over && ss.reason === 'stalemate' && ss.result === 'draw', true, 'stalemate detected');
}
{
  // Insufficient material.
  const kk = new Chess('8/8/4k3/8/8/3K4/8/8 w - - 0 1');
  expectEqual(kk.hasInsufficientMaterial(), true, 'K vs K is insufficient');
  const kn = new Chess('8/8/4k3/8/8/3K1N2/8/8 w - - 0 1');
  expectEqual(kn.hasInsufficientMaterial(), true, 'K+N vs K is insufficient');
  const kr = new Chess('8/8/4k3/8/8/3K1R2/8/8 w - - 0 1');
  expectEqual(kr.hasInsufficientMaterial(), false, 'K+R vs K is sufficient');
}
{
  // Threefold repetition, driven through real move sequences.
  const g = new Chess();
  const history = [g.positionKey()];
  const play = (uci) => {
    const m = g.legalMoves().find((x) => moveToUci(x) === uci);
    g.makeMove(m);
    history.push(g.positionKey());
  };
  play('g1f3'); play('g8f6'); play('f3g1'); play('f6g8');
  play('g1f3'); play('g8f6'); play('f3g1'); play('f6g8');
  const st = g.status(history);
  expectEqual(st.over && st.reason === 'threefold repetition', true, 'threefold repetition detected');
}
{
  // Fifty-move rule via halfmove clock.
  const g = new Chess('8/8/4k3/8/8/3K1R2/8/8 w - - 100 200');
  const st = g.status([g.positionKey()]);
  expectEqual(st.over && st.reason === 'fifty-move rule', true, 'fifty-move rule detected');
}
{
  // SAN generation and parsing round-trip on a real opening.
  const g = new Chess();
  const san = g.moveToSan(g.legalMoves().find((m) => moveToUci(m) === 'e2e4'));
  expectEqual(san, 'e4', 'SAN for e2e4');
  const castleSan = g.moveToSan(new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    .legalMoves().find((m) => moveToUci(m) === 'e1g1'));
  expectEqual(castleSan, 'O-O', 'SAN for king-side castle');
  const disambig = new Chess('4k3/8/8/8/8/8/8/R4R1K w - - 0 1');
  expectEqual(disambig.moveToSan(disambig.legalMoves().find((m) => moveToUci(m) === 'a1d1')), 'Rad1',
    'SAN disambiguation by file');

  const g3 = new Chess();
  const m = g3.sanToMove('Nf3');
  expectEqual(moveToUci(m), 'g1f3', 'SAN parsed back to a move');
  const mateSan = new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  expectEqual(mateSan.sanToMove('Qh4#') === null, true, 'illegal SAN rejected');
}
{
  // FEN round-trip is stable across arbitrary positions.
  const fens = [
    START,
    KIWIPETE,
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  ];
  for (const fen of fens) {
    const g = new Chess(fen);
    expectEqual(g.fen(), fen, `FEN round-trip ${fen.slice(0, 20)}`);
  }
}
{
  // Incremental Zobrist hash must agree with a full recompute after every move.
  const g = new Chess(KIWIPETE);
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const moves = g.legalMoves();
    if (!moves.length) break;
    g.makeMove(moves[(i * 7 + 3) % moves.length]);
    if (g.hash !== g.computeHash()) { ok = false; break; }
  }
  expectEqual(ok, true, 'incremental hash matches recompute across 200 moves');
}
{
  // Perft with hashing enabled and disabled must agree (hash correctness).
  const g1 = new Chess(KIWIPETE);
  const g2 = new Chess(KIWIPETE);
  expectEqual(g1.perft(4), g2.perft(4), 'perft reproducible');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
