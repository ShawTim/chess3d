/**
 * Add tests/mobile.test.mjs to the npm test chain.
 *
 * The pointer-events bug shipped because the only verification of the mobile UI
 * used element.click(), which invokes a handler directly and therefore cannot
 * detect a rule that makes an element unclickable. This test computes CSS
 * specificity instead, so a rule that silently loses to the blanket `#ui > *`
 * click-through selector now fails the build.
 */
import fs from 'node:fs';

const p = 'package.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

j.scripts.test = [
  'node tests/perft.test.mjs',
  'node tests/ai.test.mjs',
  'node tests/geometry.test.mjs',
  'node tests/capture.test.mjs',
  'node tests/board.test.mjs',
  'node tests/mobile.test.mjs',
  'node tests/seo.test.mjs',
].join(' && ');

fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
console.log('npm test now runs:');
for (const c of j.scripts.test.split(' && ')) console.log('  ' + c);
