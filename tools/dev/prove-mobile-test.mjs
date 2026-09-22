/**
 * Prove the mobile pointer-events test is a real regression guard.
 *
 * Temporarily reverts the fix (drops the #ui prefix from the open-sheet and
 * backdrop rules, which is exactly the bug that shipped), runs the mobile test,
 * and restores the file. A test that cannot fail on the bug it targets is
 * worthless, and the bug that reached the user got there because the earlier
 * verification used element.click() — which invokes the handler directly and
 * bypasses hit-testing entirely.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const target = 'styles.css';
const good = fs.readFileSync(target, 'utf8');

const fixedBackdrop = '#ui .sheet-backdrop.show { opacity: 1; pointer-events: auto; }';
const buggyBackdrop = '.sheet-backdrop.show { opacity: 1; pointer-events: auto; }';

const fixedSheet = '#ui .sheet.open { pointer-events: auto; }';
const buggySheet = '.sheet.open { pointer-events: auto; }';

if (!good.includes(fixedBackdrop) || !good.includes(fixedSheet)) {
  console.error('could not find the fixed selectors to revert');
  process.exit(2);
}

let broken = good.replace(fixedBackdrop, buggyBackdrop).replace(fixedSheet, buggySheet);
fs.writeFileSync(target, broken);

let output = '';
try {
  output = execSync('node tests/mobile.test.mjs 2>&1', { encoding: 'utf8' });
} catch (e) {
  output = String(e.stdout || e.message);
} finally {
  fs.writeFileSync(target, good);
}

console.log('with the #ui prefix removed (the original bug):');
for (const l of output.split('\n').filter((l) => /FAIL|loser/i.test(l)).slice(0, 5)) {
  console.log('  ' + l.trim());
}
console.log('\nsuite failed as expected:', /FAILURES/.test(output));

const after = execSync('node tests/mobile.test.mjs 2>&1', { encoding: 'utf8' });
console.log('restored file passes:', /ALL PASS/.test(after));
