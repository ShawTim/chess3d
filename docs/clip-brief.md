# Promo clip — brief for whoever records it

Two ways to use this file: paste the short version straight into a chat with an AI
agent or a videographer, or hand over the whole document. Everything below is
either a fact about the product or a decision already made, so nothing here needs
re-litigating — but the shot list is a proposal, not a straitjacket.

---

## Short version (paste this)

> Record a 15-second promo clip of the browser chess game at
> <https://shawt.im/chess3d/> (source: <https://github.com/ShawTim/chess3d>).
> It must be real screen recording at 60 fps, 1920×1080, with the game's own
> sound, no music, no on-screen text, and the whole board always inside frame.
> The selling point is that the game has no assets: the pieces are lathed from
> profiles in code, the wood is procedural, the lighting is a generated studio
> baked into an environment map, the knocks are synthesised through a generated
> reverb, and the engine is hand-written. Do not claim a strength the engine does
> not have — the tiers are Beginner (~500) to Maximum (~1700), estimates, not a
> rating list. Follow the shot list in the brief: wide drift, a pawn move with the
> legal-move dots, a capture dissolving into dust, a promotion with the piece
> picker, then pull out to the top view. Prepared positions are given as share
> links so no game has to be played to reach them. Deliver 16:9 1080p60 plus a
> 9:16 crop, and a poster frame.

---

## The product, in facts you may rely on

- **Chess3D**, a 3D chess game that runs entirely in one static page. No server,
  no API, no account, no tracking, no build step.
- **Zero assets.** The repository contains no `.glb`, no texture image, no audio
  file, no CDN. Pieces are lathed from hand-tuned 2D profiles (the knight's head
  is lofted along a spine), the board is procedural veneer sampled per square, the
  studio lighting is a hand-built room captured into a PMREM at load, and every
  sound is synthesised at play time — the knock of a piece on wood is filtered
  noise through a generated 0.45 s room impulse.
- **Rules are complete**: castling, en passant, promotion including
  underpromotion, check, stalemate, fifty-move, threefold repetition,
  insufficient material.
- **Six tiers**, honestly labelled by estimated strength: Beginner (~500), Easy
  (~700), Intermediate (~950), Advanced (~1200), Expert (~1450), Maximum (~1700).
  These are estimates from search depth and self-play, not a measured rating
  list. The top tier reaches about depth nine in five seconds on a laptop.
- There is a small opening book, so the first moves are instant and varied.
- **Offline and installable**: a service worker caches everything after the first
  visit.
- A game can be **shared as a URL fragment** and exported as **PGN**.
- Undo, hints, a reviewable move list, keyboard controls, and a phone layout.

Never describe it as Stockfish-level, grandmaster strength, or 2200 Elo. Being
modest about the engine is part of the pitch, and anyone can test it in ten
minutes.

## Deliverables

| File | Spec |
| --- | --- |
| `chess3d-promo-16x9.mp4` | 1920×1080, 60 fps, 12–15 s, H.264 High, yuv420p, AAC 192 kb/s, faststart |
| `chess3d-promo-9x16.mp4` | 1080×1920 crop of the same edit, safe margins for platform UI |
| `chess3d-poster.png` | one frame from the clip, 1920×1080, used as the video thumbnail |

Optional, only if asked for: a 6-second cutdown for autoplay placements, and a
version with a two-second end card.

## Hard rules

1. **Real recording, not a rendered sequence.** The previous attempt at this was
   produced by driving the app headlessly, stepping its clock one frame at a time
   and screenshotting each frame. It was technically 60 fps and it looked
   mechanical: over-tight zooms, snap cuts between positions, no human hand on the
   camera. Screen-record the app as a person would use it.
2. **No text, no logos, no captions burnt in** unless separately agreed. The clip
   is meant to be posted as-is.
3. **No music.** Keep the game's own sounds, recorded from system audio (not a
   microphone — a mic recording of laptop speakers is worse than silence).
4. **Never crop the board.** Every piece must stay inside frame for the whole clip.
5. **Don't fake the UI.** No compositing in fake windows, no invented menus, no
   sped-up playback that misrepresents how fast the engine replies.
