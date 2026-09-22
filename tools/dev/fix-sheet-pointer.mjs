/**
 * Fix the sheet's pointer-events, and record why the first attempt failed.
 *
 * The bug reported: on a phone, opening the Menu sheet works but tapping outside
 * it does not close it.
 *
 * Root cause was CSS specificity, not JavaScript. The stylesheet has a blanket
 *
 *     #ui > * { pointer-events: none; }
 *
 * which makes the UI overlay click-through, and then re-enables specific
 * descendants. That selector is (1,0,0) — an ID — while the rule added for the
 * sheet was
 *
 *     .sheet-backdrop.show { pointer-events: auto; }
 *
 * at (0,2,0). An ID beats any number of classes, so the rule never applied and
 * the backdrop stayed pointer-events:none, unable to receive the click.
 *
 * The Menu button worked, which hid the problem: .sheet-toggle is a <button>, and
 * the blanket rule's companion selector is `#ui button` at (1,0,1) — high enough
 * to win. So "open" worked and "close" did not, exactly as reported.
 *
 * Fixes, all by matching ID specificity:
 *   1. The backdrop is re-enabled with `#ui .sheet-backdrop.show` (1,2,0).
 *   2. The open sheet gets `#ui .sheet.open { pointer-events: auto }` so its
 *      contents — the scrollable move list, the blurb — accept input. Before this,
 *      only its buttons were clickable, since buttons are the one descendant the
 *      blanket rule exempts.
 */
import fs from 'node:fs';

const p = 'styles.css';
let css = fs.readFileSync(p, 'utf8');

const oldBase = [
  '/* Inert until a phone opens the sheet. */',
  '.sheet-backdrop {',
  '  display: none;',
  '  position: fixed;',
  '  inset: 0;',
  '  z-index: 25;',
  '  background: rgba(4, 5, 8, 0.55);',
  '  backdrop-filter: blur(3px);',
  '  opacity: 0;',
  '  transition: opacity 0.25s;',
  '}',
  '.sheet-backdrop.show { opacity: 1; }',
].join('\n');

const newBase = [
  '/*',
  '  Inert until a phone opens the sheet.',
  '',
  '  The pointer-events rules carry an explicit #ui prefix so they outrank the',
  '  blanket rule above. An ID selector beats any number of classes, so a plain',
  '  .sheet-backdrop.show rule silently loses — which is what stopped the sheet',
  '  closing when tapped outside on a phone.',
  '*/',
  '.sheet-backdrop {',
  '  display: none;',
  '  position: fixed;',
  '  inset: 0;',
  '  z-index: 25;',
  '  background: rgba(4, 5, 8, 0.55);',
  '  backdrop-filter: blur(3px);',
  '  opacity: 0;',
  '  transition: opacity 0.25s;',
  '}',
  '#ui .sheet-backdrop { pointer-events: none; }',
  '#ui .sheet-backdrop.show { opacity: 1; pointer-events: auto; }',
].join('\n');

if (!css.includes(oldBase)) throw new Error('backdrop base rule not found');
css = css.replace(oldBase, newBase);

const oldSheet = '.sheet { display: contents; }';
const newSheet = [
  '.sheet { display: contents; }',
  '/*',
  '  Nothing inside the desktop wrapper intercepts input. It is display:contents on',
  '  desktop anyway, but the rule also has to be outranked by #ui .sheet.open in the',
  '  mobile query below, so both carry the ID prefix.',
  '*/',
  '#ui .sheet { pointer-events: none; }',
].join('\n');

if (!css.includes(oldSheet)) throw new Error('sheet base rule not found');
css = css.replace(oldSheet, newSheet);

const oldMobile = [
  '  .sheet-toggle { display: inline-flex; }',
  '  .sheet-backdrop { display: block; pointer-events: none; }',
  '  .sheet-backdrop.show { pointer-events: auto; }',
].join('\n');

const newMobile = [
  '  .sheet-toggle { display: inline-flex; }',
  '',
  '  /*',
  '    Both need #ui to outrank the blanket rule. The open sheet also has to accept',
  '    input itself, so its scroll area and blurb work — previously only the buttons',
  '    inside it were clickable, because buttons are the one descendant the blanket',
  '    rule exempts.',
  '  */',
  '  #ui .sheet-backdrop { display: block; }',
  '  #ui .sheet-backdrop.show { pointer-events: auto; }',
  '  #ui .sheet.open { pointer-events: auto; }',
].join('\n');

if (!css.includes(oldMobile)) throw new Error('mobile sheet rules not found');
css = css.replace(oldMobile, newMobile);

fs.writeFileSync(p, css);
console.log('styles.css: sheet pointer-events fixed at ID specificity');
