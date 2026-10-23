/**
 * Game controller.
 *
 * Owns the single source of truth (a `Chess` instance), the piece views, the AI
 * worker and the UI, and sequences everything the player sees: picking a piece,
 * previewing legal moves, animating a move, waiting for the engine, detecting
 * the end of the game.
 *
 * The controller is the only place that mutates game state. Views are pure
 * functions of that state, which keeps undo and new-game handling simple:
 * change the state, rebuild the views.
 */
import * as THREE from 'three';
import {
  Chess, WHITE, BLACK,
  moveFrom, moveTo, moveFlags, movePromo, moveToUci,
  pieceType, pieceColor, squareName, FLAG_CASTLE, FLAG_CAPTURE, FLAG_EP,
} from '../engine/chess.js';
import { DIFFICULTIES, getDifficulty, DEFAULT_DIFFICULTY } from '../engine/ai.js';
import { squareToWorld } from '../render/board.js';
import { clearGame, loadGame, saveGame } from './autosave.js';

/** Player-facing game phases. */
export const Phase = {
  IDLE: 'idle',
  PLAYER_TURN: 'player',
  ANIMATING: 'animating',
  AI_THINKING: 'thinking',
  PROMOTING: 'promoting',
  GAME_OVER: 'over',
};

/**
 * The parts of a move that the move list and the review need.
 *
 * Called BEFORE `game.makeMove`: the SAN and the captured piece belong to the
 * position before the move. The caller fills in `fen` once the move is made.
 */
function describeMove(game, move, san) {
  const from = moveFrom(move);
  const to = moveTo(move);
  const flags = moveFlags(move);
  const color = pieceColor(game.board[from]);
  const capturedSq = (flags & FLAG_EP) ? (color === WHITE ? to + 8 : to - 8) : to;
  const captured = (flags & FLAG_CAPTURE) ? game.board[capturedSq] : null;
  return {
    san,
    uci: moveToUci(move),
    from,
    to,
    color,
    captured: captured ?? null,
    check: san.includes('+') || san.includes('#'),
  };
}

export class GameController {
  constructor({ rig, cameraRig, pieceViews, board, hud, audio, storage = null }) {
    this.rig = rig;
    this.cameraRig = cameraRig;
    this.pieceViews = pieceViews;
    this.board = board;
    this.hud = hud;
    this.audio = audio;

    this.game = new Chess();
    this.history = [this.game.positionKey()];
    this.moveList = [];

    this.playerColor = WHITE;
    this.difficulty = DEFAULT_DIFFICULTY;
    this.phase = Phase.IDLE;
    this.selected = null;
    this.legalForSelected = [];
    this.lastMove = null;
    this.hintMove = null;

    // A promotion is a choice, not a default: the four candidate moves are held
    // here until the player picks a piece.
    this.promotion = null;

    /** Index into moveList while reviewing history, or null when live. */
    this.reviewPly = null;

    this.worker = null;
    this.workerReady = false;
    this.searchId = 0;
    this.pendingSearch = null;
    this.pendingHint = null;
    this.thinkTimer = 0;

    /** Where the auto-save lives, or null when storage is unavailable. */
    this.storage = storage;
    /** False until init() has settled, so boot cannot overwrite the save it reads. */
    this.ready = false;
  }

  /* ------------------------------------------------------------- lifecycle -- */

  init() {
    this.spawnWorker();
    if (this.restoreSavedGame()) {
      this.ready = true;
      this.updateControls();
      return;
    }
    this.pieceViews.rebuild(this.game);
    this.syncViews();
    this.hud.buildDifficultyOptions(DIFFICULTIES, this.difficulty);
    this.hud.renderMoveList(this.moveList);
    this.hud.renderCaptured([], []);
    this.hud.setStatus('Your move', 'Good luck');
    this.hud.setThinking(false);
    this.phase = Phase.PLAYER_TURN;
    this.ready = true;
    this.updateControls();
  }

