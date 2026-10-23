#!/usr/bin/env node
/**
 * Share-link and PGN tests.
 *
 * A shared link has to hold three promises: the fragment alone carries the game
 * (nothing is sent to a server), a hand-edited or stale link can never put an
 * illegal board on screen, and the exported PGN is something another chess
 * program will accept. The address bar also has to track the game, because
 * "Copy link" is only ever the current URL.
 *
 * The controller runs against the same fakes as the auto-save suite, plus a fake
 * `urlSync` that records what the address bar was told.
 */
import { Chess, moveToUci } from '../src/engine/chess.js';
import { GameController, Phase } from '../src/game/controller.js';
import {
  buildShareUrl, encodeMoves, hashFor, parseMoves, resultTag, toPgn,
} from '../src/game/share.js';

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

/* ---------------------------------------------------------------- fakes -- */

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

/** A stand-in for the address bar: remembers the fragment and every write. */
function makeUrlSync(hash = '') {
  const state = { hash, writes: [] };
  return {
    state,
    read: () => state.hash,
    write: (fragment) => {
      state.hash = fragment ? `#${fragment}` : '';
      state.writes.push(fragment);
    },
  };
}

function makeHud() {
  const calls = { toasts: [], gameOver: [], status: [], review: [] };
  return {
    calls,
    buildDifficultyOptions() {},
    renderMoveList() {},
    renderCaptured() {},
    setStatus(main) { calls.status.push(main); },
    setThinking() {},
    setEngineInfo() {},
    setSelectionInfo() {},
    setDifficulty() {},
    setSide() {},
    setView() {},
    setControls() {},
    setReviewing(index) { calls.review.push(index); },
    showGameOver(opts) { calls.gameOver.push(opts); },
    hideGameOver() {},
    flashCheck() {},
    showToast(text) { calls.toasts.push(text); },
    showHint() {},
    showPromotion() {},
    hidePromotion() {},
  };
}

const makePieceViews = () => ({
  busy: false,
  rebuild() {},
  animateMove() { return Promise.resolve(); },
  setSelected() {},
  update() {},
});

const makeBoard = () => ({
  setSelection() {}, setLegalMoves() {}, setLastMove() {}, setCheck() {}, pulseCheck() {},
});

const makeAudio = () => ({
  playUi() {}, playMove() {}, playCapture() {}, playCastle() {}, playPromote() {},
  playCheck() {}, playIllegal() {}, playGameOver() {},
});

function makeController({ storage = null, urlSync = null } = {}) {
  const hud = makeHud();
  const controller = new GameController({
    rig: {},
    cameraRig: { goTo() {}, focusOn() {}, applyView() {} },
    pieceViews: makePieceViews(),
    board: makeBoard(),
    hud,
    audio: makeAudio(),
    storage,
    urlSync,
  });
  // Booting a worker needs a browser; the controller is what is under test.
  controller.spawnWorker = () => {
    controller.worker = { postMessage() {} };
    controller.workerReady = true;
  };
  return { controller, hud };
}

/** Play one UCI move through the real move pipeline. */
async function play(controller, uci) {
  const move = controller.game.legalMoves().find((m) => moveToUci(m) === uci);
  if (move === undefined) throw new Error(`illegal move in test: ${uci}`);
  await controller.applyMove(move);
}

/* --------------------------------------------------------------- module -- */

console.log('--- The fragment ---');
{
  expect(hashFor(['e2e4', 'e7e5']) === 'moves=e2e4,e7e5', 'a game becomes a fragment', hashFor(['e2e4', 'e7e5']));
  expect(hashFor([]) === '', 'an empty board leaves the URL clean', hashFor([]));
  expect(encodeMoves(['e2e4', 'e7e5', 'g1f3']) === 'e2e4,e7e5,g1f3', 'moves are comma separated');

  const round = parseMoves(`#${hashFor(['e2e4', 'e7e5', 'g1f3'])}`);
  expect(round?.join(' ') === 'e2e4 e7e5 g1f3', 'a fragment parses back', String(round));

  const bare = parseMoves('#e2e4,e7e5');
  expect(bare?.join(' ') === 'e2e4 e7e5', 'the bare form works too', String(bare));

  const sloppy = parseMoves('#moves=E2E4, e7e5 ,');
  expect(sloppy?.join(' ') === 'e2e4 e7e5', 'case, spaces and a trailing comma are tolerated', String(sloppy));

  const promo = parseMoves('#moves=e7e8q');
  expect(promo?.[0] === 'e7e8q', 'a promotion suffix survives');

  expect(parseMoves('#moves=e2e4,e4e8')?.length === 2, 'replay decides legality, not the parser');

  for (const [bad, label] of [
    ['', 'an empty fragment'],
    ['#', 'a bare hash'],
    ['#moves=', 'an empty value'],
    ['#moves=e2e4,zz9z', 'a nonsense square'],
    ['#moves=e4', 'a half move'],
    ['#moves=e2e4;e7e5', 'a semicolon instead of a comma'],
    ['#moves=<script>', 'markup'],
  ]) {
    expect(parseMoves(bad) === null, `${label} is rejected`, JSON.stringify(bad));
  }
  expect(parseMoves(null) === null, 'a non-string is rejected');
  expect(parseMoves(`#moves=${Array(1001).fill('e2e4').join(',')}`) === null, 'an absurdly long list is rejected');
}

