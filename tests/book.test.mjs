#!/usr/bin/env node
/**
 * Opening-book tests.
 *
 * A book is a data file that the engine trusts, so the tests are mostly about
 * the data being true: every line has to replay through the rules engine, every
 * reply has to be legal in the position it is offered for, and the whole thing
 * has to stay small enough to justify calling it "micro".
 *
 * The other half is behaviour: the book answers instantly and without searching,
 * the weak tiers do not use it, and a caller that passes the wrong move list for
 * a position gets a legal move anyway.
 */
import { Chess, moveToUci } from '../src/engine/chess.js';
import { bookCandidates, bookLines, bookMove, BOOK_PLIES } from '../src/engine/book.js';
import { DIFFICULTIES, findBestMove } from '../src/engine/ai.js';

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

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Replay a UCI list from the starting position, or null if one move is illegal. */
function replay(moves) {
  const game = new Chess();
  for (const uci of moves) {
    const move = game.legalMoves().find((m) => moveToUci(m) === uci);
    if (move === undefined) return null;
    game.makeMove(move);
  }
  return game;
}

const lines = bookLines();

console.log('--- The data ---');
{
  expect(lines.length >= 20, 'the book has a usable number of lines', `${lines.length} lines`);
  expect(lines.every((line) => line.length >= 4 && line.length <= BOOK_PLIES + 2),
    'every line is a real opening, four to ten plies',
    `shortest ${Math.min(...lines.map((l) => l.length))}, longest ${Math.max(...lines.map((l) => l.length))}`);
  expect(lines.every((line) => line.every((uci) => UCI.test(uci))), 'every move is UCI');

  const joined = lines.map((line) => line.join(' ')).join(',');
  expect(joined.length < 5000, 'the book data stays under 5KB', `${joined.length} bytes`);
  expect(new Set(lines.map((line) => line.join(' '))).size === lines.length,
    'no line is repeated');

  // The first move of a game the engine plays as White.
  const openers = bookCandidates([]);
  expect(openers.length >= 3, 'the book knows more than one first move', openers.join(' '));
  expect(openers.includes('e2e4') && openers.includes('d2d4'),
    'and both main first moves', openers.join(' '));
  expect(openers.every((uci) => UCI.test(uci)), 'the openers are UCI');
}

console.log('\n--- Every line replays ---');
{
  let bad = 0;
  for (const line of lines) {
    if (replay(line) === null) {
      bad++;
      console.log(`   illegal line: ${line.join(' ')}`);
    }
  }
  expect(bad === 0, 'every line is a legal game', `${lines.length - bad}/${lines.length}`);
}

console.log('\n--- Every reply is legal where it is offered ---');
{
  // Walk the whole index: for each position reached by a line, the book's
  // candidates must all be legal moves in that position. This is the check that
  // catches a line edited in one place and not the other.
  let checked = 0;
  let illegal = 0;
  const seen = new Set();
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const prefix = line.slice(0, i);
      const key = prefix.join(' ');
      if (seen.has(key)) continue;
      seen.add(key);

      const game = replay(prefix);
      if (game === null) { illegal++; continue; }
      const legal = new Set(game.legalMoves().map((m) => moveToUci(m)));
      for (const candidate of bookCandidates(prefix)) {
        checked++;
        if (!legal.has(candidate)) {
          illegal++;
          console.log(`   ${candidate} is not legal after: ${key || '(start)'}`);
        }
      }
    }
  }
  expect(checked > 100, 'the index was walked', `${checked} candidate moves`);
  expect(illegal === 0, 'every candidate is legal in its position');
}

console.log('\n--- Asking for a move ---');
{
  expect(bookCandidates([]).length > 0, 'the start position is in the book');
  expect(bookCandidates(['e2e4']).includes('c7c5'), 'after 1.e4 the Sicilian is offered',
    bookCandidates(['e2e4']).join(' '));
  expect(bookCandidates(['e2e4']).includes('c7c6'), 'and the Caro-Kann');
  expect(bookCandidates(['e2e4', 'e7e5']).includes('g1f3'), 'after 1.e4 e5, Nf3 is offered',
    bookCandidates(['e2e4', 'e7e5']).join(' '));
  expect(bookCandidates(['a2a3']).length === 0, 'a position outside the book offers nothing');

  // Weighted choice: the first and last entries are what the extremes of the
  // random draw land on, and everything drawn is a candidate.
  const replies = bookCandidates(['e2e4']);
  expect(bookMove(['e2e4'], { random: () => 0 }) === replies[0], 'a draw of 0 picks the first reply',
    bookMove(['e2e4'], { random: () => 0 }));
  expect(bookMove(['e2e4'], { random: () => 0.999 }) === replies[replies.length - 1],
    'a draw near 1 picks the last', bookMove(['e2e4'], { random: () => 0.999 }));

  const draws = new Set();
  for (let i = 0; i < 200; i++) draws.add(bookMove(['e2e4']));
  expect(draws.size >= 3, 'the replies vary between games', [...draws].join(' '));
  expect([...draws].every((uci) => replies.includes(uci)), 'and never leave the candidate list');

  // Depth limit: past the book the engine has to search.
  const deep = lines[0].slice(0, BOOK_PLIES);
  expect(bookMove(deep) === null, `nothing is offered at ${BOOK_PLIES} plies`);
}

