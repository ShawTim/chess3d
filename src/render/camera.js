/**
 * Camera rig.
 *
 * Wraps OrbitControls with chess-specific constraints and adds smooth animated
 * transitions between named viewpoints.
 *
 * View presets are not fixed positions. Each one is a direction plus a framing
 * request, and `frame()` solves the distance and target height needed to fit the
 * board inside a safe band of the viewport — the band between the top bar and
 * the bottom toolbar, measured live from the DOM. Hard-coding a position looks
 * right on the machine it was tuned on and clips the near rank on every other
 * aspect ratio; solving it keeps the full board visible at any window size,
 * which matters because the back rank is where the king and queen live.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Board half-extent including the decorative frame. */
const BOARD_EXTENT = 4.62;
/** Tallest piece (the king), used to keep finials inside the frame. */
const TALLEST = 1.62;

/**
 * View presets. `dir` is the unit-ish direction from the board centre towards
 * the camera; `fov` the field of view used while framing that view.
 */
export const VIEWS = {
  white: { dir: [0, 0.86, 0.51], fov: 38 },
  black: { dir: [0, 0.86, -0.51], fov: 38 },
  side: { dir: [0.84, 0.54, 0], fov: 38 },
  top: { dir: [0, 1, 0.02], fov: 34 },
  cinematic: { dir: [0.55, 0.52, 0.65], fov: 34 },
};

const MIN_POLAR = 0.10;
const MAX_POLAR = Math.PI * 0.47;
const MIN_DISTANCE = 5.5;
const MAX_DISTANCE = 34;

/** Pixels of clearance kept between the board and the UI bars. */
const SAFE_MARGIN = 14;

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Measure the vertical band of the viewport not covered by UI chrome.
 * Falls back to sensible insets when the HUD has not been built yet.
 */
function safeBand() {
  const h = window.innerHeight;
  let top = 96;
  let bottom = h - 96;

  const topbar = document.querySelector('.topbar');
  if (topbar) top = Math.max(top, topbar.getBoundingClientRect().bottom + SAFE_MARGIN);

  const bottomBar = document.querySelector('.bottombar');
  if (bottomBar) bottom = Math.min(bottom, bottomBar.getBoundingClientRect().top - SAFE_MARGIN);

  const left = document.querySelector('.panel-left');
  const right = document.querySelector('.panel-right');

  return {
    top,
    bottom: Math.max(bottom, top + 120),
    left: left ? left.getBoundingClientRect().right + SAFE_MARGIN : 24,
    right: right ? right.getBoundingClientRect().left - SAFE_MARGIN : window.innerWidth - 24,
  };
}

