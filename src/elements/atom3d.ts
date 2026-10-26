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

/**
 * What the bond view shows happening between its two atoms, the less
 * electronegative on the left: electrons handed across (ionic), pairs shared
 * between them (covalent), outer electrons roaming over both (metallic), or
 * nothing.
 */
export type BondPicture =
  | { kind: 'ionic'; moves: number }
  | { kind: 'covalent'; order: number }
  | { kind: 'metallic' }
  | { kind: 'apart' };

/** A label floating over the bond view; its role sets its colour (positive blue, negative red, shared gold). */
export interface Tag {
  text: string;
  role: 'pos' | 'neg' | 'shared' | 'plain';
}

/** The bond view's labels: each atom's before and once the bond is made, and one under the bond. */
export interface PairTags {
  left: [Tag, Tag];
  right: [Tag, Tag];
  mid: Tag | null;
}

const SHELL_R0 = 2.4;
const SHELL_DR = 1.15;
const NUCLEON_R = 0.2;
const MAX_NUCLEONS = 300;
/** how big the outermost shell is drawn: every atom fits the view, a small one a little smaller */
const FIT_R = 6.6;
const FIT_MIN = 4.4;
/** the bond view, in seconds: the atoms rest, then each electron takes FLY to cross, the next one STAGGER later */
const BOND_T0 = 1.1;
const FLY = 1.2;
const STAGGER = 0.45;
/** how far a pair may spread across the view, in the units FIT_R is in - and up it, which the header and caption share */
const PAIR_W = 23;
const PAIR_H = 15;

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

/** the shared pairs' cloud: brightest seen face on, fading to nothing at its edge, so it has no hard rim */
const GLOW_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float f = pow(abs(dot(normalize(vN), normalize(vView))), 3.0);
    gl_FragColor = vec4(uColor * f, f * uOpacity);
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

interface Ring {
  mesh: THREE.InstancedMesh;
  ring: number;
  count: number;
  speed: number;
  tilt: THREE.Euler;
}

interface Built {
  group: THREE.Group;
  shells: THREE.Group;
  orbitals: THREE.Group;
  electrons: Ring[];
  rings: THREE.Mesh[];
  orbitalMats: THREE.ShaderMaterial[];
  born: number;
  /** the group's scale once it has grown in */
  fit: number;
}

/** One electron the bond view moves out of its shell. */
interface Mover {
  /** the atom it leaves, an index into Pair.atoms */
  from: number;
  shell: number;
  /** seconds after the pair appears that it leaves */
  start: number;
  /** where it leaves from: the last of `of` electrons in its shell */
  slot: number;
  of: number;
  /** ionic: the atom it goes to, and the slot it takes in that atom's outer shell; null join: it stays out, shared or roaming */
  to: number;
  join: number | null;
  /** the bond it belongs to, an index into Pair.bonds */
  bond: number;
  /** its index among its bond's shared or roaming electrons */
  i: number;
}

/** Two bonded atoms: `a` of the left element, `b` of the right. */
interface Bond {
  a: number;
  b: number;
  /** ionic: the electrons that cross */
  moves: number;
  /** where shared electrons gather: the middle of where the two outer shells meet */
  mid: THREE.Vector3;
  /** two directions across the bond, for the shared electrons to circle in */
  u: THREE.Vector3;
  v: THREE.Vector3;
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null;
}

/**
 * A compound drawn whole: which of the pair each atom is (0 the left), where
 * it sits in bond lengths (y up), and its bonds - two atoms, the left
 * element's first, and the electrons that cross (ionic).
 */
export interface MoleculeLayout {
  side: (0 | 1)[];
  at: [number, number, number][];
  bonds: [number, number, number][];
}

