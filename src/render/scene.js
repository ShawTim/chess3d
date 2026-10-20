/**
 * Scene, lighting and post-processing.
 *
 * The look is "studio product photography": a warm key softbox, a cool fill and
 * a warm rim, reflected in a hand-built environment rather than a generic
 * room. The environment is generated at runtime from emissive panels, so the
 * page still ships without a single image asset.
 *
 * Post-processing is a restrained film chain: bloom only on real speculars, a
 * vignette, SMAA, ACES tone mapping, then a grade pass that adds a little
 * halation-free grain and the faintest edge aberration. Heavy effects would
 * fight the wood.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createPuffTexture } from './textures.js';

/** Gentle vignette + subtle saturation lift, applied before tone mapping. */
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.06 },
    darkness: { value: 0.34 },
    saturation: { value: 1.05 },
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

/**
 * Final grade: lifted blacks, a gentle S-curve, a hair of lens aberration at
 * the frame edges and animated grain. Runs after OutputPass, so it works in
 * display space and cannot be crushed by ACES.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grain: { value: 0.018 },
    aberration: { value: 0.0007 },
    resolution: { value: new THREE.Vector2(1, 1) },
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
    uniform float time;
    uniform float grain;
    uniform float aberration;
    uniform vec2 resolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * aberration * (0.35 + r2 * 2.2);

      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;

      // Lift the blacks a touch and add a very soft filmic S-curve.
      col = col + vec3(0.008, 0.010, 0.014) * (1.0 - col);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.10);

      // Grain, strongest in the midtones so pure blacks stay clean.
      float n = hash(uv * resolution + fract(time) * 137.0) - 0.5;
      float mask = smoothstep(0.02, 0.32, col.g) * (1.0 - smoothstep(0.75, 1.0, col.g));
      col += n * grain * (0.35 + mask);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * A hand-built studio in HDR, captured to a PMREM.
 *
 * RoomEnvironment is a bright, evenly lit room: it makes marble look chalky and
 * gold look like yellow plastic because every surface reflects the same white
 * walls. This room is dark with three shaped softboxes, so the pieces pick up a
 * long warm highlight down one flank and a cool edge down the other — the
 * single biggest change to how "expensive" the set looks.
 */
function createStudioEnvironment() {
  const env = new THREE.Scene();

  const room = new THREE.Mesh(
    new THREE.SphereGeometry(16, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x07080b, side: THREE.BackSide }),
  );
  env.add(room);

  const panel = (w, h, rgb, pos, target = [0, 0, 0]) => {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    mat.color.setRGB(rgb[0], rgb[1], rgb[2]);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.lookAt(target[0], target[1], target[2]);
    env.add(mesh);
    return mesh;
  };

  // Key: big warm softbox, high and slightly in front of White's side.
  panel(7.0, 4.6, [6.8, 5.6, 3.9], [6.4, 8.8, 5.6]);
  // Fill: cool panel on the opposite side, dimmer and softer.
  panel(5.2, 6.4, [1.05, 1.45, 2.15], [-8.4, 3.0, 2.4]);
  // Rim: a narrow warm strip behind, which draws the black pieces' edges.
  panel(4.6, 1.5, [4.8, 3.1, 1.8], [-2.6, 4.2, -8.2]);
  // Broad top light so the board never falls into pure black.
  panel(6.5, 6.5, [0.82, 0.88, 1.02], [0, 11.5, 0]);
  // Low warm bounce, as if the light were bouncing off a wooden table.
  panel(10.0, 3.0, [0.75, 0.58, 0.40], [0, -4.5, 6.0]);

  return env;
}

/**
 * The visible backdrop: a huge inside-out sphere with a soft vertical gradient
 * and a warm pool low behind the board. A flat clear colour reads as a void and
 * flattens the whole image; this gives the scene a horizon to sit against.
 */
