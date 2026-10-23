#!/usr/bin/env node
/**
 * Verify the SEO and social metadata is complete and internally consistent.
 *
 * These are the checks that are easy to get wrong and impossible to notice by
 * looking at the page:
 *
 *   - og:image and twitter:image must be ABSOLUTE urls. Crawlers do not resolve
 *     relative paths against the page, so a relative value silently produces no
 *     preview image at all.
 *   - every locally-referenced asset (icons, manifest, og image) must exist on
 *     disk, or the tag points at a 404.
 *   - canonical and og:url must match the host AND subpath the site serves from.
 *   - the structured data must parse as JSON and declare what schema.org needs.
 *
 * Run from the repository root.
 */
import fs from 'node:fs';

const ORIGIN = 'https://shawt.im/chess3d/';
let failures = 0;
let checks = 0;

function expect(cond, label, detail = '') {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${label} ${detail}`);
  } else {
    console.log(`ok   ${label} ${detail}`);
  }
}

const html = fs.readFileSync('index.html', 'utf8');
const attr = (re) => {
  const m = html.match(re);
  return m ? m[1] : null;
};
const og = (p) => attr(new RegExp(`<meta property="${p}" content="([^"]+)"`));
const tw = (p) => attr(new RegExp(`<meta name="${p}" content="([^"]+)"`));

console.log('--- Core metadata ---');
const title = attr(/<title>([^<]+)<\/title>/);
const desc = attr(/<meta name="description" content="([^"]+)"/);
const canonical = attr(/<link rel="canonical" href="([^"]+)"/);
expect(!!title && title.length > 10 && title.length < 70,
  'title present, sensible length', `"${title}" (${title ? title.length : 0} chars)`);
expect(!!desc && desc.length >= 80 && desc.length <= 320,
  'description present, sensible length', `${desc ? desc.length : 0} chars`);
expect(canonical === ORIGIN, 'canonical points at the real URL', `${canonical}`);
expect(/index/.test(attr(/<meta name="robots" content="([^"]+)"/) ?? ''),
  'robots meta permits indexing');

console.log('\n--- Open Graph ---');
for (const p of ['og:type', 'og:title', 'og:description', 'og:image', 'og:url', 'og:site_name', 'og:image:alt']) {
  expect(!!og(p), `${p} present`);
}
expect(/^https?:\/\//.test(og('og:image') ?? ''),
  'og:image is ABSOLUTE (crawlers cannot resolve relative)', og('og:image'));
expect(og('og:url') === ORIGIN, 'og:url matches the canonical', `${og('og:url')}`);
expect(`${og('og:image:width')}x${og('og:image:height')}` === '1200x630',
  'og:image declares 1200x630',
  `${og('og:image:width')}x${og('og:image:height')}`);
// The version query is what makes a regenerated card appear without anyone
// re-scraping it by hand, so the card URL and the secure URL must agree on it.
const ogImage = og('og:image') ?? '';
expect(ogImage === (og('og:image:secure_url') ?? ''),
  'og:image and og:image:secure_url are the same URL',
  `${ogImage} vs ${og('og:image:secure_url')}`);

console.log('\n--- Twitter / X ---');
expect(tw('twitter:card') === 'summary_large_image',
  'card type is summary_large_image', tw('twitter:card'));
expect(!!tw('twitter:title') && !!tw('twitter:description'), 'title and description present');
expect(/^https?:\/\//.test(tw('twitter:image') ?? ''),
  'twitter:image is ABSOLUTE', tw('twitter:image'));
expect((tw('twitter:image') ?? '') === ogImage,
  'twitter:image is the same card URL as og:image',
  `${tw('twitter:image')} vs ${ogImage}`);

console.log('\n--- Referenced local assets exist on disk ---');
const refs = new Set();
for (const m of html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)) refs.add(m[1]);
for (const r of [...refs].sort()) {
  const exists = fs.existsSync(r);
  if (!exists) failures++;
  checks++;
  console.log(`${exists ? 'ok  ' : 'FAIL'} ${r}${exists ? '' : '  <- MISSING'}`);
}
// The og image is referenced by absolute URL, so check its path separately. The
// ?v= query is a cache buster for the social platforms, not part of the file
// name, so it is stripped before asking the filesystem.
const ogPath = (og('og:image') ?? '').replace(ORIGIN, '').replace(/\?.*$/, '');
const ogExists = !!ogPath && fs.existsSync(ogPath);
if (!ogExists) failures++;
checks++;
console.log(`${ogExists ? 'ok  ' : 'FAIL'} ${ogPath || '(none)'} (og image)`);

