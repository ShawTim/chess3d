/**
 * Add tests/board.test.mjs to the npm test chain.
 *
 * The board-colour bug survived repeated visual review precisely because no test
 * covered square colours, so the assertion belongs in the default suite.
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
].join(' && ');

fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
console.log('npm test now runs:');
for (const c of j.scripts.test.split(' && ')) console.log('  ' + c);
