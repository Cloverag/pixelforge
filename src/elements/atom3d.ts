import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { HARMONICS } from './atom';

/**
 * The ELEMENTS mode's atom, in three.js.
 *
 * - The nucleus: a ball of protons (red) and neutrons (grey-blue), enormously
 *   magnified - at true scale it would be a speck far too small to see.
 * - The shells, K outwards: a ring each, with that shell's electrons moving
 *   round it. A picture of how many electrons each shell holds, not of paths:
 *   electrons do not orbit like planets.
 * - The orbitals of the subshell the element filled last, drawn as the polar
 *   plot of |Y|² (the angular part of a hydrogen-like orbital), the two signs
 *   of the wavefunction in two colours: argon's three p dumbbells, iron's d
 *   cloverleaves.
 *
 * Everything glowing is over-bright, so the bloom pass treats it as light,
 * as the playground's 3D view (render/pg3d.ts) does.
 */

export interface AtomSpec {
  z: number;
  /** nucleons to draw: the standard atomic weight, rounded */
  nucleons: number;
  /** electrons per shell, K first */
  shells: number[];
  /** the orbitals drawn as lobes (empty for none) */
  orbitals: (typeof HARMONICS)[number];
  /** the element's category colour, '#rrggbb' */
  tint: string;
}

export interface Layers {
  orbitals: boolean;
  shells: boolean;
}

const SHELL_R0 = 2.4;
const SHELL_DR = 1.15;
const NUCLEON_R = 0.2;
const MAX_NUCLEONS = 300;
/** how big the outermost shell is drawn: every atom fits the view, a small one a little smaller */
const FIT_R = 6.6;
const FIT_MIN = 4.4;

const ORBITAL_VERT = /* glsl */ `
  attribute float aSign;
  varying float vSign;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vSign = aSign;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const ORBITAL_FRAG = /* glsl */ `
  uniform vec3 uPos;
  uniform vec3 uNeg;
  uniform float uFade;
  uniform float uGain;
  varying float vSign;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    // glass: faint face-on, bright at the silhouette
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 2.2);
    vec3 col = vSign > 0.0 ? uPos : uNeg;
    gl_FragColor = vec4(col * (0.12 + 1.1 * rim) * uGain, (0.05 + 0.4 * rim) * uFade);
  }
