/**
 * Application entry point.
 *
 * Wires the render rig, board, pieces, HUD and game controller together and
 * drives the single render loop. Everything here runs entirely in the browser:
 * there is no network request in this file or anything it imports, which is what
 * lets the whole game be served as static files.
 */
import * as THREE from 'three';
import { SceneRig } from './render/scene.js';
import { CameraRig } from './render/camera.js';
import { MaterialLibrary } from './render/materials.js';
import { createBoard } from './render/board.js';
import { PieceViews } from './render/pieceViews.js';
import { usableStorage } from './game/autosave.js';
import { buildShareUrl, resultTag, toPgn } from './game/share.js';
import { TapGesture } from './game/tap.js';
import { Hud } from './ui/hud.js';
import { AudioEngine } from './audio/sfx.js';
import { GameController } from './game/controller.js';
import { WHITE } from './engine/chess.js';
import { DIFFICULTIES, getDifficulty } from './engine/ai.js';
import { createPuffTexture } from './render/textures.js';

const loader = document.getElementById('loader');
const loaderNote = document.getElementById('loader-note');

/**
 * Update the loading text and yield so the browser can paint it.
 *
 * The yield races an animation frame against a short timer. Gating purely on
 * requestAnimationFrame would park boot() forever when the page is opened in a
 * background or occluded tab, because rAF does not fire until the tab is
 * visible — the game must still finish initialising without being watched.
 */
function setLoading(text) {
  if (loaderNote) loaderNote.textContent = text;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 32);
  });
}

/**
 * Copy text to the clipboard, returning whether it worked.
 *
 * `navigator.clipboard` needs a secure context and a document that still holds
 * focus, and it can be refused by permission — the selection-based path below is
 * deprecated but still works everywhere, so sharing degrades instead of failing.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the selection-based path */ }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

