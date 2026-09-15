/**
 * Prove the board-colour test is a real regression guard.
 *
 * Temporarily reverts the parity to the inverted version, runs the board test,
 * and restores the file. A test that cannot fail on the bug it targets is
 * worthless, and this bug survived repeated visual review precisely because
 * nothing checked it.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const target = 'src/render/board.js';
const good = fs.readFileSync(target, 'utf8');

const fixed = 'return (((sq >> 3) + (sq & 7)) & 1) === 1;';
const inverted = 'return (((sq >> 3) + (sq & 7)) & 1) === 0;';

if (!good.includes(fixed)) {
  console.error('could not find the fixed parity line');
  process.exit(2);
}

fs.writeFileSync(target, good.replace(fixed, inverted));
let output = '';
try {
  output = execSync('node tests/board.test.mjs 2>&1', { encoding: 'utf8' });
} catch (e) {
  output = String(e.stdout || e.message);
} finally {
  fs.writeFileSync(target, good);
}

const lines = output.split('\n').filter((l) => /FAIL|wrong/i.test(l)).slice(0, 5);
console.log('with the inverted parity restored:');
lines.forEach((l) => console.log('  ' + l.trim()));
console.log('\nsuite failed as expected:', /FAILURES/.test(output));

// And confirm the restored file passes again.
const after = execSync('node tests/board.test.mjs 2>&1', { encoding: 'utf8' });
console.log('restored file passes:', /ALL PASS/.test(after));
