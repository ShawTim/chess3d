# Getting Chess3D in front of people

Draft copy for the places worth posting to, and the reasons behind the wording.

The one rule: **lead with the thing that is actually unusual.** "3D chess" is a
crowded shelf — chess.com, Lichess and a hundred Three.js demos all render a
board. What almost nobody does is build the *whole* thing in code with no assets:
the pieces turned from lathe profiles, the wood grain sampled per square, the
room baked into a PMREM, the knock of a piece synthesised through a generated
0.45-second reverb, and a chess engine written from scratch — served as static
files with no build step, no CDN and no backend. That is the hook for developers,
and it is true, which is what makes it worth posting.

What not to say: that the engine is 2200 or grandmaster strength. It is not. The
tiers are labelled Beginner (~500) to Maximum (~1700), those numbers are
estimates, and anyone on Hacker News will find out within ten minutes if the copy
overclaims. Being modest about the engine costs nothing and buys credibility for
everything else.

---

## Hacker News — Show HN

**Title** (74 characters, fits):

> Show HN: Chess3D – 3D chess in pure JS with zero external assets

**URL:** <https://shawt.im/chess3d/>

**First comment** — post it immediately after the submission, so the thread opens
with the technical story rather than with "what stack?":

> Author here. The constraint I set myself was that the repository may not contain
> a single asset: no `.glb`, no texture image, no audio file, no CDN, no build
> step. Everything is generated at load time, in the browser, from code.
>
> The pieces are lathed from hand-tuned 2D profiles — foot, plinth, cove, beads,
> collar — and the knight's head is lofted along a curved spine instead of being
> spun. Corners sharper than about 30° are deliberately left creased so a
> highlight stops at the arris instead of being averaged away, and every section
> carries a sub-millimetre ovality so nothing is a perfect solid of revolution.
> The board is veneer: each of the 32 light squares samples a different part of
> the tiling grain, half of them rotated a quarter turn, and the room is a small
> studio — warm key softbox, cool fill, rim strip — captured into an environment
> map at load. The knock of a piece on wood is noise through a generated
> 0.45-second room impulse, so it reads as wood in a room rather than a beep.
>
> The AI is a negamax search with alpha-beta, iterative deepening, a transposition
> table, quiescence search and killer/history ordering, written from scratch in
> plain JS and run in a Web Worker. It is not Stockfish; the tiers are honestly
> labelled from ~500 to ~1700, and there is a small opening book so the first
> moves are instant and varied.
>
> It is a static page. A service worker caches the whole thing after the first
> visit, so it also plays on a plane, and a game can be shared as a URL fragment
> or exported as PGN. Source: https://github.com/ShawTim/chess3d — happy to answer
> anything about the geometry, the renderer or the search.

**Timing:** a weekday morning in US Eastern time (roughly 13:00–15:00 UTC). One
submission only — a repost within a few weeks reads as spam and gets flagged.

---

## Reddit

Reddit rewards a specific claim per subreddit, and punishes the same text posted
everywhere. Post the video first (see below), put the link in the body, and answer
comments as the author.

### r/threejs and r/webgl

**Title:** 100% procedural geometry and textures, zero .glb or image files — a 3D
chess set generated from code

**Body:**

> Every piece is lathed from a 2D profile (the knight's head is lofted along a
> spine), the wood is a procedural grain sampled per square, the marble is noise,
> and the studio lighting is a hand-built room captured into a PMREM at load.
> There is no `.glb`, no texture image and no environment map on disk — the whole
> repository contains no binary asset at all.
>
> The one Three.js trick that mattered most was creasing: I treat the profile as
> cut work, so any corner sharper than ~30° stays split instead of being smoothed,
> which is what makes a bead's highlight stop at the arris. The other was
> sampling the same wood tiling at 32 different offsets (half rotated 90°) so the
> light squares stop looking identical.
>
> Live: https://shawt.im/chess3d/ — source: https://github.com/ShawTim/chess3d
> (Three.js is vendored, no build step.)

### r/proceduralgeneration