console.log('\n--- Building a link ---');
{
  expect(buildShareUrl('https://shawt.im/chess3d/', ['e2e4', 'e7e5'])
    === 'https://shawt.im/chess3d/#moves=e2e4,e7e5', 'the fragment is appended',
    buildShareUrl('https://shawt.im/chess3d/', ['e2e4', 'e7e5']));
  expect(buildShareUrl('https://shawt.im/chess3d/#moves=e2e4', ['d2d4'])
    === 'https://shawt.im/chess3d/#moves=d2d4', 'an old fragment is replaced',
    buildShareUrl('https://shawt.im/chess3d/#moves=e2e4', ['d2d4']));
  expect(buildShareUrl('https://shawt.im/chess3d/?x=1#moves=e2e4', [])
    === 'https://shawt.im/chess3d/?x=1', 'a fresh board drops the fragment and keeps the query',
    buildShareUrl('https://shawt.im/chess3d/?x=1#moves=e2e4', []));
}

console.log('\n--- The result tag ---');
{
  expect(resultTag(null) === '*', 'no status is an unfinished game');
  expect(resultTag({ over: false, result: 'white' }) === '*', 'a live game is unfinished');
  expect(resultTag({ over: true, result: 'white' }) === '1-0', 'White wins reads 1-0');
  expect(resultTag({ over: true, result: 'black' }) === '0-1', 'Black wins reads 0-1');
  expect(resultTag({ over: true, result: 'draw' }) === '1/2-1/2', 'a draw reads 1/2-1/2');
}

console.log('\n--- The PGN ---');
{
  const moves = [
    { san: 'e4' }, { san: 'e5' }, { san: 'Nf3' }, { san: 'Nc6' }, { san: 'Bb5' },
  ];
  const pgn = toPgn(moves, {
    white: 'You',
    black: 'Chess3D (Master)',
    result: '1-0',
    site: 'https://shawt.im/chess3d/',
    date: new Date(2024, 2, 5),
  });
  const lines = pgn.split('\n');

  expect(/^\[Event "Chess3D"\]$/.test(lines[0]), 'the event tag comes first', lines[0]);
  for (const tag of [
    '[Site "https://shawt.im/chess3d/"]',
    '[Date "2024.03.05"]',
    '[Round "-"]',
    '[White "You"]',
    '[Black "Chess3D (Master)"]',
    '[Result "1-0"]',
  ]) {
    expect(lines.includes(tag), `the header carries ${tag.split(' ')[0].slice(1)}`, tag);
  }
  expect(lines[7] === '', 'blank line between headers and moves', JSON.stringify(lines[7]));

  const movetext = pgn.split('\n\n')[1].trim();
  expect(movetext === '1. e4 e5 2. Nf3 Nc6 3. Bb5 1-0', 'the movetext is numbered and ends in the result', movetext);
  expect(pgn.endsWith('\n'), 'the game ends with a newline');

  const unfinished = toPgn(moves.slice(0, 3), { date: new Date(2024, 0, 1) });
  expect(unfinished.includes('[Result "*"]') && unfinished.trimEnd().endsWith('2. Nf3 *'),
    'an unfinished game ends in *', unfinished.split('\n\n')[1]);

  const empty = toPgn([], { date: new Date(2024, 0, 1) });
  expect(empty.split('\n\n')[1] === '*\n', 'an empty game is headers and *', JSON.stringify(empty.split('\n\n')[1]));

  const quoted = toPgn([], { white: 'He said "hi"', date: new Date(2024, 0, 1) });
  expect(quoted.includes('[White "He said \\"hi\\""]'), 'quotes in a name are escaped',
    quoted.split('\n')[4]);

  // A real game is long enough to need wrapping, which is what other programs
  // are fussy about: PGN is a line-based format.
  const long = Array.from({ length: 80 }, (_, i) => ({ san: i % 2 ? 'Nf6' : 'Nf3' }));
  const wide = toPgn(long, { result: '1/2-1/2', date: new Date(2024, 0, 1) });
  const body = wide.split('\n\n')[1].split('\n');
  expect(body.length > 1, 'a long game wraps onto several lines', String(body.length));
  expect(body.every((line) => line.length <= 80), 'no line exceeds 80 columns',
    String(Math.max(...body.map((l) => l.length))));
  expect(wide.split('\n\n')[1].trimEnd().endsWith('1/2-1/2'), 'the wrapped game still ends in the result');
  // Wrapping must not lose or reorder anything: the tokens read the same joined.
  const unwrapped = body.join(' ');
  expect(/^1\. Nf3 Nf6 2\. Nf3 Nf6 /.test(unwrapped), 'the wrapped move numbers are intact',
    unwrapped.slice(0, 24));
}

