import * as THREE from 'three';
import { knightParts, PIECE_HEIGHT, knightHeadGeo } from '../src/render/pieces.js';
import { KNIGHT } from '../src/engine/chess.js';

function box(g) { g.computeBoundingBox(); return g.boundingBox; }

const head0 = knightHeadGeo();
console.log('head pre-assembly  y:', box(head0).min.y.toFixed(3), '..', box(head0).max.y.toFixed(3));
console.log('head pre-assembly  z:', box(head0).min.z.toFixed(3), '..', box(head0).max.z.toFixed(3));
console.log('head pre-assembly  x:', box(head0).min.x.toFixed(3), '..', box(head0).max.x.toFixed(3));

const p = knightParts();
const hb = box(p.head), eb = box(p.ear), mb = box(p.mane), bb = box(p.base);
console.log('\nAFTER knightParts scale+seat:');
console.log('  base  y:', bb.min.y.toFixed(3), '..', bb.max.y.toFixed(3));
console.log('  head  y:', hb.min.y.toFixed(3), '..', hb.max.y.toFixed(3), ' z:', hb.min.z.toFixed(3), '..', hb.max.z.toFixed(3));
console.log('  ear   y:', eb.min.y.toFixed(3), '..', eb.max.y.toFixed(3), ' z:', eb.min.z.toFixed(3), '..', eb.max.z.toFixed(3));
console.log('  mane  y:', mb.min.y.toFixed(3), '..', mb.max.y.toFixed(3));
console.log('\n  ear.min.y - head.max.y =', (eb.min.y - hb.max.y).toFixed(3), '(want negative)');
