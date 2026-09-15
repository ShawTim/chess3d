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
  Chess, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  moveFrom, moveTo, moveFlags, movePromo, moveToUci,
  pieceType, pieceColor, squareName, FLAG_CASTLE, FLAG_CAPTURE,
} from '../engine/chess.js';
import { DIFFICULTIES, getDifficulty, DEFAULT_DIFFICULTY } from '../engine/ai.js';
import { squareToWorld } from '../render/board.js';

/** Player-facing game phases. */
export const Phase = {
  IDLE: 'idle',
  PLAYER_TURN: 'player',
  ANIMATING: 'animating',
  AI_THINKING: 'thinking',
  GAME_OVER: 'over',
};

export class GameController {
  constructor({ rig, cameraRig, pieceViews, board, hud, audio }) {
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

    this.worker = null;
    this.workerReady = false;
    this.searchId = 0;
    this.pendingSearch = null;
    this.thinkTimer = 0;
  }

  /* ------------------------------------------------------------- lifecycle -- */

  init() {
    this.spawnWorker();
    this.pieceViews.rebuild(this.game);
    this.syncViews();
    this.hud.buildDifficultyOptions(DIFFICULTIES, this.difficulty);
    this.hud.renderMoveList(this.moveList);
    this.hud.renderCaptured([], []);
    this.hud.setStatus('Your move', 'Good luck');
    this.hud.setThinking(false);
    this.phase = Phase.PLAYER_TURN;
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
    if (!this.pendingSearch || msg.id !== this.pendingSearch.id) return;

    const pending = this.pendingSearch;
    this.pendingSearch = null;
    this.hud.setThinking(false);
    this.hud.setEngineInfo({ depth: msg.depth, nodes: msg.nodes, ms: msg.ms, score: msg.score });

    if (!msg.uci) { this.onGameOver(); return; }
    const move = pending.legal.find((m) => moveToUci(m) === msg.uci);
    if (!move) {
      console.warn('Engine returned an unusable move:', msg.uci);
      this.applyMove(pending.legal[0]);
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

    const move = this.legalForSelected.find((m) => moveTo(m) === square);
    if (move) {
      this.playPlayerMove(move);
      return;
    }

    if (isOwn) this.select(square);
    else {
      this.audio.playIllegal();
      this.clearSelection();
    }
  }

  select(square) {
    this.selected = square;
    this.legalForSelected = this.game.legalMoves().filter((m) => moveFrom(m) === square);
    this.board.setSelection(square);
    this.board.setLegalMoves(this.legalForSelected, this.game.board);
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
    const isEp = (flags & 4) !== 0;
    const capturedSq = isEp ? (color === WHITE ? to + 8 : to - 8) : to;
    const capturedPiece = this.game.board[capturedSq];

    // SAN and the capture list must be read before the model is mutated.
    const san = this.game.moveToSan(move);

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

    this.moveList.push({
      san,
      uci: moveToUci(move),
      from, to, color,
      captured: isCapture ? capturedPiece : null,
      check: san.includes('+') || san.includes('#'),
    });
    this.hud.renderMoveList(this.moveList);
    this.updateCaptured();

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
    if (!this.moveList.length) return;

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
  }

  /* -------------------------------------------------------------- new game -- */

  newGame({ playerColor = this.playerColor, difficulty = this.difficulty } = {}) {
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

    this.cameraRig.goTo(playerColor === WHITE ? 'white' : 'black', 1.2);

    // When the player takes Black the engine has the first move, so the phase
    // has to be advanced before the search is requested.
    if (this.game.turn !== this.playerColor) {
      this.phase = Phase.AI_THINKING;
      this.hud.setStatus('Thinking', this.difficultyLabel());
      this.requestAiMove();
    }
  }

  setPlayerColor(color) {
    this.newGame({ playerColor: color, difficulty: this.difficulty });
  }

  setDifficulty(id) {
    this.difficulty = id;
    this.hud.setDifficulty(id);
    this.hud.setEngineInfo(null);
    if (this.phase === Phase.PLAYER_TURN) this.hud.setStatus('Your move', this.difficultyLabel());
  }

  /* ------------------------------------------------------------------ hints -- */

  async hint() {
    if (this.phase !== Phase.PLAYER_TURN || this.pieceViews.busy) return;
    this.hud.setThinking(true);
    // Hints always come from a strong setting regardless of the opponent's
    // difficulty, so the suggestion is actually worth following.
    const { findBestMove } = await import('../engine/ai.js');
    await new Promise((r) => setTimeout(r, 20));
    const res = findBestMove(this.game.fen(), 'advanced');
    this.hud.setThinking(false);
    if (!res.uci) return;
    const move = this.game.legalMoves().find((m) => moveToUci(m) === res.uci);
    if (!move) return;
    this.hintMove = move;
    this.board.setSelection(moveFrom(move));
    this.board.setLegalMoves([move], this.game.board);
    this.hud.showHint(res.uci, res.score);
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
  }

  dispose() {
    if (this.worker) this.worker.terminate();
  }
}
