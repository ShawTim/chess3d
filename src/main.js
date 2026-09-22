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
import { Hud } from './ui/hud.js';
import { AudioEngine } from './audio/sfx.js';
import { GameController } from './game/controller.js';
import { WHITE, BLACK } from './engine/chess.js';

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

async function boot() {
  const canvas = document.getElementById('scene');

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

  // A large, softly lit disc under the board stands in for a table.
  const groundGeo = new THREE.CircleGeometry(40, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, lib.ground);
  ground.position.y = -0.32;
  ground.receiveShadow = true;
  rig.scene.add(ground);

  // ---------------------------------------------------------------- pieces --
  await setLoading('Turning the pieces');
  const pieceViews = new PieceViews(rig.scene, lib);

  // -------------------------------------------------------------------- ui --
  const audio = new AudioEngine();
  let controller = null;

  const hud = new Hud({
    onNewGame: (color) => {
      audio.unlock();
      audio.playUi();
      controller.setPlayerColor(color);
      hud.setSide(color);
    },
    onDifficulty: (id) => {
      audio.unlock();
      audio.playUi();
      controller.setDifficulty(id);
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
      const side = controller.playerColor === WHITE ? BLACK : WHITE;
      controller.setPlayerColor(side);
      hud.setSide(side);
    },
    onRestart: () => {
      audio.unlock();
      audio.playUi();
      controller.newGame();
    },
    onSoundToggle: (on) => {
      audio.unlock();
      audio.setEnabled(on);
      if (on) audio.playUi();
    },
    onQualityToggle: (on) => rig.setCinematic(on),
    // Opening the mobile sheet disables camera input: the sheet is a modal
    // surface, and an orbit drag that started on it should not spin the board
    // behind it. Closing restores control.
    onSheetToggle: (open) => {
      cameraRig.controls.enabled = !open;
    },
  });

  // ------------------------------------------------------------ controller --
  await setLoading('Waking the engine');
  controller = new GameController({ rig, cameraRig, pieceViews, board, hud, audio });
  controller.init();
  hud.setSide(WHITE);

  // The HUD is on screen now, so its real extents are measurable: re-solve the
  // opening view against them rather than the fallback insets.
  cameraRig.applyView('white');
  hud.setView('white');

  // ----------------------------------------------------------- interaction --
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  let pointerDown = null;
  let hoverSquare = null;

  // Touch needs a more forgiving definition of "a tap" than a mouse does. The
  // previous threshold of 6px was tuned for a mouse and rejects a lot of real
  // finger taps, because a finger rolls a few pixels even when the player means
  // to tap straight down. Measured on a phone, a square is only about 30-45 CSS
  // px across, so a 6px slop is a substantial fraction of the target.
  const isCoarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const TAP_SLOP_PX = () => (isCoarsePointer() ? 14 : 6);
  const TAP_TIME_MS = () => (isCoarsePointer() ? 900 : 700);

  canvas.addEventListener('pointerdown', (e) => {
    // A second finger means a pinch (zoom), not a tap: abandon the pending tap so
    // the gesture does not also register as a board click on release.
    if (pointerDown) { pointerDown = null; return; }
    pointerDown = { x: e.clientX, y: e.clientY, time: performance.now(), id: e.pointerId };
    audio.unlock();
  });

  canvas.addEventListener('pointercancel', () => { pointerDown = null; });

  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDown || e.pointerId !== pointerDown.id) return;
    const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    const elapsed = performance.now() - pointerDown.time;
    pointerDown = null;

    // Only treat it as a tap if the finger barely moved. Camera orbiting also
    // begins with a pointerdown here, so a drag must not select a square.
    if (moved > TAP_SLOP_PX() || elapsed > TAP_TIME_MS()) return;

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
   * Two strategies are tried: first a raycast against the tile meshes, then an
   * intersection with the mathematical board plane. The plane fallback is what
   * makes clicks near the base of a tall piece still land on the right square,
   * where the tile itself is occluded by the piece standing on it.
   */
  function pickSquare(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, rig.camera);

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
    switch (e.key.toLowerCase()) {
      case 'u': controller.undo(); break;
      case 'h': controller.hint(); break;
      case 'n': controller.newGame(); break;
      case 'f': {
        const side = controller.playerColor === WHITE ? BLACK : WHITE;
        controller.setPlayerColor(side);
        hud.setSide(side);
        break;
      }
      case '1': cameraRig.goTo('white'); hud.setView('white'); break;
      case '2': cameraRig.goTo('black'); hud.setView('black'); break;
      case '3': cameraRig.goTo('side'); hud.setView('side'); break;
      case '4': cameraRig.goTo('top'); hud.setView('top'); break;
      case 'escape': controller.clearSelection(); break;
      default: break;
    }
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
