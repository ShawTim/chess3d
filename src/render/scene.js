/**
 * Scene, lighting and post-processing.
 *
 * The lighting is a classic three-point studio setup over a soft image-based
 * environment, which is what gives the marble its believable reflections. The
 * environment is generated procedurally at runtime (RoomEnvironment), so no HDR
 * file is needed and the page stays fully offline.
 *
 * Post-processing is intentionally restrained: a whisper of bloom on the specular
 * highlights, a gentle vignette, and SMAA. Heavy effects would fight the wood.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Gentle vignette + subtle saturation lift, applied after tone mapping. */
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.02 },
    darkness: { value: 0.42 },
    saturation: { value: 1.06 },
    warmth: { value: 0.012 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    uniform float saturation;
    uniform float warmth;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Radial falloff from the centre of the frame.
      vec2 uv = (vUv - 0.5) * vec2(offset);
      float vignette = 1.0 - dot(uv, uv) * darkness;
      color.rgb *= clamp(vignette, 0.0, 1.0);

      // Lift saturation slightly and add a touch of warmth to the highlights.
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luma), color.rgb, saturation);
      color.rgb += warmth * smoothstep(0.6, 1.0, luma);

      gl_FragColor = color;
    }
  `,
};

export class SceneRig {
  constructor(canvas, { onResize } = {}) {
    this.canvas = canvas;

    // ------------------------------------------------------------- renderer --
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // SMAA handles this; MSAA is unavailable with a composer.
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.10;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // --------------------------------------------------------------- scene --
    this.scene = new THREE.Scene();
    // A deep, slightly cool background so the warm board pops forward.
    this.scene.background = new THREE.Color(0x0a0b0e);
    this.scene.fog = new THREE.FogExp2(0x0a0b0e, 0.028);

    // ----------------------------------------------------------- environment --
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    // Background stays the flat colour set above; the env only lights surfaces.
    pmrem.dispose();

    // --------------------------------------------------------------- camera --
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 8.2, 7.6);
    this.camera.lookAt(0, 0.4, 0);

    this.setupLights();
    this.setupComposer();

    this.onResize = onResize;
    this.resize();
  }

  setupLights() {
    // Key light: a warm, soft shadow caster high on White's side.
    const key = new THREE.DirectionalLight(0xfff0d8, 2.6);
    key.position.set(5.5, 11, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    const s = 7.2;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.022;
    key.shadow.radius = 2.4;
    this.scene.add(key, key.target);
    this.keyLight = key;

    // Fill light: cool and shadowless, to keep the dark pieces from going black.
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.85);
    fill.position.set(-7, 6, -3.5);
    this.scene.add(fill, fill.target);

    // Rim light from behind to separate the black pieces from the background.
    const rim = new THREE.DirectionalLight(0xffd9a8, 1.25);
    rim.position.set(-2.5, 4.5, -8.5);
    this.scene.add(rim, rim.target);

    // A very low ambient so nothing is ever fully unlit.
    this.scene.add(new THREE.AmbientLight(0x404a5c, 0.35));

    // Soft pool of light on the table directly under the board.
    const under = new THREE.PointLight(0xffd9a0, 12, 22, 2);
    under.position.set(0, -2.4, 2.5);
    this.scene.add(under);
  }

  setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Bloom: high threshold so only glints and the gold accents catch it.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.20,  // strength
      0.50,  // radius
      0.97,  // threshold: only the gold accents and true speculars bloom
    );
    this.composer.addPass(this.bloom);

    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);

    this.smaa = new SMAAPass(size.x, size.y);
    this.composer.addPass(this.smaa);

    // OutputPass performs tone mapping + colour space conversion for the chain.
    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  /**
   * Toggle the "cinematic" look.
   *
   * Cinematic mode adds bloom and the vignette pass on top of the base render.
   * Turning it off leaves a clean, fast image for lower-powered devices; the
   * passes are skipped rather than merely zeroed, which is a real saving
   * because the composer still has to run each pass it is given.
   */
  setCinematic(on) {
    this.cinematic = on;
    if (this.bloom) this.bloom.enabled = on;
    if (this.vignette) this.vignette.enabled = on;
    // Exposure is raised slightly with the effects on, so the bloom reads as
    // highlight bleed rather than a global brightness lift.
    this.renderer.toneMappingExposure = on ? 1.10 : 1.04;
  }

  /** Attach an OrbitControls-based camera rig. */
  attachControls(controls) {
    this.controls = controls;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = this.renderer.getPixelRatio();

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w * dpr, h * dpr);

    if (this.smaa) this.smaa.setSize(w * dpr, h * dpr);
    if (this.bloom) this.bloom.setSize(w * dpr, h * dpr);

    this.onResize?.(w, h);
  }

  render(dt) {
    this.controls?.update?.(dt);
    this.composer.render(dt);
  }

  dispose() {
    this.envRT?.dispose();
    this.composer?.dispose?.();
    this.renderer.dispose();
  }
}
