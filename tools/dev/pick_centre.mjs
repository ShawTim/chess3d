/**
 * Pick the knight's forward centring by measuring the ACTUAL built mesh.
 *
 * Previous attempts solved this analytically and got it wrong twice — once by
 * searching the wrong range, once by double-counting the shift that
 * knightHeadGeo already applies internally. Both mistakes were invisible until
 * the geometry tests failed.
 *
 * This version avoids the problem entirely: it patches KNIGHT_Z_CENTRE in a
 * scratch copy of the module, imports the real knightParts(), and measures the
 * head's final bounds. The offset that satisfies both balance constraints with
 * the most slack is then reported. What the tests measure is exactly what is
 * measured here.
 *
 * Constraints
 *   nose overhang  head.max.z - baseBodyRadius <= 0.10
 *   neck back      |head.min.z|            <= baseBodyRadius + 0.05
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = 'src/render/pieces.js';
// The scratch copy must live in the SAME directory as the original, because the
// module imports its siblings with relative paths ('../engine/chess.js') and
// those would resolve against tools/ instead of src/render/.
const SCRATCH = 'src/render/.pieces.scratch.js';
const original = fs.readFileSync(SRC, 'utf8');

const BASE_BODY_RADIUS = 0.185;
const MAX_OVERHANG = 0.10;
const NECK_LIMIT = BASE_BODY_RADIUS + 0.05;

async function measure(centre) {
  const patched = original.replace(
    /const KNIGHT_Z_CENTRE = [^;]+;/,
    `const KNIGHT_Z_CENTRE = ${centre};`,
  );
  if (patched === original) throw new Error('KNIGHT_Z_CENTRE not found in source');
  fs.writeFileSync(SCRATCH, patched);

  // Cache-bust so each measurement loads fresh source.
  const mod = await import(pathToFileURL(path.resolve(SCRATCH)).href + '?v=' + centre);
  const parts = mod.knightParts();
  parts.head.computeBoundingBox();
  const b = parts.head.boundingBox;
  return { minZ: b.min.z, maxZ: b.max.z };
}

const rows = [];
for (let c = 0.080; c <= 0.200; c += 0.004) {
  const centre = Number(c.toFixed(3));
  const { minZ, maxZ } = await measure(centre);
  const overhang = maxZ - BASE_BODY_RADIUS;
  const neck = Math.abs(minZ);
  const noseOk = overhang <= MAX_OVERHANG;
  const neckOk = neck <= NECK_LIMIT;
  rows.push({ centre, minZ, maxZ, overhang, neck, ok: noseOk && neckOk });
}

console.log('  centre   head.min.z   head.max.z   overhang   |neck|   verdict');
for (const r of rows) {
  if (Math.round(r.centre * 1000) % 20 !== 0 && !r.ok) continue;
  console.log(
    `  ${r.centre.toFixed(3)}    ${r.minZ.toFixed(4).padStart(8)}     ${r.maxZ.toFixed(4).padStart(8)}   ` +
    `${r.overhang.toFixed(4).padStart(8)}   ${r.neck.toFixed(4)}   ${r.ok ? 'OK' : 'no'}`,
  );
}

const feasible = rows.filter((r) => r.ok);
console.log('');
if (!feasible.length) {
  console.log('NO feasible centre. Head span =',
    (rows[0].maxZ - rows[0].minZ).toFixed(4),
    ' allowed span =', (BASE_BODY_RADIUS + MAX_OVERHANG + NECK_LIMIT).toFixed(4));
} else {
  // Prefer the option with the most slack on the tighter of the two limits.
  feasible.sort((a, b) => {
    const slack = (r) => Math.min(MAX_OVERHANG - r.overhang, NECK_LIMIT - r.neck);
    return slack(b) - slack(a);
  });
  const best = feasible[0];
  console.log('recommended KNIGHT_Z_CENTRE =', best.centre.toFixed(3));
  console.log('  nose overhang =', best.overhang.toFixed(4), '(limit', MAX_OVERHANG + ')');
  console.log('  |neck back|   =', best.neck.toFixed(4), '(limit', NECK_LIMIT.toFixed(3) + ')');
  console.log('  feasible centres:', feasible.length, 'of', rows.length);
}

fs.rmSync(SCRATCH, { force: true });
