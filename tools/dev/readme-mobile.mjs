/**
 * Document the mobile support in the README.
 *
 * The mobile work introduced a layout concept (the collapsible sheet) and a
 * measured set of numbers, both of which belong in the docs: without them the
 * next person to touch the CSS has no way to tell whether a change helped.
 */
import fs from 'node:fs';

const p = 'README.md';
let r = fs.readFileSync(p, 'utf8');

// --- Controls: document touch ---
const controlTable = `| Input | Action |
| --- | --- |
| Click a piece, then a destination | Move |
| Drag on the board | Orbit the camera |
| Scroll | Zoom |`;
const newControlTable = `| Input | Action |
| --- | --- |
| Click / tap a piece, then a destination | Move |
| Drag on the board | Orbit the camera |
| Scroll or pinch | Zoom |
| Tap **Menu** (phone) | Open difficulty, side, move list and captured pieces |`;
if (r.includes(controlTable)) {
  r = r.replace(controlTable, newControlTable);
  console.log('README: controls updated for touch');
}

// --- Testing: add the mobile suite note -------------------------------------
const suiteAnchor = '- `tests/seo.test.mjs` — the social and search metadata: absolute og:image URLs,';
if (r.includes(suiteAnchor) && !r.includes('mobile-harness')) {
  const mobileNote = `
### Checking mobile layout

\`tools/dev/mobile-harness.html\` runs the app inside an iframe at real device
sizes, one at a time (\`?only=ip14\`), and reports the projected board rect, the
panel rects, and the on-screen size of one board square. It exists because the
mobile layout cannot be judged by eye — the failures it found were numbers:
the board overflowing by 29px, panels overlapping it, and a square 21.9px across.

\`\`\`bash
npm run serve   # then open /tools/dev/mobile-harness.html?only=ip14
\`\`\`

Measured square sizes, all five viewports with zero overflow and no panel overlap:

| Device | Square |
| --- | --- |
| iPhone SE 375x667 | 36.2px |
| iPhone 14 390x844 | 39.4px |
| Pixel 7 412x915 | 42.7px |
| iPad mini 744x1133 | 74.4px |
| iPhone landscape 844x390 | 26.6px (81.8px after pinch) |

Landscape stays smaller because the space between the bars is only 276px of a
390px screen — that is geometry, not a defect. Pinch-zoom is the answer there, and
the camera also tilts towards top-down on short wide viewports so the squares
project as large as the band allows.
`;
  // Insert before the Deployment section.
  const deploy = r.indexOf('## Deployment');
  if (deploy > 0) {
    r = r.slice(0, deploy) + mobileNote + '\n' + r.slice(deploy);
    console.log('README: mobile harness documented');
  }
}

// --- Features: mention the phone layout -------------------------------------
const featAnchor = '- Camera presets that solve their own framing against the live UI layout, so the';
if (r.includes(featAnchor) && !r.includes('collapses into an on-demand sheet')) {
  r = r.replace(
    featAnchor,
    '- A phone layout that collapses both side panels into an on-demand sheet, so the\n  board gets the screen; framing adapts to the viewport shape.\n- Camera presets that solve their own framing against the live UI layout, so the',
  );
  console.log('README: features updated');
}

fs.writeFileSync(p, r);
