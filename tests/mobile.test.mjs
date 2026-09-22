#!/usr/bin/env node
/**
 * Mobile UI regression tests.
 *
 * These exist because a real bug reached the user: on a phone the Menu sheet
 * opened but could not be closed by tapping outside it.
 *
 * The cause was CSS specificity, and it is worth stating plainly because it is
 * easy to repeat. The stylesheet makes the whole UI click-through with
 *
 *     #ui > * { pointer-events: none; }
 *
 * and then re-enables named descendants. That selector is specificity (1,0,0) —
 * it contains an ID. A rule added later as
 *
 *     .sheet-backdrop.show { pointer-events: auto; }
 *
 * is (0,2,0), so it loses no matter how specific its classes look. The Menu
 * button appeared to work only because it is a <button>, and the companion rule
 * `#ui button` is (1,0,1) — high enough to win. So "open" worked and "close" did
 * not.
 *
 * The lesson encoded here: for anything that must receive pointer input under
 * #ui, the rule has to carry an ID too, or it silently does nothing. These tests
 * compute specificity and fail when a pointer-events rule cannot win.
 */
import fs from 'node:fs';

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

const css = fs.readFileSync('styles.css', 'utf8');

/**
 * Specificity of a selector as [ids, classes, types].
 *
 * A deliberately small implementation: enough to compare the shapes this
 * stylesheet uses (id, class, tag, descendant combinators). Attribute selectors
 * count as classes, pseudo-classes as classes, pseudo-elements as types, which
 * matches how browsers rank them for the cases here.
 */
