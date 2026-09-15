/**
 * Prove the shading assertion catches the flat-shading regression.
 *
 * Temporarily restores the non-indexed merge (which forced per-face normals),
 * runs the suite, then restores the file.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const target = 'src/render/pieces.js';
const good = fs.readFileSync(target, 'utf8');

const fixed = `  const merged = mergeGeometries(parts.map(toIndexed), false);
  merged.computeVertexNormals();`;
const flat = `  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  merged.computeVertexNormals();`;

if (!good.includes(fixed)) {
  console.error('could not find the indexed merge to revert');
  process.exit(2);
}

fs.writeFileSync(target, good.replace(fixed, flat));
let output = '';
try {
  output = execSync('node tests/geometry.test.mjs 2>&1', { encoding: 'utf8' });
} catch (e) {
  output = String(e.stdout || e.message);
} finally {
  fs.writeFileSync(target, good);
}

const lines = output.split('\n').filter((l) => /FAIL|faceted/.test(l)).slice(0, 4);
console.log('with the non-indexed merge restored:');
for (const l of lines) console.log('  ' + l.trim());
console.log('\nsuite failed as expected:', /FAILURES/.test(output));