console.log('\n--- Supporting files ---');
for (const f of ['robots.txt', 'sitemap.xml', 'site.webmanifest', '.nojekyll']) {
  const ok = fs.existsSync(f);
  if (!ok) failures++;
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f}`);
}

console.log('\n--- robots.txt and sitemap.xml agree ---');
{
  const robots = fs.readFileSync('robots.txt', 'utf8');
  const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
  const loc = sitemap.match(/<loc>([^<]+)<\/loc>/)?.[1];
  expect(/Sitemap:\s*https?:\/\//.test(robots), 'robots.txt declares a sitemap');
  expect(robots.includes(loc ?? '\u0000'), 'robots.txt sitemap URL matches sitemap.xml', loc);
  expect(loc === ORIGIN, 'sitemap loc is the real URL', `${loc}`);
  expect(!/^Disallow:\s*\/\s*$/m.test(robots), 'robots.txt does not block everything');
}

console.log('\n--- Structured data (JSON-LD) ---');
{
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(!!m, 'JSON-LD block present');
  let data = null;
  if (m) {
    try {
      data = JSON.parse(m[1]);
      expect(true, 'JSON-LD parses as valid JSON');
    } catch (e) {
      expect(false, 'JSON-LD parses as valid JSON', String(e.message));
    }
  }
  if (data) {
    expect(data['@context'] === 'https://schema.org', '@context is schema.org');
    expect(data['@type'] === 'WebApplication', '@type is WebApplication', data['@type']);
    expect(typeof data.name === 'string' && data.name.length > 0, 'name set', data.name);
    expect(typeof data.description === 'string' && data.description.length > 0, 'description set');
    expect(data.url === ORIGIN, 'url matches the canonical', data.url);
    expect(Array.isArray(data.featureList) && data.featureList.length > 0,
      'featureList is a non-empty array', `${data.featureList ? data.featureList.length : 0} entries`);
    expect(!!data.offers && data.offers.price === '0', 'declares a free price');
    expect(!!data.image && /^https?:\/\//.test(data.image), 'image is an absolute URL');
  }
}

console.log('\n--- Web manifest ---');
{
  let mf = null;
  try {
    mf = JSON.parse(fs.readFileSync('site.webmanifest', 'utf8'));
    expect(true, 'manifest parses as valid JSON');
  } catch (e) {
    expect(false, 'manifest parses as valid JSON', String(e.message));
  }
  if (mf) {
    expect(!!mf.name && !!mf.short_name, 'name and short_name set');
    expect(!!mf.start_url && !!mf.display, 'start_url and display set', `display=${mf.display}`);
    expect(Array.isArray(mf.icons) && mf.icons.length >= 2,
      'at least two icons declared', `${mf.icons ? mf.icons.length : 0}`);
    for (const ic of mf.icons ?? []) {
      const p = ic.src.replace(/^\.\//, '');
      const ok = fs.existsSync(p);
      if (!ok) failures++;
      checks++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} icon ${p}${ok ? '' : '  <- MISSING'}`);
    }
  }
}

console.log('\n--- Every image we generate is a sane size ---');
for (const [f, min] of [['docs/og-image.png', 20000], ['docs/icon-512.png', 3000],
  ['docs/apple-touch-icon.png', 1000], ['docs/favicon-32.png', 200]]) {
  const sz = fs.existsSync(f) ? fs.statSync(f).size : 0;
  const ok = sz >= min;
  if (!ok) failures++;
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} ${sz} bytes (min ${min})`);
}

console.log('\n--- Text a crawler can read without playing the game ---');
{
  // Strip script/style and tags, then count what a reader would actually see.
  const text = (source) => source
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = (source) => text(source).split(' ').filter(Boolean).length;

  const about = html.match(/<dialog id="about"[\s\S]*?<\/dialog>/)?.[0] ?? '';
  const noScript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';

  expect(about.length > 0, 'the About article is in the document');
  expect(/<article class="about-body">/.test(about), 'the text is an article, not div soup');
  expect(/aria-labelledby="about-title"/.test(about), 'the dialog is named by its own heading');
  expect(/<h1 id="about-title">/.test(about), 'and has a real top-level heading');
  expect(!/<dialog[^>]*\sopen\b/.test(html),
    'the dialog is closed on load, so it costs the board no layout');

  const aboutWords = words(about);
  expect(aboutWords >= 450, 'the article has enough substance to be worth indexing',
    `${aboutWords} words`);

  // The long-tail terms the page is actually about. A crawler that runs no
  // scripts used to see one sentence, which is what made this a thin page.
  for (const term of ['Chess3D', 'three-dimensional', 'Three.js', 'offline',
    'Web Worker', 'castling', 'en passant', 'Staunton', 'procedural', 'PGN']) {
    expect(new RegExp(term, 'i').test(text(about)), `the article mentions ${term}`);
  }
  expect(!/https?:\/\//.test(text(about)), 'the article references nothing external');

  const noScriptWords = words(noScript);
  expect(noScriptWords >= 80, 'the no-JavaScript summary is a paragraph, not a warning',
    `${noScriptWords} words`);
  expect(/WebGL/.test(noScript), 'and still explains what the game needs');

  const total = aboutWords + noScriptWords;
  expect(total >= 550, 'the page carries real text with no script at all', `${total} words`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : 'FAILURES: ' + failures} (${checks} checks)`);
process.exit(failures === 0 ? 0 : 1);