  /**
   * Bring back the game that was on the board when the page was closed.
   *
   * The moves are replayed through the rules engine rather than trusting a
   * stored FEN: the engine is the only thing that can say whether a position is
   * reachable, and a replay also rebuilds the repetition history and the
   * per-move FENs the review needs. A move that no longer replays means the entry
   * is stale (an older build, a hand-edited value), so it is dropped and the
   * player gets a fresh board rather than a broken one.
   *
   * @returns {boolean} True when a saved game was restored.
   */
  restoreSavedGame() {
    const saved = loadGame(this.storage);
    if (!saved) return false;

    const game = new Chess();
    const history = [game.positionKey()];
    const moveList = [];
    for (const uci of saved.moves) {
      const move = game.legalMoves().find((m) => moveToUci(m) === uci);
      if (move === undefined) {
        clearGame(this.storage);
        return false;
      }
      const entry = describeMove(game, move, game.moveToSan(move));
      game.makeMove(move);
      history.push(game.positionKey());
      entry.fen = game.fen();
      moveList.push(entry);
    }

    this.game = game;
    this.history = history;
    this.moveList = moveList;
    this.playerColor = saved.playerColor;
    if (DIFFICULTIES[saved.difficulty]) this.difficulty = saved.difficulty;
    const last = moveList[moveList.length - 1];
    this.lastMove = last ? { from: last.from, to: last.to } : null;
    this.hintMove = null;
    this.selected = null;
    this.legalForSelected = [];
    this.reviewPly = null;
    this.promotion = null;

    this.board.setSelection(null);
    this.board.setLegalMoves([], this.game.board);
    this.pieceViews.rebuild(this.game);
    this.syncViews();
    this.hud.buildDifficultyOptions(DIFFICULTIES, this.difficulty);
    this.hud.setDifficulty(this.difficulty);
    this.hud.setSide(this.playerColor);
    this.hud.renderMoveList(this.moveList);
    this.updateCaptured();
    this.hud.setThinking(false);
    this.hud.setEngineInfo(null);
    this.hud.setSelectionInfo(null);

    const status = this.game.status(this.history);
    if (status.over) {
      this.phase = Phase.GAME_OVER;
      this.onGameOver(status);
    } else if (this.game.turn === this.playerColor) {
      this.phase = Phase.PLAYER_TURN;
      this.hud.setStatus('Your move', status.check ? 'You are in check' : this.difficultyLabel());
    } else {
      this.phase = Phase.AI_THINKING;
      this.hud.setStatus('Thinking', this.difficultyLabel());
      this.requestAiMove();
    }

    if (moveList.length) {
      this.hud.showToast?.(status.over ? 'Restored your finished game' : 'Resumed your last game');
    }
    return true;
  }

  /**
   * Write the game to storage, after every move, undo and new game.
   */
  saveState() {
    if (!this.ready || !this.storage) return;
    saveGame(this.storage, {
      playerColor: this.playerColor,
      difficulty: this.difficulty,
      moves: this.moveList.map((m) => m.uci),
    });
  }

  /**
   * Keep the toolbar honest.
   *
   * Undo and Hint used to stay lit in states where they could not do anything:
   * Hint while the AI was thinking, Undo on an untouched board. Clicking them
   * produced silence, which reads as a broken button. They are disabled now.
   */
  updateControls() {
    const canHint = this.phase === Phase.PLAYER_TURN
      && !this.pendingHint
      && this.reviewPly === null;
    const canUndo = this.moveList.length > 0
      && this.phase !== Phase.ANIMATING
      && !this.pieceViews.busy;
    this.hud.setControls?.({ canHint, canUndo });
  }