6. **Lead with the constraint, not the genre.** "3D chess" is a crowded shelf;
   "a 3D chess game with no assets at all, generated in code" is the hook.

## How to get good footage

- Open <https://shawt.im/chess3d/> in Chrome on a machine with a real GPU, in a
  window at least 1920×1080. A window smaller than that upscales badly.
- Wait for the board to appear, then **click once on the board** — browsers only
  start audio after a gesture, and the knocks are half the "cinematic" claim.
  Check the Sound toggle in the panel is on.
- **Hide the interface** for a clean scene: open the console
  (`View → Developer → JavaScript Console`), run
  `document.getElementById('ui').style.display='none'`, and reload to bring it
  back. Only do this after you have set the difficulty and turned sound on,
  because the controls go with it.
- **Camera**: drag with the mouse, slowly, and let go before you stop moving —
  the orbit has damping, so a slow drag keeps drifting for a moment and reads as
  intentional. Do not orbit past eye level; the board should be seen from above.
  There are view presets in the panel (White, Side, Top) and `F` flips the camera
  180°: use them as beats, not as jumps.
- **Record at 60 fps** and keep the recording clean: QuickTime Player's
  "New Screen Recording" chose 60 fps on recent macOS, or use OBS at 60 fps with
  a capture of the Chrome window only.

### Prepared positions, so no game has to be played

The game stores its state in the URL fragment, so a position can be opened
directly. Each link below leaves White to move, and the engine plays Black — so
the shot is: open link, play the highlighted move, let the engine answer.

- **Capture shot** — <https://shawt.im/chess3d/#moves=e2e4,d7d5>
  White pawn on e4 can take the pawn on d5. That capture is the dust dissolve.
- **Promotion shot** —
  <https://shawt.im/chess3d/#moves=e2e4,d7d5,e4d5,g8f6,d5d6,f6d7,d6c7,h7h6>
  The white pawn stands on c7, one move from promoting on b8 — and it is a
  capture, so the shot gets the dissolve *and* the promotion.

## Shot list (proposal, 15 s)

| Time | Shot | Notes |
| --- | --- | --- |
| 0.0–2.0 | Wide three-quarter view of the starting position, very slow drift right | The light crosses the pieces as the camera moves. No input yet; let the set be the subject. |
| 2.0–4.5 | Hover the e2 pawn, so the legal-move dots appear, then click e4 | The dots are a nice detail; hold on them for half a second before clicking. The pawn lands with a knock. |
| 4.5–7.5 | Open the capture link, hover the e4 pawn (the capture ring shows on d5), then take on d5 | This is the money shot: the captured pawn dissolves into dust. Hold after it lands. |
| 7.5–11.0 | Open the promotion link, click the c7 pawn, take on b8, pick the Queen | The piece picker is a real UI feature worth showing for a beat; the promoted queen pops. |
| 11.0–13.0 | Stay on the resulting position; let the engine answer | The reply is a real engine move with a real animation. Do not cut it short. |
| 13.0–15.0 | Pull back and up to the Top view, hold one second, end | End on the whole board, nothing moving, so the clip can loop or be trimmed. |

Keep at least four frames of stillness at the end — platforms trim the tail.

## What went wrong last time (avoid these)

- The camera pushed in so far that pieces left the frame; the board must stay
  whole.
- Position changes were hard cuts, which read as a slideshow rather than a game.
- The zooms were driven by code on a fixed curve, so they arrived and stopped
  exactly on time — mechanical. A hand on the mouse, with damping, looks alive.
- Only three knocks in fifteen seconds, and nothing else — the audio felt broken
  rather than sparse.
- No cursor and no hover states, so the game looked like an animation rather than
  something you can play.

## Acceptance checklist

- [ ] 1920×1080, 60 fps, 12–15 s, plays in QuickTime and in Chrome.
- [ ] Board and every piece inside frame for the whole clip.
- [ ] At least one capture dissolve and one promotion are visible.
- [ ] The game's own knocks are audible, on the animations, and there is no music.
- [ ] No burnt-in text, no logos, no cursor artefacts left in the frame.
- [ ] Nothing in the clip implies the engine is stronger than the tier table says.
- [ ] A 9:16 crop and a poster frame accompany the master.