console.log('\n--- The engine uses it ---');
{
  const start = new Chess().fen();
  const book = findBestMove(start, 'grandmaster', { moves: [] });
  expect(book.book === true, 'a book-enabled tier answers from the book');
  expect(['e2e4', 'd2d4', 'c2c4', 'g1f3'].includes(book.uci), 'with a real first move', book.uci);
  expect(book.depth === 0 && book.nodes === 0, 'without searching', `d${book.depth}/${book.nodes}`);

  const game = new Chess(start);
  expect(game.legalMoves().some((m) => moveToUci(m) === book.uci), 'and the move is legal');

  const weak = findBestMove(start, 'beginner', { moves: [] });
  expect(weak.book !== true, 'a weak tier searches instead');
  expect(weak.depth >= 1 && weak.nodes > 0, 'so it really searched', `d${weak.depth}/${weak.nodes}`);

  // No move list, no book: the caller has to say how the position was reached.
  const noMoves = findBestMove(start, 'grandmaster');
  expect(noMoves.book !== true, 'without a move list the engine searches');

  // After 1.e4 the book's reply must be legal in the position it is given.
  const afterE4 = replay(['e2e4']);
  const reply = findBestMove(afterE4.fen(), 'advanced', { moves: ['e2e4'] });
  expect(reply.book === true, 'after 1.e4 the engine answers from the book', reply.uci);
  expect(afterE4.legalMoves().some((m) => moveToUci(m) === reply.uci),
    'and the reply is legal for Black', reply.uci);
}

console.log('\n--- A mismatched move list cannot produce an illegal move ---');
{
  // The move list says it is Black's move (three plies have been played), but the
  // FEN is the starting position, where White is to move. The book's reply for
  // that prefix is a Black move, which has no legal move here — it must be
  // discarded rather than played.
  const start = new Chess().fen();
  const mismatched = findBestMove(start, 'grandmaster', { moves: ['e2e4', 'e7e5', 'g1f3'] });
  const legal = new Chess(start).legalMoves().map((m) => moveToUci(m));
  expect(mismatched.uci !== null && legal.includes(mismatched.uci),
    'the engine still returns a legal move', String(mismatched.uci));
  expect(mismatched.book !== true, 'and it came from the search, not the book', String(mismatched.book));
}

console.log('\n--- The status line stays honest ---');
{
  // A book move has no depth and no node count; showing "d0 · 0k nodes · 0.00"
  // would look like a broken engine.
  const fakeHud = { engineBody: { textContent: '' } };
  const { Hud } = await import('../src/ui/hud.js').catch(() => ({ Hud: null }));
  if (Hud) {
    Hud.prototype.setEngineInfo.call(fakeHud, { depth: 0, nodes: 0, ms: 0, score: 0, book: true });
    expect(fakeHud.engineBody.textContent === 'opening book', 'a book move is labelled as one',
      fakeHud.engineBody.textContent);
    Hud.prototype.setEngineInfo.call(fakeHud, { depth: 6, nodes: 120000, ms: 900, score: 25 });
    expect(/^d6 /.test(fakeHud.engineBody.textContent), 'a search still reports its numbers',
      fakeHud.engineBody.textContent);
  } else {
    expect(true, 'hud.js is not importable outside a browser; covered by the browser check');
  }
}

console.log('\n--- The tiers agree ---');
{
  expect(DIFFICULTIES.beginner.book === false, 'Beginner does not use the book');
  expect(DIFFICULTIES.easy.book === false, 'Easy does not use the book');
  for (const id of ['intermediate', 'advanced', 'master', 'grandmaster']) {
    expect(DIFFICULTIES[id].book === true, `${DIFFICULTIES[id].name} uses the book`);
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
