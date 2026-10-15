import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { SIM_H, SIM_W } from '../sim/protocol';

/**
 * The particle playground as a lit 3D scene - the "rendered in Blender"
 * version of the 2D toy, in real time.
 *
 * - Particles are emissive instanced spheres in linear, over-bright colour,
 *   so the bloom pass and ACES tone mapping treat them as light.
 * - A glossy floor reflects them (a planar mirror under a dark, semi-clear
 *   sheet, which reads as polished stone rather than a perfect mirror).
 * - Each firework burst borrows one of a small fixed pool of point lights,
 *   so the floor and walls flash with it. The pool is fixed because adding
 *   or removing lights makes three recompile every lit shader.
 * - Walls are lit 3D slabs; force markers are glowing rings.
 *
 * The simulation stays 2D in the worker (it now also tracks depth, which
 * only this view uses). Clicking still uses the selected tool: the pointer
 * is ray-cast onto the play plane and handed back in sim coordinates.
 */

type ToolCb = (x: number, y: number, phase: 'down' | 'move' | 'up', button: number) => void;

const CAP = 24000;
const LIGHTS = 6;
/** sim cell -> world units */
const toX = (x: number) => x - SIM_W / 2;
const toY = (y: number) => SIM_H / 2 - y;
const FLOOR_Y = -SIM_H / 2 - 1;