/** Two atoms side by side - or a whole small molecule - and what passes between them. */
interface Pair {
  /** scaled to fit; holds the atoms and the electrons in between */
  group: THREE.Group;
  atoms: Built[];
  /** which of the two elements each atom is: 0 the left, 1 the right */
  side: (0 | 1)[];
  bonds: Bond[];
  pic: BondPicture;
  movers: Mover[];
  /** the electrons the pair draws itself: in flight, shared or roaming */
  free: THREE.InstancedMesh;
  /** half the width roaming electrons wander over */
  span: number;
  /** electrons per shell of each atom before any move */
  shells0: number[][];
  /** outer radius of each atom, in the group's units */
  radii: number[];
  /** a compound drawn whole: its labels sit away from its middle */
  whole: boolean;
  tags: { atoms: HTMLElement[]; mid: HTMLElement | null; e: HTMLElement; spec: PairTags } | null;
  born: number;
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
  private pair: Pair | null = null;
  private layers: Layers = { orbitals: true, shells: true };
  private raf = 0;
  private spin: boolean;
  private paused = false;
  private last = 0;
  private time = 0;
  private resizeObs: ResizeObserver;
  private nucleonGeo = new THREE.SphereGeometry(NUCLEON_R, 14, 10);
  private electronGeo = new THREE.SphereGeometry(0.11, 12, 8);
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  /** the bond view's labels, over the canvas */
  private tagLayer: HTMLElement;

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
    this.tagLayer = document.createElement('div');
    this.tagLayer.className = 'el-tags';
    this.tagLayer.setAttribute('aria-hidden', 'true');
    container.appendChild(this.tagLayer);

