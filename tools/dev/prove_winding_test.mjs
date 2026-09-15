/**
 * Prove the new orientation assertions actually catch the inverted-winding bug.
 *
 * Temporarily flips the knight head's winding back to the broken order, runs the
 * suite, then restores the file. A regression test that cannot fail is worthless,
 * and this bug slipped past every earlier check because they were all blind to
 * triangle orientation.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const target = 'src/render/pieces.js';
const good = fs.readFileSync(target, 'utf8');

const outward = `      indices.push(base + k, next + k2, next + k);
      indices.push(base + k, base + k2, next + k2);`;
const inward = `      indices.push(base + k, next + k, next + k2);
      indices.push(base + k, next + k2, base + k2);`;

if (!good.includes(outward)) {
  console.error('could not find the outward winding to flip');
  process.exit(2);
}

fs.writeFileSync(target, good.replace(outward, inward));
let failed = false;
let output = '';
try {
  output = execSync('node tests/geometry.test.mjs 2>&1', { encoding: 'utf8' });
} catch (e) {
  failed = true;
  output = String(e.stdout || e.message);
} finally {
  fs.writeFileSync(target, good);
}

const flipped = output.split('\n').filter((l) => /FAIL|INWARD/.test(l)).slice(0, 6);
console.log('with winding reverted:');
for (const l of flipped) console.log('  ' + l.trim());
console.log('\nsuite failed as expected:', /FAILURES/.test(output));
console.log('=> the orientation test is a real regression guard:', /FAILURES/.test(output));
