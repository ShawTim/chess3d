/**
 * PBR material library.
 *
 * Every map is generated procedurally at load (see textures.js), so the app
 * ships with no image files at all. Materials are created once and shared across
 * all the meshes that use them, which keeps the draw-call state changes low.
 */
import * as THREE from 'three';
import {
  createWoodTexture, createWoodRoughness, createWoodNormalMap,
  createMarbleTexture, createMarbleRoughness, createMarbleNormalMap,
  createGroundTexture,
} from './textures.js';

/** Wood palette, chosen so the light squares stay legible under bloom. */
const LIGHT_WOOD = {
  seed: 11,
  // Slightly deeper than the original honey tone: under the new exposure the old
  // values read as lemon-yellow and fought the brass inlay.
  dark: [0.48, 0.31, 0.155],
  light: [0.80, 0.645, 0.435],
  rings: 5,
};

const DARK_WOOD = {
  seed: 23,
  dark: [0.13, 0.070, 0.032],
  light: [0.36, 0.20, 0.093],
  rings: 6,
};

/** Frame wood is a deeper, redder timber than either square colour. */
const FRAME_WOOD = {
  seed: 41,
  dark: [0.075, 0.040, 0.022],
  light: [0.24, 0.125, 0.058],
  rings: 4,
};

const WHITE_PIECE = {
  seed: 3,
  // Ivory, not chalk. At 0.96 with the studio environment the highlights
  // clipped to pure white and every piece lost its carved detail.
  base: [0.70, 0.678, 0.632],
  vein: [0.44, 0.42, 0.39],
  veinStrength: 0.55,
  swirl: 3.1,
  scale: 1.4,
};

const BLACK_PIECE = {
  seed: 57,
  base: [0.115, 0.113, 0.122],
  vein: [0.30, 0.305, 0.325],
  veinStrength: 0.85,
  swirl: 3.6,
  scale: 1.6,
};

export class MaterialLibrary {
  constructor({ anisotropy = 8 } = {}) {
    this.anisotropy = anisotropy;
    this.textures = [];
    this.materials = [];
    this.build();
  }

  track(tex) {
    this.textures.push(tex);
    return tex;
  }

  keep(mat) {
    this.materials.push(mat);
    return mat;
  }

  build() {
    const aniso = this.anisotropy;

    // --- Board squares -----------------------------------------------------
    // Light and dark squares share the same geometry; only the maps differ.
    this.lightSquare = this.keep(new THREE.MeshPhysicalMaterial({
      map: this.track(createWoodTexture({ ...LIGHT_WOOD, size: 512 })),
      roughnessMap: this.track(createWoodRoughness({ seed: LIGHT_WOOD.seed, size: 256, min: 0.22, max: 0.50 })),
      normalMap: this.track(createWoodNormalMap({ seed: LIGHT_WOOD.seed, size: 512, rings: LIGHT_WOOD.rings })),
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughness: 1.0,
      metalness: 0.0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.28,
      sheen: 0.15,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(0x3a2a18),
      envMapIntensity: 0.85,
    }));

    this.darkSquare = this.keep(new THREE.MeshPhysicalMaterial({
      map: this.track(createWoodTexture({ ...DARK_WOOD, size: 512 })),
      roughnessMap: this.track(createWoodRoughness({ seed: DARK_WOOD.seed, size: 256, min: 0.18, max: 0.44 })),
      normalMap: this.track(createWoodNormalMap({ seed: DARK_WOOD.seed, size: 512, rings: DARK_WOOD.rings })),
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: 1.0,
      metalness: 0.0,
      clearcoat: 0.70,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.0,
    }));

    // --- Board frame -------------------------------------------------------
    this.frame = this.keep(new THREE.MeshPhysicalMaterial({
      map: this.track(createWoodTexture({ ...FRAME_WOOD, size: 512 })),
      roughnessMap: this.track(createWoodRoughness({ seed: FRAME_WOOD.seed, size: 256, min: 0.14, max: 0.38 })),
      normalMap: this.track(createWoodNormalMap({ seed: FRAME_WOOD.seed, size: 512, rings: FRAME_WOOD.rings })),
      normalScale: new THREE.Vector2(0.30, 0.30),
      roughness: 1.0,
      metalness: 0.0,
      clearcoat: 0.85,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.15,
    }));

    // --- Pieces ------------------------------------------------------------
    // Marble with a lacquered clearcoat, which is how a fine wooden/stone set
    // actually looks: hard specular highlight over a softly veined body.
    this.whitePiece = this.keep(new THREE.MeshPhysicalMaterial({
      map: this.track(createMarbleTexture({ ...WHITE_PIECE, size: 512 })),
      roughnessMap: this.track(createMarbleRoughness({ seed: WHITE_PIECE.seed, size: 256, min: 0.16, max: 0.40 })),
      normalMap: this.track(createMarbleNormalMap({ seed: WHITE_PIECE.seed, size: 512 })),
      normalScale: new THREE.Vector2(0.30, 0.30),
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.13,
      sheen: 0.28,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0x6b5a44),
      envMapIntensity: 0.76,
    }));

