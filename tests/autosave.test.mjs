#!/usr/bin/env node
/**
 * Auto-save tests.
 *
 * The promise of the feature is narrow: a game survives a reload, and nothing
 * else changes. That means an entry which no longer replays must never reach the
 * board, a game in progress must come back exactly (position, move list, side,
 * difficulty, whose turn it is), and every action that changes the game must
 * write the new state.
 *
 * The controller is driven through the same fakes the UX suite uses, so this runs
 * in plain Node.
 */
import { Chess, moveToUci } from '../src/engine/chess.js';
import { GameController, Phase } from '../src/game/controller.js';
import {
  AUTOSAVE_KEY, clearGame, loadGame, saveGame, usableStorage,
} from '../src/game/autosave.js';

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

/** A stand-in for localStorage that records what was written. */
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
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

function makeController(storage) {
  const hud = makeHud();
  const controller = new GameController({
    rig: {},
    cameraRig: { goTo() {}, focusOn() {}, applyView() {} },
    pieceViews: makePieceViews(),
    board: makeBoard(),
    hud,
    audio: makeAudio(),
    storage,
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

console.log('--- The stored entry ---');
{
  const storage = makeStorage();
  const wrote = saveGame(storage, { playerColor: 1, difficulty: 'advanced', moves: ['e2e4', 'e7e5'] });
  expect(wrote, 'saveGame writes');
  const back = loadGame(storage);
  expect(back?.playerColor === 1, 'the side comes back', String(back?.playerColor));
  expect(back?.difficulty === 'advanced', 'the difficulty comes back', String(back?.difficulty));
  expect(back?.moves.join(' ') === 'e2e4 e7e5', 'the moves come back', String(back?.moves));

  clearGame(storage);
  expect(storage.map.has(AUTOSAVE_KEY) === false, 'clearGame removes the entry');
  expect(loadGame(storage) === null, 'nothing left to load');
}
{
  const wrongVersion = makeStorage({
    [AUTOSAVE_KEY]: JSON.stringify({ version: 99, playerColor: 0, difficulty: 'easy', moves: [] }),
  });
  expect(loadGame(wrongVersion) === null, 'a different version is ignored');

  const corrupt = makeStorage({ [AUTOSAVE_KEY]: '{not json' });
  expect(loadGame(corrupt) === null, 'corrupt JSON is ignored');

  const badMoves = makeStorage({
    [AUTOSAVE_KEY]: JSON.stringify({ version: 1, playerColor: 0, difficulty: 'easy', moves: [7] }),
  });
  expect(loadGame(badMoves) === null, 'non-string moves are ignored');

  const noDifficulty = makeStorage({
    [AUTOSAVE_KEY]: JSON.stringify({ version: 1, playerColor: 0, moves: [] }),
  });
  expect(loadGame(noDifficulty) === null, 'a missing difficulty is ignored');
}
{
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('denied'); },
  };
  expect(usableStorage(broken) === null, 'storage that cannot be written is discarded');
  expect(saveGame(broken, { playerColor: 0, difficulty: 'easy', moves: [] }) === false,
    'saveGame swallows a quota error');
}

/* ----------------------------------------------------------- controller -- */

console.log('\n--- A game in progress comes back ---');
{
  const storage = makeStorage();
  const { controller } = makeController(storage);
  controller.init();
  controller.setDifficulty('advanced');
  await play(controller, 'e2e4');
  await play(controller, 'e7e5');
  await play(controller, 'g1f3');

  const fenAfter = controller.game.fen();
  const saved = loadGame(storage);
  expect(saved?.moves.join(' ') === 'e2e4 e7e5 g1f3', 'every move is written', String(saved?.moves));
  expect(saved?.difficulty === 'advanced', 'the chosen difficulty is written', String(saved?.difficulty));

  const { controller: revived, hud } = makeController(storage);
  revived.init();
  expect(revived.game.fen() === fenAfter, 'the position is identical', revived.game.fen());
  expect(revived.moveList.map((m) => m.san).join(' ') === 'e4 e5 Nf3',
    'the move list is rebuilt', revived.moveList.map((m) => m.san).join(' '));
  expect(revived.moveList[0].fen === controller.moveList[0].fen,
    'each move keeps its own FEN for review', revived.moveList[0].fen);
  expect(revived.difficulty === 'advanced', 'the difficulty is restored', revived.difficulty);
  expect(revived.playerColor === 0, 'the side is restored', String(revived.playerColor));
  expect(revived.phase === Phase.AI_THINKING, 'it is Black (the engine) to move', revived.phase);
  expect(revived.history.length === 4, 'the repetition history is rebuilt', String(revived.history.length));
  expect(hud.calls.toasts.some((t) => /Resumed/.test(t)), 'the player is told the game came back',
    hud.calls.toasts.join('|'));
}

console.log('\n--- A finished game comes back as finished ---');
{
  const storage = makeStorage();
  const { controller } = makeController(storage);
  controller.init();
  await play(controller, 'f2f3');
  await play(controller, 'e7e5');
  await play(controller, 'g2g4');
  await play(controller, 'd8h4');

  const { controller: revived, hud } = makeController(storage);
  revived.init();
  expect(revived.phase === Phase.GAME_OVER, 'the phase is game over', revived.phase);
  expect(hud.calls.gameOver.length > 0, 'the result panel is shown again');
  expect(/Black wins/.test(hud.calls.gameOver.at(-1)?.title ?? ''),
    'with the same result', JSON.stringify(hud.calls.gameOver.at(-1)));
}

console.log('\n--- A stale entry never reaches the board ---');
{
  const storage = makeStorage({
    [AUTOSAVE_KEY]: JSON.stringify({
      version: 1, playerColor: 0, difficulty: 'easy', moves: ['e2e4', 'e7e5', 'e4e8'],
    }),
  });
  const { controller } = makeController(storage);
  controller.init();
  expect(controller.game.fen() === new Chess().fen(), 'the board starts fresh',
    controller.game.fen());
  expect(controller.moveList.length === 0, 'the move list is empty');
  expect(storage.map.has(AUTOSAVE_KEY) === false, 'the unusable entry is discarded');
}

console.log('\n--- Undo and a new game update the save ---');
{
  const storage = makeStorage();
  const { controller } = makeController(storage);
  controller.init();
  await play(controller, 'e2e4');
  await play(controller, 'e7e5');
  await play(controller, 'g1f3');

  controller.undo();
  expect(loadGame(storage)?.moves.join(' ') === 'e2e4 e7e5', 'undo shortens the saved game',
    String(loadGame(storage)?.moves));

  controller.newGame();
  expect(loadGame(storage)?.moves.length === 0, 'a new game saves an empty board',
    String(loadGame(storage)?.moves));

  const { controller: revived } = makeController(storage);
  revived.init();
  expect(revived.game.fen() === new Chess().fen(), 'the reload shows the fresh board');
  expect(revived.phase === Phase.PLAYER_TURN, 'and waits for the player', revived.phase);
}
{
  // Taking Black must survive too: the board is empty, but the side is not.
  const storage = makeStorage();
  const { controller } = makeController(storage);
  controller.init();
  controller.setPlayerColor(1);
  const { controller: revived } = makeController(storage);
  revived.init();
  expect(revived.playerColor === 1, 'the side survives a reload', String(revived.playerColor));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
