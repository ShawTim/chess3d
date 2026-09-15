/**
 * Board construction: the playing surface, its frame, coordinate labels and the
 * interaction overlays (selection ring, legal-move dots, last-move highlights).
 *
 * The board is built in a local space where the 64 tiles span [-4, 4] on both
 * X and Z, so square (file, rank) maps to a simple linear transform. `squareToWorld`
 * is the single source of truth for that mapping and is used by the camera,
 * the raycaster and the piece layout alike.
 */
import * as THREE from 'three';
import { SQUARE_NAMES, pieceType, WHITE, BLACK } from '../engine/chess.js';
import { createLabelTexture } from './textures.js';

export const TILE = 1;
export const BOARD_HALF = 4;
export const BOARD_THICKNESS = 0.34;
/** Width of the decorative frame around the playing area. */
export const FRAME_WIDTH = 0.62;

/**
 * Centre of a board square in world space.
 *
 * Board indices run 0 (a8) to 63 (h1), i.e. row-major from White's left. The
 * world X axis follows the files a..h and Z runs from Black's side (negative)
 * to White's side (positive), which puts White nearest the default camera.
 */
export function squareToWorld(sq, y = 0, target = new THREE.Vector3()) {
  const file = sq & 7;
  const rank = sq >> 3;
  target.set(
    (file - 3.5) * TILE,
    y,
    (rank - 3.5) * TILE,
  );
  return target;
}

/** World-space centre of the board, used for camera framing and light targets. */
export const BOARD_CENTER = new THREE.Vector3(0, 0, 0);

/**
 * Is this square one of the dark ones?
 *
 * Board indices run 0 = a8 to 63 = h1, so the file is `sq & 7` and the rank
 * index (0 at rank 8) is `sq >> 3`.
 *
 * The parity is pinned by the standard: a1 is DARK and h1 is LIGHT ("light
 * square on the right"), which puts the white queen on the light d1 — "queen on
 * her own colour". Working that through, a square is dark when the rank and file
 * indices have OPPOSITE parity, i.e. when their sum is ODD.
 *
 * This was inverted for most of the project's life, so every square rendered the
 * wrong colour and the board read as flipped to anyone who plays. It is purely
 * cosmetic — move generation was never affected — which is exactly why it
 * survived so long: the tests cover rules and geometry, and a rendered board
 * looks plausible either way. `tools/check-board-colours.mjs` asserts it now.
 */
export function isDarkSquare(sq) {
  return (((sq >> 3) + (sq & 7)) & 1) === 1;
}

/**
 * Shared geometry for a single tile. Tiles are drawn as flat slabs so the
 * raycaster has a clean, coplanar surface to hit.
 */
function tileGeometry() {
  const geo = new THREE.BoxGeometry(TILE, BOARD_THICKNESS * 0.55, TILE, 1, 1, 1);
  geo.translate(0, -BOARD_THICKNESS * 0.55 * 0.5, 0);
  return geo;
}

/**
 * Build the board group.
 *
 * @param {import('./materials.js').MaterialLibrary} lib
 * @param {{ onSquareHover: Function, onSquareClick: Function }} handlers
 */