function specificity(sel) {
  const s = sel.trim();
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+/g) || []).length
    + (s.match(/\[[^\]]+\]/g) || []).length
    + (s.match(/:[\w-]+(\([^)]*\))?/g) || []).filter((p) => !p.startsWith('::')).length;
  const types = (s.replace(/[#.][\w-]+/g, ' ').match(/\b[a-zA-Z][\w-]*\b/g) || [])
    .filter((t) => !['not', 'is', 'where', 'has'].includes(t)).length
    + (s.match(/::[\w-]+/g) || []).length;
  return [ids, classes, types];
}

/** Compare two specificity triples: returns -1, 0 or 1. */
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Extract top-level style rules, respecting at-rule nesting (media queries).
 * Returns { selector, declarations, inMedia } entries.
 */
function styleRules(text) {
  const out = [];
  // Strip comments first so braces inside them cannot confuse the scan.
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  let buf = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '{') {
      const head = buf.trim();
      stack.push(head);
      buf = '';
    } else if (ch === '}') {
      const head = stack[stack.length - 1];
      if (head && !head.startsWith('@')) {
        // A declaration block: find the '{' we just closed.
        const open = clean.lastIndexOf('{', i);
        const body = clean.slice(open + 1, i);
        const media = stack.find((h) => h.startsWith('@media') || h.startsWith('@supports'));
        out.push({ selector: head, declarations: body, inMedia: media || null });
      }
      stack.pop();
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out;
}

const rules = styleRules(css);

/**
 * Find the winning declaration of a property for a given selector shape.
 *
 * `candidates` are selectors to test; a declaration only counts if its selector
 * would match the element. This is checked against a real element in the browser
 * tests; here the caller passes the relevant selectors explicitly.
 */
function pointerRulesFor(selectors) {
  const found = [];
  for (const r of rules) {
    if (!/pointer-events\s*:/.test(r.declarations)) continue;
    for (const part of r.selector.split(',')) {
      const sel = part.trim();
      if (selectors.includes(sel)) {
        const value = /pointer-events\s*:\s*([\w-]+)/.exec(r.declarations)[1];
        found.push({ sel, value, spec: specificity(sel), media: r.inMedia });
      }
    }
  }
  return found;
}

console.log('--- The blanket click-through rule exists ---');
{
  const blanket = rules.find((r) => r.selector === '#ui > *'
    && /pointer-events\s*:\s*none/.test(r.declarations));
  expect(!!blanket, 'the UI overlay is click-through by default (#ui > *)');
  expect(blanket ? compare(specificity('#ui > *'), [1, 0, 0]) === 0 : false,
    'its specificity is (1,0,0) — an ID, which is the trap',
    blanket ? JSON.stringify(specificity('#ui > *')) : '');
}

console.log('\n--- Things that must receive input beat the blanket rule ---');
{
  // Any selector that re-enables pointer events under #ui must outrank
  // `#ui > *` = (1,0,0). A class-only selector cannot, and would silently fail.
  const reenabling = [];
  for (const r of rules) {
    if (!/pointer-events\s*:\s*(auto|all)/.test(r.declarations)) continue;
    for (const part of r.selector.split(',')) {
      const sel = part.trim();
      if (!sel) continue;
      reenabling.push({ sel, spec: specificity(sel) });
    }
  }

  expect(reenabling.length > 0, 'there are rules that re-enable input',
    `${reenabling.length} selectors`);

  const blanketSpec = [1, 0, 0];
  const losers = reenabling.filter((r) => compare(r.spec, blanketSpec) <= 0);
  expect(losers.length === 0,
    'every pointer-events:auto rule outranks the blanket #ui > * rule',
    losers.length ? 'losers: ' + losers.map((l) => l.sel + ' ' + JSON.stringify(l.spec)).join(', ') : 'all win');
}

console.log('\n--- The sheet and backdrop specifically ---');
{
  // These two are the ones that broke. Pin their exact selectors so a future
  // edit cannot quietly drop the #ui prefix.
  const backdropOpen = pointerRulesFor(['#ui .sheet-backdrop.show', '.sheet-backdrop.show']);
  const backdropHasAuto = backdropOpen.some((r) => r.value === 'auto' && r.sel.startsWith('#ui'));
  expect(backdropHasAuto,
    'the open backdrop enables pointer events with an #ui-prefixed selector',
    backdropOpen.map((r) => r.sel + '=' + r.value).join(' | ') || 'none found');

  const sheetOpen = pointerRulesFor(['#ui .sheet.open', '.sheet.open']);
  const sheetHasAuto = sheetOpen.some((r) => r.value === 'auto' && r.sel.startsWith('#ui'));
  expect(sheetHasAuto,
    'the open sheet enables pointer events with an #ui-prefixed selector',
    sheetOpen.map((r) => r.sel + '=' + r.value).join(' | ') || 'none found');

  // And confirm those selectors really do outrank the blanket rule.
  for (const sel of ['#ui .sheet-backdrop.show', '#ui .sheet.open']) {
    expect(compare(specificity(sel), blanketSpecOf()) > 0,
      `${sel} outranks #ui > *`,
      `${JSON.stringify(specificity(sel))} vs ${JSON.stringify(blanketSpecOf())}`);
  }
}

function blanketSpecOf() { return [1, 0, 0]; }

console.log('\n--- A closed sheet must not cover the board ---');
{
  // The closed sheet is translated off-screen. If it stayed on screen with
  // pointer-events:auto it would swallow every tap meant for the board, which is
  // the failure mode the specificity bug would cause in the opposite direction.
  // The rule may be written on one line or several, so match the selector and the
  // declaration independently rather than assuming a particular layout.
  const sheetBase = rules.find((r) => r.selector.trim() === '.sheet'
    && /display\s*:\s*contents/.test(r.declarations));
  expect(!!sheetBase, 'the desktop sheet wrapper is display:contents (no layout cost)');

  const closedHidden = rules.some((r) => (
    /transform\s*:\s*translateY\(1\d\d%\)|transform\s*:\s*translateY\(101%\)/.test(r.declarations)
  ));
  expect(closedHidden, 'the mobile sheet is parked off-screen by default (translateY ~101%)');

  const openZero = rules.some((r) => /transform\s*:\s*translateY\(0\)/.test(r.declarations));
  expect(openZero, 'the open sheet is positioned at translateY(0)');
}

console.log('\n--- The blanket rule is not accidentally defeating the toggle ---');
{
  // The Menu button worked only because `#ui button` (1,0,1) is strong enough.
  // If the blanket rule were ever raised to `#ui > *` with a button exception
  // removed, the toggle would break too — assert the exception still exists.
  const buttonExempt = rules.some((r) => r.selector.includes('#ui button')
    && /pointer-events\s*:\s*auto/.test(r.declarations));
  expect(buttonExempt, 'buttons under #ui are exempted, which is why Menu works');
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