async function boot() {
  const canvas = document.getElementById('scene');
  // The About article is static markup in index.html (so the page describes
  // itself without JavaScript); all the game does is open its dialog.
  const aboutDialog = document.getElementById('about');

  // ---------------------------------------------------------------- render --
  await setLoading('Building the studio');
  const rig = new SceneRig(canvas);
  const cameraRig = new CameraRig(rig.camera, canvas);
  rig.attachControls(cameraRig.controls);

  await setLoading('Painting textures');
  const lib = new MaterialLibrary({
    anisotropy: Math.min(8, rig.renderer.capabilities.getMaxAnisotropy()),
  });

  // ----------------------------------------------------------------- board --
  await setLoading('Carving the board');
  const board = createBoard(lib, {});
  rig.scene.add(board.group);

  // A large, softly lit disc under the board stands in for a table. It sits
  // below the felt pad's bottom face, so the pad reads as resting on it instead
  // of being sliced by the floor plane.
  const groundGeo = new THREE.CircleGeometry(40, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, lib.ground);
  ground.position.y = -0.38;
  ground.receiveShadow = true;
  rig.scene.add(ground);

  // A warm pool of practical light on the table around the set. Additive and
  // very low opacity: it should read as spill from the key, not as a decal.
  const poolTex = createPuffTexture({ size: 128 });
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex,
    color: 0xffcf9a,
    transparent: true,
    opacity: 0.17,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const poolGeo = new THREE.PlaneGeometry(24, 24);
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.y = -0.377;
  pool.renderOrder = 0;
  rig.scene.add(pool);

  // ---------------------------------------------------------------- pieces --
  await setLoading('Turning the pieces');
  const pieceViews = new PieceViews(rig.scene, lib);

  // -------------------------------------------------------------------- ui --
  const audio = new AudioEngine();
  let controller = null;

  /**
   * Start a new game, but never throw away a live position without asking.
   * A finished game needs no confirmation.
   */
  function requestNewGame() {
    if (!controller || controller.phase === 'over' || controller.moveList.length === 0) {
      controller?.newGame();
      return;
    }
    if (hud.confirmOpen) return;
    hud.showConfirm({
      title: 'Start a new game?',
      detail: 'The current position will be lost.',
      confirmLabel: 'New game',
      onConfirm: () => controller.newGame(),
    });
  }

  /** `localStorage` can be missing, or throw on access in privacy modes. */
  const gameStorage = () => {
    try { return usableStorage(window.localStorage); }
    catch { return null; }
  };

  // Settings survive a reload: a player who turned off the sound or prefers the
  // top view should not have to redo that on every visit.
  const SETTINGS_KEY = 'chess3d.settings.v1';
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch { return {}; }
  })();
  const persist = () => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        difficulty: controller?.difficulty,
        sound: hud.btnSound?.getValue?.(),
        cinematic: hud.btnQuality?.getValue?.(),
      }));
    } catch { /* private mode: settings simply do not persist */ }
  };

  const hud = new Hud({
    onNewGame: (color) => {
      audio.unlock();
      audio.playUi();
      // Choosing the side you are already playing should not restart anything.
      if (color === controller.playerColor) {
        if (controller.moveList.length) {
          hud.showToast('Already playing ' + (color === WHITE ? 'White' : 'Black'));
        }
        return;
      }
      const start = () => {
        controller.setPlayerColor(color);
        hud.setSide(color);
      };
      if (controller.moveList.length && controller.phase !== 'over') {
        hud.showConfirm({
          title: `Start a new game as ${color === WHITE ? 'White' : 'Black'}?`,
          detail: 'Switching sides starts a new game and the current position will be lost.',
          confirmLabel: 'Switch sides',
          onConfirm: start,
        });
      } else {
        start();
      }
    },
    onDifficulty: (id) => {
      audio.unlock();
      audio.playUi();
      controller.setDifficulty(id);
      persist();
    },
    onUndo: () => {
      audio.unlock();
      controller.undo();
    },
    onHint: () => {
      audio.unlock();
      controller.hint();
    },
    onView: (view) => {
      audio.unlock();
      audio.playUi();
      cameraRig.goTo(view, 1.0);
      hud.setView(view);
    },
    onFlip: () => {
      audio.unlock();
      audio.playUi();
      // Flip the CAMERA, not the game. This used to call setPlayerColor, which
      // starts a new game and discarded the position the player was looking at.
      cameraRig.flip();
      hud.setView(null);
    },
    onRestart: () => {
      audio.unlock();
      audio.playUi();
      requestNewGame();
    },
    onSoundToggle: (on) => {
      audio.unlock();
      audio.setEnabled(on);
      if (on) audio.playUi();
      persist();
    },
    onQualityToggle: (on) => { rig.setCinematic(on); persist(); },
    // Sharing needs no server: the whole game fits in the URL fragment, and the
    // address bar is already kept up to date, so a link is just the current URL.
    onShareLink: async () => {
      audio.unlock();
      audio.playUi();
      const url = buildShareUrl(window.location.href, controller.moveList.map((m) => m.uci));
      const copied = await copyText(url);
      // A refused clipboard must not swallow the link: show it so it can still be
      // selected and copied by hand.
      hud.showToast(copied ? 'Link copied' : url, copied ? 1800 : 6000);
    },
    onSharePgn: async () => {
      audio.unlock();
      audio.playUi();
      const status = controller.game.status(controller.history);
      const engine = `Chess3D (${getDifficulty(controller.difficulty).name})`;
      const pgn = toPgn(controller.moveList, {
        white: controller.playerColor === WHITE ? 'You' : engine,
        black: controller.playerColor === WHITE ? engine : 'You',
        result: resultTag(status),
        // PGN wants the page the game was played on, not the share fragment.
        site: window.location.protocol.startsWith('http')
          ? window.location.origin + window.location.pathname
          : '',
      });
      const copied = await copyText(pgn);
      hud.showToast(copied ? 'PGN copied' : 'Copy failed', copied ? 1800 : 3000);
    },
    onMoveClick: (index) => controller.preview(index),
    // The article is a native dialog, so focus trapping and Escape are free. The
    // only script it needs is opening it and letting a backdrop click close it.
    onAbout: () => {
      audio.unlock();
      audio.playUi();
      if (aboutDialog && !aboutDialog.open) aboutDialog.showModal();
    },
    onExitReview: () => controller.returnToLive(),
    // Opening the mobile sheet disables camera input: the sheet is a modal
    // surface, and an orbit drag that started on it should not spin the board
    // behind it. Closing restores control.
    onSheetToggle: (open) => {
      cameraRig.controls.enabled = !open;
    },
  });

  // Apply persisted preferences. Difficulty goes in before init(), because init()
  // may restore a saved game, and the game carries its own side and difficulty —
  // those must win over the settings, not the other way round.
  if (saved.sound === false) {
    audio.setEnabled(false);
    hud.btnSound.setState(false);
  }
  if (saved.cinematic === false) {
    rig.setCinematic(false);
    hud.btnQuality.setState(false);
  }

  // ------------------------------------------------------------ controller --
  await setLoading('Waking the engine');
  controller = new GameController({
    rig, cameraRig, pieceViews, board, hud, audio,
    storage: gameStorage(),
    // The address bar carries the game. `replaceState`, not `pushState`: a game is
    // one continuous state, not a series of pages the back button should walk
    // through. A relative URL is enough, so the game survives being hosted under
    // any path.
    urlSync: {
      read: () => window.location.hash,
      write: (hash) => {
        const { pathname, search } = window.location;
        window.history.replaceState(null, '', hash ? `${pathname}${search}#${hash}` : `${pathname}${search}`);
      },
    },
  });
  if (saved.difficulty && DIFFICULTIES[saved.difficulty]) controller.setDifficulty(saved.difficulty);
  controller.init();
  hud.setSide(controller.playerColor);
  hud.setDifficulty(controller.difficulty);

  // The HUD is on screen now, so its real extents are measurable: re-solve the
  // opening view against them rather than the fallback insets.
  const startView = controller.playerColor === WHITE ? 'white' : 'black';
  cameraRig.applyView(startView);
  hud.setView(startView);

  // ----------------------------------------------------------- interaction --
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  let hoverSquare = null;

  // Touch needs a more forgiving definition of "a tap" than a mouse does. The
  // previous threshold of 6px was tuned for a mouse and rejects a lot of real
  // finger taps, because a finger rolls a few pixels even when the player means
  // to tap straight down. Measured on a phone, a square is only about 30-45 CSS
  // px across, so a 6px slop is a substantial fraction of the target.
  const isCoarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const tap = new TapGesture({ slopPx: () => (isCoarsePointer() ? 14 : 6) });

  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    // A second finger means a pinch (zoom), not a tap; TapGesture drops the
    // candidate in that case. A fresh primary press always starts a new gesture,
    // so a missed pointerup can no longer swallow the next click.
    tap.start(e.pointerId, e.clientX, e.clientY, e.isPrimary);
  });

  canvas.addEventListener('pointermove', (e) => tap.move(e.pointerId, e.clientX, e.clientY));
  canvas.addEventListener('pointercancel', () => tap.cancel());

  canvas.addEventListener('pointerup', (e) => {
    // Holding a piece while deciding is still a tap. Only a gesture that
    // travelled further than the slop radius counts as a camera drag.
    if (!tap.end(e.pointerId)) return;
    const square = pickSquare(e);
    if (square !== null) controller.onSquareClick(square);
  });

  // Hover highlighting is a mouse affordance. On a touch screen there is no
  // hover, and a synthetic pointermove during a drag would flicker highlights
  // across the board, so it is skipped for coarse pointers.
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const square = pickSquare(e);
    if (square === hoverSquare) return;
    hoverSquare = square;
    board.setHover(square);
  });

  canvas.addEventListener('pointerleave', () => {
    hoverSquare = null;
    board.setHover(null);
  });

  /**
   * Resolve a pointer event to a board square.
   *
   * Pieces are tested first. With the old tile-first order, clicking the upper
   * half of a tall piece put the ray through empty air above the board and the
   * plane fallback picked the square BEHIND the piece, so kings and queens were
   * hard to select at steep camera angles. Hitting the piece mesh itself maps
   * back through its userData, which is always the square it stands on.
   */
  function pickSquare(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, rig.camera);

    const pieceHits = raycaster.intersectObjects(pieceViews.group.children, true);
    for (const hit of pieceHits) {
      let node = hit.object;
      while (node && node.userData?.square === undefined) node = node.parent;
      if (node && node.userData.square >= 0) return node.userData.square;
    }

    const tileHits = raycaster.intersectObjects(board.pickTargets(), false);
    if (tileHits.length) {
      const sq = tileHits[0].object.userData.square;
      if (sq !== undefined) return sq;
    }
    if (raycaster.ray.intersectPlane(boardPlane, hitPoint)) {
      return board.worldToSquare(hitPoint);
    }
    return null;
  }

  // -------------------------------------------------------------- shortcuts --
  window.addEventListener('keydown', (e) => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    // Modal surfaces own the keyboard: do not let game shortcuts fire beneath
    // the promotion or confirmation dialog.
    // A modal surface owns the keyboard: the promotion dialog, the confirmation
    // and the About article must not let a game shortcut fire underneath them.
    if (controller.phase === 'promoting' || hud.confirmOpen || aboutDialog?.open) return;
    switch (e.key.toLowerCase()) {
      case 'u': controller.undo(); break;
      case 'h': controller.hint(); break;
      case 'n': requestNewGame(); break;
      case 'f':
        // Flip the camera only. This used to change sides, which restarted the
        // game and lost the position the player was looking at.
        cameraRig.flip();
        hud.setView(null);
        break;
      case '1': cameraRig.goTo('white'); hud.setView('white'); break;
      case '2': cameraRig.goTo('black'); hud.setView('black'); break;
      case '3': cameraRig.goTo('side'); hud.setView('side'); break;
      case '4': cameraRig.goTo('top'); hud.setView('top'); break;
      case 'escape':
        if (controller.reviewPly !== null) controller.returnToLive();
        else if (hud.sheetOpen) hud.closeSheet();
        else controller.clearSelection();
        break;
      default: break;
    }
  });

  // ------------------------------------------------------------------ link --
  // Pasting or editing a share link changes only the fragment, which navigates
  // without reloading: without this, the address bar would name one position
  // while the board showed another.
  window.addEventListener('hashchange', () => {
    if (!controller.adoptUrlHash()) controller.writeUrl();
  });

  // A click on the backdrop is delivered to the dialog element itself, which is
  // the cheapest way to offer click-outside-to-close without a wrapper div.
  aboutDialog?.addEventListener('click', (event) => {
    if (event.target === aboutDialog) aboutDialog.close();
  });

  // ----------------------------------------------------------------- resize --
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      rig.resize();
      cameraRig.reframe();
    }, 90);
  });

  // -------------------------------------------------------------- main loop --
  const clock = new THREE.Clock();
  let running = true;
  let rafHandle = 0;
  let timerHandle = 0;

  /**
   * Schedule the next frame.
   *
   * requestAnimationFrame is preferred (it is vsync-aligned and pauses when the
   * tab is hidden), but it does not fire at all in a background or occluded tab
   * — including the first frame. A timer is raced against it so the simulation
   * still starts when the page is opened without focus, and the first rAF to
   * arrive takes over from then on.
   */
  function schedule() {
    let scheduled = false;
    const next = () => {
      if (scheduled || !running) return;
      scheduled = true;
      clearTimeout(timerHandle);
      frame();
    };
    rafHandle = requestAnimationFrame(next);
    timerHandle = setTimeout(next, 100);
  }

  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05);

    cameraRig.update(dt);
    pieceViews.update(dt);
    controller.update(dt);
    rig.render(dt);

    schedule();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(rafHandle);
      clearTimeout(timerHandle);
    } else if (!running) {
      running = true;
      clock.getDelta();
      schedule();
    }
  });

  await setLoading('Ready');
  schedule();

  // Fade the loader out once the first frame is on screen. Raced against a
  // timer for the same reason as setLoading: rAF may never fire here.
  const hideLoader = () => {
    if (!loader) return;
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 800);
  };
  requestAnimationFrame(hideLoader);
  setTimeout(hideLoader, 600);

  // ------------------------------------------------------------- offline --
  // The service worker caches the whole game, which is what lets it open with no
  // network — and what makes the page installable as an app.
  //
  // Registered only after the first frame: fetching and caching forty files must
  // never compete with the boot, and a player who leaves immediately has no use
  // for the cache. A failure is not fatal either — without a worker the game is
  // still a set of static files and simply needs the network.
  if ('serviceWorker' in navigator) {
    const register = () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  // Exposed for debugging from the console.
  window.__chess = { rig, cameraRig, board, pieceViews, controller, hud, audio, lib };
}

boot().catch((err) => {
  console.error('Failed to start Chess3D:', err);
  if (loaderNote) {
    loaderNote.textContent = 'Failed to start: ' + (err && err.message ? err.message : err);
    loaderNote.style.color = '#e2795f';
  }
});
