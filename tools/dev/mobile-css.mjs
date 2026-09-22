#!/usr/bin/env node
/**
 * Replace the mobile media queries in styles.css with a real phone layout.
 *
 * Measured problems this fixes
 * ---------------------------
 * On a phone the two side panels plus the top and bottom bars covered almost the
 * whole viewport. On an 844x390 landscape viewport they left about 150px for the
 * board; in portrait the board was reduced to a narrow strip with panels
 * overlapping it on both sides, and a square was only ~22px across — below the
 * 44px minimum comfortable tap target.
 *
 * The fix is structural rather than cosmetic: below 900px both side panels
 * collapse into an on-demand sheet, so the board gets the screen. The board is
 * the game; the panels are reference material you consult occasionally.
 *
 * Approach
 * --------
 * The old rules lifted each panel out of the grid individually with absolute
 * positioning, which fought the layout. Here the panels' common wrapper (.sheet)
 * becomes the movable element instead, and on desktop that wrapper is
 * `display: contents` so it disappears from layout entirely and the grid places
 * the panels exactly as before.
 */
import fs from 'node:fs';

const p = 'styles.css';
let css = fs.readFileSync(p, 'utf8');

// ---------------------------------------------------------------- sheet base --
// Insert the sheet styles just before the responsive section so the mobile rules
// below can override them.
const marker = '/* --------------------------------------------------------------- responsive -- */';
if (!css.includes(marker)) throw new Error('responsive marker not found');

const sheetBase = `/* ------------------------------------------------------------------ sheet -- */
/*
  The wrapper around both side panels.

  Desktop: display:contents removes this element from the box tree entirely, so
  the grid lays out .panel-left and .panel-right exactly as it did before the
  wrapper existed. The wrapper costs the desktop nothing.

  Mobile: it becomes a slide-up sheet (see the media queries below).
*/
.sheet { display: contents; }

/* Inert until a phone opens the sheet. */
.sheet-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 25;
  background: rgba(4, 5, 8, 0.55);
  backdrop-filter: blur(3px);
  opacity: 0;
  transition: opacity 0.25s;
}
.sheet-backdrop.show { opacity: 1; }

/* Hidden on desktop, where both panels are permanently visible. */
.sheet-toggle { display: none; }

${marker}`;

css = css.replace(marker, sheetBase);

// ------------------------------------------------- replace the mobile queries --
// Everything from the first media query onward is rewritten.
const firstMedia = css.indexOf('@media (max-width: 1180px)');
if (firstMedia < 0) throw new Error('first media query not found');
const tail = css.indexOf('/* Respect users who ask for less motion. */');
if (tail < 0) throw new Error('reduced-motion block not found');

