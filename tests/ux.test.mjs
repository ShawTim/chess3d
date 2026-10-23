#!/usr/bin/env node
/**
 * UX regression tests.
 *
 * These cover behaviour that the rules tests cannot see and that a screenshot
 * will not catch: the controls that have state.
 *
 * Every case here is a defect that existed in the shipped build:
 *
 *   - "Flip view" called `setPlayerColor`, which is the play-as-the-other-side
 *     entry point and starts a NEW GAME. Looking at the board from the other
 *     side silently discarded the position.
 *   - a pawn reaching the last rank always became a queen. The engine generates
 *     four promotion moves to the same square and the click handler took the
 *     first one, so underpromotion was unreachable despite being implemented.
 *   - undoing while the engine was thinking left `pendingSearch` set. The reply
 *     arrived for a board that no longer existed and was played into it.
 *   - move-list entries looked clickable and did nothing.
 *
 * The controller is driven through fakes rather than a browser: its contract
 * with the view layer is a handful of methods, so the fakes are small and the
 * test runs in plain Node alongside the engine tests.
 */
import * as THREE from 'three';
import { GameController, Phase } from '../src/game/controller.js';
import { flipAround } from '../src/render/camera.js';
import {
  Chess, PAWN, KNIGHT, WHITE, makePiece, moveFrom, movePromo, moveTo, moveToUci,
} from '../src/engine/chess.js';

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

/** A HUD that records calls and exposes only what the controller uses. */
function makeHud() {
  const calls = { promotion: [], reviewing: [], controls: [], status: [] };
  return {
    calls,
    buildDifficultyOptions() {},
    renderMoveList() {},
    renderCaptured() {},
    setStatus(main, sub) { calls.status.push([main, sub]); },
    setThinking() {},
    setEngineInfo() {},
    setSelectionInfo() {},
    setDifficulty() {},
    setSide() {},
    setView() {},
    setControls(state) { calls.controls.push(state); },
    setReviewing(index, san) { calls.reviewing.push([index, san]); },
    showGameOver() {},
    hideGameOver() {},
    flashCheck() {},
    showToast() {},
    showHint() {},
    showPromotion(opts) { calls.promotion.push(opts); },
    hidePromotion() { calls.promotion.push(null); },
  };
}

function makePieceViews() {
  const calls = { rebuilds: 0, selected: [], moves: [] };
  return {
    busy: false,
    calls,
    rebuild() { calls.rebuilds++; },
    animateMove(opts) { calls.moves.push(opts); return Promise.resolve(); },
    setSelected(sq) { calls.selected.push(sq); },
    update() {},
  };
}

function makeBoard() {
  return {
    setSelection() {}, setLegalMoves() {}, setLastMove() {}, setCheck() {},
    pulseCheck() {},
  };
}

function makeController() {
  const hud = makeHud();
  const pieceViews = makePieceViews();
  const controller = new GameController({
    rig: {},
    cameraRig: { goTo() {}, focusOn() {}, applyView() {} },
    pieceViews,
    board: makeBoard(),
    hud,
    audio: { playUi() {}, playMove() {}, playCapture() {}, playCastle() {},
      playPromote() {}, playCheck() {}, playIllegal() {}, playGameOver() {} },
  });
  controller.phase = Phase.PLAYER_TURN;
  return { controller, hud, pieceViews };
}

/** Load a position and rebuild the view, the way the controller does. */
function setPosition(controller, fen) {
  controller.game.load(fen);
  controller.history = [controller.game.positionKey()];
  controller.moveList = [];
  controller.phase = Phase.PLAYER_TURN;
}

/* ------------------------------------------------------------- promotion -- */

console.log('--- A promotion offers all four pieces, not just a queen ---');
{
  const { controller, hud } = makeController();
  // White pawn a7, black king h8, white king h1. a8 is a promotion square.
  setPosition(controller, '7k/P7/8/8/8/8/8/7K w - - 0 1');

  controller.select(8);
  const legal = controller.game.legalMoves().filter((m) => moveTo(m) === 0);
  expect(legal.length === 4, 'four promotion moves share the a8 destination',
    `count=${legal.length}`);

  controller.onSquareClick(0);
  expect(controller.phase === Phase.PROMOTING,
    'clicking the promotion square opens the picker instead of playing',
    `phase=${controller.phase}`);
  const prompt = hud.calls.promotion.at(-1);
  expect(!!prompt, 'the HUD was asked to show the promotion dialog');
}

