/**
 * Piece rendering and animation.
 *
 * Owns one `THREE.Group` per board square and drives every visual transition:
 * sliding a piece, arcing a knight, dissolving a captured piece into dust,
 * rebuilding after a promotion, and the smooth cross-fade when the player
 * switches sides.
 *
 * Animations are described by small records in an active list rather than by
 * tween callbacks, so a move can be aborted cleanly when the user undoes or
 * starts a new game mid-flight.
 */
import * as THREE from 'three';
import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  pieceType, pieceColor, EMPTY, makePiece,
} from '../engine/chess.js';
import { getPieceGeometry, PIECE_HEIGHT } from './pieces.js';
import { squareToWorld } from './board.js';
import { createPuffTexture } from './textures.js';

const LIFT = 0.00;

/** Easing curves used by the various animations. */
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export class PieceViews {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./materials.js').MaterialLibrary} lib
   */
  constructor(scene, lib) {
    this.scene = scene;
    this.lib = lib;
    this.group = new THREE.Group();
    this.group.name = 'pieces';
    scene.add(this.group);

    /** All live piece groups, keyed by a monotonically increasing id. */
    this.pieces = new Map();
    this.nextId = 1;
    /** Animations currently in flight. */
    this.anims = [];
    /** Sub-meshes grouped by material, so a side-swap can fade them together. */
    this.meshes = [];

    this.puffTexture = createPuffTexture({ size: 128 });
    this.puffs = [];
    this.buildPuffPool(10);

    this._tmpVec = new THREE.Vector3();
  }

  buildPuffPool(count) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.puffTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        color: 0xd8cfc0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.scale.setScalar(0.6);
      this.group.add(sprite);
      this.puffs.push({ sprite, mat, life: 0, duration: 0, velocity: new THREE.Vector3(), anim: null });
    }
  }

  /**
   * Create the mesh tree for one piece.
   * The returned group carries `userData.piece` so raycast hits can be resolved
   * back to the chess piece without a board lookup.
   */
  createPiece(pieceInt) {
    const type = pieceType(pieceInt);
    const color = pieceColor(pieceInt);
    const geo = getPieceGeometry(type);

    const g = new THREE.Group();
    g.userData.piece = pieceInt;
    g.userData.type = type;
    g.userData.color = color;

    const bodyMat = this.lib.piece(color);
    const accentMat = this.lib.accent(color);

    const shell = new THREE.Mesh(geo.shell, bodyMat);
    shell.castShadow = true;
    shell.receiveShadow = true;
    shell.userData.baseMaterial = bodyMat;
    g.add(shell);

    for (const inlay of geo.inlays) {
      const m = new THREE.Mesh(inlay, bodyMat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.baseMaterial = bodyMat;
      g.add(m);
    }

    // Queen coronets and king crosses are rendered in the accent metal, which is
    // what gives the two sides their distinct look under the key light.
    for (const crown of geo.crowns ?? []) {
      const m = new THREE.Mesh(crown, accentMat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.baseMaterial = accentMat;
      g.add(m);
    }

    // Knights face the opponent. The extruded head is modelled facing +Z, which
    // is White's side of the board, so Black's knights already look the right way
    // and White's are turned around. The rotation goes on the child meshes, not
    // the group, because the move animation resets group rotation each frame.
    if (type === KNIGHT) {
      const yaw = color === WHITE ? Math.PI : 0;
      for (const child of g.children) child.rotation.y = yaw;
    }

    return g;
  }

  /** Add a piece to the view on the given square. */
  add(square, pieceInt, { animate = false } = {}) {
    const g = this.createPiece(pieceInt);
    squareToWorld(square, LIFT, g.position);
    g.userData.square = square;
    g.userData.id = this.nextId++;
    g.userData.targetScale = 1;
    this.group.add(g);
    this.pieces.set(g.userData.id, g);

    if (animate) {
      g.scale.setScalar(0.01);
      this.anims.push({
        kind: 'spawn', group: g, elapsed: 0, duration: 0.32,
      });
    }
    return g;
  }

  /** Find the live piece group currently sitting on a square. */
  at(square) {
    for (const g of this.pieces.values()) {
      if (g.userData.square === square && !g.userData.removing) return g;
    }
    return null;
  }

  /** Rebuild the whole view from a chess board array. */
  rebuild(game, { animate = false } = {}) {
    this.clearAll();
    for (let sq = 0; sq < 64; sq++) {
      const p = game.board[sq];
      if (!p) continue;
      this.add(sq, p, { animate: false });
    }
  }

  clearAll() {
    this.anims.length = 0;
    for (const g of this.pieces.values()) {
      this.group.remove(g);
      // Geometries and materials are shared/cached, so only the group goes.
    }
    this.pieces.clear();
    for (const p of this.puffs) {
      p.sprite.visible = false;
      p.anim = null;
    }
  }

  /* ------------------------------------------------------------ animation -- */

  /**
   * Animate a move.
   *
   * @param {object} opts
   * @param {number} opts.from        source square
   * @param {number} opts.to          destination square
   * @param {number} opts.piece       moving piece (after any promotion)
   * @param {number} opts.type        moving piece type
   * @param {boolean} opts.capture    whether a piece is taken
   * @param {number|null} opts.capturedSq  square of the captured piece
   * @param {boolean} opts.castle      whether this is a castling move
   * @param {boolean} opts.enPassant
   * @param {number|null} opts.rookFrom / opts.rookTo  for castling
   * @param {number} opts.promoType    promotion target type, if any
   * @param {number} opts.duration
   * @returns {Promise<void>} resolves when the move has finished animating
   */
  animateMove({
    from, to, type, capture, capturedSq, castle, rookFrom, rookTo,
    promoType, duration,
  }) {
    const moving = this.at(from);
    if (!moving) {
      // Nothing to animate (e.g. state drift); snap instead of throwing.
      return Promise.resolve();
    }

    const dest = squareToWorld(to, LIFT, new THREE.Vector3());
    const start = moving.position.clone();
    const isKnight = type === KNIGHT;

    const dist = start.distanceTo(dest);
    const dur = duration ?? Math.min(0.62, 0.30 + dist * 0.055);
    const arcHeight = isKnight ? 0.62 : Math.min(0.18, 0.05 + dist * 0.018);

    // Look the victim up BEFORE re-tagging the mover. For an ordinary capture
    // capturedSq === to, so once the mover claims that square both pieces report
    // it and at() can return the mover, which would then dissolve itself and
    // make the capturing piece vanish.
    let victim = null;
    if (capture && capturedSq !== null && capturedSq !== undefined) {
      victim = this.at(capturedSq);
      if (victim === moving) victim = null;
    }

    moving.userData.square = to;

    const anim = {
      kind: 'move',
      group: moving,
      elapsed: 0,
      duration: dur,
      start,
      dest,
      arcHeight,
      isKnight,
      resolve: null,
    };

    // Dissolve first so the two animations overlap naturally.
    if (victim) this.dissolve(victim);

    const done = new Promise((resolve) => { anim.resolve = resolve; });
    this.anims.push(anim);

    if (castle && rookFrom !== undefined && rookTo !== undefined) {
      const rook = this.at(rookFrom);
      if (rook) {
        const rDest = squareToWorld(rookTo, LIFT, new THREE.Vector3());
        const rAnim = {
          kind: 'move',
          group: rook,
          elapsed: 0,
          duration: dur * 0.92,
          start: rook.position.clone(),
          dest: rDest,
          arcHeight: 0.02,
          isKnight: false,
          resolve: null,
        };
        rook.userData.square = rookTo;
        this.anims.push(rAnim);
      }
    }

    if (promoType) {
      // The pawn rides to the promotion square, then is replaced by the new
      // piece in a pop. Queue that as a follow-up animation.
      this.anims.push({
        kind: 'promote',
        group: moving,
        elapsed: 0,
        duration: 0.34,
        delay: dur,
        promoType,
        to,
        color: pieceColorFromGroup(moving),
      });
    }

    return done;
  }

  /** Animate a piece being captured: it sinks, shrinks and fades to dust. */
  dissolve(group) {
    group.userData.removing = true;
    // Remove it from square lookups immediately so it cannot be re-targeted.
    group.userData.square = -1;
    this.anims.push({ kind: 'dissolve', group, elapsed: 0, duration: 0.42 });
    this.spawnPuff(group.position, group.userData.color);
  }

  spawnPuff(position, color) {
    const p = this.puffs.find((x) => !x.sprite.visible) ?? this.puffs[0];
    p.sprite.visible = true;
    p.sprite.position.copy(position).setY(0.24);
    p.mat.opacity = 0.85;
    p.mat.color.set(color === WHITE ? 0xe8e2d6 : 0x8a8a94);
    p.sprite.scale.setScalar(0.35);
    p.life = 0;
    p.duration = 0.62;
    p.velocity.set(
      (Math.random() - 0.5) * 0.5,
      0.45 + Math.random() * 0.3,
      (Math.random() - 0.5) * 0.5,
    );
  }

  /** Fade the whole set in or out; used when swapping which side faces us. */
  setOpacity(opacity) {
    for (const g of this.pieces.values()) {
      g.traverse((o) => {
        if (!o.isMesh) return;
        const base = o.userData.baseMaterial;
        if (!base) return;
        if (opacity >= 1) {
          o.material = base;
        } else {
          if (o.material === base) {
            o.material = base.clone();
            o.material.transparent = true;
          }
          o.material.opacity = opacity;
        }
      });
    }
  }

  update(dt) {
    const tmp = this._tmpVec;

    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];

      if (a.kind === 'move') {
        a.elapsed += dt;
        const t = Math.min(a.elapsed / a.duration, 1);
        const e = easeInOutQuad(t);
        a.group.position.lerpVectors(a.start, a.dest, e);
        // Arc: a sine bump scaled by the piece type.
        a.group.position.y = LIFT + Math.sin(Math.PI * t) * a.arcHeight;
        if (a.isKnight) {
          // Knights get a slight roll as they leap.
          a.group.rotation.z = Math.sin(Math.PI * t) * 0.16;
          a.group.rotation.x = Math.sin(Math.PI * t) * -0.10;
        }
        if (t >= 1) {
          a.group.position.copy(a.dest);
          a.group.position.y = LIFT;
          a.group.rotation.set(0, 0, 0);
          a.resolve?.();
          this.anims.splice(i, 1);
        }
        continue;
      }

      if (a.kind === 'spawn') {
        a.elapsed += dt;
        const t = Math.min(a.elapsed / a.duration, 1);
        const e = easeOutBack(t);
        a.group.scale.setScalar(Math.max(0.01, e));
        if (t >= 1) {
          a.group.scale.setScalar(1);
          this.anims.splice(i, 1);
        }
        continue;
      }

      if (a.kind === 'dissolve') {
        a.elapsed += dt;
        const t = Math.min(a.elapsed / a.duration, 1);
        const e = easeOutCubic(t);
        a.group.position.y = LIFT - e * 0.30;
        a.group.scale.setScalar(Math.max(0.01, 1 - e));
        if (t >= 1) {
          this.group.remove(a.group);
          this.pieces.delete(a.group.userData.id);
          this.anims.splice(i, 1);
        }
        continue;
      }

      if (a.kind === 'promote') {
        if (a.delay > 0) {
          a.delay -= dt;
          if (a.delay > 0) continue;
        }
        a.elapsed += dt;
        const t = Math.min(a.elapsed / a.duration, 1);
        if (!a.swapped && t > 0.35) {
          // Swap the pawn for the promoted piece at the peak of the pop.
          const pawnGroup = a.group;
          const pieceInt = makePiece(a.promoType, a.color);
          const g = this.createPiece(pieceInt);
          g.position.copy(pawnGroup.position);
          g.userData.square = a.to;
          g.userData.id = this.nextId++;
          this.group.add(g);
          this.pieces.set(g.userData.id, g);
          this.group.remove(pawnGroup);
          this.pieces.delete(pawnGroup.userData.id);
          a.group = g;
          a.swapped = true;
        }
        const pop = 1 + Math.sin(Math.PI * t) * 0.22;
        a.group.scale.setScalar(Math.max(0.01, pop * t > 0 ? pop : 1));
        if (t >= 1) {
          a.group.scale.setScalar(1);
          this.anims.splice(i, 1);
        }
        continue;
      }
    }

    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.life += dt;
      const t = p.life / p.duration;
      if (t >= 1) {
        p.sprite.visible = false;
        continue;
      }
      p.velocity.y -= dt * 1.4;
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.scale.setScalar(0.35 + t * 1.5);
      p.mat.opacity = 0.85 * (1 - t) ** 1.4;
    }
  }

  /** True while any move/dissolve/promote animation is still running. */
  get busy() {
    return this.anims.some((a) => a.kind !== 'spawn');
  }

  dispose() {
    this.clearAll();
    this.puffTexture.dispose();
    for (const p of this.puffs) p.mat.dispose();
    this.scene.remove(this.group);
  }
}

function pieceColorFromGroup(g) {
  return g.userData.color;
}