    this.scene.background = new THREE.Color(0x070816);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.camera.position.set(0, 4, 26);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 60;
    this.spin = !this.reduced.matches;
    this.controls.autoRotate = this.spin;
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
    return this.spin;
  }

  /**
   * One atom turns by the camera circling it. A pair would pass behind
   * itself that way, so the camera holds still and the pair rolls about the
   * line between its nuclei instead.
   */
  setSpin(on: boolean): void {
    this.spin = on;
    this.controls.autoRotate = on && !this.pair;
  }

  setLayers(l: Layers): void {
    this.layers = l;
    if (this.atom) {
      this.atom.orbitals.visible = l.orbitals;
      this.atom.shells.visible = l.shells;
    }
    for (const b of this.pair?.atoms ?? []) b.shells.visible = l.shells;
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
    this.clear();
    this.atom = this.build(spec);
    this.scene.add(this.atom.group);
    this.setLayers(this.layers);
  }

  /**
   * Two atoms side by side, `a` on the left, and the bond between them
   * played out once: no orbital lobes here, the shells carry the story.
   * With `mol`, the whole compound, every bond played in turn (CO2 drawn as
   * one C and one O read as CO).
   */
  showPair(a: AtomSpec, b: AtomSpec, pic: BondPicture, tags: PairTags | null = null, mol: MoleculeLayout | null = null): void {
    // from one atom: face the pair square on, so the two stand side by side
    if (!this.pair) this.camera.position.set(0, 4, 26).setLength(this.camera.position.length());
    this.clear();
    const specs = [a, b];
    const side: (0 | 1)[] = mol ? mol.side : [0, 1];
    const atoms = side.map((k) => this.build({ ...specs[k], orbitals: [] }));
    const radii = atoms.map((x) => SHELL_R0 + (x.electrons.length - 1) * SHELL_DR);
    const ra = radii[side.indexOf(0)];
    const rb = radii[side.indexOf(1)];
    // ions stand apart; atoms that share or pool electrons overlap their outer shells
    const gap = pic.kind === 'ionic' ? 1.2 : pic.kind === 'covalent' ? -0.35 * Math.min(ra, rb) : pic.kind === 'metallic' ? -0.2 * Math.min(ra, rb) : 1.5;
    const d = ra + gap + rb;
    // a pair along x
    const pos = mol ? mol.at.map((u) => new THREE.Vector3(...u).multiplyScalar(d)) : [new THREE.Vector3(-d / 2, 0, 0), new THREE.Vector3(d / 2, 0, 0)];
    // centred on what is drawn, so a bent molecule does not hang below the middle
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    pos.forEach((p, k) => {
      lo.min(p.clone().subScalar(radii[k]));
      hi.max(p.clone().addScalar(radii[k]));
    });
    const centre = lo.clone().add(hi).multiplyScalar(0.5);
    for (const p of pos) p.sub(centre);
    const group = new THREE.Group();
    atoms.forEach((x, k) => {
      x.group.position.copy(pos[k]);
      x.group.scale.setScalar(1);
      group.add(x.group);
    });
    const pairs: [number, number, number][] = mol ? mol.bonds : [[0, 1, pic.kind === 'ionic' ? pic.moves : 0]];
    const bonds: Bond[] = pairs.map(([ia, ib, moves]) => {
      const axis = pos[ib].clone().sub(pos[ia]).normalize();
      // the middle of where the two outer shells meet
      const mid = pos[ia].clone().addScaledVector(axis, radii[ia]).add(pos[ib].clone().addScaledVector(axis, -radii[ib])).multiplyScalar(0.5);
      const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)).normalize();
      const v = new THREE.Vector3().crossVectors(axis, u);
      let glow: Bond['glow'] = null;
      if (pic.kind === 'covalent') {
        // the shared pairs' cloud between the nuclei, warm like them
        glow = new THREE.Mesh(
          new THREE.SphereGeometry(1, 32, 16),
          new THREE.ShaderMaterial({
            vertexShader: GLOW_VERT,
            fragmentShader: GLOW_FRAG,
            uniforms: { uColor: { value: new THREE.Color(2.2, 1.7, 0.7) }, uOpacity: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        const thick = 0.7 + 0.15 * pic.order;
        glow.scale.set(Math.min(1.6, Math.min(mid.distanceTo(pos[ia]), mid.distanceTo(pos[ib])) * 0.6), thick, thick);
        glow.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis);
        glow.position.copy(mid);
        group.add(glow);
      }
      return { a: ia, b: ib, moves, mid, u, v, glow };
    });
    const shells0 = side.map((k) => specs[k].shells.slice());
    const movers = this.movers(pic, shells0, bonds);
    // the electrons in play glow warm, so they stand out from the shells' white ones
    const free = new THREE.InstancedMesh(this.electronGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.7) }), Math.max(1, movers.length));
    free.count = 0;
    group.add(free);
    // across, and up as it rolls (about x)
    const tall = 2 * Math.max(...pos.map((p, k) => Math.hypot(p.y, p.z) + radii[k]));
    // a compound keeps a margin: a row of five ran off both sides
    const fit = Math.min(FIT_R / Math.max(ra, rb, FIT_MIN), (mol ? 0.85 * PAIR_W : PAIR_W) / (hi.x - lo.x), mol ? PAIR_H / tall : Infinity);
    group.scale.setScalar(0.7 * fit);
    const tag = (t: Tag) => {
      const el = document.createElement('span');
      el.className = `el-tag ${t.role}`;
      el.textContent = t.text;
      this.tagLayer.append(el);
      return el;
    };
    const tagEls = tags
      ? {
          atoms: side.map((k) => tag((k === 0 ? tags.left : tags.right)[0])),
          // over one bond of a molecule it read as that bond's alone, and
          // crowded its labels; the caption says it for every bond
          mid: tags.mid && !mol ? tag(tags.mid) : null,
          e: tag({ text: 'e⁻', role: 'shared' }),
          spec: tags,
        }
      : null;
    this.pair = { group, atoms, side, bonds, pic, movers, free, span: d / 2 + 0.5 * Math.min(ra, rb), shells0, radii, whole: mol !== null, tags: tagEls, born: this.time, fit };
    this.scene.add(group);
    this.setSpin(this.spin);
    this.setLayers(this.layers);
  }

  /** the bond view: whether its electrons have yet to move, are moving, or the bond is made (null: one atom) */
  bondPhase(): 'before' | 'moving' | 'made' | null {
    const p = this.pair;
    if (!p) return null;
    const age = this.paused || this.reduced.matches ? Infinity : this.time - p.born;
    return age < BOND_T0 && p.movers.length ? 'before' : age < this.madeAt(p) ? 'moving' : 'made';
  }

  /** the bond view: play the bond again from the start */
  replay(): void {
    if (!this.pair) return;
    this.pair.born = this.time;
    this.drawIfPaused();
  }

  private clear(): void {
    if (this.atom) this.disposeAtom(this.atom);
    this.atom = null;
    if (this.pair) {
      const p = this.pair;
      this.scene.remove(p.group);
      for (const b of p.atoms) this.disposeAtom(b);
      (p.free.material as THREE.Material).dispose();
      for (const b of p.bonds) {
        b.glow?.geometry.dispose();
        b.glow?.material.dispose();
      }
      this.tagLayer.replaceChildren();
      this.pair = null;
      this.setSpin(this.spin);
    }
  }

  /**
   * Which electrons leave their shells, and when: an ionic bond hands
   * `moves` from its left atom to its right one's outer shell; a covalent
   * one takes `order` from each to share; a metallic one lets every outer
   * electron go. Each comes from the outermost shell that still has one.
   * A molecule's bonds play one after another.
   */
  private movers(pic: BondPicture, shells0: number[][], bonds: Bond[]): Mover[] {
    const left = shells0.map((sh) => sh.slice());
    const joined = shells0.map(() => 0);
    const out: Mover[] = [];
    const take = (from: number, start: number, to: number, bond: number) => {
      const sh = left[from];
      let k = sh.length - 1;
      while (k > 0 && sh[k] === 0) k--;
      if (!sh[k]) return;
      const join = pic.kind === 'ionic' ? shells0[to][shells0[to].length - 1] + joined[to]++ : null;
      const i = out.filter((m) => m.bond === bond && m.join === null).length;
      out.push({ from, shell: k, start, slot: sh[k] - 1, of: sh[k], to, join, bond, i });
      sh[k]--;
    };
    let t0 = BOND_T0;
    bonds.forEach((b, j) => {
      const steps = pic.kind === 'ionic' ? Math.min(4, b.moves) : pic.kind === 'covalent' ? Math.max(1, Math.min(3, pic.order)) : 0;
      if (j > 0) t0 += 0.3;
      for (let i = 0; i < steps; i++) {
        if (pic.kind === 'ionic') take(b.a, t0 + i * STAGGER, b.b, j);
        else {
          take(b.a, t0 + i * STAGGER, b.b, j);
          take(b.b, t0 + i * STAGGER, b.a, j);
        }
      }
      t0 += steps * STAGGER;
    });
    if (pic.kind === 'metallic') {
      for (const [k, atom] of [bonds[0].a, bonds[0].b].entries()) {
        const n = shells0[atom][shells0[atom].length - 1];
        for (let j = 0; j < n; j++) take(atom, BOND_T0 + out.length * 0.15, k === 0 ? bonds[0].b : bonds[0].a, 0);
      }
    }
    return out;
  }

  /** paused, the loop is stopped: a change still shows, grown in at once (a bond already made) */
  private drawIfPaused(): void {
    if (!this.paused) return;
    if (this.atom) {
      this.atom.group.scale.setScalar(this.atom.fit);
      for (const om of this.atom.orbitalMats) om.uniforms.uFade.value = 1;
      this.placeElectrons(this.atom);
    } else if (this.pair) {
      this.pair.group.scale.setScalar(this.pair.fit);
      this.placePair(this.pair, Infinity);
      this.placeTags(this.pair, Infinity);
    } else return;
    this.composer.render(0);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObs.disconnect();
    this.clear();
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
    const rings: THREE.Mesh[] = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(0.7), transparent: true, opacity: 0.45 });
    const eMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 2.0, 2.2) });
    spec.shells.forEach((count, k) => {
      const r = SHELL_R0 + k * SHELL_DR;
      const tilt = new THREE.Euler(1.1 + k * 0.62, k * 1.9, k * 0.35);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 6, 160), ringMat);
      ring.rotation.copy(tilt);
      shells.add(ring);
      rings.push(ring);
      // room for the electrons an ionic bond brings in
      const mesh = new THREE.InstancedMesh(this.electronGeo, eMat, count + 4);
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
    return { group, shells, orbitals, electrons, rings, orbitalMats, born: this.time, fit };
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

  /** electron j of `count` on a ring at time t, in its atom's frame */
  private ringPoint(e: Ring, j: number, count: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (this.reduced.matches ? 0 : t * e.speed) + (j / count) * Math.PI * 2;
    // in the ring's own plane (a torus lies in xy), then tilted with it
    return out.set(Math.cos(a) * e.ring, Math.sin(a) * e.ring, 0).applyEuler(e.tilt);
  }

  private placeElectrons(b: Built): void {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const e of b.electrons) {
      e.mesh.count = e.count;
      for (let j = 0; j < e.count; j++) {
        this.ringPoint(e, j, e.count, this.time, p);
        e.mesh.setMatrixAt(j, m.makeTranslation(p.x, p.y, p.z));
      }
      e.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** an electron in flight this frame (the first), in the pair's frame: the e⁻ label follows it */
  private flying: THREE.Vector3 | null = null;

  /** seconds after the pair appears that its last electron has landed: the bond is made */
  private madeAt(p: Pair): number {
    return p.movers.reduce((t, m) => Math.max(t, m.start + FLY), 0);
  }

  /**
   * The labels follow the atoms on screen: each atom's under it, its charge
   * or δ once the bond is made; the shared pair's under the bond; e⁻ on an
   * electron in flight.
   */
  private placeTags(p: Pair, age: number): void {
    const t = p.tags;
    if (!t) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const v = new THREE.Vector3();
    const up = new THREE.Vector3();
    const s = p.group.scale.x;
    const at = (el: HTMLElement, x: number, y: number) => {
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    };
    const screen = (world: THREE.Vector3): [number, number] => {
      v.copy(world).project(this.camera);
      return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    };
    const made = age >= this.madeAt(p);
    // a compound's labels go above or below each atom, whichever is away
    // from its middle on screen - all below, they landed on each other and
    // on the caption; pushed out along the bonds, off the view
    const ys = p.atoms.map((b) => screen(b.group.getWorldPosition(up))[1]);
    const middle = ys.reduce((a, y) => a + y, 0) / ys.length;
    const below = ys.map((y) => !p.whole || y >= middle - 6);
    p.atoms.forEach((b, k) => {
      const el = t.atoms[k];
      const spec = (p.side[k] === 0 ? t.spec.left : t.spec.right)[made ? 1 : 0];
      if (el.textContent !== spec.text) {
        el.textContent = spec.text;
        el.className = `el-tag ${spec.role}`;
      }
      // under the atom (the header sits above), by world up: the pair rolls, the labels do not.
      // A molecule's sit closer, inside its shell: they crowd
      b.group.getWorldPosition(up);
      up.y += (below[k] ? -1 : 1) * (p.whole ? 0.45 * p.radii[k] + 0.6 : p.radii[k] + 0.9) * s;
      at(el, ...screen(up));
    });
    if (t.mid) {
      t.mid.style.opacity = made ? '1' : '0';
      up.copy(p.bonds[0].mid);
      p.group.localToWorld(up);
      // over the bond, clear of the atoms' own labels below
      up.y += 2.4 * s;
      at(t.mid, ...screen(up));
    }
    t.e.style.opacity = this.flying ? '1' : '0';
    if (this.flying) {
      up.copy(this.flying);
      p.group.localToWorld(up);
      const [x, y] = screen(up);
      at(t.e, x + 16, y - 16);
    }
  }

  /** The pair `age` seconds after it appeared: who has left, who has arrived, and where the rest are. */
  private placePair(p: Pair, age: number): void {
    const t = this.time;
    p.atoms.forEach((b, a) => {
      b.electrons.forEach((e, k) => {
        let c = p.shells0[a][k];
        for (const m of p.movers) {
          if (m.from === a && m.shell === k && age >= m.start) c--;
          if (m.to === a && m.join !== null && k === b.electrons.length - 1 && age >= m.start + FLY) c++;
        }
        e.count = c;
        // an emptied shell goes: sodium's M ring once its electron has gone over
        b.rings[k].visible = c > 0;
      });
      this.placeElectrons(b);
    });

    const mat = new THREE.Matrix4();
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const shared = p.bonds.map((_, j) => p.movers.filter((m) => m.bond === j && m.join === null).length);
    let n = 0;
    this.flying = null;
    for (const m of p.movers) {
      if (age < m.start) continue;
      const k = (age - m.start) / FLY;
      if (m.join !== null && k >= 1) continue;
      const src = p.atoms[m.from];
      this.ringPoint(src.electrons[m.shell], m.slot, m.of, p.born + m.start, from).add(src.group.position);
      const bond = p.bonds[m.bond];
      if (m.join !== null) {
        const dst = p.atoms[m.to];
        this.ringPoint(dst.electrons[dst.electrons.length - 1], m.join, m.join + 1, t, to).add(dst.group.position);
      } else if (p.pic.kind === 'covalent') {
        // the shared electrons circle their bond, between its two atoms
        const a = (this.reduced.matches ? 0 : t * 1.4) + (m.i / shared[m.bond]) * Math.PI * 2;
        to.copy(bond.mid).addScaledVector(bond.u, Math.cos(a) * 0.55).addScaledVector(bond.v, Math.sin(a) * 0.55);
      } else {
        // a metal's outer electrons wander over both atoms
        const r = seeded(m.i + 7);
        const still = this.reduced.matches ? 0 : t;
        to.set(
          bond.mid.x + p.span * Math.sin(still * (0.35 + 0.3 * r()) + 6.3 * r()),
          1.7 * Math.sin(still * (0.5 + 0.4 * r()) + 6.3 * r()),
          1.7 * Math.sin(still * (0.45 + 0.4 * r()) + 6.3 * r()),
        );
      }
      if (k < 1) {
        const e = k * k * (3 - 2 * k);
        // over the top, not through the nuclei
        to.sub(from).multiplyScalar(e).add(from);
        to.y += Math.sin(Math.PI * k) * 1.4;
        this.flying ??= to.clone();
      }
      p.free.setMatrixAt(n++, mat.makeTranslation(to.x, to.y, to.z));
    }
    p.free.count = n;
    p.free.instanceMatrix.needsUpdate = true;
    p.bonds.forEach((b, j) => {
      if (!b.glow) return;
      // up once the bond's last electron has landed
      const landed = p.movers.reduce((t, m) => (m.bond === j ? Math.max(t, m.start + FLY) : t), 0);
      b.glow.material.uniforms.uOpacity.value = 0.35 * Math.max(0, Math.min(1, (age - landed) / 0.6));
    });
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
    // a new element grows in and its orbitals fade up
    const grow = (age: number) => 0.7 + 0.3 * (1 - Math.pow(1 - Math.min(1, age / 0.45), 3));
    const b = this.atom;
    if (b) {
      const age = this.time - b.born;
      b.group.scale.setScalar(b.fit * grow(age));
      for (const om of b.orbitalMats) om.uniforms.uFade.value = Math.min(1, age / 0.8);
      this.placeElectrons(b);
    }
    const p = this.pair;
    if (p) {
      const age = this.time - p.born;
      p.group.scale.setScalar(p.fit * grow(age));
      if (this.spin) p.group.rotation.x += dt * 0.35;
      // with reduced motion, the bond is shown made
      this.placePair(p, this.reduced.matches ? Infinity : age);
      this.placeTags(p, this.reduced.matches ? Infinity : age);
    }
    this.controls.update(dt);
    this.composer.render(dt);
  }
}