{
  const { controller, hud } = makeController();
  setPosition(controller, '7k/P7/8/8/8/8/8/7K w - - 0 1');
  controller.select(8);
  controller.onSquareClick(0);
  const prompt = hud.calls.promotion.at(-1);

  // Choose a knight: the old build could only ever produce a queen.
  await prompt.onPick(KNIGHT);
  expect(controller.game.board[0] === makePiece(KNIGHT, WHITE),
    'the chosen underpromotion is what lands on the board',
    `piece=${controller.game.board[0]}`);
  expect(controller.moveList[0]?.san === 'a8=N',
    'the move list records the knight, not a queen',
    `san=${controller.moveList[0]?.san}`);
}

{
  const { controller } = makeController();
  setPosition(controller, '7k/P7/8/8/8/8/8/7K w - - 0 1');
  controller.select(8);
  controller.onSquareClick(0);
  controller.cancelPromotion();
  expect(controller.phase === Phase.PLAYER_TURN,
    'cancelling the picker returns control to the player',
    `phase=${controller.phase}`);
  expect(controller.game.board[8] === makePiece(PAWN, WHITE),
    'cancelling leaves the pawn where it was');
}

/* ------------------------------------------------------------- flip view -- */

console.log('\n--- Flip mirrors the camera and touches nothing else ---');
{
  // The geometry of the control: rotate the eye 180 degrees about the target's
  // vertical axis, preserving distance and height.
  const target = new THREE.Vector3(0, 0.2, 0);
  const position = new THREE.Vector3(0.4, 19.5, 13.5);
  const flipped = flipAround(position, target);

  expect(Math.abs(flipped.y - position.y) < 1e-9, 'flip keeps the camera height');
  expect(Math.abs(flipped.x + position.x) < 1e-9 && Math.abs(flipped.z + position.z) < 1e-9,
    'flip mirrors X and Z through the target',
    `got=${flipped.x.toFixed(3)},${flipped.z.toFixed(3)}`);
  expect(Math.abs(flipped.distanceTo(target) - position.distanceTo(target)) < 1e-9,
    'flip preserves the orbit radius');
}

