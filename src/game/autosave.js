/**
 * Auto-save: a game in progress survives a reload.
 *
 * Only the move list is stored, plus the two choices the position depends on
 * (side and difficulty). The board is rebuilt by replaying those moves through
 * the rules engine, so a stale or hand-edited entry can never put an illegal
 * position on screen — anything that does not replay cleanly is thrown away and
 * the player simply starts fresh.
 *
 * The payload is deliberately small (a 200-move game is under 3 kB) and the
 * storage is probed once, because `localStorage` can be missing entirely, full,
 * or throw on write in private mode. None of that may break the game.
 */
import { BLACK } from '../engine/chess.js';

export const AUTOSAVE_KEY = 'chess3d.game.v1';
export const AUTOSAVE_VERSION = 1;

/**
 * Wrap a Storage in something safe to call, or null when it cannot be written.
 *
 * @param {Storage|null|undefined} candidate
 * @returns {Storage|null}
 */
export function usableStorage(candidate) {
  if (!candidate) return null;
  try {
    const probe = 'chess3d.storage-probe';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Persist the current game.
 *
 * @param {{ setItem: Function }|null} storage
 * @param {{ playerColor: number, difficulty: string, moves: string[] }} state
 * @returns {boolean} True when the entry was written.
 */
export function saveGame(storage, { playerColor, difficulty, moves }) {
  if (!storage) return false;
  try {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify({
      version: AUTOSAVE_VERSION,
      playerColor,
      difficulty,
      moves,
    }));
    return true;
  } catch {
    // Quota or private mode: the game simply does not persist this session.
    return false;
  }
}

/**
 * Read the saved game, or null when there is nothing trustworthy to restore.
 *
 * The moves are NOT validated here — only the shape. The controller replays them
 * against the rules engine, which is the only thing that can decide legality.
 *
 * @param {{ getItem: Function }|null} storage
 * @returns {{ playerColor: number, difficulty: string, moves: string[] }|null}
 */
export function loadGame(storage) {
  if (!storage) return null;

  let raw;
  try {
    raw = storage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.version !== AUTOSAVE_VERSION) return null;
  if (!Array.isArray(data.moves) || data.moves.some((m) => typeof m !== 'string')) return null;
  if (typeof data.difficulty !== 'string' || !data.difficulty) return null;

  const playerColor = data.playerColor === BLACK ? BLACK : 0;
  return { playerColor, difficulty: data.difficulty, moves: data.moves.slice() };
}

/**
 * Forget the saved game, for a corrupt entry or an explicit discard.
 *
 * @param {{ removeItem: Function }|null} storage
 */
export function clearGame(storage) {
  if (!storage) return;
  try {
    storage.removeItem(AUTOSAVE_KEY);
  } catch { /* nothing to do: the entry is unreadable anyway */ }
}