  spawnWorker() {
    try {
      this.worker = new Worker(new URL('../worker/aiWorker.js', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (e) => this.onWorkerMessage(e.data));
      this.worker.addEventListener('error', (e) => {
        console.error('[worker] error', e.message ?? e);
        this.workerReady = false;
        this.pendingSearch = null;
        this.hud.setThinking(false);
      });
    } catch (err) {
      console.warn('Worker unavailable; falling back to a synchronous search', err);
      this.worker = null;
    }
  }

  onWorkerMessage(msg) {
    if (!msg) return;
    if (msg.type === 'ready') { this.workerReady = true; return; }
    if (msg.type === 'error') {
      console.error('[worker]', msg.message);
      this.pendingSearch = null;
      this.hud.setThinking(false);
      return;
    }
    if (msg.type !== 'result') return;

    // A hint is a search result too, but it must never be played. Match it
    // against its own id first so a hint can never be mistaken for the AI move.
    if (this.pendingHint && msg.id === this.pendingHint.id) {
      const hint = this.pendingHint;
      this.pendingHint = null;
      this.hud.setThinking(false);
      this.hud.setEngineInfo({ depth: msg.depth, nodes: msg.nodes, ms: msg.ms, score: msg.score });
      const move = hint.legal.find((m) => moveToUci(m) === msg.uci);
      if (!move) return;
      this.hintMove = move;
      this.board.setSelection(moveFrom(move));
      this.board.setLegalMoves([move], this.game.board);
      this.pieceViews.setSelected(moveFrom(move));
      this.hud.showHint(this.game.moveToSan(move), msg.score);
      return;
    }

    if (!this.pendingSearch || msg.id !== this.pendingSearch.id) return;

    const pending = this.pendingSearch;
    this.pendingSearch = null;
    this.hud.setThinking(false);
    this.hud.setEngineInfo({ depth: msg.depth, nodes: msg.nodes, ms: msg.ms, score: msg.score });

    if (!msg.uci) { this.onGameOver(); return; }

    // The engine replies from a snapshot of the position it was given. If the
    // player undid, restarted or reviewed history while it was thinking, the
    // reply is for a board that no longer exists, and playing it would corrupt
    // the game. Validate against the current position instead of trusting it.
    if (this.phase !== Phase.AI_THINKING) return;
    const move = pending.legal.find((m) => moveToUci(m) === msg.uci)
      ?? this.game.legalMoves().find((m) => moveToUci(m) === msg.uci);
    if (!move) {
      console.warn('Engine returned an unusable move:', msg.uci);
      const fallback = this.game.legalMoves()[0];
      if (fallback !== undefined) this.applyMove(fallback);
      return;
    }
    this.applyMove(move);
  }

  /* ------------------------------------------------------------ user input -- */

  /**
   * Two-step click handling: the first click selects a piece of the player's
   * colour, the second plays a legal destination. Clicking the selected piece
   * again, or elsewhere with nothing selected, clears the selection. A two-step
   * pick is far more forgiving with a 3D pointer than drag-and-drop.
   */
  onSquareClick(square) {
    // Touching the board while reviewing history returns to the live game; it
    // must never play a move into a position the player is only inspecting.
    if (this.reviewPly !== null) { this.returnToLive(); return; }
    if (this.phase !== Phase.PLAYER_TURN) return;
    if (this.pieceViews.busy) return;

    const piece = this.game.board[square];
    const isOwn = piece && pieceColor(piece) === this.playerColor
      && this.game.turn === this.playerColor;

    if (this.selected === null) {
      if (isOwn) this.select(square);
      return;
    }

    if (square === this.selected) {
      this.clearSelection();
      return;
    }

    // A promotion produces FOUR legal moves that share a destination square. The
    // old code took the first match, which was always the queen, so the
    // underpromotions the rules describe could never actually be played. Hand a
    // real choice to the player instead.
    const candidates = this.legalForSelected.filter((m) => moveTo(m) === square);
    if (candidates.length > 1 && candidates.some((m) => movePromo(m))) {
      this.promptPromotion(candidates);
      return;
    }
    if (candidates.length) {
      this.playPlayerMove(candidates[0]);
      return;
    }

    if (isOwn) this.select(square);
    else {
      this.audio.playIllegal();
      this.clearSelection();
    }
  }

  /** Ask the player which piece to promote to. */
  promptPromotion(moves) {
    this.phase = Phase.PROMOTING;
    this.promotion = { moves, from: this.selected };
    this.audio.playUi();
    this.hud.showPromotion({
      color: this.playerColor,
      onPick: (type) => this.resolvePromotion(type),
      onCancel: () => this.cancelPromotion(),
    });
  }

  resolvePromotion(type) {
    const pending = this.promotion;
    this.promotion = null;
    this.hud.hidePromotion();
    if (!pending) return;
    const move = pending.moves.find((m) => movePromo(m) === type);
    this.phase = Phase.PLAYER_TURN;
    if (move) this.playPlayerMove(move);
    else this.clearSelection();
  }

  cancelPromotion() {
    this.promotion = null;
    this.hud.hidePromotion();
    if (this.phase === Phase.PROMOTING) this.phase = Phase.PLAYER_TURN;
    this.clearSelection();
  }

  select(square) {
    this.selected = square;
    this.legalForSelected = this.game.legalMoves().filter((m) => moveFrom(m) === square);
    this.board.setSelection(square);
    this.board.setLegalMoves(this.legalForSelected, this.game.board);
    this.pieceViews.setSelected(square);
    const piece = this.game.board[square];
    this.hud.setSelectionInfo({
      square: squareName(square),
      piece,
      moves: this.legalForSelected.map(moveToUci),
    });
    this.audio.playUi();
  }

  clearSelection() {
    this.selected = null;
    this.legalForSelected = [];
    this.board.setSelection(null);
    this.board.setLegalMoves([], this.game.board);
    this.pieceViews.setSelected(null);
    this.hud.setSelectionInfo(null);
  }

  playPlayerMove(move) {
    this.clearSelection();
    this.applyMove(move);
  }

  /* ----------------------------------------------------------- move making -- */

  /**
   * Play a move: update the model, animate the views, then hand over to the AI.
   * Everything after the animation runs from the promise so the phases stay
   * strictly ordered and no stale callback can fire into a finished game.
   */
  async applyMove(move) {
    if (this.phase === Phase.GAME_OVER) return;

    const from = moveFrom(move);
    const to = moveTo(move);
    const flags = moveFlags(move);
    const promo = movePromo(move);
    const movingPiece = this.game.board[from];
    const type = pieceType(movingPiece);
    const color = pieceColor(movingPiece);
    const isCastle = (flags & FLAG_CASTLE) !== 0;
    const isCapture = (flags & FLAG_CAPTURE) !== 0;
    const isEp = (flags & FLAG_EP) !== 0;
    const capturedSq = isEp ? (color === WHITE ? to + 8 : to - 8) : to;
    const capturedPiece = this.game.board[capturedSq];

    // SAN and the capture list must be read before the model is mutated.
    const san = this.game.moveToSan(move);
    const entry = describeMove(this.game, move, san);

    this.phase = Phase.ANIMATING;
    this.clearSelection();

    this.game.makeMove(move);
    this.history.push(this.game.positionKey());

    const castleRook = isCastle ? this.castleRookSquares(color, to) : null;

    if (isCapture && capturedPiece) this.audio.playCapture();
    else if (isCastle) this.audio.playCastle();
    else if (promo) this.audio.playPromote();
    else this.audio.playMove();

    const animPromise = this.pieceViews.animateMove({
      from, to, type, color,
      capture: isCapture && !!capturedPiece,
      capturedSq: isCapture && capturedPiece ? capturedSq : null,
      castle: isCastle,
      rookFrom: castleRook ? castleRook.from : undefined,
      rookTo: castleRook ? castleRook.to : undefined,
      promoType: promo || null,
    });

    this.lastMove = { from, to };
    this.board.setLastMove(from, to);
    this.hintMove = null;

    // Stored so the move list can show the position after any move without
    // replaying the whole game.
    this.moveList.push({ ...entry, fen: this.game.fen() });
    this.hud.renderMoveList(this.moveList);
    this.updateCaptured();
    // Persist immediately: a reload during the animation must not lose the move.
    this.saveState();

    await animPromise;

    const status = this.game.status(this.history);
    if (status.over) {
      await this.onGameOver(status);
      return;
    }
    if (status.check) {
      this.audio.playCheck();
      this.board.setCheck(this.game.kingSq[this.game.turn]);
      this.hud.flashCheck();
    } else {
      this.board.setCheck(null);
    }

    if (this.game.turn === this.playerColor) {
      this.phase = Phase.PLAYER_TURN;
      this.hud.setStatus('Your move', status.check ? 'You are in check' : this.difficultyLabel());
    } else {
      this.phase = Phase.AI_THINKING;
      this.hud.setStatus('Thinking', this.difficultyLabel());
      this.requestAiMove();
    }
    this.updateControls();
  }

  castleRookSquares(color, kingTo) {
    const rank = color === WHITE ? 56 : 0;
    if (kingTo === rank + 6) return { from: rank + 7, to: rank + 5 };
    return { from: rank + 0, to: rank + 3 };
  }

  requestAiMove() {
    const legal = this.game.legalMoves();
    if (!legal.length) { this.onGameOver(); return; }

    // A short, human-feeling pause before the engine starts, so instant replies
    // on easy levels do not feel robotic.
    const minThink = 160 + Math.random() * 220;

    setTimeout(() => {
      if (this.phase !== Phase.AI_THINKING) return;
      this.hud.setThinking(true, 0);

      this.searchId++;
      const id = this.searchId;
      this.pendingSearch = { id, legal };

      if (this.worker && this.workerReady) {
        this.worker.postMessage({
          id,
          type: 'search',
          fen: this.game.fen(),
          difficulty: this.difficulty,
          history: this.history,
        });
      } else {
        // Synchronous fallback: search on the main thread so the game stays
        // playable even where module workers are unavailable.
        import('../engine/ai.js')
          .then(({ findBestMove }) => {
            if (!this.pendingSearch || this.pendingSearch.id !== id) return;
            const res = findBestMove(this.game.fen(), this.difficulty);
            this.onWorkerMessage({ id, type: 'result', uci: res.uci, score: res.score, depth: res.depth, nodes: res.nodes, ms: res.ms, pv: res.pv });
          })
          .catch((err) => {
            console.error('Search failed', err);
            this.pendingSearch = null;
            this.hud.setThinking(false);
            if (this.phase === Phase.AI_THINKING) this.applyMove(legal[0]);
          });
      }
    }, minThink);
  }

  /* ---------------------------------------------------------------- status -- */

  async onGameOver(status = null) {
    this.phase = Phase.GAME_OVER;
    this.hud.setThinking(false);
    const st = status ?? this.game.status(this.history);

    let title = 'Draw';
    let detail = 'Drawn position';
    let won = null;

    if (st.result === 'white' || st.result === 'black') {
      const winner = st.result === 'white' ? WHITE : BLACK;
      title = st.result === 'white' ? 'White wins' : 'Black wins';
      detail = st.reason === 'checkmate' ? 'Checkmate'
        : st.reason.charAt(0).toUpperCase() + st.reason.slice(1);
      won = winner === this.playerColor;
    } else if (st.reason) {
      detail = st.reason.charAt(0).toUpperCase() + st.reason.slice(1);
    }

    this.hud.setStatus(title, detail);
    this.hud.showGameOver({ title, detail, won });
    this.audio.playGameOver(won === true);

    // Frame the finish by easing in on the mated king.
    if (st.result === 'white' || st.result === 'black') {
      const loser = st.result === 'white' ? BLACK : WHITE;
      const p = squareToWorld(this.game.kingSq[loser], 0, new THREE.Vector3());
      this.cameraRig.focusOn(p, { zoom: 0.58, duration: 1.0, hold: 0.6 });
    }
  }

  /* ------------------------------------------------------------------- undo -- */

  undo() {
    if (this.phase === Phase.ANIMATING || this.pieceViews.busy) return;
    if (this.phase === Phase.PROMOTING) this.cancelPromotion();
    if (!this.moveList.length) return;

    // Anything the engine is still computing refers to the position being taken
    // back. Cancel it first, or its reply lands on the restored board later.
    this.cancelSearches();
    this.exitReview();
    // Undo back to the player's turn. When the last move played was the
    // opponent's, its reply is taken back along with the player's own move;
    // otherwise a single ply is enough.
    const last = this.moveList[this.moveList.length - 1];
    const plies = (last && last.color !== this.playerColor && this.moveList.length >= 2) ? 2 : 1;

    for (let i = 0; i < plies; i++) {
      if (!this.moveList.length) break;
      this.game.undoMove();
      this.moveList.pop();
      if (this.history.length > 1) this.history.pop();
    }

    this.phase = Phase.PLAYER_TURN;
    this.lastMove = this.moveList.length
      ? { from: this.moveList[this.moveList.length - 1].from, to: this.moveList[this.moveList.length - 1].to }
      : null;
    this.hintMove = null;

    this.board.setLastMove(this.lastMove ? this.lastMove.from : null, this.lastMove ? this.lastMove.to : null);
    this.board.setCheck(this.game.inCheck(this.game.turn) ? this.game.kingSq[this.game.turn] : null);
    this.clearSelection();
    this.pieceViews.rebuild(this.game);
    this.hud.renderMoveList(this.moveList);
    this.updateCaptured();
    this.hud.setStatus('Your move', 'Move taken back');
    this.hud.hideGameOver();
    this.hud.setEngineInfo(null);
    this.audio.playUi();
    this.saveState();
    this.updateControls();
  }

  /* -------------------------------------------------------------- new game -- */

  newGame({ playerColor = this.playerColor, difficulty = this.difficulty } = {}) {
    this.cancelSearches();
    this.exitReview();
    if (this.phase === Phase.PROMOTING) {
      this.promotion = null;
      this.hud.hidePromotion();
    }
    this.playerColor = playerColor;
    this.difficulty = difficulty;
    this.game = new Chess();
    this.history = [this.game.positionKey()];
    this.moveList = [];
    this.lastMove = null;
    this.hintMove = null;
    this.selected = null;
    this.legalForSelected = [];
    this.phase = Phase.PLAYER_TURN;

    this.board.setLastMove(null, null);
    this.board.setCheck(null);
    this.board.setSelection(null);
    this.board.setLegalMoves([], this.game.board);
    this.pieceViews.rebuild(this.game);
    this.hud.renderMoveList(this.moveList);
    this.hud.renderCaptured([], []);
    this.hud.setSelectionInfo(null);
    this.hud.setEngineInfo(null);
    this.hud.hideGameOver();
    this.hud.setDifficulty(difficulty);
    this.hud.setStatus('Your move', this.difficultyLabel());
    this.updateControls();

    this.cameraRig.goTo(playerColor === WHITE ? 'white' : 'black', 1.2);

    // When the player takes Black the engine has the first move, so the phase
    // has to be advanced before the search is requested.
    if (this.game.turn !== this.playerColor) {
      this.phase = Phase.AI_THINKING;
      this.hud.setStatus('Thinking', this.difficultyLabel());
      this.requestAiMove();
    }
    this.saveState();
  }

  setPlayerColor(color) {
    this.newGame({ playerColor: color, difficulty: this.difficulty });
  }

  setDifficulty(id) {
    this.difficulty = id;
    this.hud.setDifficulty(id);
    this.hud.setEngineInfo(null);
    if (this.phase === Phase.PLAYER_TURN) this.hud.setStatus('Your move', this.difficultyLabel());
    this.saveState();
  }
  /**
   * Suggest a move for the player.
   *
   * This used to call `findBestMove` synchronously on the main thread with a
   * 1.2-second budget, which froze the render loop for the whole search — the
   * camera stuttered and the board stopped responding while "thinking". It now
   * runs in the same worker as the opponent, on a stronger setting, so the hint
   * is genuinely good and the scene keeps animating.
   */
  async hint() {
    if (this.phase !== Phase.PLAYER_TURN || this.pieceViews.busy) return;
    if (this.pendingHint) return;
    const legal = this.game.legalMoves();
    if (!legal.length) return;

    this.hud.setThinking(true);
    this.cancelSearches({ keepThinking: true });
    this.searchId++;
    const id = this.searchId;
    this.pendingHint = { id, legal };

    if (this.worker && this.workerReady) {
      this.worker.postMessage({
        id,
        type: 'search',
        fen: this.game.fen(),
        difficulty: 'advanced',
        history: this.history,
      });
      return;
    }

    // Fallback: no worker (very old browser). Compute it inline, but on the next
    // macrotask so the spinner paints first.
    const { findBestMove } = await import('../engine/ai.js');
    await new Promise((r) => setTimeout(r, 20));
    const res = findBestMove(this.game.fen(), 'advanced');
    this.pendingHint = null;
    this.hud.setThinking(false);
    const move = legal.find((m) => moveToUci(m) === res.uci);
    if (!move) return;
    this.hintMove = move;
    this.board.setSelection(moveFrom(move));
    this.board.setLegalMoves([move], this.game.board);
    this.pieceViews.setSelected(moveFrom(move));
    this.hud.showHint(this.game.moveToSan(move), res.score);
  }

  /** Drop any search in flight; its reply would be for a stale position. */
  cancelSearches({ keepThinking = false } = {}) {
    this.pendingHint = null;
    if (this.pendingSearch) {
      this.pendingSearch = null;
      this.searchId++;
    }
    if (!keepThinking) this.hud.setThinking(false);
  }

  /* ---------------------------------------------------------------- review -- */

  /**
   * Show the position after move `index` in the move list.
   *
   * The move list items look clickable, and previously clicking one did nothing
   * at all — a dead affordance. Each entry now stores the FEN it produced, so a
   * click can rebuild the pieces at that point without replaying the game.
   */
  preview(index) {
    if (this.pieceViews.busy) return;
    if (this.phase === Phase.ANIMATING) return;
    const entry = this.moveList[index];
    if (!entry || !entry.fen) return;
    if (this.reviewPly === index) { this.returnToLive(); return; }

    this.reviewPly = index;
    const game = new Chess(entry.fen);
    this.pieceViews.rebuild(game);
    this.board.setSelection(null);
    this.board.setLegalMoves([], game.board);
    this.board.setLastMove(entry.from, entry.to);
    this.board.setCheck(game.inCheck(game.turn) ? game.kingSq[game.turn] : null);
    this.hud.setSelectionInfo(null);
    this.hud.setReviewing(index, entry.san);
  }

  /** Leave review and restore the live position. */
  returnToLive() {
    if (this.reviewPly === null) return;
    this.reviewPly = null;
    this.hud.setReviewing(null);
    this.pieceViews.rebuild(this.game);
    this.clearSelection();
    this.syncViews();
  }

  /** Internal: clear review state without rebuilding the live position. */
  exitReview() {
    this.reviewPly = null;
    this.hud.setReviewing(null);
  }

  /* ------------------------------------------------------------------ views -- */

  syncViews() {
    this.board.setLastMove(this.lastMove ? this.lastMove.from : null, this.lastMove ? this.lastMove.to : null);
    this.board.setCheck(this.game.inCheck(this.game.turn) ? this.game.kingSq[this.game.turn] : null);
  }

  updateCaptured() {
    const capturedByWhite = [];
    const capturedByBlack = [];
    for (const entry of this.moveList) {
      if (!entry.captured) continue;
      const t = pieceType(entry.captured);
      if (pieceColor(entry.captured) === BLACK) capturedByWhite.push(t);
      else capturedByBlack.push(t);
    }
    this.hud.renderCaptured(capturedByWhite, capturedByBlack);
  }

  difficultyLabel() {
    const d = getDifficulty(this.difficulty);
    return d.name + ' \u00b7 ' + d.elo;
  }

  /** Advance per-frame timers. */
  update(dt) {
    if (this.phase === Phase.AI_THINKING) {
      this.thinkTimer += dt;
      this.hud.setThinking(true, this.thinkTimer);
    } else {
      this.thinkTimer = 0;
    }

    // Breathe the check marker so it reads as an alarm rather than a red tile.
    const checkSq = this.game.inCheck(this.game.turn) ? this.game.kingSq[this.game.turn] : null;
    this.board.pulseCheck?.(dt, checkSq !== null && this.reviewPly === null);
  }

  dispose() {
    if (this.worker) this.worker.terminate();
  }
}