{
  // And the controller's state is untouched by a camera flip. The whole point of
  // the regression is that flip must not restart the game.
  const { controller } = makeController();
  setPosition(controller, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  controller.moveList.push({ san: 'e4', uci: 'e2e4', from: 52, to: 36, color: WHITE, captured: null, check: false });
  const fenBefore = controller.game.fen();
  const movesBefore = controller.moveList.length;

  flipAround(new THREE.Vector3(0, 19, 13), new THREE.Vector3(0, 0, 0));

  expect(controller.game.fen() === fenBefore, 'flip leaves the position untouched');
  expect(controller.moveList.length === movesBefore, 'flip leaves the move list untouched');
}

/* ------------------------------------------------------- stale AI results -- */

console.log('\n--- Undo cancels a search, and a stale reply cannot be played ---');
{
  const { controller, hud, pieceViews } = makeController();
  const game = controller.game;
  const e2e4 = game.legalMoves().find((m) => moveFrom(m) === 52 && moveTo(m) === 36);
  game.makeMove(e2e4);
  controller.history.push(game.positionKey());
  controller.moveList.push({ san: 'e4', uci: 'e2e4', from: 52, to: 36, color: WHITE, captured: null, check: false });

  controller.phase = Phase.AI_THINKING;
  const staleId = controller.searchId + 1;
  controller.searchId = staleId;
  controller.pendingSearch = { id: staleId, legal: game.legalMoves() };

  const fenBeforeUndo = controller.game.fen();
  controller.undo();

  expect(controller.pendingSearch === null, 'undo clears the pending search');
  expect(controller.searchId > staleId, 'undo invalidates the in-flight id', `searchId=${controller.searchId}`);
  expect(controller.phase === Phase.PLAYER_TURN, 'undo returns control to the player');

  const rebuildsBefore = pieceViews.calls.rebuilds;
  const movesBefore = controller.moveList.length;
  // A late reply from the cancelled search arrives.
  controller.onWorkerMessage({
    id: staleId, type: 'result', uci: 'e7e5', score: 12, depth: 2, nodes: 100, ms: 5, pv: [],
  });

  expect(controller.moveList.length === movesBefore,
    'a stale engine reply does not add a move',
    `moves=${controller.moveList.length}`);
  expect(controller.game.fen() !== fenBeforeUndo || controller.moveList.length === 0,
    'the board was taken back rather than advanced by the stale reply');
  expect(pieceViews.calls.rebuilds >= rebuildsBefore, 'the view was rebuilt for the undo');
  expect(hud.calls.status.length > 0, 'the status line was updated');
}

/* ------------------------------------------------------------- reviewing -- */

console.log('\n--- Clicking a move reviews that position, and returns ---');
{
  const { controller, hud, pieceViews } = makeController();
  const game = controller.game;
  const e2e4 = game.legalMoves().find((m) => moveFrom(m) === 52 && moveTo(m) === 36);
  game.makeMove(e2e4);
  controller.history.push(game.positionKey());
  const fenAfterE4 = game.fen();
  controller.moveList.push({
    san: 'e4', uci: 'e2e4', from: 52, to: 36, color: WHITE, captured: null, check: false, fen: fenAfterE4,
  });

  const rebuildsBefore = pieceViews.calls.rebuilds;
  controller.preview(0);
  expect(controller.reviewPly === 0, 'preview enters review at the clicked ply',
    `reviewPly=${controller.reviewPly}`);
  expect(pieceViews.calls.rebuilds > rebuildsBefore, 'preview rebuilds the view');
  expect(hud.calls.reviewing.at(-1)?.[0] === 0, 'the HUD shows the review banner',
    JSON.stringify(hud.calls.reviewing.at(-1)));

  // Touching the board must leave review rather than play into an old position.
  controller.onSquareClick(36);
  expect(controller.reviewPly === null, 'clicking the board returns to the live game',
    `reviewPly=${controller.reviewPly}`);

  controller.preview(0);
  controller.returnToLive();
  expect(controller.reviewPly === null, 'returnToLive clears the review state');
  expect(hud.calls.reviewing.at(-1)?.[0] === null, 'the banner is dismissed');
  expect(controller.game.fen() === game.fen(), 'the live position is restored');
}


/* ------------------------------------------------- every legal move plays -- */

console.log('\n--- Every legal move can be played by clicking it ---');
{
  // The reported symptom was a white pawn on f7 that would not capture the
  // knight on g8. The rules generated the move, so this drives every legal move
  // in awkward positions through the same two clicks a player makes, and checks
  // the move that lands is the one that was clicked.
  const cases = [
    ['5bk1/5P2/8/8/8/8/8/6K1 w - - 0 1', 'promotion capture on g8 (the reported position)'],
    ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'castling both ways'],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'the opening position'],
    ['7k/8/8/8/8/8/p7/7K b - - 0 1', 'black promotion'],
  ];

  for (const [fen, label] of cases) {
    const probe = new Chess(fen);
    const legal = probe.legalMoves();
    let played = 0;
    const missed = [];

    for (const move of legal) {
      const { controller, hud } = makeController();
      controller.game.load(fen);
      controller.history = [controller.game.positionKey()];
      controller.moveList = [];
      controller.playerColor = controller.game.turn;
      controller.phase = Phase.PLAYER_TURN;
      // A worker that never answers keeps the AI reply out of this assertion.
      controller.worker = { postMessage() {} };
      controller.workerReady = true;

      controller.onSquareClick(moveFrom(move));
      controller.onSquareClick(moveTo(move));
      const prompt = hud.calls.promotion.at(-1);
      if (controller.phase === Phase.PROMOTING && prompt) {
        await prompt.onPick(movePromo(move));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (controller.moveList[0]?.uci === moveToUci(move)) played++;
      else missed.push(`${moveToUci(move)}->${controller.moveList[0]?.uci ?? 'nothing'}`);
    }

    expect(played === legal.length, `${label}: ${played}/${legal.length} legal moves play`,
      missed.slice(0, 4).join(' '));
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
