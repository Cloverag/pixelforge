import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Cat, MATS, Mat, NMATS, rampIndexAt } from '../sim/materials';

/**
 * How far back each material class is extruded, in voxel units.
 *
 * Depth is the one thing a 2D falling-sand view cannot show, so we spend it
 * on the property the player already reasons about: what *kind* of stuff a
 * cell is. Solids are chunky masonry, powders are shallower heaps, liquids
 * are sheets, gases are wisps. Orbiting the diorama therefore reads the
 * material classes straight off the silhouette.
 */
const CAT_DEPTH: Record<number, number> = {
  [Cat.SOLID]: 9,
  [Cat.POWDER]: 6,
  [Cat.LIQUID]: 3.5,
  [Cat.GAS]: 1.75,
  [Cat.EMPTY]: 0,
};

/** Materials that light the scene rather than merely reflect it. */
const EMISSIVE = new Set<number>([Mat.FIRE, Mat.LAVA, Mat.TORCH, Mat.EMBER]);

/** Per-cell relief, as a fraction of the material's depth. */
const RELIEF = 0.45;

/** How far over 1.0 emissive colours are pushed, to clear the bloom threshold. */
const GLOW_GAIN = 1.45;

/** sRGB -> linear, matching what THREE.ColorManagement does on the way in. */
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Flattened linear-RGB table for every material's four ramp entries, so the
 * per-cell hot loop is three array reads instead of a Color allocation and a
 * colour-space conversion. Layout: `(mat * 4 + rampIndex) * 3 + channel`.
 */
function buildRampTable(): Float32Array {
  const t = new Float32Array(NMATS * 4 * 3);
  for (let m = 0; m < NMATS; m++) {
    const ramp = MATS[m]?.ramp;
    if (!ramp) continue;
    for (let k = 0; k < 4; k++) {
      const abgr = ramp[k];
      const o = (m * 4 + k) * 3;
      t[o] = toLinear((abgr & 255) / 255);
      t[o + 1] = toLinear(((abgr >>> 8) & 255) / 255);
      t[o + 2] = toLinear(((abgr >>> 16) & 255) / 255);
    }
  }
  return t;
}

export type CamPreset = 'front' | 'iso' | 'tilt';

