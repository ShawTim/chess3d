/**
 * One-off repair: strip stray tool-syntax tags that leaked into the source when
 * a large file was written through a wrapper that appended its closing tag.
 */
import fs from 'node:fs';

const files = ['src/render/pieces.js'];
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s.length;
  s = s.replace(/^<\/parameter>\s*$/gm, '');
  s = s.replace(/^<\/invoke>\s*$/gm, '');
  s = s.replace(/^<parameter name="[^"]*">\s*$/gm, '');
  fs.writeFileSync(f, s);
  console.log(f, 'removed', before - s.length, 'chars');
}
