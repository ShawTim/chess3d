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
import { createLabelTexture } from './textures.js';

export const TILE = 1;
export const BOARD_HALF = 4;
export const BOARD_THICKNESS = 0.34;
/** Width of the decorative frame around the playing area. */
export const FRAME_WIDTH = 0.62;
/** Top surface of the frame, a hair above the tiles so it catches the key light. */
export const FRAME_TOP = 0.035;

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
  // A hair of gap between squares. Real veneered boards are cut from separate
  // pieces and show a dark seam; butting 1.0-wide boxes together produced a
  // single printed-looking surface.
  const size = TILE * 0.986;
  const geo = new THREE.BoxGeometry(size, BOARD_THICKNESS * 0.55, size, 1, 1, 1);
  geo.translate(0, -BOARD_THICKNESS * 0.55 * 0.5, 0);
  return geo;
}

/**
 * Per-tile UV variation.
 *
 * Every square used the same map with the same 0..1 UVs, so all 32 light
 * squares showed a pixel-identical wood grain and the board read as a printed
 * pattern rather than a veneered one. Shifting each tile's UVs into a different
 * part of the tiling texture — and rotating half of them a quarter turn — gives
 * each square its own grain without a single extra texture.
 */
function tileGeometryVariant(sq) {
  const geo = tileGeometry();
  const uv = geo.attributes.uv;
  // Two irrational-ish strides keep neighbouring squares from landing on the
  // same offset.
  const du = ((sq * 0.371) % 1) * 0.83;
  const dv = ((sq * 0.613) % 1) * 0.71;
  const rotate = ((sq * 0.29) % 1) > 0.55;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i) + du;
    let v = uv.getY(i) + dv;
    if (rotate) {
      const t = u;
      u = 1 - v;
      v = t;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * Rounded-rectangle ring used for the frame profile.
 *
 * The old frame was a plain box: four razor-sharp edges, no highlight, no
 * weight. A real board has a moulded edge, and that bevel is what the key light
 * draws a bright line along. The profile is extruded with a real bevel rather
 * than faked with a second box, so it reads correctly from every orbit angle.
 */
function frameGeometry() {
  const outer = BOARD_HALF + FRAME_WIDTH;
  const inner = BOARD_HALF - 0.005;
  const radius = 0.16;

  const rounded = (shape, half, r) => {
    shape.moveTo(-half + r, -half);
    shape.lineTo(half - r, -half);
    shape.quadraticCurveTo(half, -half, half, -half + r);
    shape.lineTo(half, half - r);
    shape.quadraticCurveTo(half, half, half - r, half);
    shape.lineTo(-half + r, half);
    shape.quadraticCurveTo(-half, half, -half, half - r);
    shape.lineTo(-half, -half + r);
    shape.quadraticCurveTo(-half, -half, -half + r, -half);
    return shape;
  };

  const shape = rounded(new THREE.Shape(), outer, radius);
  // The hole is traversed in the opposite direction, which is what tells the
  // triangulator it is a hole rather than an overlapping second outline.
  shape.holes.push(rounded(new THREE.Path(), inner, 0.03));

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: BOARD_THICKNESS,
    bevelEnabled: true,
    bevelThickness: 0.030,
    bevelSize: 0.030,
    bevelSegments: 3,
    curveSegments: 12,
  });
  // Extrusion runs along +Z; lay it flat so the depth becomes vertical.
  // Extrusion runs along +Z, which after this rotation points up. The bevel
  // extends `bevelThickness` past each end, so the geometry is shifted down by
  // the full bevelled height to put its top surface exactly on FRAME_TOP.
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, FRAME_TOP - (BOARD_THICKNESS + 0.030), 0);
  geo.computeVertexNormals();
  return geo;
}

/** Outer half-extent of the finished frame, including its moulding. */
export const FRAME_EXTENT = BOARD_HALF + FRAME_WIDTH;