export class PG3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private parts: THREE.InstancedMesh;
  private walls: THREE.InstancedMesh;
  private reflector: Reflector | null = null;
  private lights: { light: THREE.PointLight; life: number }[] = [];
  private nextLight = 0;
  private markers: THREE.Mesh[] = [];
  private markerGeo = new THREE.TorusGeometry(5, 0.7, 8, 32);
  private coreGeo = new THREE.SphereGeometry(3.2, 20, 14);
  private coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private markerMats: THREE.MeshBasicMaterial[];
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private hit = new THREE.Vector3();
  private ndc = new THREE.Vector2();
  private painting = false;
  private dummy = new THREE.Object3D();
  private frame = 0;
  /** quality ladder: 0 full, 1 no reflection, 2 no bloom (measured, one-way) */
  private quality = 0;
  private frameMs = 16.7;
  private lastT = 0;
  private nextStepAt = 0;
  private hintEl: HTMLElement;
  visible = false;

  constructor(private container: HTMLElement, private onTool: ToolCb) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(container.clientWidth, container.clientHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    container.appendChild(r.domElement);
    this.renderer = r;

    this.scene.background = new THREE.Color(0x05060c);
    this.scene.fog = new THREE.FogExp2(0x05060c, 0.0016);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 3000);
    this.camera.position.set(0, 60, 430);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 1200;
    this.controls.maxPolarAngle = Math.PI * 0.53; // never under the floor
    // left button belongs to the tools; orbit with the right, zoom with wheel
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };

    // light: a cool dim fill and a warm key, so walls read in the dark
    this.scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x1a1208, 0.8));
    const key = new THREE.DirectionalLight(0xffe2c0, 1.6);
    key.position.set(-200, 300, 400);
    this.scene.add(key);
    for (let k = 0; k < LIGHTS; k++) {
      const light = new THREE.PointLight(0xffffff, 0, 420, 1.6);
      this.scene.add(light);
      this.lights.push({ light, life: 0 });
    }

    this.buildBackdrop();
    this.buildFloor();

    // particles: unlit spheres, colour per instance, bright enough to bloom
    const sphere = new THREE.IcosahedronGeometry(1.9, 1);
    this.parts = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial(), CAP);
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.parts.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.parts.count = 0;
    this.parts.frustumCulled = false;
    this.scene.add(this.parts);

    // walls: lit slabs, one box per 2x2 sim block
    const wallCap = (SIM_W >> 1) * (SIM_H >> 1);
    this.walls = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2, 2, 26),
      new THREE.MeshStandardMaterial({ color: 0x8a8aa2, roughness: 0.5, metalness: 0.15 }),
      wallCap,
    );
    this.walls.count = 0;
    this.walls.frustumCulled = false;
    this.scene.add(this.walls);

    this.markerMats = [
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 2.0) }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.5, 1.2) }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.4, 0.5) }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.4, 0.4) }), // black hole's hot ring
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 1.5, 0.4) }), // portal, orange
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 3.6) }), // portal, blue
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.45, 0.15) }), // portal, waiting
    ];

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 1.4, 0.6, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'pg3d-hint';
    this.hintEl.textContent = 'Left: use tool  ·  Right-drag: orbit  ·  Wheel: zoom';
    container.appendChild(this.hintEl);

    r.domElement.addEventListener('pointerdown', this.onDown);
    r.domElement.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    r.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', this.onResize);
    // dev only: lets a screenshot pin full quality on a software renderer
    if (import.meta.env.DEV) (window as unknown as { __pg3d: PG3D }).__pg3d = this;
  }

  /** Pin a quality level (dev/testing). */
  pinQuality(q: number): void {
    this.quality = q;
    this.nextStepAt = Infinity;
    if (this.reflector) this.reflector.visible = q < 1;
  }

  /**
   * A soft gradient backdrop behind the stage - a studio cyclorama rather
   * than a black void - so the scene has somewhere for depth to go.
   */
  private buildBackdrop(): void {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 150, 10, 128, 140, 170);
    grad.addColorStop(0, '#1f1d3a');
    grad.addColorStop(0.45, '#0e0f1f');
    grad.addColorStop(1, '#05060c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 1500),
      new THREE.MeshBasicMaterial({ map: tex, fog: false }),
    );
    back.position.set(0, 300, -420);
    this.scene.add(back);
  }

  private buildFloor(): void {
    const size = 2400;
    const geo = new THREE.PlaneGeometry(size, size);
    try {
      this.reflector = new Reflector(geo, {
        textureWidth: Math.floor(this.container.clientWidth * 0.5),
        textureHeight: Math.floor(this.container.clientHeight * 0.5),
        color: 0x888888,
      });
      this.reflector.rotation.x = -Math.PI / 2;
      this.reflector.position.y = FLOOR_Y - 0.5;
      this.scene.add(this.reflector);
    } catch {
      this.reflector = null;
    }
    // a dark, partly clear sheet over the mirror: polished stone, not glass
    const sheet = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0x0a0b12,
        roughness: 0.35,
        metalness: 0.2,
        transparent: true,
        opacity: this.reflector ? 0.72 : 1,
      }),
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = FLOOR_Y;
    this.scene.add(sheet);
  }

  // ---- input: ray-cast the pointer onto the play plane ----

  private toSim(e: PointerEvent): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    const x = this.hit.x + SIM_W / 2;
    const y = SIM_H / 2 - this.hit.y;
    if (x < 0 || y < 0 || x >= SIM_W || y >= SIM_H) return null;
    return { x: x | 0, y: y | 0 };
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const p = this.toSim(e);
    if (!p) return;
    this.painting = true;
    this.onTool(p.x, p.y, 'down', 0);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.painting) return;
    const p = this.toSim(e);
    if (p) this.onTool(p.x, p.y, 'move', 0);
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.painting) return;
    this.painting = false;
    const p = this.toSim(e);
    this.onTool(p?.x ?? 0, p?.y ?? 0, 'up', 0);
  };

  private onResize = (): void => {
    if (!this.visible) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };

  // ---- data from the worker ----

  update(buf: Float32Array, n: number, forces: number[]): void {
    const m = this.parts.instanceMatrix.array as Float32Array;
    const c = this.parts.instanceColor!.array as Float32Array;
    const count = Math.min(n, CAP);
    for (let i = 0; i < count; i++) {
      const o = i * 6;
      const k = i * 16;
      // scale-free translation matrix, written directly: thousands per frame
      m[k] = 1; m[k + 5] = 1; m[k + 10] = 1; m[k + 15] = 1;
      m[k + 12] = toX(buf[o]);
      m[k + 13] = toY(buf[o + 1]);
      m[k + 14] = buf[o + 2];
      c[i * 3] = buf[o + 3];
      c[i * 3 + 1] = buf[o + 4];
      c[i * 3 + 2] = buf[o + 5];
    }
    this.parts.count = count;
    this.parts.instanceMatrix.needsUpdate = true;
    this.parts.instanceColor!.needsUpdate = true;

    // force markers: reuse meshes, one per force
    const nf = forces.length / 3;
    while (this.markers.length < nf) {
      const mesh = new THREE.Mesh(this.markerGeo, this.markerMats[0]);
      // a black core, shown only for black holes
      const core = new THREE.Mesh(this.coreGeo, this.coreMat);
      core.visible = false;
      mesh.add(core);
      this.scene.add(mesh);
      this.markers.push(mesh);
    }
    for (let k = 0; k < this.markers.length; k++) {
      const mesh = this.markers[k];
      mesh.visible = k < nf;
      if (!mesh.visible) continue;
      const kind = forces[k * 3];
      mesh.material = this.markerMats[kind];
      mesh.position.set(toX(forces[k * 3 + 1]), toY(forces[k * 3 + 2]), 0);
      const t = this.frame * 0.05;
      mesh.children[0].visible = kind === 3;
      if (kind >= 4) {
        // portals face the camera's side of the stage and turn in opposite senses
        mesh.rotation.set(0, 0, t * (kind === 5 ? -3 : 3));
        mesh.scale.setScalar(kind === 6 ? 1.0 + 0.15 * Math.sin(t * 3) : 1.3);
      } else if (kind === 3) {
        // black hole: a fast-turning ring, tilted like an accretion disc
        mesh.rotation.set(Math.PI / 2.6, 0, t * 4);
        mesh.scale.setScalar(1.5);
      } else if (kind === 2) {
        mesh.rotation.set(t * 0.7, t * 1.3, t * 2.2); // vortex tumbles
        mesh.scale.setScalar(1);
      } else {
        const pulse = (this.frame % 40) / 40;
        mesh.rotation.set(Math.PI / 2.3, 0, t);
        mesh.scale.setScalar(kind === 0 ? 1.6 - pulse : 0.6 + pulse);
      }
    }
  }

  setWalls(mask: Uint8Array): void {
    const mw = SIM_W >> 1;
    const mh = SIM_H >> 1;
    let n = 0;
    for (let y = 0; y < mh; y++)
      for (let x = 0; x < mw; x++) {
        if (!mask[y * mw + x]) continue;
        this.dummy.position.set(toX(x * 2 + 1), toY(y * 2 + 1), 0);
        this.dummy.updateMatrix();
        this.walls.setMatrixAt(n++, this.dummy.matrix);
      }
    this.walls.count = n;
    this.walls.instanceMatrix.needsUpdate = true;
  }

  /** A firework burst at sim (x, y): borrow a point light and flash it. */
  flash(x: number, y: number): void {
    const slot = this.lights[this.nextLight];
    this.nextLight = (this.nextLight + 1) % LIGHTS;
    slot.light.position.set(toX(x), toY(y), 20);
    slot.light.color.setHSL(Math.random(), 0.7, 0.6);
    slot.life = 1;
  }

  render(): void {
    if (!this.visible) return;
    this.frame++;
    for (const s of this.lights) {
      s.life = Math.max(0, s.life - 0.035);
      s.light.intensity = s.life * s.life * 260000;
    }
    this.controls.update();
    this.measure();
    if (this.quality < 2) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Step quality down if frames run long; never back up (flapping looks worse). */
  private measure(): void {
    const now = performance.now();
    if (this.lastT) this.frameMs = this.frameMs * 0.92 + (now - this.lastT) * 0.08;
    this.lastT = now;
    if (now < this.nextStepAt || this.frameMs < 28 || this.quality >= 2) return;
    this.quality++;
    this.nextStepAt = now + 2500;
    if (this.quality === 1 && this.reflector) this.reflector.visible = false;
  }

  show(): void {
    this.visible = true;
    this.container.classList.remove('hidden');
    this.lastT = 0;
    this.nextStepAt = performance.now() + 2500;
    this.onResize();
  }

  hide(): void {
    this.visible = false;
    this.container.classList.add('hidden');
  }
}
