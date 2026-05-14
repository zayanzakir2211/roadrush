/**
 * graphics.js — Three.js Renderer Setup + Quality Presets
 *
 * Sets up the WebGL2 renderer, scene, camera, lighting, and postprocessing.
 * Quality presets control shadow resolution, antialiasing, render distance,
 * bloom, ambient occlusion, and particle density.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// ── Quality preset definitions ───────────────────────────────────────────────

const FOG_COLOR = new THREE.Color(0xe3f0ff);
const SKY_SETTINGS = {
  turbidity: 2.6,
  rayleigh: 1.8,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.82,
  elevation: 38,
  azimuth: 180,
};

let sky = null;
let sunVector = new THREE.Vector3();
let pmremGenerator = null;
let skyEnv = null;
let fxaaPass = null;
let bloomPass = null;

export const QUALITY_PRESETS = {
  low: {
    shadows: false,
    shadowMapSize: 0,
    renderDistanceChunks: 2,
    particles: 'off',
    ao: false,
    aa: 'off',
    lodDistance: 20,
    physicsObjects: 20,
    bloom: false,
    fog: true,
    fogNear: 140,
    fogFar: 360,
  },
  medium: {
    shadows: true,
    shadowMapSize: 512,
    renderDistanceChunks: 4,
    particles: 'low',
    ao: false,
    aa: 'FXAA',
    lodDistance: 50,
    physicsObjects: 50,
    bloom: false,
    fog: true,
    fogNear: 180,
    fogFar: 520,
  },
  high: {
    shadows: true,
    shadowMapSize: 2048,
    renderDistanceChunks: 6,
    particles: 'medium',
    ao: true,
    aa: 'FXAA',
    lodDistance: 100,
    physicsObjects: 100,
    bloom: true,
    fog: true,
    fogNear: 240,
    fogFar: 800,
  },
  ultra: {
    shadows: true,
    shadowMapSize: 4096,
    renderDistanceChunks: 8,
    particles: 'full',
    ao: true,
    aa: 'MSAA4',
    lodDistance: 200,
    physicsObjects: 200,
    bloom: true,
    fog: true,
    fogNear: 300,
    fogFar: 1100,
  },
};

export let currentPreset = 'medium';
export let composer = null;
export let sunLight = null;
export let ambientLight = null;

// ── Renderer + scene setup ───────────────────────────────────────────────────

export function setupRenderer() {
  const container = document.getElementById('canvas-container');

  const renderer = new THREE.WebGLRenderer({
    antialias: false, // MSAA handled via sample count on demand
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(FOG_COLOR, 180, 700);

  const camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 8, -15);

  // Sky + environment lighting
  setupSky(scene, renderer);

  // Lighting
  setupLighting(scene);

  // Postprocessing composer
  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  return { renderer, scene, camera };
}

// ── Sky + environment ──────────────────────────────────────────────────────

function setupSky(scene, renderer) {
  sky = new Sky();
  sky.scale.setScalar(450000);
  scene.add(sky);

  const uniforms = sky.material.uniforms;
  uniforms['turbidity'].value = SKY_SETTINGS.turbidity;
  uniforms['rayleigh'].value = SKY_SETTINGS.rayleigh;
  uniforms['mieCoefficient'].value = SKY_SETTINGS.mieCoefficient;
  uniforms['mieDirectionalG'].value = SKY_SETTINGS.mieDirectionalG;

  pmremGenerator = new THREE.PMREMGenerator(renderer);
  updateSkyEnvironment(scene, renderer);
}

function updateSkyEnvironment(scene, renderer) {
  const phi = THREE.MathUtils.degToRad(90 - SKY_SETTINGS.elevation);
  const theta = THREE.MathUtils.degToRad(SKY_SETTINGS.azimuth);
  sunVector.setFromSphericalCoords(1, phi, theta);

  if (sky) {
    sky.material.uniforms['sunPosition'].value.copy(sunVector);
  }

  if (sunLight) {
    sunLight.position.copy(sunVector).multiplyScalar(400);
  }

  if (pmremGenerator && sky) {
    if (skyEnv) skyEnv.dispose();
    skyEnv = pmremGenerator.fromScene(sky);
    scene.environment = skyEnv.texture;
  }
}


// ── Lighting ──────────────────────────────────────────────────────────────────

function setupLighting(scene) {
  // Hemisphere (sky/ground)
  const hemi = new THREE.HemisphereLight(0xcfe5ff, 0xd9c3a8, 0.6);
  scene.add(hemi);

  // Sun (directional + shadows)
  sunLight = new THREE.DirectionalLight(0xffffff, 1.15);
  sunLight.position.set(50, 100, 50);
  sunLight.castShadow = true;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 400;
  sunLight.shadow.camera.left = -100;
  sunLight.shadow.camera.right = 100;
  sunLight.shadow.camera.top = 100;
  sunLight.shadow.camera.bottom = -100;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);

  // Ambient fill
  ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
}

// ── Apply quality preset ──────────────────────────────────────────────────────

export function setQualityPreset(presetName, renderer, scene) {
  const preset = QUALITY_PRESETS[presetName];
  if (!preset) return;

  currentPreset = presetName;

  // Shadows
  renderer.shadowMap.enabled = preset.shadows;
  if (sunLight) {
    sunLight.castShadow = preset.shadows;
    if (preset.shadows && preset.shadowMapSize > 0) {
      sunLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      sunLight.shadow.map?.dispose();
      sunLight.shadow.map = null;
    }
  }

  // Fog
  if (preset.fog) {
    scene.fog = new THREE.Fog(FOG_COLOR, preset.fogNear, preset.fogFar);
  } else {
    scene.fog = null;
  }

  // Postprocessing passes — rebuild composer
  if (composer) {
    // Remove existing passes after RenderPass
    while (composer.passes.length > 1) {
      composer.passes.pop();
    }

    // FXAA
    fxaaPass = null;
    bloomPass = null;

    if (preset.aa === 'FXAA') {
      fxaaPass = new ShaderPass(FXAAShader);
      fxaaPass.material.uniforms['resolution'].value.set(
        1 / window.innerWidth,
        1 / window.innerHeight
      );
      composer.addPass(fxaaPass);
    }

    // Bloom (high/ultra)
    if (preset.bloom) {
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.38,  // strength
        0.45,  // radius
        0.78  // threshold
      );
      composer.addPass(bloomPass);
    }
  }

  // Dispatch event so other systems can react (e.g. WorldManager adjusts render distance)
  window.dispatchEvent(
    new CustomEvent('qualityChanged', { detail: { preset: presetName, settings: preset } })
  );

  if (sky) {
    updateSkyEnvironment(scene, renderer);
  }
}

export function resizePostFX(width, height) {
  if (composer) composer.setSize(width, height);
  if (fxaaPass) {
    fxaaPass.material.uniforms['resolution'].value.set(1 / width, 1 / height);
  }
  if (bloomPass) bloomPass.setSize(width, height);
}

// ── GPU tier detection ────────────────────────────────────────────────────────

export function detectGPUTier(renderer) {
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  let gpuTier = 2; // default: medium

  if (debugInfo) {
    const gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
    if (
      gpu.includes('rtx') ||
      gpu.includes('rx 6') ||
      gpu.includes('rx 7') ||
      gpu.includes('m1') ||
      gpu.includes('m2') ||
      gpu.includes('a14') ||
      gpu.includes('a15') ||
      gpu.includes('a16') ||
      gpu.includes('a17')
    ) {
      gpuTier = 3; // high
    } else if (
      gpu.includes('intel') ||
      gpu.includes('hd graphics') ||
      gpu.includes('uhd graphics') ||
      gpu.includes('mali') ||
      gpu.includes('adreno 5') ||
      gpu.includes('adreno 4')
    ) {
      gpuTier = 1; // low
    }
  }

  // Mobile: cap at medium
  if (/Mobi|Android|iPhone|iPad/.test(navigator.userAgent) && gpuTier > 2) {
    gpuTier = 2;
  }

  return gpuTier;
}

// ── Day/night cycle ───────────────────────────────────────────────────────────

let dayTime = 0.3; // 0=midnight, 0.5=noon, 1=midnight
const DAY_SPEED = 0.0005; // full cycle every ~33 minutes real time

export function updateDayNight(delta, scene) {
  dayTime = (dayTime + DAY_SPEED * delta) % 1.0;

  // Sun position: arc across sky
  const angle = dayTime * Math.PI * 2 - Math.PI * 0.5;
  const radius = 150;
  if (sunLight) {
    sunLight.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      50
    );

    // Sky and fog colour transitions
    const t = Math.max(0, Math.sin(angle)); // 0 at night, 1 at noon
    if (scene.fog) scene.fog.color.copy(FOG_COLOR);

    // Sun intensity
    sunLight.intensity = 0.9 + t * 0.35;
    if (ambientLight) ambientLight.intensity = 0.35 + t * 0.25;
  }
}