/* ----------------------------------------------------------- controller -- */

console.log('\n--- A shared link opens its game ---');
{
  const urlSync = makeUrlSync('#moves=e2e4,e7e5,g1f3');
  const { controller, hud } = makeController({ urlSync });
  controller.init();

  const expected = new Chess();
  for (const uci of ['e2e4', 'e7e5', 'g1f3']) {
    expected.makeMove(expected.legalMoves().find((m) => moveToUci(m) === uci));
  }

  expect(controller.game.fen() === expected.fen(), 'the position is the linked one', controller.game.fen());
  expect(controller.moveList.map((m) => m.san).join(' ') === 'e4 e5 Nf3', 'the move list is rebuilt',
    controller.moveList.map((m) => m.san).join(' '));
  expect(typeof controller.moveList[1].fen === 'string'
    && controller.moveList[1].fen !== controller.moveList[0].fen,
  'each move keeps its own FEN for review', controller.moveList[1].fen);
  expect(controller.playerColor === 0, 'the link plays White', String(controller.playerColor));
  expect(controller.history.length === 4, 'the repetition history is rebuilt', String(controller.history.length));
  expect(controller.phase === Phase.AI_THINKING, 'it is Black (the engine) to move', controller.phase);
  expect(hud.calls.toasts.some((t) => /shared game/i.test(t)), 'the player is told what happened',
    hud.calls.toasts.join('|'));
  expect(urlSync.state.writes.at(-1) === 'moves=e2e4,e7e5,g1f3',
    'the address bar still points at the shared game', String(urlSync.state.writes.at(-1)));
}

console.log('\n--- A link beats the auto-save, and a bad link does not ---');
{
  const storage = makeStorage({
    'chess3d.game.v1': JSON.stringify({
      version: 1, playerColor: 1, difficulty: 'beginner', moves: ['d2d4'],
    }),
  });
  const urlSync = makeUrlSync('#moves=c2c4');
  const { controller } = makeController({ storage, urlSync });
  controller.init();
  expect(controller.moveList.map((m) => m.uci).join(' ') === 'c2c4', 'the link wins over the saved game',
    controller.moveList.map((m) => m.uci).join(' '));
  expect(controller.difficulty !== 'beginner', 'the saved difficulty is not taken with it', controller.difficulty);
}
{
  // e4 e5, then a move that cannot follow: the link must not reach the board.
  const urlSync = makeUrlSync('#moves=e2e4,e7e5,e4e4');
  const { controller } = makeController({ urlSync });
  controller.init();
  expect(controller.game.fen() === new Chess().fen(), 'an illegal link leaves the starting position',
    controller.game.fen());
  expect(controller.moveList.length === 0, 'and an empty move list');
  expect(controller.phase === Phase.PLAYER_TURN, 'the player can just start playing', controller.phase);
  expect(urlSync.state.hash === '', 'the broken fragment is dropped from the URL', JSON.stringify(urlSync.state.hash));
}
{
  const storage = makeStorage({
    'chess3d.game.v1': JSON.stringify({
      version: 1, playerColor: 0, difficulty: 'easy', moves: ['d2d4', 'd7d5'],
    }),
  });
  const urlSync = makeUrlSync('#moves=e2e4,e7e5,e4e4');
  const { controller } = makeController({ storage, urlSync });
  controller.init();
  expect(controller.moveList.map((m) => m.uci).join(' ') === 'd2d4 d7d5',
    'a bad link falls back to the saved game', controller.moveList.map((m) => m.uci).join(' '));
  expect(urlSync.state.hash === '#moves=d2d4,d7d5', 'and the URL is repointed at it', urlSync.state.hash);
}
{
  const urlSync = makeUrlSync('#something-else');
  const { controller } = makeController({ urlSync });
  controller.init();
  expect(controller.moveList.length === 0, 'an unrelated fragment is not a game');
  expect(urlSync.state.hash === '', 'and is cleared once the board is known', JSON.stringify(urlSync.state.hash));
}