export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.controls = new OrbitControls(camera, domElement);

    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.85;
    this.controls.panSpeed = 0.6;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;

    this.controls.minPolarAngle = MIN_POLAR;
    this.controls.maxPolarAngle = MAX_POLAR;
    this.controls.minDistance = MIN_DISTANCE;
    this.controls.maxDistance = MAX_DISTANCE;
    this.controls.maxTargetRadius = 3.2;

    // Animation state for scripted camera moves.
    this.anim = null;

    // Stop an in-flight animation as soon as the user grabs the view.
    this.controls.addEventListener('start', () => { this.anim = null; });

    // Frame the default view immediately so the very first rendered frame is
    // already correct rather than snapping after the HUD is measured.
    this.applyView('white');
  }

  /**
   * Solve a camera distance and target height so the whole board fits the safe
   * band, then place the camera along `dir` at that distance.
   *
   * The solve is a coarse-to-fine scan rather than a closed form because the
   * constraint is "the projected bounding box of 8 board corners plus the tall
   * pieces stays inside a rectangle", which is cheap to evaluate and awkward to
   * invert exactly. It runs only on view changes, so the cost is irrelevant.
   */
  frame(preset) {
    const camera = this.camera;
    const w = this.domElement.clientWidth || window.innerWidth;
    const h = this.domElement.clientHeight || window.innerHeight;
    const band = safeBand();

    const dir = new THREE.Vector3(...preset.dir).normalize();

    // Points on the board that must stay visible.
    const points = [];
    for (const x of [-BOARD_EXTENT, BOARD_EXTENT]) {
      for (const z of [-BOARD_EXTENT, BOARD_EXTENT]) {
        points.push(new THREE.Vector3(x, 0, z));
        points.push(new THREE.Vector3(x, TALLEST, z));
      }
    }
    for (const x of [-4, 0, 4]) points.push(new THREE.Vector3(x, 0, 4));
    for (const z of [-4, 0, 4]) points.push(new THREE.Vector3(0, TALLEST, z));

    const savedFov = camera.fov;
    camera.fov = preset.fov ?? savedFov;

    const probe = camera.clone();
    const scratch = new THREE.Vector3();

    /** Project every point and return the screen-space bounds. */
    const measure = (distance, targetY) => {
      const target = new THREE.Vector3(0, targetY, 0);
      const pos = target.clone().addScaledVector(dir, distance);
      probe.position.copy(pos);
      probe.lookAt(target);
      probe.updateMatrixWorld(true);

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const v = new THREE.Vector3();
      for (const p of points) {
        v.copy(p).project(probe);
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }
      return { minX, maxX, minY, maxY };
    };

    const fits = (m) => m.minY >= band.top && m.maxY <= band.bottom
      && m.minX >= band.left && m.maxX <= band.right;

    // Coarse scan first: the feasible distance grows monotonically with the
    // target height offset, so a simple grid finds the sweet spot reliably.
    let best = null;
    const targetYs = [];
    for (let ty = -1.0; ty <= 2.0; ty += 0.25) targetYs.push(ty);

    for (const ty of targetYs) {
      // Find the smallest distance that fits at this target height.
      let lo = MIN_DISTANCE;
      let hi = MAX_DISTANCE;
      for (const d of [lo]) { /* keep lo as a real candidate */ }
      // Exponential probe outwards, then a short refinement pass.
      let chosen = null;
      for (let d = MIN_DISTANCE; d <= MAX_DISTANCE; d += 0.5) {
        if (fits(measure(d, ty))) { chosen = d; break; }
      }
      if (chosen === null) continue;
      lo = Math.max(MIN_DISTANCE, chosen - 0.5);
      hi = chosen;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (fits(measure(mid, ty))) hi = mid; else lo = mid;
      }
      const distance = hi;
      const m = measure(distance, ty);
      const area = (m.maxX - m.minX) * (m.maxY - m.minY);
      if (!best || area > best.area) best = { distance, targetY: ty, area, m };
    }

    camera.fov = preset.fov ?? savedFov;
    camera.updateProjectionMatrix();

    if (!best) {
      // Nothing fit (an extremely short window). Fall back to a sane wide shot
      // rather than leaving the camera at a broken distance.
      best = { distance: MAX_DISTANCE * 0.85, targetY: 0.2 };
    }

    const target = new THREE.Vector3(0, best.targetY, 0);
    const position = target.clone().addScaledVector(dir, best.distance);
    return { position, target, fov: preset.fov ?? savedFov };
  }

  /**
   * Smoothly move to a named view, or to an explicit framing.
   *
   * @param {string|object} view Preset name, or `{dir, fov}` / `{position, target}`.
   * @param {number} [duration] Seconds; defaults to 1.1.
   */
  /** Resolve any accepted view description into Vector3 position/target. */
  resolveView(view) {
    const preset = typeof view === 'string' ? VIEWS[view] : view;
    if (!preset) return null;
    if (preset.position) {
      // Fully explicit framing (position + target). Values may be arrays.
      return {
        position: new THREE.Vector3().set(...(preset.position.toArray ? preset.position.toArray() : preset.position)),
        target: new THREE.Vector3().set(...(preset.target.toArray ? preset.target.toArray() : preset.target)),
        fov: preset.fov ?? this.camera.fov,
      };
    }
    return this.frame(preset);
  }

  goTo(view, duration = 1.1) {
    const resolved = this.resolveView(view);
    if (!resolved) return;
    if (duration <= 0) { this.applyResolved(resolved); return; }

    this.anim = {
      fromPos: this.camera.position.clone(),
      toPos: resolved.position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: resolved.target.clone(),
      fromFov: this.camera.fov,
      toFov: resolved.fov,
      elapsed: 0,
      duration,
    };
  }

  applyView(view) {
    const resolved = this.resolveView(view);
    if (resolved) this.applyResolved(resolved);
  }

  applyResolved({ position, target, fov }) {
    if (position) this.camera.position.copy(position);
    if (target) this.controls.target.copy(target);
    if (fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
  }

  /**
   * A short push-in on the given world point, used to draw the eye to a
   * just-played move, then ease back to where the camera started.
   */
  focusOn(worldPoint, { zoom = 0.86, duration = 0.75, hold = 0.35 } = {}) {
    const fromTarget = this.controls.target.clone();
    const fromPos = this.camera.position.clone();
    const toTarget = worldPoint.clone().setY(0.35);
    const offset = fromPos.clone().sub(fromTarget);
    const toPos = toTarget.clone().add(offset.clone().multiplyScalar(zoom));

    this.anim = {
      fromPos, toPos, fromTarget, toTarget,
      fromFov: this.camera.fov, toFov: this.camera.fov,
      elapsed: 0, duration, hold,
      returnTo: { position: fromPos.toArray(), target: fromTarget.toArray(), fov: this.camera.fov },
      phase: 'in',
    };
  }

  /** Re-solve the current view; called on resize so framing stays correct. */
  reframe() {
    if (this.anim) return;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    // Only re-solve near-horizontal angles; a user-framed view is left alone.
    const elev = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    if (Math.abs(elev) < 0.15 || Math.abs(elev) > 1.45) return;
    const fov = this.camera.fov;
    const { position, target } = this.frame({ dir: dir.toArray(), fov });
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.update();
  }

  update(dt) {
    const anim = this.anim;
    if (anim) {
      anim.elapsed += dt;
      const t = Math.min(anim.elapsed / anim.duration, 1);
      const e = easeInOutCubic(t);
      this.camera.position.lerpVectors(anim.fromPos, anim.toPos, e);
      this.controls.target.lerpVectors(anim.fromTarget, anim.toTarget, e);
      if (anim.fromFov !== anim.toFov) {
        this.camera.fov = anim.fromFov + (anim.toFov - anim.fromFov) * e;
        this.camera.updateProjectionMatrix();
      }

      if (t >= 1) {
        if (anim.returnTo) {
          if (anim.phase === 'in') {
            anim.phase = 'hold';
            anim.elapsed = 0;
            anim.holdLeft = anim.hold ?? 0.3;
          } else if (anim.phase === 'hold') {
            anim.holdLeft -= dt;
            if (anim.holdLeft <= 0) {
              anim.phase = 'out';
              anim.elapsed = 0;
              anim.fromPos = this.camera.position.clone();
              anim.toPos = new THREE.Vector3(...anim.returnTo.position);
              anim.fromTarget = this.controls.target.clone();
              anim.toTarget = new THREE.Vector3(...anim.returnTo.target);
              anim.duration = 0.55;
            }
          } else {
            this.anim = null;
          }
        } else {
          this.anim = null;
        }
      }
    }

    this.controls.update();
  }

  get isAnimating() {
    return this.anim !== null;
  }

  dispose() {
    this.controls.dispose();
  }
}
