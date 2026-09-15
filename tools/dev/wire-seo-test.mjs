/**
 * Add tests/seo.test.mjs to the npm test chain, and document the SEO work in the
 * README.
 *
 * The SEO metadata is the kind of thing that silently rots: a relative og:image,
 * a canonical pointing at the wrong host, or a renamed icon file all produce
 * broken previews that nobody notices until the link is shared. So it belongs in
 * the default suite alongside the game tests.
 */
import fs from 'node:fs';

// --- 1. npm test --------------------------------------------------------------
const pkg = 'package.json';
const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
j.scripts.test = [
  'node tests/perft.test.mjs',
  'node tests/ai.test.mjs',
  'node tests/geometry.test.mjs',
  'node tests/capture.test.mjs',
  'node tests/board.test.mjs',
  'node tests/seo.test.mjs',
].join(' && ');
fs.writeFileSync(pkg, JSON.stringify(j, null, 2) + '\n');
console.log('npm test now runs:');
for (const c of j.scripts.test.split(' && ')) console.log('  ' + c);

// --- 2. README: live URL + the two new suites --------------------------------
const readme = 'README.md';
let r = fs.readFileSync(readme, 'utf8');

// Put the live link near the top, where a visitor looks for it.
const introAnchor = '![Chess3D](docs/screenshot.png)';
if (r.includes(introAnchor) && !r.includes('**Play it now:**')) {
  r = r.replace(
    introAnchor,
    '**Play it now:** <https://shawt.im/chess3d/>\n\n' + introAnchor,
  );
  console.log('README: live URL added');
}

// Document the two suites that were added after the original write-up.
const oldSuiteList = '- `tests/capture.test.mjs` — the view layer, run headlessly against a stubbed\n  canvas: a capture must remove the captured piece, not the capturing one.';
const newSuiteList = oldSuiteList + `
- \`tests/board.test.mjs\` — the board's square colours, asserted against the rules
  of chess rather than against the implementation: a1 dark, h1 light, the queen on
  her own colour. This caught a real bug that had inverted every square for most of
  the project's life and survived repeated visual review, because nothing checked
  it and a rendered board looks plausible either way.
- \`tests/seo.test.mjs\` — the social and search metadata: absolute og:image URLs,
  a canonical matching the deployed host and subpath, structured data that parses,
  and every referenced icon present on disk.`;
if (r.includes(oldSuiteList)) {
  r = r.replace(oldSuiteList, newSuiteList);
  console.log('README: new suites documented');
}

fs.writeFileSync(readme, r);