console.log('\n--- The address bar follows the game ---');
{
  const urlSync = makeUrlSync();
  const { controller } = makeController({ urlSync });
  controller.init();
  expect(urlSync.state.writes.length === 1 && urlSync.state.writes[0] === '',
    'a fresh board writes an empty fragment once', JSON.stringify(urlSync.state.writes));

  await play(controller, 'e2e4');
  expect(urlSync.state.hash === '#moves=e2e4', 'a move is written to the URL', urlSync.state.hash);
  await play(controller, 'e7e5');
  expect(urlSync.state.hash === '#moves=e2e4,e7e5', 'the next move extends it', urlSync.state.hash);
  await play(controller, 'g1f3');
  expect(urlSync.state.hash === '#moves=e2e4,e7e5,g1f3', 'and the one after that', urlSync.state.hash);

  // The last move played was the player's own, so a single ply comes off: the URL
  // has to lose exactly that move, or a shared link reopens a position the player
  // is no longer looking at.
  controller.undo();
  expect(urlSync.state.hash === '#moves=e2e4,e7e5', 'undo rewrites the URL', urlSync.state.hash);

  controller.newGame();
  expect(urlSync.state.hash === '', 'a new game clears the fragment', JSON.stringify(urlSync.state.hash));
}
console.log('\n--- A pasted link is followed, a broken one is not ---');
{
  const urlSync = makeUrlSync();
  const { controller } = makeController({ urlSync });
  controller.init();
  await play(controller, 'e2e4');
  await play(controller, 'e7e5');

  // The player pastes another game's link into the address bar. Only the
  // fragment changes, so the page is not reloaded and the controller has to act.
  urlSync.state.hash = '#moves=d2d4,d7d5';
  expect(controller.adoptUrlHash() === true, 'the pasted link is followed');
  expect(controller.moveList.map((m) => m.uci).join(' ') === 'd2d4 d7d5',
    'the board switches to it', controller.moveList.map((m) => m.uci).join(' '));
  expect(urlSync.state.hash === '#moves=d2d4,d7d5', 'and the URL agrees', urlSync.state.hash);

  // Something unusable in the fragment must not cost the player their game.
  urlSync.state.hash = '#moves=e2e4,e4e4';
  expect(controller.adoptUrlHash() === false, 'an unusable link is refused');
  expect(controller.moveList.map((m) => m.uci).join(' ') === 'd2d4 d7d5',
    'the board is untouched', controller.moveList.map((m) => m.uci).join(' '));
  controller.writeUrl();
  expect(urlSync.state.hash === '#moves=d2d4,d7d5', 'and the URL is pointed back at it',
    urlSync.state.hash);
}

{
  // The boot code sets a difficulty before init(); a game that has not been
  // restored yet looks empty, and writing then would wipe the link being opened.
  const urlSync = makeUrlSync('#moves=e2e4');
  const { controller } = makeController({ urlSync });
  controller.setDifficulty('master');
  expect(urlSync.state.writes.length === 0, 'nothing is written before init()', JSON.stringify(urlSync.state.writes));
  controller.init();
  expect(controller.moveList.map((m) => m.uci).join(' ') === 'e2e4',
    'the link survived the pre-init difficulty change', controller.moveList.map((m) => m.uci).join(' '));
}

console.log('\n--- A link and the PGN agree ---');
{
  // Round trip: play a game, take the URL it publishes, open that URL, export.
  const urlSync = makeUrlSync();
  const { controller } = makeController({ urlSync });
  controller.init();
  await play(controller, 'e2e4');
  await play(controller, 'e7e5');
  await play(controller, 'g1f3');
  await play(controller, 'b8c6');

  const link = buildShareUrl('https://shawt.im/chess3d/', urlSync.state.writes.at(-1).replace(/^moves=/, '').split(','));
  const reopened = makeUrlSync(`#${new URL(link).hash.slice(1)}`);
  const { controller: revived } = makeController({ urlSync: reopened });
  revived.init();

  expect(revived.game.fen() === controller.game.fen(), 'the reopened link shows the same position',
    revived.game.fen());

  const pgn = toPgn(revived.moveList, {
    white: 'You',
    black: 'Chess3D (Intermediate)',
    result: resultTag(revived.game.status(revived.history)),
    site: 'https://shawt.im/chess3d/',
  });
  expect(pgn.includes('1. e4 e5 2. Nf3 Nc6 *'), 'the PGN of the reopened game is complete',
    pgn.split('\n\n')[1]);
  expect(pgn.includes('[Result "*"]'), 'an unfinished game exports as *');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
