/**
 * Update the README's Deployment section for the files that now ship.
 *
 * The original list predates the SEO work: it named only index.html, styles.css,
 * src/ and vendor/, so anyone following it would publish a site whose social
 * previews 404 and whose manifest and sitemap are missing.
 */
import fs from 'node:fs';

const readme = 'README.md';
let r = fs.readFileSync(readme, 'utf8');

const start = r.indexOf('## Deployment');
const end = r.indexOf('## Browser support');
if (start < 0 || end < 0 || end <= start) throw new Error('deployment section not found');

const section = `## Deployment

The app is static files, so any static host works: GitHub Pages, Netlify,
Cloudflare Pages, S3, nginx. There is no build step.

**Live:** <https://shawt.im/chess3d/>

### What to publish

Everything except the development-only paths:

| Path | Why it ships |
| --- | --- |
| \`index.html\` | the page, including all SEO and social metadata |
| \`styles.css\` | the UI styling |
| \`src/\` | the engine, renderer, HUD and AI worker |
| \`vendor/\` | Three.js, vendored so nothing loads from a CDN |
| \`docs/\` | the social card, app icons and README screenshot |
| \`robots.txt\` | crawler policy and sitemap pointer |
| \`sitemap.xml\` | the single URL, for search engines |
| \`site.webmanifest\` | app name, icons and theme colour for install |
| \`.nojekyll\` | **required on GitHub Pages** — without it Jekyll processing can drop files |

Development-only, safe to exclude: \`node_modules/\`, \`tests/\`, \`tools/\`,
\`package.json\`, \`package-lock.json\`.

### Host requirements

Two things must be true of the host, and both are worth checking because they
fail in ways that are easy to miss:

1. **\`.js\` must be served with a JavaScript MIME type.** The page uses a module
   worker, and a wrong content type stops the AI worker loading. Every common
   static host does this correctly.
2. **The site may live under a subpath.** All asset paths are relative and the
   import map points at \`./vendor/...\`, so the app works at \`/chess3d/\` as well
   as at a domain root. The absolute URLs in \`index.html\` (canonical, \`og:image\`,
   sitemap) are the one place a subpath is hard-coded — update those four values
   if you host it somewhere else.

### GitHub Pages

Publish the repository root from the \`main\` branch. \`.nojekyll\` is already
committed. If you use a custom domain, set it in the repository's Pages settings
and add a \`CNAME\` file containing the domain.

### Social previews

\`docs/og-image.png\` (1200x630) is referenced by absolute URL, and \`og:image\`
points at it. After changing it, re-scrape the URL with the
[Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) or the
[Twitter Card Validator](https://cards-dev.twitter.com/validator) to clear the
cached preview. \`npm test\` includes \`tests/seo.test.mjs\`, which fails if the
image goes missing or the URLs drift from the deployed origin.

### Regenerating the images

\`\`\`bash
python3 tools/make-social-images.py   # needs Pillow and docs/hero-render.png
\`\`\`

The script composes the card from a captured 3D render, so it can be rebuilt at
any time rather than being a hand-edited binary.

`;

r = r.slice(0, start) + section + r.slice(end);
fs.writeFileSync(readme, r);
console.log('Deployment section rewritten');