    this.blackPiece = this.keep(new THREE.MeshPhysicalMaterial({
      map: this.track(createMarbleTexture({ ...BLACK_PIECE, size: 512 })),
      roughnessMap: this.track(createMarbleRoughness({ seed: BLACK_PIECE.seed, size: 256, min: 0.10, max: 0.32 })),
      normalMap: this.track(createMarbleNormalMap({ seed: BLACK_PIECE.seed, size: 512 })),
      normalScale: new THREE.Vector2(0.26, 0.26),
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.07,
      envMapIntensity: 1.5,
    }));

    // --- Accents -----------------------------------------------------------
    // Warm gold for queen crowns and king finials. Anisotropy is what reads as
    // "turned metal" rather than a smooth plastic swirl: the highlight stretches
    // along the lathe direction the way it does on a real gilt finial.
    this.gold = this.keep(new THREE.MeshPhysicalMaterial({
      color: 0xd8ad55,
      metalness: 1.0,
      roughness: 0.28,
      anisotropy: 0.55,
      anisotropyRotation: Math.PI / 2,
      clearcoat: 0.45,
      clearcoatRoughness: 0.30,
      envMapIntensity: 1.55,
    }));

    // Darker bronze for the black side's accents, so the two sides read apart.
    this.bronze = this.keep(new THREE.MeshPhysicalMaterial({
      color: 0x8a6a3c,
      metalness: 1.0,
      roughness: 0.38,
      anisotropy: 0.45,
      anisotropyRotation: Math.PI / 2,
      clearcoat: 0.32,
      clearcoatRoughness: 0.38,
      envMapIntensity: 1.35,
    }));

    // Brass inlay: the thin line set into the frame around the playing field.
    // Slightly brighter and smoother than the accent gold so it catches a
    // continuous highlight along its whole length.
    this.inlay = this.keep(new THREE.MeshPhysicalMaterial({
      color: 0xe2bf74,
      metalness: 1.0,
      roughness: 0.20,
      anisotropy: 0.7,
      anisotropyRotation: 0,
      envMapIntensity: 1.7,
    }));

    // Felt under the board, so the set sits on something instead of floating.
    this.felt = this.keep(new THREE.MeshPhysicalMaterial({
      color: 0x141a17,
      roughness: 0.96,
      metalness: 0.0,
      sheen: 0.5,
      sheenRoughness: 0.9,
      sheenColor: new THREE.Color(0x2d3a33),
      envMapIntensity: 0.25,
    }));

    // --- Ground ------------------------------------------------------------
    const groundTex = this.track(createGroundTexture({ size: 1024 }));
    this.ground = this.keep(new THREE.MeshPhysicalMaterial({
      map: groundTex,
      roughness: 0.62,
      metalness: 0.0,
      clearcoat: 0.22,
      clearcoatRoughness: 0.5,
      envMapIntensity: 0.5,
    }));

    // --- Overlays ----------------------------------------------------------
    // --- Overlays ----------------------------------------------------------
    // The highlight palette is warm and desaturated, drawn from the same brass
    // and ivory as the rest of the UI. Neon cyan is the one colour that makes a
    // considered 3D scene look like a prototype, so the markers now read as
    // light falling on the wood rather than as debug gizmos.
    this.selectRing = this.keep(new THREE.MeshBasicMaterial({
      color: 0xffe0a8,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));

    this.moveDot = this.keep(new THREE.MeshBasicMaterial({
      color: 0xffe7c0,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));

    this.captureRing = this.keep(new THREE.MeshBasicMaterial({
      color: 0xffab6e,
      transparent: true,
      opacity: 0.80,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));

    this.lastMoveFrom = this.keep(new THREE.MeshBasicMaterial({
      color: 0xf3cf92,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));

    this.lastMoveTo = this.keep(new THREE.MeshBasicMaterial({
      color: 0xffd88f,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));

    // Very soft wash under the cursor: reads as a light shift, not a tile tint.
    this.hover = this.keep(new THREE.MeshBasicMaterial({
      color: 0xfff2da,
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));

    // Check is the one place that earns a saturated colour: it is a warning.
    this.checkPulse = this.keep(new THREE.MeshBasicMaterial({
      color: 0xff5540,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
  }

  /** Material for a piece of the given colour. */
  piece(color) {
    return color === 0 ? this.whitePiece : this.blackPiece;
  }

  /** Accent metal for a piece colour: gold for White, bronze for Black. */
  accent(color) {
    return color === 0 ? this.gold : this.bronze;
  }

  dispose() {
    for (const t of this.textures) t.dispose?.();
    for (const m of this.materials) m.dispose?.();
    this.textures.length = 0;
    this.materials.length = 0;
  }
}
