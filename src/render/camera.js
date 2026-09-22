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
 * The rectangle of the viewport that is not covered by UI chrome.
 *
 * The panels MOVE between layouts, so their position must be detected rather than
 * assumed. On desktop, `.panel-left` and `.panel-right` are columns down the
 * sides. On a phone the stylesheet lifts both out of the grid: the left panel
 * becomes a bar across the bottom and the right panel moves to the top.
 *
 * The previous version assumed the desktop arrangement unconditionally, so on a
 * phone it computed `left = fullWidth + margin` and `right = smallX - margin` — an
 * INVERTED band that nothing can fit inside. The solver then fell through to a
 * blind fallback distance, which is why the board overflowed the screen
 * horizontally on narrow devices while the code looked reasonable.
 *
 * Edges are insets only where a panel actually sits, decided by comparing the
 * panel's rect to the viewport rather than by matching a breakpoint, so the two
 * cannot drift apart if the CSS changes.
 */
function safeBand() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = 88;
  let bottom = vh - 88;
  let left = 20;
  let right = vw - 20;

  const rectOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return r;
  };

  const topbar = rectOf('.topbar');
  if (topbar && topbar.height < vh * 0.4) {
    top = Math.max(top, topbar.bottom + SAFE_MARGIN);
  }

  const bottomBar = rectOf('.bottombar');
  if (bottomBar && bottomBar.height < vh * 0.4) {
    bottom = Math.min(bottom, bottomBar.top - SAFE_MARGIN);
  }

  // A side panel narrows the horizontal band only if it is genuinely a SIDE
  // column: taller than it is wide, and hugging one edge. A panel pinned across
  // the bottom is wide and short, so it must not be treated as a column.
  const isSideColumn = (r) => r && r.height > r.width && r.width < vw * 0.42;

  const leftPanel = rectOf('.panel-left');
  if (isSideColumn(leftPanel) && leftPanel.left < vw * 0.35) {
    left = Math.max(left, leftPanel.right + SAFE_MARGIN);
  }

  const rightPanel = rectOf('.panel-right');
  if (isSideColumn(rightPanel) && rightPanel.right > vw * 0.65) {
    right = Math.min(right, rightPanel.left - SAFE_MARGIN);
  }

  // A panel spanning most of the width at the top or bottom eats into the
  // vertical band, whichever panel it happens to be.
  for (const p of [leftPanel, rightPanel]) {
    if (!p) continue;
    const spansWidth = p.width > vw * 0.5;
    if (!spansWidth) continue;
    if (p.top > vh * 0.45) bottom = Math.min(bottom, p.top - SAFE_MARGIN);
    if (p.bottom < vh * 0.35) top = Math.max(top, p.bottom + SAFE_MARGIN);
  }

  // Never return an inverted or degenerate band. If it is inverted the solver has
  // nothing to fit into and silently falls back to an arbitrary distance, which is
  // exactly how the board ended up off-screen on phones.
  if (bottom - top < 160) {
    const mid = (top + bottom) / 2;
    const half = Math.max(80, Math.min((vh - 16) / 2, (bottom - top) / 2 + 50));
    top = Math.max(8, mid - half);
    bottom = Math.min(vh - 8, mid + half);
  }
  if (right - left < 160) {
    const mid = (left + right) / 2;
    const half = Math.max(80, Math.min((vw - 16) / 2, (right - left) / 2 + 50));
    left = Math.max(8, mid - half);
    right = Math.min(vw - 8, mid + half);
  }

  return { top, bottom, left, right };
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

    let dir = new THREE.Vector3(...preset.dir).normalize();

    // On a short, wide viewport (a phone in landscape) a shallow camera wastes most
    // of the width: the board projects as a wide, flat trapezoid, so its HEIGHT
    // becomes the binding constraint and the squares stay small. Measured on an
    // 844x390 viewport the board used only 31% of the available width, giving 27px
    // squares — below a comfortable thumb target.
    //
    // Tilting the camera towards top-down makes the projection closer to square,
    // which fits that shape of viewport far better. The tilt is applied to the
    // direction only when the aspect ratio is wide AND the viewport is short, so
    // portrait phones and desktop are unaffected.
    const aspect = w / Math.max(1, h);
    if (aspect > 1.5 && h < 560) {
      // 0.88 is close to top-down, chosen by measurement: a landscape phone has a
      // wide, short band (276px tall on an 844x390 viewport) and the board only
      // uses its width, so what matters is making the projection as close to
      // SQUARE as possible. A square projection fills that band's height and
      // therefore maximises the square size. Measured: 26.6px per square at 0.62,
      // which is below a comfortable thumb target.
      const steepen = THREE.MathUtils.clamp((aspect - 1.5) * 1.3, 0, 0.88);
      const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
      const tilted = flat.clone().multiplyScalar(1 - steepen).setY(steepen).normalize();
      dir = tilted;
    }

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
      // Nothing fit the band. Rather than jumping to an arbitrary wide distance
      // (which is how the board used to end up off-screen), pick the distance that
      // clips the LEAST — the smallest amount of overflow is the most usable view.
      let fallback = null;
      for (let ty = -0.6; ty <= 1.2; ty += 0.2) {
        for (let d = MIN_DISTANCE; d <= MAX_DISTANCE; d += 0.5) {
          const m = measure(d, ty);
          const overflow = Math.max(0, band.top - m.minY)
            + Math.max(0, m.maxY - band.bottom)
            + Math.max(0, band.left - m.minX)
            + Math.max(0, m.maxX - band.right);
          if (!fallback || overflow < fallback.overflow) {
            fallback = { distance: d, targetY: ty, overflow };
          }
        }
      }
      best = fallback ?? { distance: MAX_DISTANCE * 0.85, targetY: 0.2 };
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
