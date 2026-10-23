/**
 * Sharing a game without a server.
 *
 * A game is encoded into the URL fragment, which browsers never send to the
 * server: a shared link is still a static page, and nothing about the "no
 * backend" promise changes. The fragment carries the same UCI move list the
 * auto-save already stores, so a link is restored by replaying it through the
 * rules engine — an illegal or hand-edited link cannot put a bogus board on
 * screen, it is simply ignored.
 *
 * PGN export lives here too: the move list already holds the SAN of every move,
 * so a game can be handed to any other chess program as text.
 */

export const SHARE_HASH_KEY = 'moves';

/** `h` file (a-h), rank (1-8), twice, optional promotion piece. */
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * Encode moves for a URL fragment.
 *
 * @param {string[]} moves UCI moves in game order.
 * @returns {string}
 */
export function encodeMoves(moves) {
  return moves.join(',');
}

/**
 * Read moves out of a URL fragment.
 *
 * Accepts `#moves=e2e4,e7e5` and the bare `#e2e4,e7e5` form, because the short
 * one is what a player will hand-edit. Returns null when there is nothing usable
 * — malformed input is not an error worth reporting, it just means "no shared
 * game in this link".
 *
 * @param {string} hash
 * @returns {string[]|null}
 */
export function parseMoves(hash) {
  if (typeof hash !== 'string') return null;
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) return null;

  const value = raw.startsWith(`${SHARE_HASH_KEY}=`)
    ? raw.slice(SHARE_HASH_KEY.length + 1)
    : raw;
  if (!value) return null;

  const moves = value.split(',')
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0);
  if (!moves.length || moves.length > 1000) return null;
  if (moves.some((m) => !UCI_MOVE.test(m))) return null;
  return moves;
}

/**
 * The fragment for a game, without the leading `#`. Empty for no moves, so a
 * fresh board leaves the URL clean.
 *
 * @param {string[]} moves
 * @returns {string}
 */
export function hashFor(moves) {
  return moves.length ? `${SHARE_HASH_KEY}=${encodeMoves(moves)}` : '';
}

/**
 * Build a shareable absolute URL for a game.
 *
 * @param {string} href The page's own URL (usually `location.href`).
 * @param {string[]} moves
 * @returns {string}
 */
export function buildShareUrl(href, moves) {
  const url = new URL(href);
  url.hash = hashFor(moves);
  return url.toString();
}

/**
 * PGN result tag for a game status.
 *
 * @param {{over: boolean, result?: string}|null} status
 * @returns {string}
 */
export function resultTag(status) {
  if (!status || !status.over) return '*';
  if (status.result === 'white') return '1-0';
  if (status.result === 'black') return '0-1';
  return '1/2-1/2';
}

const PGN_LINE_WIDTH = 80;

/**
 * Render a game as PGN.
 *
 * @param {{san: string}[]} moveList Entries from the controller's move list.
 * @param {{white?: string, black?: string, result?: string, site?: string, date?: Date}} [meta]
 * @returns {string}
 */
export function toPgn(moveList, meta = {}) {
  const {
    white = 'You',
    black = 'Chess3D',
    result = '*',
    site = '',
    date = new Date(),
  } = meta;

  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('.');

  const headers = [
    ['Event', 'Chess3D'],
    ['Site', site],
    ['Date', stamp],
    ['Round', '-'],
    ['White', white],
    ['Black', black],
    ['Result', result],
  ];
  const head = headers
    .map(([key, value]) => `[${key} "${String(value).replace(/"/g, '\\"')}"]`)
    .join('\n');

  const tokens = [];
  moveList.forEach((entry, index) => {
    if (index % 2 === 0) tokens.push(`${index / 2 + 1}.`);
    tokens.push(entry.san);
  });
  tokens.push(result);

  const lines = [];
  let line = '';
  for (const token of tokens) {
    if (line.length === 0) line = token;
    else if (line.length + 1 + token.length > PGN_LINE_WIDTH) {
      lines.push(line);
      line = token;
    } else line += ` ${token}`;
  }
  if (line.length) lines.push(line);

  return `${head}\n\n${lines.join('\n')}\n`;
}