**Title:** Everything in this 3D chess game is generated: the pieces, the wood,
the marble, the studio lighting, the sound — and the opponent

**Body:** shorter, and lead with the breadth rather than the chess: the geometry,
the PBR maps, the PMREM environment, the WebAudio knocks through a generated
reverb, and a chess engine written from scratch. Mention that it is all
deterministic and re-generated on every load, and that the procedural pieces are
settled by tests (surface continuity, creasing at the arrises, ovality).

### r/chess

**Title:** A free 3D chess game that runs entirely offline in the browser — six
tiers from ~500 to ~1700, no signup, no ads, no tracking

**Body:** talk like a player, not a developer. Six levels, full rules including
underpromotion, undo, hints, a reviewable move list, PGN export, share links,
works offline once loaded. Say plainly that the engine is a hobby search engine
and not a Stockfish replacement, so a 1500 player will beat the top tier and a
beginner will not. That honesty is what stops the "yet another weak engine"
comments.

### r/javascript

**Title:** A complete 3D game in plain ES modules, no build step, no bundler, no
dependencies installed at runtime

**Body:** the engineering angle — vendored Three.js behind an import map, a
module worker for the engine, `localStorage` auto-save that stores the move list
and replays it through the rules engine instead of trusting a stored board, the
share link as a URL fragment, and a service worker for offline play. Mention the
test suite (`npm test`, 13 suites, ~500 assertions, no browser needed for most of
them).

### r/chessbeginners

Do **not** post here. It is a help subreddit and a game promotion reads as noise.

---

## Three.js forum (discourse.threejs.org, Showcase)

**Title:** Chess3D — procedural pieces, procedural wood, baked studio lighting,
zero assets

Post the same body as r/threejs, plus the technical numbers a Three.js audience
asks for: renderer settings (ACES tone mapping, UnrealBloom, SMAA, a final grade
pass), the PMREM studio setup, why the pieces are creased, and the fact that
everything runs on a vendored 0.160 build with the import map. This is the post
most likely to be picked up by the Three.js newsletter, and it is the one worth
spending an hour on.

---

## itch.io

- **Title:** Chess3D — cinematic 3D chess against an offline engine
- **Tags:** `3d`, `chess`, `webgl`, `procedural`, `board-game`, `singleplayer`
- **Kind of project:** HTML5 (upload the repository folder as-is; it is already
  static and needs no build step)
- **Price:** free, with an optional donation
- **Description:** two short paragraphs — what it looks like (procedurally
  generated set, studio lighting) and how it plays (six tiers, full rules,
  offline, share links, PGN export) — then the same honest note about engine
  strength.

itch.io is the one place that keeps sending traffic without anyone upvoting
anything, so it is worth the twenty minutes.

---

## The 15-second clip

Post a clip with every visual post. Pull the camera close and show, in order:

1. a slow orbit at the start position, with the key light crossing the pieces;
2. the knight leaping and rolling, then settling into its square;
3. a capture dissolving into dust;
4. a promotion, with the piece popping up;
5. the camera dropping to the top view so the board fills the frame.

Record at 60 fps, no music, keep the original sound — the wooden knock is half
the "cinematic" claim.

`docs/clip-brief.md` is the brief to hand to whoever records it: the deliverables,
the hard rules, how to record cleanly, share links that open the exact positions
worth filming, and a shot list with timings. It exists because the first attempt
was produced by driving the app headlessly and stepping its clock frame by frame —
technically 60 fps, and mechanical: the camera pushed in until pieces left the
frame, and cuts between positions read as a slideshow.

---

## Order of operations

1. Publish, confirm the live URL and the offline install both work.
2. Post to r/threejs and r/webgl (they are small and forgiving; if something in
   the copy is wrong, these are the threads that will tell you).
3. Fix whatever they find.
4. Post the Show HN on a weekday morning, US Eastern.
5. Post to r/chess, r/proceduralgeneration and r/javascript over the next few
   days, each with its own angle, never the same text twice.
6. Submit `sitemap.xml` in Google Search Console once (see the README's
   "Search" section) — that is the part that keeps working after the traffic
   spike is gone.
