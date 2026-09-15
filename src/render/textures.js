/**
 * Procedural textures.
 *
 * Every texture in the app is generated at load time from value noise painted
 * into an offscreen canvas. Nothing is fetched from the network, which is what
 * lets the whole game ship as a single static page with no asset pipeline.
 */
import * as THREE from 'three';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Integer hash -> [0,1). Math.imul keeps the arithmetic in 32-bit space. */
function ihash(x, y, seed) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

/** Smoothstep-interpolated value noise. */
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = ihash(x0, y0, seed);
  const b = ihash(x0 + 1, y0, seed);
  const c = ihash(x0, y0 + 1, seed);
  const d = ihash(x0 + 1, y0 + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Fractal Brownian motion; the workhorse for every material below. */
export function fbm(x, y, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 131);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function toTexture(canvas, { srgb = false, repeat = 1, anisotropy = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Paint a per-pixel field into a canvas; `fn` returns [r,g,b] in 0..1. */
function paint(size, fn) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = fn(x / size, y / size);
      const o = (y * size + x) * 4;
      data[o] = rgb[0] * 255;
      data[o + 1] = rgb[1] * 255;
      data[o + 2] = rgb[2] * 255;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Paint a scalar field into a greyscale canvas. */
function paintScalar(size, fn) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = clamp01(fn(x / size, y / size)) * 255;
      const o = (y * size + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const mix = (a, b, t) => a + (b - a) * t;

/**
 * Straight-grain wood. The grain runs along the U axis with a slow warp so the
 * rings wander the way sawn timber does, plus a high-frequency fibre overlay.
 */
export function createWoodTexture({
  size = 512,
  seed = 7,
  dark = [0.26, 0.15, 0.07],
  light = [0.72, 0.51, 0.29],
  rings = 7,
  warp = 1.6,
  fibre = 0.16,
} = {}) {
  const canvas = paint(size, (u, v) => {
    const w = fbm(u * 2.6, v * 1.1, seed, 4) - 0.5;
    const ring = Math.sin((u * rings + v * 0.15 + w * warp) * Math.PI * 2);
    // Sharpen the ring so the grain reads as lines rather than a smooth sine.
    const sharp = Math.pow(Math.abs(ring) * 0.5 + 0.5, 0.6);
    const tone = fbm(u * 1.7, v * 1.7, seed + 501, 3);
    const fibreNoise = (fbm(u * 190, v * 5.0, seed + 77, 3) - 0.5) * fibre;
    const k = clamp01(sharp * 0.62 + tone * 0.42 + fibreNoise + 0.02);
    return [mix(dark[0], light[0], k), mix(dark[1], light[1], k), mix(dark[2], light[2], k)];
  });
  return toTexture(canvas, { srgb: true, repeat: 1 });
}

/** Roughness companion for the wood: polished in the grain, duller in the pores. */
export function createWoodRoughness({ size = 256, seed = 7, min = 0.28, max = 0.62 } = {}) {
  const canvas = paintScalar(size, (u, v) => {
    const grain = fbm(u * 8, v * 2.2, seed + 11, 4);
    const pores = fbm(u * 150, v * 8, seed + 23, 3);
    return mix(min, max, grain * 0.7 + pores * 0.3);
  });
  return toTexture(canvas, { repeat: 1 });
}

/**
 * Marble for the pieces: a warm base shot through with darker veins, plus the
 * faint secondary veining real stone has.
 */
export function createMarbleTexture({
  size = 512,
  seed = 3,
  base = [0.94, 0.91, 0.85],
  vein = [0.58, 0.56, 0.53],
  veinStrength = 0.75,
  swirl = 3.4,
  scale = 1.5,
} = {}) {
  const canvas = paint(size, (u, v) => {
    const w = fbm(u * scale * 1.1, v * scale * 1.1, seed, 5) - 0.5;
    const primary = Math.sin((u * 1.9 + v * 0.8 + w * swirl) * Math.PI * 1.15);
    const t1 = Math.pow(Math.abs(primary), 5) * veinStrength;
    const w2 = fbm(u * 3.4, v * 2.6, seed + 91, 4) - 0.5;
    const secondary = Math.sin((v * 3.1 - u * 1.4 + w2 * 4.2) * Math.PI * 1.4);
    const t2 = Math.pow(Math.abs(secondary), 7) * veinStrength * 0.45;
    const t = clamp01(t1 + t2);
    // A little tonal drift keeps large flat faces from looking painted.
    const drift = (fbm(u * 1.2, v * 1.2, seed + 300, 3) - 0.5) * 0.06;
    return [
      clamp01(mix(base[0], vein[0], t) + drift),
      clamp01(mix(base[1], vein[1], t) + drift),
      clamp01(mix(base[2], vein[2], t) + drift),
    ];
  });
  return toTexture(canvas, { srgb: true, repeat: 1 });
}

/** Roughness for marble: mostly satin with slightly duller veins. */
export function createMarbleRoughness({ size = 256, seed = 3, min = 0.18, max = 0.44 } = {}) {
  const canvas = paintScalar(size, (u, v) => {
    const w = fbm(u * 1.65, v * 1.65, seed, 5) - 0.5;
    const primary = Math.sin((u * 1.9 + v * 0.8 + w * 3.4) * Math.PI * 1.15);
    const t = Math.pow(Math.abs(primary), 5);
    const body = fbm(u * 4.5, v * 4.5, seed + 55, 3);
    return mix(min, max, t * 0.65 + body * 0.35);
  });
  return toTexture(canvas, { repeat: 1 });
}

/**
 * Derive a tangent-space normal map from a height field by central differences.
 * Cheap enough to run at load for a 512 map, and the surface detail it adds is
 * what makes the stone look like stone rather than painted plastic.
 */
export function createNormalMap({ size = 512, heightFn, strength = 1.6 }) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      h[y * size + x] = heightFn(x / size, y / size);
    }
  }
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const step = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = h[y * size + ((x - 1 + size) % size)];
      const xr = h[y * size + ((x + 1) % size)];
      const yd = h[((y - 1 + size) % size) * size + x];
      const yu = h[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength / (2 * step) / size;
      let ny = (yd - yu) * strength / (2 * step) / size;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      const nzn = nz / len;
      const o = (y * size + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = (nzn * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { repeat: 1 });
}

/** Marble surface relief, matched to the albedo veining so the veins sit in the stone. */
export function createMarbleNormalMap({ size = 512, seed = 3 } = {}) {
  const height = (u, v) => {
    const w = fbm(u * 1.65, v * 1.65, seed, 5) - 0.5;
    const primary = Math.sin((u * 1.9 + v * 0.8 + w * 3.4) * Math.PI * 1.15);
    const veins = -Math.pow(Math.abs(primary), 5) * 0.55;
    const grain = fbm(u * 26, v * 26, seed + 601, 3) * 0.16;
    return veins + grain;
  };
  return createNormalMap({ size, heightFn: height, strength: 1.1 });
}

/** Wood relief for the board tiles: fine open grain, barely raised. */
export function createWoodNormalMap({ size = 512, seed = 7, rings = 7, warp = 1.6 } = {}) {
  const height = (u, v) => {
    const w = fbm(u * 2.6, v * 1.1, seed, 4) - 0.5;
    const ring = Math.sin((u * rings + v * 0.15 + w * warp) * Math.PI * 2);
    const grain = -Math.abs(ring) * 0.35;
    const fibre = (fbm(u * 190, v * 5.0, seed + 77, 3) - 0.5) * 0.4;
    return grain + fibre;
  };
  return createNormalMap({ size, heightFn: height, strength: 0.55 });
}

/**
 * The soft radial gradient of a table surface beneath the board. Kept dark and
 * low contrast so it reads as a pool of light rather than a visible circle.
 */
export function createGroundTexture({ size = 512, inner = [0.13, 0.12, 0.14], outer = [0.03, 0.03, 0.04] } = {}) {
  const canvas = paint(size, (u, v) => {
    const dx = (u - 0.5) * 2;
    const dy = (v - 0.5) * 2;
    const d = clamp01(Math.hypot(dx, dy));
    const t = d * d * (3 - 2 * d);
    const speck = (fbm(u * 70, v * 70, 909, 3) - 0.5) * 0.05;
    const k = clamp01(t + speck);
    return [
      clamp01(mix(inner[0], outer[0], k)),
      clamp01(mix(inner[1], outer[1], k)),
      clamp01(mix(inner[2], outer[2], k)),
    ];
  });
  return toTexture(canvas, { srgb: true, repeat: 1 });
}

/** Coordinate letters/digits for the board frame, drawn with transparency. */
export function createLabelTexture(text, {
  size = 128,
  color = '#e8dcc6',
  font = 'bold 72px "Helvetica Neue", Helvetica, Arial, sans-serif',
  opacity = 0.72,
} = {}) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 2 + size * 0.03);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * A round soft sprite used for the dust puff when a piece is captured.
 * White with a radial alpha falloff so it can be tinted at draw time.
 */
export function createPuffTexture({ size = 128 } = {}) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / size - 0.5) * 2;
      const dy = (y / size - 0.5) * 2;
      const d = Math.hypot(dx, dy);
      const n = fbm(x / size * 4, y / size * 4, 4242, 3);
      const a = clamp01(1 - d) ** 2 * (0.6 + n * 0.7);
      const o = (y * size + x) * 4;
      data[o] = 255;
      data[o + 1] = 250;
      data[o + 2] = 235;
      data[o + 3] = clamp01(a) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
