/**
 * Fix two layout bugs in the phone media query, both found by measurement.
 *
 * 1. THE BOTTOM BAR STRETCHED TO 605px TALL.
 *    The query declared `grid-template-areas: "top" "bottom"` (two rows) but
 *    `grid-template-rows: auto 1fr auto` (three rows). The named areas map onto
 *    the first two rows, so the bottom bar landed in the `1fr` row and was
 *    stretched to fill the viewport. Measured on a 375x667 phone it became
 *    770x605, overlapping the board by 456px.
 *
 *    The canvas is `position: fixed`, so it is NOT a grid item and there is no
 *    third item to occupy a middle row. Using two auto rows plus
 *    `align-content: space-between` pins the bars to the top and bottom and lets
 *    each keep its natural height, which is what the layout actually wants.
 *
 * 2. THE BOTTOM BAR WAS WIDER THAN THE SCREEN.
 *    Desktop CSS sets `justify-self: center` on `.bottombar`, which sizes it to
 *    its content — 770px of buttons on a 375px screen. Restoring `stretch` and
 *    `max-width: 100%` makes the element fit the viewport so its `overflow-x`
 *    can scroll the buttons instead of the element overflowing the page.
 *    `justify-content: flex-start` is also needed: with `center`, content wider
 *    than the container has its start clipped and is unreachable by scrolling.
 */
import fs from 'node:fs';

const p = 'styles.css';
let css = fs.readFileSync(p, 'utf8');

const oldGrid = `  #ui {
    padding: 8px;
    gap: 8px;
    grid-template-columns: 1fr;
    grid-template-areas:
      "top"
      "bottom";
    /* The middle row collapses: the board fills it. */
    grid-template-rows: auto 1fr auto;
  }`;

const newGrid = `  #ui {
    padding: 8px;
    gap: 8px;
    /* Two rows only. The canvas is position:fixed and the sheet/overlays are
       fixed too, so the grid's only in-flow children are the two bars — a third
       row would be empty, and naming a row that does not exist put the bottom
       bar in a 1fr track that stretched it over the whole screen. */
    grid-template-columns: 1fr;
    grid-template-areas:
      "top"
      "bottom";
    grid-template-rows: auto auto;
    align-content: space-between;
  }`;

if (!css.includes(oldGrid)) throw new Error('grid block not found');
css = css.replace(oldGrid, newGrid);

const oldBar = `  .bottombar {
    padding: 7px 8px calc(7px + env(safe-area-inset-bottom));
    gap: 6px;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }`;

const newBar = `  .bottombar {
    /* stretch, not the desktop's centre: centring sizes the bar to its content
       (770px of buttons on a 375px screen) and overflows the page. */
    justify-self: stretch;
    max-width: 100%;
    padding: 7px 8px calc(7px + env(safe-area-inset-bottom));
    gap: 6px;
    flex-wrap: nowrap;
    /* flex-start so the first button is not clipped beyond reach when the row
       is wider than the screen and has to scroll. */
    justify-content: flex-start;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }`;

if (!css.includes(oldBar)) throw new Error('bottombar block not found');
css = css.replace(oldBar, newBar);

fs.writeFileSync(p, css);
console.log('styles.css: mobile grid rows fixed, bottom bar constrained to viewport');