`;

/** n points spread evenly over a unit sphere (a Fibonacci spiral). */
function fibonacci(i: number, n: number): THREE.Vector3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(1 - y * y);
  const a = i * Math.PI * (3 - Math.sqrt(5));
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
}

/** A small deterministic generator, so an element's nucleus is the same every visit. */
function seeded(seed: number): () => number {
  let s = seed * 2654435761;
  return () => {
    s = (s ^ (s >>> 15)) * 2246822519;
    s = (s ^ (s >>> 13)) * 3266489917;
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

/** The lobes of one orbital: a sphere pushed out to |Y|² in each direction. */
function orbitalGeometry(y: (x: number, y: number, z: number) => number, size: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 96, 64);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const sign = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  let max = 0;
  const vals = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // chemistry's z is up; three's y is
    vals[i] = y(v.x, -v.z, v.y);
    max = Math.max(max, vals[i] * vals[i]);
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = max > 0 ? ((vals[i] * vals[i]) / max) * size : size;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
    sign[i] = vals[i] >= 0 ? 1 : -1;
  }
  g.setAttribute('aSign', new THREE.BufferAttribute(sign, 1));
  g.computeVertexNormals();
  return g;
}

interface Built {
  group: THREE.Group;
  shells: THREE.Group;
  orbitals: THREE.Group;
  electrons: { mesh: THREE.InstancedMesh; ring: number; count: number; speed: number; tilt: THREE.Euler }[];
  orbitalMats: THREE.ShaderMaterial[];
  born: number;
  /** the group's scale once it has grown in */
  fit: number;
}

export class Atom3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private atom: Built | null = null;
  private layers: Layers = { orbitals: true, shells: true };
  private raf = 0;
  private paused = false;
  private last = 0;
  private time = 0;
  private resizeObs: ResizeObserver;
  private nucleonGeo = new THREE.SphereGeometry(NUCLEON_R, 14, 10);
  private electronGeo = new THREE.SphereGeometry(0.11, 12, 8);
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * `shiftX`: move the atom off centre by this share of the width (the title
   * screen's preview keeps it clear of the menu). `interactive: false`: no
   * drag to turn, it only spins.
   */
  constructor(
    private container: HTMLElement,
    private opts: { shiftX?: number; interactive?: boolean } = {},
  ) {
    const r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
    container.appendChild(r.domElement);
    this.renderer = r;

    this.scene.background = new THREE.Color(0x070816);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 4, 26);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 60;
    this.controls.autoRotate = !this.reduced.matches;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.enabled = opts.interactive !== false;

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20141a, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 10);
    this.scene.add(key);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 0.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  get spinning(): boolean {
    return this.controls.autoRotate;
  }

  setSpin(on: boolean): void {
    this.controls.autoRotate = on;
  }

  setLayers(l: Layers): void {
    this.layers = l;
    if (this.atom) {
      this.atom.orbitals.visible = l.orbitals;
      this.atom.shells.visible = l.shells;
    }
    this.drawIfPaused();
  }

  /** the game paused: the atom holds still and stops drawing */
  setPaused(p: boolean): void {
    this.paused = p;
    if (!p && !this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  show(spec: AtomSpec): void {
    if (this.atom) this.disposeAtom(this.atom);
    this.atom = this.build(spec);
    this.scene.add(this.atom.group);
    this.setLayers(this.layers);
  }

  /** paused, the loop is stopped: a change still shows, grown in at once */
  private drawIfPaused(): void {
    if (!this.paused || !this.atom) return;
    this.atom.group.scale.setScalar(this.atom.fit);
    for (const om of this.atom.orbitalMats) om.uniforms.uFade.value = 1;
    this.placeElectrons(this.atom);
    this.composer.render(0);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObs.disconnect();
    if (this.atom) this.disposeAtom(this.atom);
    this.nucleonGeo.dispose();
    this.electronGeo.dispose();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    // a narrow view backs off so the outer shell still fits across it
    this.camera.position.setLength(w / h < 1 ? 26 / Math.max(0.55, w / h) : 26);
    // a view offset slides the picture sideways without turning the camera
    if (this.opts.shiftX) this.camera.setViewOffset(w, h, -w * this.opts.shiftX, 0, w, h);
    else this.camera.updateProjectionMatrix();
  }

  private build(spec: AtomSpec): Built {
    const group = new THREE.Group();
    const tint = new THREE.Color(spec.tint);

    // nucleus: protons and neutrons packed into a ball
    const a = Math.max(1, Math.min(MAX_NUCLEONS, spec.nucleons));
    const protons = Math.min(spec.z, a);
    const radius = NUCLEON_R * 1.25 * Math.cbrt(a);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
    const nucleus = new THREE.InstancedMesh(this.nucleonGeo, mat, a);
    const rand = seeded(spec.z);
    const isProton = Array.from({ length: a }, (_, i) => i < protons);
    for (let i = a - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [isProton[i], isProton[j]] = [isProton[j], isProton[i]];
    }
    const m = new THREE.Matrix4();
    const red = new THREE.Color(1.6, 0.32, 0.22);
    const grey = new THREE.Color(0.55, 0.68, 0.95);
    for (let i = 0; i < a; i++) {
      const p = fibonacci(i, a).multiplyScalar(a === 1 ? 0 : radius * Math.cbrt((i + 0.5) / a));
      nucleus.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
      nucleus.setColorAt(i, isProton[i] ? red : grey);
    }
    group.add(nucleus);

    // shells: a ring each, tilted differently, electrons spaced round it
    const shells = new THREE.Group();
    const electrons: Built['electrons'] = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(0.7), transparent: true, opacity: 0.45 });
    const eMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 2.0, 2.2) });
    spec.shells.forEach((count, k) => {
      const r = SHELL_R0 + k * SHELL_DR;
      const tilt = new THREE.Euler(1.1 + k * 0.62, k * 1.9, k * 0.35);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 6, 160), ringMat);
      ring.rotation.copy(tilt);
      shells.add(ring);
      const mesh = new THREE.InstancedMesh(this.electronGeo, eMat, Math.max(1, count));
      mesh.count = count;
      shells.add(mesh);
      // inner shells move faster
      electrons.push({ mesh, ring: r, count, speed: 0.9 / Math.pow(k + 1, 0.7), tilt });
    });
    group.add(shells);

    // the last subshell's orbitals, as large as the outer shell
    const orbitals = new THREE.Group();
    const size = (SHELL_R0 + (spec.shells.length - 1) * SHELL_DR) * 1.02;
    const orbitalMats: THREE.ShaderMaterial[] = [];
    // the lobes add up where they overlap: seven f orbitals (fourteen lobes) at
    // the brightness of three p ones would burn the middle out to white
    const gain = Math.min(1, 3 / Math.max(1, spec.orbitals.length)) ** 0.8;
    const neg = new THREE.Color().setHSL((tint.getHSL({ h: 0, s: 0, l: 0 }).h + 0.5) % 1, 0.75, 0.6);
    for (const o of spec.orbitals) {
      const om = new THREE.ShaderMaterial({
        vertexShader: ORBITAL_VERT,
        fragmentShader: ORBITAL_FRAG,
        uniforms: { uPos: { value: tint.clone() }, uNeg: { value: neg }, uFade: { value: 0 }, uGain: { value: gain } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      orbitalMats.push(om);
      // an s orbital is a sphere: smaller, so the nucleus and rings show through
      orbitals.add(new THREE.Mesh(orbitalGeometry(o.y, o.name === 's' ? size * 0.8 : size), om));
    }
    group.add(orbitals);
    const outer = SHELL_R0 + (spec.shells.length - 1) * SHELL_DR;
    const fit = FIT_R / Math.max(outer, FIT_MIN);
    group.scale.setScalar(0.7 * fit);
    return { group, shells, orbitals, electrons, orbitalMats, born: this.time, fit };
  }

  private disposeAtom(b: Built): void {
    this.scene.remove(b.group);
    b.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        if (o.geometry !== this.nucleonGeo && o.geometry !== this.electronGeo) o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }

  private placeElectrons(b: Built): void {
    const still = this.reduced.matches;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const e of b.electrons) {
      const phase = still ? 0 : this.time * e.speed;
      for (let j = 0; j < e.count; j++) {
        const a = phase + (j / e.count) * Math.PI * 2;
        // in the ring's own plane (a torus lies in xy), then tilted with it
        p.set(Math.cos(a) * e.ring, Math.sin(a) * e.ring, 0).applyEuler(e.tilt);
        e.mesh.setMatrixAt(j, m.makeTranslation(p.x, p.y, p.z));
      }
      e.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private loop(now: number): void {
    if (this.paused) {
      this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    this.time += dt;
    const b = this.atom;
    if (b) {
      // a new element grows in and its orbitals fade up
      const age = this.time - b.born;
      const k = Math.min(1, age / 0.45);
      b.group.scale.setScalar(b.fit * (0.7 + 0.3 * (1 - Math.pow(1 - k, 3))));
      for (const om of b.orbitalMats) om.uniforms.uFade.value = Math.min(1, age / 0.8);
      this.placeElectrons(b);
    }
    this.controls.update(dt);
    this.composer.render(dt);
  }
}
