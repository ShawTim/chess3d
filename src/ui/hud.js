/**
 * Heads-up display.
 *
 * The HUD owns every piece of DOM in the app. It never touches game state: the
 * controller calls these methods with plain data and the HUD renders it. That
 * one-way flow means a UI bug can never desynchronise the board.
 *
 * All elements are created here rather than being written in index.html, so the
 * markup and the code that drives it live together and there is no chance of the
 * two drifting apart.
 */
import { PIECE_GLYPHS } from './glyphs.js';
import { DIFFICULTIES } from '../engine/ai.js';
import { QUEEN, ROOK, BISHOP, KNIGHT } from '../engine/chess.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class Hud {
  /**
   * @param {object} callbacks
   * @param {(color: number) => void} callbacks.onNewGame
   * @param {(id: string) => void} callbacks.onDifficulty
   * @param {() => void} callbacks.onUndo
   * @param {() => void} callbacks.onHint
   * @param {(view: string) => void} callbacks.onView
   * @param {(flipped: boolean) => void} callbacks.onFlip
   * @param {(on: boolean) => void} callbacks.onSoundToggle
   * @param {(on: boolean) => void} callbacks.onQualityToggle
   * @param {() => void} callbacks.onRestart
   * @param {() => void} callbacks.onShareLink
   * @param {() => void} callbacks.onSharePgn
   */
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.root = document.getElementById('ui') ?? document.body;
    this.difficultyButtons = new Map();
    this.checkTimer = 0;
    this.build();
  }

  build() {
    // ------------------------------------------------------------- top bar --
    this.topbar = el('div', 'topbar');

    this.brand = el('div', 'brand');
    this.brand.innerHTML = '<span class="brand-mark">&#9822;</span><span class="brand-text">CHESS<b>3D</b></span>';
    this.topbar.appendChild(this.brand);

    this.statusWrap = el('div', 'status');
    // Screen readers announce "Your move", "Check", "White wins" as they change.
    this.statusWrap.setAttribute('role', 'status');
    this.statusWrap.setAttribute('aria-live', 'polite');
    this.statusMain = el('div', 'status-main', 'Loading');
    this.statusSub = el('div', 'status-sub', '');
    this.statusWrap.append(this.statusMain, this.statusSub);
    this.topbar.appendChild(this.statusWrap);

    this.engineWrap = el('div', 'engine-info');
    this.engineWrap.appendChild(el('span', 'engine-label', 'engine'));
    this.engineBody = el('span', 'engine-body', 'idle');
    this.engineWrap.appendChild(this.engineBody);
    this.topbar.appendChild(this.engineWrap);

    this.root.appendChild(this.topbar);

    // ---------------------------------------------------------- left panel --
    this.left = el('aside', 'panel panel-left');

    this.left.appendChild(this.sectionTitle('Difficulty'));
    this.difficultyList = el('div', 'difficulty-list');
    this.left.appendChild(this.difficultyList);

    this.difficultyBlurb = el('p', 'blurb', '');
    this.left.appendChild(this.difficultyBlurb);

    this.left.appendChild(this.sectionTitle('Play as'));
    const sideRow = el('div', 'segmented');
    this.sideWhite = el('button', 'seg-btn', 'White');
    this.sideBlack = el('button', 'seg-btn', 'Black');
    this.sideWhite.addEventListener('click', () => this.cb.onNewGame?.(0));
    this.sideBlack.addEventListener('click', () => this.cb.onNewGame?.(1));

    sideRow.append(this.sideWhite, this.sideBlack);
    this.left.appendChild(sideRow);

    this.left.appendChild(this.sectionTitle('View'));
    const views = el('div', 'view-presets in-panel');
    for (const [id, label, title] of [
      ['white', 'White', 'White perspective'],
      ['black', 'Black', 'Black perspective'],
      ['side', 'Side', 'Side view'],
      ['top', 'Top', 'Top-down view'],
    ]) {
      const b = el('button', 'icon-btn', label);
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', () => this.cb.onView?.(id));
      views.appendChild(b);
    }
    this.presetButtons = [...views.querySelectorAll('.icon-btn')];
    this.left.appendChild(views);

    this.left.appendChild(this.sectionTitle('Options'));
    const options = el('div', 'options-row');
    this.btnSound = this.toggleButton('Sound', true, (on) => this.cb.onSoundToggle?.(on));
    this.btnQuality = this.toggleButton('Cinematic', true, (on) => this.cb.onQualityToggle?.(on));
    options.append(this.btnSound, this.btnQuality);
    this.left.appendChild(options);

    // Sharing lives in the panel, not the bottom toolbar: the toolbar is already
    // at its width limit on a phone, and the phone sheet reuses this panel.
    this.left.appendChild(this.sectionTitle('Share'));
    const shareRow = el('div', 'options-row');
    this.btnShareLink = this.actionButton('Copy link', () => this.cb.onShareLink?.());
    this.btnShareLink.title = 'Copy a link that opens this exact position';
    this.btnShareLink.setAttribute('aria-label', 'Copy a link to this position');
    this.btnSharePgn = this.actionButton('Copy PGN', () => this.cb.onSharePgn?.());
    this.btnSharePgn.title = 'Copy the game as PGN for another chess program';
    this.btnSharePgn.setAttribute('aria-label', 'Copy the game as PGN');
    shareRow.append(this.btnShareLink, this.btnSharePgn);
    this.left.appendChild(shareRow);

    // The side panels are wrapped so a phone can present them as one slide-up
    // sheet the player opens on demand. On desktop the wrapper is
    // `display: contents`, which removes it from layout entirely: the grid places
    // both panels exactly where it did before, so desktop is unaffected.
    //
    // This exists because on a phone the two panels plus the bars covered almost
    // the whole screen. Measured on an 844x390 landscape viewport they left about
    // 150px for the board, and in portrait the board was squeezed to a strip.
    this.sheet = el('div', 'sheet');
    this.sheet.appendChild(this.left);

    // --------------------------------------------------------- right panel --
    this.right = el('aside', 'panel panel-right');

    this.right.appendChild(this.sectionTitle('Moves'));
    this.moveScroll = el('div', 'move-scroll');
    this.moveTable = el('div', 'move-table');
    this.moveScroll.appendChild(this.moveTable);
    this.right.appendChild(this.moveScroll);

    this.right.appendChild(this.sectionTitle('Captured'));
    this.capturedWrap = el('div', 'captured');
    this.capturedBlack = el('div', 'captured-row capt-by-white');
    this.capturedWhite = el('div', 'captured-row capt-by-black');
    this.capturedWrap.append(
      this.labeledRow('White took', this.capturedBlack),
      this.labeledRow('Black took', this.capturedWhite),
    );
    this.right.appendChild(this.capturedWrap);

    this.sheet.appendChild(this.right);
    this.root.appendChild(this.sheet);

    // Backdrop behind the open sheet; clicking it closes the sheet. Inert on
    // desktop, where the sheet is never collapsed.
    this.sheetBackdrop = el('div', 'sheet-backdrop');
    this.sheetBackdrop.addEventListener('click', () => this.closeSheet());
    this.root.appendChild(this.sheetBackdrop);

    // ------------------------------------------------------------- bottom --
    this.bottom = el('div', 'bottombar');

    // The sheet button is the mobile replacement for the two side panels: it
    // opens difficulty, side selection, the move list and captured pieces in one
    // overlay. Hidden on desktop by CSS, where both panels are always visible.
    this.btnSheet = el('button', 'btn sheet-toggle', 'Menu');
    this.btnSheet.setAttribute('aria-label', 'Open settings and move list');
    this.btnSheet.setAttribute('aria-expanded', 'false');
    this.btnSheet.addEventListener('click', () => this.toggleSheet());

    this.btnUndo = this.actionButton('Undo', () => this.cb.onUndo?.());
    this.btnHint = this.actionButton('Hint', () => this.cb.onHint?.());
    // "Flip" rotates the CAMERA; it never changes sides or restarts the game.
    this.btnFlip = this.actionButton('Flip', () => this.cb.onFlip?.(true));
    this.btnFlip.title = 'Flip the camera 180 degrees';
    this.btnFlip.setAttribute('aria-label', 'Flip the camera 180 degrees');
    this.btnNew = this.actionButton('New game', () => this.cb.onRestart?.(), 'primary');

    // Only actions live in this bar. View presets and the two toggles moved into
    // the settings panel: on a 612px-wide window the old bar overflowed, and
    // Sound and Cinematic sat off-screen with no hint that they existed.
    this.bottom.append(this.btnSheet, this.btnUndo, this.btnHint, this.btnFlip, this.btnNew);

    this.root.appendChild(this.bottom);

    // ------------------------------------------------------------ overlays --
    this.thinking = el('div', 'thinking');
    this.thinkingDot = el('span', 'think-dot');
    this.thinkingText = el('span', 'think-text', 'Thinking');
    this.thinking.append(this.thinkingDot, this.thinkingText);
    this.thinking.style.display = 'none';
    this.root.appendChild(this.thinking);

    this.toast = el('div', 'toast');
    this.toast.style.display = 'none';
    this.root.appendChild(this.toast);

    this.selectionInfo = el('div', 'selection-info');
    this.selectionInfo.style.display = 'none';
    this.root.appendChild(this.selectionInfo);
    // Reviewing history is a mode, not a toast: it needs a visible exit.
    this.reviewBanner = el('div', 'review-banner');
    this.reviewBanner.style.display = 'none';
    this.reviewText = el('span', 'review-text', '');
    this.reviewExit = el('button', 'btn review-exit', 'Back to game');
    this.reviewExit.addEventListener('click', () => this.cb.onExitReview?.());
    this.reviewBanner.append(this.reviewText, this.reviewExit);
    this.root.appendChild(this.reviewBanner);

    // ------------------------------------------------------------ promotion --
    // A promotion is a rules decision, not a default. The four legal pieces are
    // offered explicitly, and Q/R/B/N + Escape work without a pointer.
    this.promotion = el('div', 'promo-backdrop');
    this.promotion.style.display = 'none';
    this.promoCard = el('div', 'promo-card');
    this.promoCard.setAttribute('role', 'dialog');
    this.promoCard.setAttribute('aria-modal', 'true');
    this.promoCard.setAttribute('aria-label', 'Choose a promotion piece');
    this.promoTitle = el('h2', 'promo-title', 'Promote to');
    this.promoRow = el('div', 'promo-row');
    this.promoCard.append(this.promoTitle, this.promoRow);
    this.promotion.appendChild(this.promoCard);
    this.root.appendChild(this.promotion);


    this.modal = el('div', 'modal-backdrop');
    this.modal.style.display = 'none';
    const card = el('div', 'modal-card');
    this.modalTitle = el('h2', 'modal-title', '');
    this.modalDetail = el('p', 'modal-detail', '');
    this.modalActions = el('div', 'modal-actions');
    this.btnModalNew = el('button', 'btn primary', 'New game');
    this.btnModalNew.addEventListener('click', () => {
      this.hideGameOver();
      this.cb.onRestart?.();
    });
    this.btnModalClose = el('button', 'btn', 'Review board');
    this.btnModalClose.addEventListener('click', () => this.hideGameOver());
    this.modalActions.append(this.btnModalNew, this.btnModalClose);
    card.append(this.modalTitle, this.modalDetail, this.modalActions);
    this.modal.appendChild(card);
    this.root.appendChild(this.modal);

    // Confirmation dialog, used before destructive actions such as starting a
    // new game over a live position. The game-over modal is separate because it
    // has different actions and copy.
    this.confirmModal = el('div', 'modal-backdrop confirm');
    this.confirmModal.style.display = 'none';
    this.confirmModal.setAttribute('role', 'dialog');
    this.confirmModal.setAttribute('aria-modal', 'true');
    const confirmCard = el('div', 'modal-card');
    this.confirmTitle = el('h2', 'modal-title', '');
    this.confirmDetail = el('p', 'modal-detail', '');
    this.confirmActions = el('div', 'modal-actions');
    this.confirmYes = el('button', 'btn primary', 'Continue');
    this.confirmNo = el('button', 'btn', 'Cancel');
    this.confirmActions.append(this.confirmYes, this.confirmNo);
    confirmCard.append(this.confirmTitle, this.confirmDetail, this.confirmActions);
    this.confirmModal.appendChild(confirmCard);
    this.root.appendChild(this.confirmModal);
  }

  sectionTitle(text) {
    return el('h3', 'panel-title', text);
  }

  /* ------------------------------------------------------------- mobile sheet -- */

  /**
   * The collapsible panel, used on phones.
   *
   * On a phone the two side panels plus the top and bottom bars covered nearly
   * the whole screen — measured on an 844x390 landscape viewport they left about
   * 150px for the board. Collapsing them into an on-demand sheet gives the board
   * the screen, which is the whole point of the app.
   *
   * These methods are harmless on desktop: the sheet is `display: contents` there
   * so both panels are always laid out, and the toggle button is hidden, so
   * opening a "sheet" simply adds a class that nothing styles.
   */
  toggleSheet() {
    if (this.sheet.classList.contains('open')) this.closeSheet();
    else this.openSheet();
  }

  openSheet() {
    this.sheet.classList.add('open');
    this.sheetBackdrop.classList.add('show');
    this.btnSheet?.setAttribute('aria-expanded', 'true');
    this.cb.onSheetToggle?.(true);
  }

  closeSheet() {
    this.sheet.classList.remove('open');
    this.sheetBackdrop.classList.remove('show');
    this.btnSheet?.setAttribute('aria-expanded', 'false');
    this.cb.onSheetToggle?.(false);
  }

  get sheetOpen() {
    return this.sheet.classList.contains('open');
  }

  get confirmOpen() {
    return this.confirmModal.classList.contains('show');
  }

  labeledRow(label, content) {
    const row = el('div', 'captured-block');
    row.appendChild(el('div', 'captured-label', label));
    row.appendChild(content);
    return row;
  }

  actionButton(label, onClick, extra = '') {
    const b = el('button', 'btn ' + extra, label);
    b.addEventListener('click', onClick);
    return b;
  }

  toggleButton(label, initial, onChange) {
    const b = el('button', 'btn toggle' + (initial ? ' on' : ''), label);
    let state = initial;
    b.setAttribute('aria-pressed', String(initial));
    b.addEventListener('click', () => {
      state = !state;
      b.classList.toggle('on', state);
      b.setAttribute('aria-pressed', String(state));
      onChange(state);
    });
    b.getValue = () => state;
    // Used when a persisted preference overrides the markup default.
    b.setState = (next) => {
      state = !!next;
      b.classList.toggle('on', state);
      b.setAttribute('aria-pressed', String(state));
    };
    return b;
  }

  /* ------------------------------------------------------------ difficulty -- */

  buildDifficultyOptions(difficulties, selectedId) {
    this.difficultyList.innerHTML = '';
    this.difficultyButtons.clear();

    for (const key of Object.keys(difficulties)) {
      const d = difficulties[key];
      const b = el('button', 'diff-btn');
      b.dataset.id = d.id;

      const name = el('span', 'diff-name', d.name);
      const elo = el('span', 'diff-elo', d.elo);
      b.append(name, elo);

      b.addEventListener('click', () => this.cb.onDifficulty?.(d.id));
      b.addEventListener('mouseenter', () => {
        this.difficultyBlurb.textContent = d.blurb;
      });
      b.addEventListener('focus', () => {
        this.difficultyBlurb.textContent = d.blurb;
      });

      this.difficultyButtons.set(d.id, b);
      this.difficultyList.appendChild(b);
    }
    this.setDifficulty(selectedId);
  }

  setDifficulty(id) {
    for (const [key, btn] of this.difficultyButtons) {
      btn.classList.toggle('active', key === id);
    }
    const d = DIFFICULTIES[id];
    if (d) this.difficultyBlurb.textContent = d.blurb;
  }

  setPlayingColor(color) {
    this.sideWhite.classList.toggle('active', color === 0);
    this.sideBlack.classList.toggle('active', color === 1);
  }

  /* ---------------------------------------------------------------- status -- */

  setStatus(main, sub = '') {
    this.statusMain.textContent = main;
    this.statusSub.textContent = sub;
    this.statusWrap.classList.toggle('alert', /check|wins|mate/i.test(main + ' ' + sub));
  }

  setThinking(on, seconds = 0) {
    this.thinking.style.display = on ? 'flex' : 'none';
    if (on) {
      const dots = '.'.repeat(1 + (Math.floor(seconds * 2.4) % 3));
      this.thinkingText.textContent = seconds > 1.5
        ? 'Thinking' + dots
        : 'Thinking';
    }
  }

  setEngineInfo(info) {
    if (!info) { this.engineBody.textContent = 'idle'; return; }
    const knps = info.ms > 0 ? (info.nodes / info.ms) : 0;
    const scorePawns = (info.score / 100).toFixed(2);
    this.engineBody.textContent =
      `d${info.depth} \u00b7 ${(info.nodes / 1000).toFixed(0)}k nodes \u00b7 ${knps.toFixed(0)}k/s \u00b7 ${scorePawns}`;
  }

  showHint(uci, score) {
    const pawns = (score / 100).toFixed(2);
    this.showToast(`Try ${uci}  (eval ${pawns})`, 2600);
  }

  showToast(text, ms = 2000) {
    this.toast.textContent = text;
    this.toast.style.display = 'block';
    this.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast.classList.remove('show');
      this.toast.style.display = 'none';
    }, ms);
  }

  flashCheck() {
    this.root.classList.add('flash-check');
    clearTimeout(this._checkTimer);
    this._checkTimer = setTimeout(() => this.root.classList.remove('flash-check'), 900);
  }

  /* ------------------------------------------------------------ move list -- */

  renderMoveList(moveList) {
    this.moveTable.innerHTML = '';
    if (!moveList.length) {
      this.moveTable.appendChild(el('div', 'empty-note', 'No moves yet'));
      return;
    }

    for (let i = 0; i < moveList.length; i += 2) {
      const row = el('div', 'move-row');
      const num = el('span', 'move-num', String(i / 2 + 1) + '.');
      row.appendChild(num);

      // A move entry is interactive (it opens that position), so it must also be
      // reachable and activatable from the keyboard, not just by pointer.
      const moveCell = (entry, ply) => {
        const node = el('span', 'move-san' + (entry.check ? ' check' : ''), entry.san);
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        node.setAttribute('aria-label', `Review the position after ${entry.san}`);
        const activate = () => this.cb.onMoveClick?.(ply);
        node.addEventListener('click', activate);
        node.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            activate();
          }
        });
        return node;
      };

      const white = moveList[i];
      row.appendChild(moveCell(white, i));

      if (moveList[i + 1]) {
        row.appendChild(moveCell(moveList[i + 1], i + 1));
      } else {
        row.appendChild(el('span', 'move-san empty', '\u00b7\u00b7\u00b7'));
      }
      this.moveTable.appendChild(row);
    }

    // Keep the latest move in view.
    this.moveScroll.scrollTop = this.moveScroll.scrollHeight;
  }

  renderCaptured(byWhite, byBlack) {
    const render = (node, list) => {
      node.innerHTML = '';
      if (!list.length) {
        node.appendChild(el('span', 'captured-none', '\u2014'));
        return;
      }
      // Group by piece type and show a count, which is easier to read than a
      // long run of glyphs.
      const counts = new Map();
      for (const t of list) counts.set(t, (counts.get(t) || 0) + 1);
      const order = [5, 4, 3, 2, 1];
      for (const t of order) {
        if (!counts.has(t)) continue;
        const n = counts.get(t);
        const span = el('span', 'captured-piece');
        span.textContent = PIECE_GLYPHS[t] + (n > 1 ? '\u00d7' + n : '');
        node.appendChild(span);
      }
    };
    render(this.capturedBlack, byWhite);
    render(this.capturedWhite, byBlack);
  }

  /* ---------------------------------------------------------- selection info -- */

  setSelectionInfo(info) {
    if (!info) {
      this.selectionInfo.style.display = 'none';
      return;
    }
    const name = PIECE_NAMES[info.piece & 7] ?? 'Piece';
    this.selectionInfo.style.display = 'block';
    this.selectionInfo.innerHTML =
      `<b>${name}</b> on ${info.square} \u00b7 ${info.moves.length} legal move${info.moves.length === 1 ? '' : 's'}`;
  }

  /* -------------------------------------------------------------- game over -- */

  showGameOver({ title, detail, won }) {
    this.modalTitle.textContent = title;
    this.modalDetail.textContent = detail;
    this.modal.classList.remove('win', 'loss', 'draw');
    this.modal.classList.add(won === true ? 'win' : won === false ? 'loss' : 'draw');
    this.modal.style.display = 'flex';
    requestAnimationFrame(() => this.modal.classList.add('show'));
  }

  hideGameOver() {
    this.modal.classList.remove('show');
    this.modal.style.display = 'none';
  }

  /**
   * Ask before a destructive action. Returns via callbacks so the HUD stays
   * state-free; Enter accepts, Escape cancels, and a backdrop click cancels.
   */
  showConfirm({
    title, detail = '', confirmLabel = 'Continue', cancelLabel = 'Cancel',
    onConfirm, onCancel,
  } = {}) {
    this.confirmTitle.textContent = title;
    this.confirmDetail.textContent = detail;
    this.confirmYes.textContent = confirmLabel;
    this.confirmNo.textContent = cancelLabel;
    this.confirmModal.style.display = 'flex';
    requestAnimationFrame(() => this.confirmModal.classList.add('show'));

    const cleanup = () => {
      window.removeEventListener('keydown', onKey);
      this.confirmModal.onclick = null;
      this.confirmModal.classList.remove('show');
      this.confirmModal.style.display = 'none';
      this._confirmCleanup = null;
    };
    const accept = () => { cleanup(); onConfirm?.(); };
    const cancel = () => { cleanup(); onCancel?.(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); accept(); }
    };
    this.confirmYes.onclick = accept;
    this.confirmNo.onclick = cancel;
    this.confirmModal.onclick = (e) => {
      if (e.target === this.confirmModal) cancel();
    };
    window.addEventListener('keydown', onKey);
    this._confirmCleanup = cleanup;
    this.confirmYes.focus();
  }

  hideConfirm() {
    this._confirmCleanup?.();
  }

  /** Reflect the player's colour in the side selector. */
  setSide(color) {
    this.setPlayingColor(color);
  }

  /** Highlight the active camera preset, or clear all when `id` is null. */
  setView(id) {
    if (!this.presetButtons) return;
    const order = ['white', 'black', 'side', 'top'];
    this.presetButtons.forEach((b, i) => {
      const on = order[i] === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** Enable/disable toolbar actions to match what is currently possible. */
  setControls({ canUndo = true, canHint = true } = {}) {
    if (this.btnUndo) this.btnUndo.disabled = !canUndo;
    if (this.btnHint) this.btnHint.disabled = !canHint;
  }

  /** Show or clear the history-review banner. */
  setReviewing(index, san) {
    if (index === null || index === undefined) {
      this.reviewBanner.style.display = 'none';
      this.reviewBanner.classList.remove('show');
      this.moveTable.querySelectorAll('.move-san.current').forEach((n) => n.classList.remove('current'));
      return;
    }
    const moveNo = Math.floor(index / 2) + 1;
    const side = index % 2 === 0 ? '' : '...';
    this.reviewText.textContent = `Reviewing ${moveNo}${side} ${san}`;
    this.reviewBanner.style.display = 'flex';
    requestAnimationFrame(() => this.reviewBanner.classList.add('show'));
    const nodes = this.moveTable.querySelectorAll('.move-san');
    nodes.forEach((n) => n.classList.remove('current'));
    nodes[index]?.classList.add('current');
  }

  /**
   * Present the four promotion choices.
   *
   * `onPick` receives a piece type (QUEEN/ROOK/BISHOP/KNIGHT); `onCancel` fires
   * on Escape, on a click outside the card, or on the close button. The dialog
   * takes focus so keyboard players are not left with focus behind it.
   */
  showPromotion({ color = 0, onPick, onCancel } = {}) {
    const choices = [
      [QUEEN, 'Queen', 'q'],
      [ROOK, 'Rook', 'r'],
      [BISHOP, 'Bishop', 'b'],
      [KNIGHT, 'Knight', 'n'],
    ];
    this.promoRow.innerHTML = '';
    const buttons = [];
    for (const [type, name, key] of choices) {
      const b = el('button', 'promo-btn' + (color === 1 ? ' black' : ''));
      b.setAttribute('aria-label', 'Promote to ' + name);
      b.dataset.key = key;
      const glyph = el('span', 'promo-glyph', PIECE_GLYPHS[type]);
      const label = el('span', 'promo-label', name);
      const kbd = el('span', 'promo-key', key.toUpperCase());
      b.append(glyph, label, kbd);
      b.addEventListener('click', () => onPick?.(type));
      this.promoRow.appendChild(b);
      buttons.push(b);
    }

    this.promotion.style.display = 'flex';
    requestAnimationFrame(() => this.promotion.classList.add('show'));
    buttons[0]?.focus();

    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        e.preventDefault();
        cleanup();
        onCancel?.();
        return;
      }
      const hit = buttons.find((b) => b.dataset.key === k);
      if (hit) {
        e.preventDefault();
        cleanup();
        onPick?.(Number(choices.find((c) => c[2] === k)[0]));
      }
    };
    const onBackdrop = (e) => {
      if (e.target !== this.promotion) return;
      cleanup();
      onCancel?.();
    };
    const cleanup = () => {
      window.removeEventListener('keydown', onKey);
      this.promotion.removeEventListener('click', onBackdrop);
      this._promoCleanup = null;
    };
    window.addEventListener('keydown', onKey);
    this.promotion.addEventListener('click', onBackdrop);
    this._promoCleanup = cleanup;
  }

  hidePromotion() {
    this.promotion.classList.remove('show');
    this.promotion.style.display = 'none';
    this._promoCleanup?.();
    this._promoCleanup = null;
  }
}

const PIECE_NAMES = {
  1: 'Pawn',
  2: 'Knight',
  3: 'Bishop',
  4: 'Rook',
  5: 'Queen',
  6: 'King',
};
