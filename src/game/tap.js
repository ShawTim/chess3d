/**
 * Tap recognition for the board canvas.
 *
 * The board has to tell a tap apart from the start of a camera orbit, and it
 * used to do that with two rules, both of which silently dropped real taps:
 *
 *   - a gesture that lasted longer than 700 ms (900 ms on touch) was rejected.
 *     Players press a piece, hold it while deciding, and release — that is still
 *     a tap, and swallowing it reads as "the board sometimes ignores my move".
 *   - a missed `pointerup` (released off the canvas, or the browser swallowed
 *     it) left the previous gesture pending, and the next `pointerdown` was
 *     thrown away to clear it. The first click after that did nothing.
 *
 * The rule is now purely geometric: a gesture is a tap when the pointer never
 * wandered further than the slop radius, however long it was held. The furthest
 * point matters, not the final one, so a circular drag that happens to end
 * where it started is still a drag. Every fresh primary press starts a new
 * gesture, so a stale one can never eat a click; only a genuinely second finger
 * (a pinch) cancels.
 */
export class TapGesture {
  /**
   * @param {{ slopPx?: number|(() => number) }} [options]
   */
  constructor({ slopPx = 6 } = {}) {
    this.slopPx = slopPx;
    this.active = null;
  }

  /** Current slop radius; a function so a media query can be re-read per gesture. */
  get slop() {
    return typeof this.slopPx === 'function' ? this.slopPx() : this.slopPx;
  }

  /**
   * Begin tracking a press.
   *
   * @param {number} id        Pointer id.
   * @param {number} x         Client x at the press.
   * @param {number} y         Client y at the press.
   * @param {boolean} [isPrimary] False for the second finger of a pinch.
   * @returns {boolean} True when the press starts a candidate tap.
   */
  start(id, x, y, isPrimary = true) {
    if (!isPrimary) {
      // A second finger means zoom, not a tap. Drop the candidate so the pinch
      // does not also register as a board click on release.
      this.active = null;
      return false;
    }
    this.active = { id, x, y, drift: 0 };
    return true;
  }

  /** Track how far the pointer has moved since the press. */
  move(id, x, y) {
    const a = this.active;
    if (!a || a.id !== id) return;
    const drift = Math.hypot(x - a.x, y - a.y);
    if (drift > a.drift) a.drift = drift;
  }

  /**
   * Finish a press.
   *
   * @returns {boolean} True when the gesture counts as a tap.
   */
  end(id) {
    const a = this.active;
    if (!a || a.id !== id) return false;
    this.active = null;
    return a.drift <= this.slop;
  }

  cancel() {
    this.active = null;
  }
}