const mobile = `/*
  Tablet: a single column, and the side panels stay put but narrow.
  Below 900px the panels collapse into a sheet instead — see below.
*/
@media (max-width: 1180px) {
  .panel-left { width: 208px; }
  .panel-right { width: 226px; }
  .engine-info { display: none; }
}

/*
  Phone and small tablet: the board gets the screen.

  Both side panels move into the sheet, which slides up from the bottom when the
  player taps Menu. Nothing overlaps the board, and the bars stay thin so the
  playing area is as large as the viewport allows.
*/
@media (max-width: 900px) {
  #ui {
    padding: 8px;
    gap: 8px;
    grid-template-columns: 1fr;
    grid-template-areas:
      "top"
      "bottom";
    /* The middle row collapses: the board fills it. */
    grid-template-rows: auto 1fr auto;
  }

  /* The sheet: off-screen until opened. */
  .sheet {
    display: block;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    max-height: 68vh;
    padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    background: linear-gradient(180deg, rgba(20, 22, 29, 0.97), rgba(12, 13, 18, 0.99));
    backdrop-filter: blur(20px) saturate(1.2);
    border-top: 1px solid var(--border-strong);
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -18px 50px rgba(0, 0, 0, 0.55);
    transform: translateY(101%);
    transition: transform 0.3s cubic-bezier(0.22, 0.9, 0.3, 1);
  }
  .sheet.open { transform: translateY(0); }

  /* Panels inside the sheet: full width, stacked, no fixed positioning. */
  .panel-left,
  .panel-right {
    position: static;
    width: auto;
    max-width: none;
    max-height: none;
    align-self: auto;
    margin: 0;
    padding: 0;
    background: transparent;
    border: none;
    box-shadow: none;
    backdrop-filter: none;
  }
  .panel-left { flex-direction: column; }
  .panel-left .panel-title,
  .panel-left .blurb { display: block; }
  .panel-left .difficulty-list {
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    min-width: 0;
  }
  .panel-left .segmented { display: flex; }
  .difficulty-list { margin-bottom: 10px; }
  .panel-right { margin-top: 4px; }
  .move-scroll { max-height: 26vh; }
  .captured { display: flex; }

  /* Roomier rows for thumbs. */
  .diff-btn { padding: 10px 11px; }
  .diff-name { font-size: 12px; }
  .seg-btn { padding: 10px 12px; }

  /* The sheet's own toggle lives in the bottom bar. */
  .sheet-toggle { display: inline-flex; }
  .sheet-backdrop { display: block; pointer-events: none; }
  .sheet-backdrop.show { pointer-events: auto; }

  /* Thin bars: every pixel here is a pixel the board does not get. */
  .topbar { padding: 7px 12px; gap: 10px; }
  .brand-text { display: none; }
  .status { min-width: 0; flex: 1; }
  .status-main { font-size: 13px; }
  .status-sub { display: none; }
  .bottombar {
    padding: 7px 8px calc(7px + env(safe-area-inset-bottom));
    gap: 6px;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .bottombar::-webkit-scrollbar { display: none; }
  .btn {
    padding: 10px 13px;
    font-size: 12.5px;
    /* Comfortable thumb target. */
    min-height: 40px;
    white-space: nowrap;
  }
  .view-presets { flex-shrink: 0; }

  /* Overlays sit above the bottom bar. */
  .thinking, .selection-info { bottom: calc(72px + env(safe-area-inset-bottom)); }
  .toast { bottom: calc(124px + env(safe-area-inset-bottom)); }
  .selection-info { max-width: 92vw; white-space: normal; text-align: center; }
}

/*
  Small phones: trim further and make the difficulty grid two columns so the
  labels stay readable rather than squeezing six buttons into three narrow ones.
*/
@media (max-width: 560px) {
  #ui { padding: 6px; gap: 6px; }
  .panel-left .difficulty-list { grid-template-columns: repeat(2, 1fr); }
  .diff-name { font-size: 11.5px; }
  .diff-elo { display: block; font-size: 9px; }
  .sheet { max-height: 74vh; }
  .modal-card { padding: 26px 20px 20px; }
  .modal-title { font-size: 22px; }
  .modal-actions { flex-direction: column; }
  .modal-actions .btn { width: 100%; }
}

/*
  Landscape phones: vertical space is the scarce resource, so the sheet is
  shorter and the bars get even thinner. The board keeps whatever is left.
*/
@media (max-height: 480px) and (orientation: landscape) {
  #ui { padding: 5px; gap: 5px; }
  .topbar { padding: 4px 10px; }
  .status-main { font-size: 12px; }
  .bottombar { padding: 4px 6px; }
  .btn { padding: 7px 10px; font-size: 11.5px; min-height: 34px; }
  .sheet { max-height: 84vh; }
  .move-scroll { max-height: 30vh; }
  .thinking, .selection-info { bottom: 54px; }
  .toast { bottom: 100px; }
}

`;

css = css.slice(0, firstMedia) + mobile + css.slice(tail);
fs.writeFileSync(p, css);
console.log('styles.css: mobile layout rewritten (sheet-based)');
console.log('lines:', css.split('\n').length);
