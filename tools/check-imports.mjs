/**
 * Verify that every import in the SHIPPED source resolves.
 *
 * Scoped to src/ deliberately: tools/dev/ holds one-off authoring scripts kept
 * only for reference, and some of those reference exports that were renamed or
 * removed during the work. They are not part of the deployed app.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|mjs)$/.test(e.name)) files.push(p);
  }
})(path.join(root, 'src'));

let errors = 0, checked = 0;
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) {
    const spec = m[1];
    checked++;
    if (spec.startsWith('three')) {
      const mapped = spec === 'three' ? 'vendor/three/three.module.js'
        : path.join('vendor/three/addons', spec.slice('three/addons/'.length));
      if (!fs.existsSync(path.join(root, mapped))) {
        console.log('UNRESOLVED (importmap):', spec, 'in', path.relative(root, f));
        errors++;
      }
      continue;
    }
    if (!spec.startsWith('.')) continue;
    if (!fs.existsSync(path.resolve(path.dirname(f), spec))) {
      console.log('UNRESOLVED:', spec, 'in', path.relative(root, f));
      errors++;
    }
  }
}
console.log(`shipped source: checked ${checked} imports across ${files.length} modules, ${errors} unresolved`);
