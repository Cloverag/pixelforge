import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MATS, NMATS } from '../sim/materials';

/** 3D voxel diorama of the 2D sim grid - orbit with the mouse. */
export class Voxel3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private mesh: THREE.InstancedMesh;
  private capacity: number;
  private colors: THREE.Color[] = [];
  private dummy = new THREE.Object3D();
  visible = false;

  constructor(private container: HTMLElement, snapW: number, snapH: number) {
    this.capacity = snapW * snapH;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0d16);
    this.scene.fog = new THREE.Fog(0x0d0d16, 260, 560);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      1200,
    );
    this.camera.position.set(0, 70, 195);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, -10, 0);
    this.controls.maxDistance = 520;
    this.controls.minDistance = 40;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
    sun.position.set(120, 220, 140);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-140, 80, -100);
    this.scene.add(fill);

    // ground plate
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(snapW + 8, 4, 60),
      new THREE.MeshLambertMaterial({ color: 0x1a1a30 }),
    );
    plate.position.set(0, -(snapH / 2) - 3, 20);
    this.scene.add(plate);

    // palette colors once
    for (let m = 0; m < NMATS; m++) {
      const c = MATS[m].ramp[0];
      this.colors[m] = new THREE.Color(
        ((c & 255) / 255),
        (((c >>> 8) & 255) / 255),
        (((c >>> 16) & 255) / 255),
      );
    }

    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      this.capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    if (!this.visible) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  /** rebuild instance buffers from a downsampled material snapshot */
  update(cells: Uint8Array, w: number, h: number): void {
    let n = 0;
    const halfH = h / 2;
    for (let y = 0; y < h; y++) {
      const rowY = y * w;
      const py = halfH - y;
      for (let x = 0; x < w; x++) {
        const m = cells[rowY + x];
        if (m === 0 || n >= this.capacity) continue;
        this.dummy.position.set(x - w / 2, py, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(n, this.dummy.matrix);
        this.mesh.setColorAt(n, this.colors[m] ?? this.colors[1]);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
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
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