/** Four thin brass bars forming the inlay line around the playing field. */
function inlayMeshes(lib) {
  const group = new THREE.Group();
  group.name = 'inlay';
  const len = BOARD_HALF * 2 + 0.09;
  const w = 0.030;
  const y = FRAME_TOP + 0.002;
  const bars = [
    { x: 0, z: -BOARD_HALF - 0.015, rot: 0, sx: len, sz: w },
    { x: 0, z: BOARD_HALF + 0.015, rot: 0, sx: len, sz: w },
    { x: -BOARD_HALF - 0.015, z: 0, rot: Math.PI / 2, sx: len, sz: w },
    { x: BOARD_HALF + 0.015, z: 0, rot: Math.PI / 2, sx: len, sz: w },
  ];
  for (const b of bars) {
    const geo = new THREE.BoxGeometry(b.sx, 0.010, b.sz);
    const mesh = new THREE.Mesh(geo, lib.inlay);
    mesh.position.set(b.x, y, b.z);
    mesh.rotation.y = b.rot;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
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

  // -------------------------------------------------------------- felt base --
  // A pad under the frame, so the set sits on a surface rather than floating in
  // space. It is only a few centimetres thick but it is what the eye reads as
  // "object on a table".
  const feltGeo = new THREE.BoxGeometry(9.62, 0.075, 9.62);
  const felt = new THREE.Mesh(feltGeo, lib.felt);
  // The pad's top sits flush under the frame's lowest edge (FRAME_TOP minus the
  // full thickness), so the set rests on it instead of hovering above it.
  felt.position.y = FRAME_TOP - BOARD_THICKNESS - 0.030;
  felt.receiveShadow = true;
  felt.castShadow = true;
  group.add(felt);

  // ---------------------------------------------------------------- frame --
  const frameGeo = frameGeometry();
  const frame = new THREE.Mesh(frameGeo, lib.frame);
  frame.receiveShadow = true;
  frame.castShadow = true;
  group.add(frame);
  group.add(inlayMeshes(lib));

  // ---------------------------------------------------------------- tiles --
  // A dark substrate shows through the tile seams, so the squares read as inlaid
  // pieces rather than one printed top.
  const substrateGeo = new THREE.BoxGeometry(BOARD_HALF * 2 + 0.02, 0.02, BOARD_HALF * 2 + 0.02);
  const substrate = new THREE.Mesh(substrateGeo, lib.frame);
  substrate.position.y = -0.012;
  substrate.receiveShadow = true;
  group.add(substrate);

  const tiles = new THREE.Group();
  tiles.name = 'tiles';
  const tileGeos = [];
  for (let sq = 0; sq < 64; sq++) {
    const dark = isDarkSquare(sq);
    const mat = dark ? lib.darkSquare : lib.lightSquare;
    const geo = tileGeometryVariant(sq);
    tileGeos.push(geo);
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

  // -------------------------------------------------------------- labels --
  const labels = new THREE.Group();
  labels.name = 'labels';
  const labelY = FRAME_TOP + 0.004;
  const offset = BOARD_HALF + FRAME_WIDTH * 0.52;
  for (let i = 0; i < 8; i++) {
    const file = String.fromCharCode(97 + i);
    const rank = String(8 - i);

    const fileTex = createLabelTexture(file);
    const rankTex = createLabelTexture(rank);
    const planeGeo = new THREE.PlaneGeometry(0.34, 0.34);

    const topLabel = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
      map: fileTex, transparent: true, depthWrite: false, opacity: 1.0,
      toneMapped: false,
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
      toneMapped: false,
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

  /** Clockwise animation phase for the check marker, so it breathes. */
  let checkPhase = 0;

  const api = {
    group,
    tiles,
    mesh: frame,

    /** Pulse the check marker; called once per frame by the controller. */
    pulseCheck(dt, active) {
      if (!active) return;
      checkPhase += dt;
      const p = 0.5 + 0.5 * Math.sin(checkPhase * 4.2);
      lib.checkPulse.opacity = 0.16 + p * 0.22;
    },

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
      frameGeo.dispose();
      feltGeo.dispose();
      substrateGeo.dispose();
      for (const g of tileGeos) g.dispose();
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