/** 3D voxel diorama of the 2D sim grid - orbit with the mouse. */
export class Voxel3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;

  /** matte materials, lit by the scene */
  private solid: THREE.InstancedMesh;
  /** fire/lava/torch/ember - unlit, over-bright, and fed to the bloom pass */
  private glow: THREE.InstancedMesh;

  private solidMat: Float32Array;
  private solidCol: Float32Array;
  private glowMat: Float32Array;
  private glowCol: Float32Array;

  private ramps = buildRampTable();
  private capacity: number;
  /** stable per-cell relief offsets, so the terrain does not shimmer */
  private jitter: Float32Array;

  private frame = 0;
  /** frames since the user last let go of the orbit controls */
  private idle = 0;
  /** true between an orbit-control 'start' and its 'end' */
  private dragging = false;
  private bloomOn = true;
  /** the in-view control pill; lives in the 3D container, not the topbar */
  private ui!: HTMLElement;
  private spinBtn!: HTMLButtonElement;
  private glowBtn!: HTMLButtonElement;

  visible = false;

  constructor(
    private container: HTMLElement,
    private snapW: number,
    private snapH: number,
  ) {
    this.capacity = snapW * snapH;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    // bloom runs a pyramid of full-screen passes, so retina pixel ratios cost
    // real frames here; 1.5 is the point where the extra sharpness stops
    // being visible on the voxel edges.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07070f);
    this.scene.fog = new THREE.Fog(0x07070f, 300, 720);

    this.camera = new THREE.PerspectiveCamera(
      48,
      container.clientWidth / container.clientHeight,
      0.1,
      1600,
    );

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 620;
    this.controls.minDistance = 30;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.addEventListener('start', () => {
      this.dragging = true;
      this.idle = 0;
      this.controls.autoRotate = false;
    });
    this.controls.addEventListener('end', () => {
      this.dragging = false;
      this.idle = 0;
    });
    this.setCamera('iso');

    this.buildLights();
    this.buildStage();

    // ---- instanced voxel meshes ----
    const box = new THREE.BoxGeometry(1, 1, 1);

    this.solid = new THREE.InstancedMesh(
      box,
      new THREE.MeshLambertMaterial(),
      this.capacity,
    );
    this.glow = new THREE.InstancedMesh(
      box,
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      this.capacity,
    );

    for (const mesh of [this.solid, this.glow]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // allocate the colour buffer up front so we can write it directly
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(this.capacity * 3),
        3,
      );
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(mesh);
    }

    this.solidMat = this.solid.instanceMatrix.array as Float32Array;
    this.solidCol = this.solid.instanceColor!.array as Float32Array;
    this.glowMat = this.glow.instanceMatrix.array as Float32Array;
    this.glowCol = this.glow.instanceColor!.array as Float32Array;
    // every voxel is an axis-aligned translate+scale, so the rotation cells
    // stay zero forever and only 4 of the 16 floats change per cell
    for (const arr of [this.solidMat, this.glowMat]) {
      for (let n = 0; n < this.capacity; n++) {
        arr[n * 16 + 5] = 1; // sy
        arr[n * 16 + 15] = 1; // w
      }
    }

    this.jitter = new Float32Array(this.capacity);
    for (let y = 0; y < snapH; y++) {
      for (let x = 0; x < snapW; x++) {
        const h = ((x * 374761393) ^ (y * 668265263)) >>> 0;
        this.jitter[y * snapW + x] = ((h >>> 8) & 1023) / 1023 - 0.5;
      }
    }

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Tuned against a scene holding lava, a torch and a burning post: at
    // strength 0.85 / threshold 0.2 the glow swallowed the whole diorama in
    // an orange haze and the material underneath stopped being readable.
    // The threshold now sits above every lit surface, so only the emissive
    // mesh blooms at all.
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.32, // strength
      0.45, // radius
      0.62, // threshold
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildControls();
    window.addEventListener('resize', this.onResize);
  }

  /**
   * Camera / render controls, drawn inside the 3D container rather than the
   * topbar. The topbar is already twelve buttons wide, and these five only
   * mean anything while the diorama is on screen.
   */
  private buildControls(): void {
    const bar = document.createElement('div');
    bar.className = 'v3d-ui';

    const mk = (label: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'px';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.onclick = fn;
      bar.appendChild(b);
      return b;
    };

    mk('FRONT', 'Face the diorama head on', () => this.preset('front'));
    mk('ISO', 'Three-quarter view', () => this.preset('iso'));
    mk('TILT', 'Look down on the diorama', () => this.preset('tilt'));
    this.spinBtn = mk('SPIN', 'Auto-orbit the camera', () => {
      this.controls.autoRotate = !this.controls.autoRotate;
      this.idle = 0;
      this.syncButtons();
    });
    this.glowBtn = mk('GLOW', 'Bloom on emissive materials', () => {
      this.setBloom(!this.bloomOn);
      this.syncButtons();
    });

    const hint = document.createElement('span');
    hint.className = 'v3d-hint';
    hint.textContent = 'drag to orbit \u00b7 scroll to zoom';
    bar.appendChild(hint);

    this.ui = bar;
    this.container.appendChild(bar);
    this.syncButtons();
  }

  /** A preset also cancels auto-orbit, or the framing you just picked drifts. */
  private preset(p: CamPreset): void {
    this.controls.autoRotate = false;
    this.idle = 0;
    this.setCamera(p);
    this.syncButtons();
  }

  private syncButtons(): void {
    this.spinBtn.classList.toggle('toggled', this.controls.autoRotate);
    this.glowBtn.classList.toggle('toggled', this.bloomOn);
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x99bbff, 0x241c28, 0.95));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
    sun.position.set(120, 220, 180);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6f8cff, 0.55);
    rim.position.set(-160, 60, -140);
    this.scene.add(rim);
  }

  /** ground plate and back wall, so the diorama sits in a room */
  private buildStage(): void {
    const { snapW, snapH } = this;
    const floorY = -(snapH / 2) - 2;

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(snapW + 24, 4, 90),
      new THREE.MeshLambertMaterial({ color: 0x161628 }),
    );
    plate.position.set(0, floorY, 0);
    this.scene.add(plate);

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(snapW + 24, snapH + 40),
      new THREE.MeshLambertMaterial({ color: 0x0d0d1c, side: THREE.DoubleSide }),
    );
    back.position.set(0, 0, -26);
    this.scene.add(back);

    const grid = new THREE.GridHelper(snapW + 24, 24, 0x2a2a48, 0x1b1b30);
    grid.position.set(0, floorY + 2.05, 0);
    this.scene.add(grid);
  }

  /** Snaps the camera to one of the three framing presets. */
  setCamera(preset: CamPreset): void {
    // distance that exactly fits the world's height in a 48-degree frustum;
    // the presets are multiples of it rather than magic numbers
    const fit = this.snapH / 2 / Math.tan((this.camera.fov / 2) * (Math.PI / 180));
    if (preset === 'front') this.camera.position.set(0, 0, fit * 1.04);
    // 45 degrees, not overhead: the world is a vertical slab about 10 units
    // deep, so a true top-down view looks straight down its edge and renders
    // as a flat line. This is the steepest angle that still shows the face.
    else if (preset === 'tilt') this.camera.position.set(0, fit * 0.72, fit * 0.72);
    else this.camera.position.set(fit * 0.6, fit * 0.42, fit * 0.84);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** Turns the bloom pass off - the cheapest thing to drop if frames suffer. */
  setBloom(on: boolean): void {
    this.bloomOn = on;
    this.bloom.enabled = on;
  }

  isBloomOn(): boolean {
    return this.bloomOn;
  }

  private onResize = (): void => {
    if (!this.visible) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  };

  /**
   * Rebuilds both instance buffers from a downsampled material snapshot.
   *
   * Writes straight into the underlying matrix/colour arrays rather than
   * going through Object3D.updateMatrix() and setColorAt() - at 57k cells a
   * frame the allocation and matrix compose in those helpers is most of the
   * cost, and every voxel here is a pure translate+scale.
   */
  update(cells: Uint8Array, w: number, h: number): void {
    const { ramps, jitter, solidMat, solidCol, glowMat, glowCol } = this;
    const frame = this.frame;
    const halfH = h / 2;
    const halfW = w / 2;
    const cap = this.capacity;
    let ns = 0;
    let ng = 0;

    for (let y = 0; y < h; y++) {
      const row = y * w;
      const py = halfH - y;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const m = cells[i];
        if (m === 0) continue;
        const def = MATS[m];
        if (!def) continue;

        const depth = CAT_DEPTH[def.cat] ?? 4;
        const sz = depth * (1 + jitter[i] * RELIEF);
        const tz = jitter[i] * depth * RELIEF;
        const k = (m * 4 + rampIndexAt(m, x, y, frame, 0)) * 3;
        const hot = EMISSIVE.has(m);

        const n = hot ? ng : ns;
        if (n >= cap) continue;
        const mat = hot ? glowMat : solidMat;
        const col = hot ? glowCol : solidCol;

        const o = n * 16;
        mat[o] = 1; // sx
        mat[o + 10] = sz;
        mat[o + 12] = x - halfW;
        mat[o + 13] = py;
        mat[o + 14] = tz;

        const c = n * 3;
        if (hot) {
          // push emissives past the bloom threshold so they actually bleed
          col[c] = ramps[k] * GLOW_GAIN;
          col[c + 1] = ramps[k + 1] * GLOW_GAIN;
          col[c + 2] = ramps[k + 2] * GLOW_GAIN;
          ng++;
        } else {
          col[c] = ramps[k];
          col[c + 1] = ramps[k + 1];
          col[c + 2] = ramps[k + 2];
          ns++;
        }
      }
    }

    this.solid.count = ns;
    this.glow.count = ng;
    this.solid.instanceMatrix.needsUpdate = true;
    this.solid.instanceColor!.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.glow.instanceColor!.needsUpdate = true;
  }

  show(): void {
    this.visible = true;
    this.container.classList.remove('hidden');
    this.onResize();
  }

  hide(): void {
    this.visible = false;
    this.container.classList.add('hidden');
  }

  render(): void {
    if (!this.visible) return;
    this.frame++;
    // drift the camera once the player stops driving it, so a diorama left
    // on screen keeps showing off its depth
    if (this.dragging) {
      this.idle = 0;
    } else if (!this.controls.autoRotate && ++this.idle > 240) {
      this.controls.autoRotate = true;
      this.syncButtons();
    }
    this.controls.update();
    this.composer.render();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.ui.remove();
  }
}