function createBackdrop() {
  const geo = new THREE.SphereGeometry(70, 40, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x080a10) },
      horizonColor: { value: new THREE.Color(0x171a21) },
      bottomColor: { value: new THREE.Color(0x05060a) },
      glowColor: { value: new THREE.Color(0x2b2116) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      uniform vec3 glowColor;
      varying vec3 vDir;

      void main() {
        float h = vDir.y;
        vec3 col = mix(horizonColor, topColor, smoothstep(0.0, 0.8, h));
        col = mix(bottomColor, col, smoothstep(-0.30, 0.04, h));
        float pool = pow(max(0.0, 1.0 - abs(h + 0.10) * 2.2), 3.0);
        col += glowColor * pool * 0.55;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'backdrop';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

export class SceneRig {
  constructor(canvas, { onResize } = {}) {
    this.canvas = canvas;
    this.time = 0;

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
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // --------------------------------------------------------------- scene --
    this.scene = new THREE.Scene();
    // Fog matches the backdrop horizon so the table dissolves into it.
    this.scene.fog = new THREE.FogExp2(0x0b0c10, 0.022);
    this.scene.add(createBackdrop());

    // ----------------------------------------------------------- environment --
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envScene = createStudioEnvironment();
    this.envRT = pmrem.fromScene(envScene, 0.02, 0.1, 100);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();
    envScene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });

    // --------------------------------------------------------------- camera --
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 8.2, 7.6);
    this.camera.lookAt(0, 0.4, 0);

    this.setupLights();
    this.setupDust();
    this.setupComposer();

    this.onResize = onResize;
    this.resize();
  }

  setupLights() {
    // Key light: a warm, soft shadow caster high on White's side.
    const key = new THREE.DirectionalLight(0xffefd6, 2.75);
    key.position.set(5.5, 11, 6.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    const s = 7.0;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.018;
    key.shadow.radius = 3.0;
    this.scene.add(key, key.target);
    this.keyLight = key;

    // Fill light: cool and shadowless, to keep the dark pieces from going black.
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.9);
    fill.position.set(-7, 6, -3.5);
    this.scene.add(fill, fill.target);

    // Rim light from behind to separate the black pieces from the background.
    const rim = new THREE.DirectionalLight(0xffd9a8, 1.95);
    rim.position.set(-2.5, 4.5, -8.5);
    this.scene.add(rim, rim.target);

    // A very low ambient so nothing is ever fully unlit.
    this.scene.add(new THREE.AmbientLight(0x3a4356, 0.20));

    // A practical behind the board, lighting the frame's back edge and the
    // table so the set does not look pasted onto a black void.
    const back = new THREE.PointLight(0xffc98a, 7, 18, 2);
    back.position.set(0, 1.6, -7.5);
    this.scene.add(back);
  }

  /** Slow atmospheric dust in the key light; cheap, and it sells scale. */
  setupDust() {
    const count = 220;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.6 + Math.random() * 7.2;
      const a = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.15 + Math.random() * 4.2;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const tex = createPuffTexture({ size: 64 });
    const mat = new THREE.PointsMaterial({
      map: tex,
      size: 0.055,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffe3bc,
      toneMapped: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.name = 'dust';
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this.dustTexture = tex;
  }

  setupComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // Bloom: threshold high enough that only glints and gold catch it.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.30,  // strength
      0.55,  // radius
      0.84,  // threshold: gold, speculars and the practical light
    );
    this.composer.addPass(this.bloom);

    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);

    this.smaa = new SMAAPass(size.x, size.y);
    this.composer.addPass(this.smaa);

    // OutputPass performs tone mapping + colour space conversion for the chain.
    this.output = new OutputPass();
    this.composer.addPass(this.output);

    // Grade runs in display space, after tone mapping.
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  /**
   * Toggle the "cinematic" look.
   *
   * Cinematic mode adds bloom, the vignette and grain on top of the base render.
   * Turning it off leaves a clean, fast image for lower-powered devices; the
   * passes are skipped rather than merely zeroed, which is a real saving
   * because the composer still has to run each pass it is given.
   */
  setCinematic(on) {
    this.cinematic = on;
    if (this.bloom) this.bloom.enabled = on;
    if (this.vignette) this.vignette.enabled = on;
    if (this.grade) {
      this.grade.enabled = true;
      this.grade.uniforms.grain.value = on ? 0.018 : 0.0;
      this.grade.uniforms.aberration.value = on ? 0.0007 : 0.0;
    }
    // Exposure is raised slightly with the effects on, so the bloom reads as
    // highlight bleed rather than a global brightness lift.
    this.renderer.toneMappingExposure = on ? 1.12 : 1.04;
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
    if (this.grade) this.grade.uniforms.resolution.value.set(w * dpr, h * dpr);

    this.onResize?.(w, h);
  }

  render(dt) {
    this.time += dt;
    this.controls?.update?.(dt);

    if (this.dust) {
      this.dust.rotation.y += dt * 0.012;
      this.dust.position.y = Math.sin(this.time * 0.18) * 0.06;
    }
    if (this.grade) this.grade.uniforms.time.value = this.time;

    this.composer.render(dt);
  }

  dispose() {
    this.envRT?.dispose();
    this.dustTexture?.dispose();
    this.dust?.geometry.dispose();
    this.dust?.material.dispose();
    this.composer?.dispose?.();
    this.renderer.dispose();
  }
}
