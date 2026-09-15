/**
 * Unicode chess glyphs.
 *
 * Used only by the HUD (captured-piece trays, selection readout). The 3D board
 * itself is geometry, so these never appear in the scene — they exist so the DOM
 * side of the UI needs no icon font or SVG files, keeping the page offline.
 *
 * The glyphs are solid black figures; CSS colours them per side.
 */
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../engine/chess.js';

export const PIECE_GLYPHS = {
  [PAWN]: '\u265F',
  [KNIGHT]: '\u265E',
  [BISHOP]: '\u265D',
  [ROOK]: '\u265C',
  [QUEEN]: '\u265B',
  [KING]: '\u265A',
};

export const PIECE_GLYPH_NAMES = {
  [PAWN]: 'pawn',
  [KNIGHT]: 'knight',
  [BISHOP]: 'bishop',
  [ROOK]: 'rook',
  [QUEEN]: 'queen',
  [KING]: 'king',
};