export function createBoard(lib, handlers = {}) {
  const group = new THREE.Group();
  group.name = 'board';

  // ---------------------------------------------------------------- tiles --
  const tiles = new THREE.Group();
  tiles.name = 'tiles';
  const geo = tileGeometry();
  for (let sq = 0; sq < 64; sq++) {
    const dark = isDarkSquare(sq);
    const mat = dark ? lib.darkSquare : lib.lightSquare;
    const tile = new THREE.Mesh(geo, mat);
    squareToWorld(sq, 0, tile.position);
    tile.userData.square = sq;
    tile.receiveShadow = true;
    tile.castShadow = false;
    // Tiles are coplanar; give each a tiny unique render order to avoid any
    // z-fighting between the seams on low-precision depth buffers.
    tile.renderOrder = 1;
    tiles.add(tile);
  }
  group.add(tiles);

  // ---------------------------------------------------------------- frame --
  const outer = BOARD_HALF + FRAME_WIDTH;
  const frameGeo = new THREE.BoxGeometry(outer * 2, BOARD_THICKNESS, outer * 2);
  const frame = new THREE.Mesh(frameGeo, lib.frame);
  frame.position.y = -BOARD_THICKNESS * 0.5 - 0.004;
  frame.receiveShadow = true;
  frame.castShadow = true;
  frame.renderOrder = 0;
  group.add(frame);

  // A recessed lip around the playing area reads as an inlaid border.
  const lipGeo = new THREE.BoxGeometry(BOARD_HALF * 2 + 0.10, 0.06, BOARD_HALF * 2 + 0.10);
  const lip = new THREE.Mesh(lipGeo, lib.frame);
  lip.position.y = -0.035;
  lip.receiveShadow = true;
  group.add(lip);

  // -------------------------------------------------------------- labels --
  const labels = new THREE.Group();
  labels.name = 'labels';
  const labelY = 0.012;
  const offset = BOARD_HALF + FRAME_WIDTH * 0.52;
  for (let i = 0; i < 8; i++) {
    const file = String.fromCharCode(97 + i);
    const rank = String(8 - i);

    // Larger and brighter than before: at the default camera distance the old
    // 0.30 planes at 0.85 opacity were too faint to read, which visual review
    // flagged. The glyphs are also given more contrast in the texture itself.
    const fileTex = createLabelTexture(file, { size: 128, opacity: 0.95 });
    const rankTex = createLabelTexture(rank, { size: 128, opacity: 0.95 });
    const planeGeo = new THREE.PlaneGeometry(0.36, 0.36);

    const topLabel = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
      map: fileTex, transparent: true, depthWrite: false, opacity: 1.0,
    }));
    topLabel.rotation.x = -Math.PI / 2;
    topLabel.position.set((i - 3.5) * TILE, labelY, -offset);
    labels.add(topLabel);

    const bottomLabel = topLabel.clone();
    bottomLabel.position.z = offset;
    bottomLabel.material = topLabel.material;
    labels.add(bottomLabel);

    const leftLabel = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
      map: rankTex, transparent: true, depthWrite: false, opacity: 1.0,
    }));
    leftLabel.rotation.x = -Math.PI / 2;
    leftLabel.position.set(-offset, labelY, (i - 3.5) * TILE);
    labels.add(leftLabel);

    const rightLabel = leftLabel.clone();
    rightLabel.material = leftLabel.material;
    rightLabel.position.x = offset;
    labels.add(rightLabel);
  }
  group.add(labels);

  // ------------------------------------------------------------ overlays --
  // Highlights live slightly above the tiles to avoid z-fighting with them.
  const overlayY = 0.006;
  const overlayGeo = new THREE.PlaneGeometry(TILE * 0.96, TILE * 0.96);
  overlayGeo.rotateX(-Math.PI / 2);

  const lastFrom = new THREE.Mesh(overlayGeo, lib.lastMoveFrom);
  const lastTo = new THREE.Mesh(overlayGeo, lib.lastMoveTo);
  lastFrom.visible = false;
  lastTo.visible = false;
  lastFrom.renderOrder = 5;
  lastTo.renderOrder = 5;
  group.add(lastFrom, lastTo);

  const checkMark = new THREE.Mesh(overlayGeo, lib.checkPulse);
  checkMark.visible = false;
  checkMark.renderOrder = 6;
  group.add(checkMark);

  // Hover highlight: a very soft wash showing which square is under the cursor.
  const hoverGeo = new THREE.PlaneGeometry(TILE * 0.98, TILE * 0.98);
  hoverGeo.rotateX(-Math.PI / 2);
  const hoverMark = new THREE.Mesh(hoverGeo, lib.hover);
  hoverMark.visible = false;
  hoverMark.renderOrder = 4;
  group.add(hoverMark);

  // Selection ring: a thin annulus around the picked piece's square.
  const ringGeo = new THREE.RingGeometry(TILE * 0.40, TILE * 0.465, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const selectRing = new THREE.Mesh(ringGeo, lib.selectRing);
  selectRing.visible = false;
  selectRing.renderOrder = 8;
  group.add(selectRing);

  // Legal-move markers: a small dot for empty targets, a ring for captures.
  const dotGeo = new THREE.CircleGeometry(TILE * 0.115, 24);
  dotGeo.rotateX(-Math.PI / 2);
  const dot = new THREE.Mesh(dotGeo, lib.moveDot);
  dot.visible = false;
  dot.renderOrder = 9;
  group.add(dot);

  const captureGeo = new THREE.RingGeometry(TILE * 0.36, TILE * 0.46, 40);
  captureGeo.rotateX(-Math.PI / 2);
  const captureRing = new THREE.Mesh(captureGeo, lib.captureRing);
  captureRing.visible = false;
  captureRing.renderOrder = 9;
  group.add(captureRing);

  // A pool of dots so a position with many legal moves needs no allocation.
  const moveDots = [];
  const poolSize = 32;
  for (let i = 0; i < poolSize; i++) {
    const m = new THREE.Mesh(dotGeo, lib.moveDot);
    m.visible = false;
    m.renderOrder = 9;
    moveDots.push(m);
    group.add(m);
  }

  const api = {
    group,
    tiles,
    mesh: frame,

    /** Highlight the from/to squares of the most recent move. */
    setLastMove(fromSq, toSq) {
      if (fromSq === null || fromSq === undefined) {
        lastFrom.visible = false;
        lastTo.visible = false;
        return;
      }
      squareToWorld(fromSq, overlayY + 0.001, lastFrom.position);
      squareToWorld(toSq, overlayY + 0.002, lastTo.position);
      lastFrom.visible = true;
      lastTo.visible = true;
    },

    /** Show a pulsing marker on a king that is in check. */
    setCheck(sq) {
      if (sq === null || sq === undefined) {
        checkMark.visible = false;
        return;
      }
      squareToWorld(sq, overlayY + 0.003, checkMark.position);
      checkMark.visible = true;
    },

    /** Soft hover highlight under the pointer, or clear it with `null`. */
    setHover(sq) {
      if (sq === null || sq === undefined) {
        hoverMark.visible = false;
        return;
      }
      squareToWorld(sq, overlayY + 0.0005, hoverMark.position);
      hoverMark.visible = true;
    },

    /** Show the selection ring, or hide it with `null`. */
    setSelection(sq) {
      if (sq === null || sq === undefined) {
        selectRing.visible = false;
        return;
      }
      squareToWorld(sq, overlayY + 0.004, selectRing.position);
      selectRing.visible = true;
    },

    /**
     * Show legal-move markers for a list of move integers. `board` is consulted
     * to decide between a dot (quiet move) and a ring (capture).
     */
    setLegalMoves(moves, board) {
      for (const m of moveDots) m.visible = false;
      dot.visible = false;
      captureRing.visible = false;

      let dotIndex = 0;
      for (const m of moves) {
        const to = (m >> 6) & 63;
        const flags = (m >> 15) & 31;
        const target = board[to];

        if (target || (flags & 1)) {
          // Capture: one ring is enough even if several pieces can take it.
          if (!captureRing.visible) {
            squareToWorld(to, overlayY + 0.005, captureRing.position);
            captureRing.visible = true;
          }
        } else if (dotIndex < moveDots.length) {
          squareToWorld(to, overlayY + 0.005, moveDots[dotIndex].position);
          moveDots[dotIndex].visible = true;
          dotIndex++;
        }
      }
    },

    /** Convert a world-space point on the board plane to a square index. */
    worldToSquare(point) {
      const file = Math.round(point.x / TILE + 3.5);
      const rank = Math.round(point.z / TILE + 3.5);
      if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
      return rank * 8 + file;
    },

    /** Meshes the raycaster should test for square picking. */
    pickTargets: () => tiles.children,

    dispose() {
      geo.dispose();
      frameGeo.dispose();
      lipGeo.dispose();
      overlayGeo.dispose();
      hoverGeo.dispose();
      ringGeo.dispose();
      dotGeo.dispose();
      captureGeo.dispose();
      group.traverse((o) => {
        if (o.isMesh && o.material && o.material.map && o.material.transparent) {
          o.material.map.dispose?.();
          o.material.dispose?.();
        }
      });
    },
  };

  return api;
}
