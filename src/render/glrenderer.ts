import { bgLift } from '../sim/background';
import { FLAMES, MATS, Mat, NMATS, Cat } from '../sim/materials';
import { CHUNKS_X, CHUNKS_Y, SIM_H, SIM_W } from '../sim/protocol';
import { Blockifier, fitSize } from './blocks';
import { EMIT_LUT, Fluid } from './fluid';
import { Cinematic } from './cinematic';
import { bindDummyVao, blit, makeTarget, Program, type Target } from './glutil';
import type { SimRenderer } from './renderer';

/**
 * WebGL2 presentation for the sand view.
 *
 * The cell frame arrives as the same RGBA buffer the 2D renderer draws, and is
 * uploaded as a texture. On top of it the GPU fluid contributes a continuous
 * dye field, and the final pass adds a cheap glow. Everything happens in one
 * canvas and one draw to the default framebuffer - the previous attempt at
 * layering an effect over the live canvas used mix-blend-mode and cost 12 FPS,
 * because blending re-reads the backdrop on every simulated frame.
 */

const COMPOSITE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uFrame;
uniform sampler2D uDye;
uniform vec2 uTexel;
uniform float uGlow;
uniform float uDyeGain;
uniform float uSoft;
uniform float uTime;
// how far the chosen background sits above NIGHT, per channel: the bloom threshold clears it
uniform vec3 uBgLift;
// cinematic (playground) mode: write HDR, and light walls from last frame's bloom
uniform float uCine;
uniform sampler2D uLight;
// the world in cells, and how many screen pixels one cell spans
uniform vec2 uSim;
uniform float uCellPx;
// what each material is (materialInfo): r = liquid
uniform sampler2D uMatInfo;
uniform float uCrt;
// what glows: each light source's colour, nothing else (EMIT pass)
uniform sampler2D uEmit;

// A frame pixel's alpha is its cell's material id (materials.ts withMat), 255
// where there is no cell. Read with texelFetch so filtering cannot blend ids.
int idAt(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uSim) - 1);
  return int(texelFetch(uFrame, p, 0).a * 255.0 + 0.5);
}
vec4 infoOf(int id) {
  return id < 128 ? texelFetch(uMatInfo, ivec2(id, 0), 0) : vec4(0.0);
}
bool liquidAt(ivec2 p) {
  return infoOf(idAt(p)).r > 0.5;
}

vec3 waterFx(vec3 c, ivec2 p) {
  // depth: liquid cells above this one (texture is flipped, +y is up)
  float d = 0.0;
  for (int k = 1; k <= 24; k++) {
    if (!liquidAt(p + ivec2(0, k))) break;
    d += 1.0;
  }
  float deep = smoothstep(1.0, 24.0, d);
  c = mix(c, c * vec3(0.42, 0.55, 0.80), deep * 0.8);

  // caustics: two interfering slow waves, quantised to three levels so the
  // shimmer stays pixel art instead of becoming a smooth gradient
  vec2 q = vec2(p) * 0.11;
  float t = uTime;
  float w = sin(q.x * 1.7 + t * 1.3 + sin(q.y * 2.3 + t * 0.9))
          * sin(q.y * 1.9 - t * 1.1 + sin(q.x * 1.3 - t * 0.7));
  w = floor(max(w, 0.0) * 3.0) / 3.0;
  c += w * 0.075 * (1.0 - deep * 0.75) * vec3(0.75, 0.9, 1.0);

  // surface: travelling glints along the top row only
  if (d == 0.0) {
    float g = sin(float(p.x) * 0.31 - t * 2.2 + sin(float(p.x) * 0.05 + t * 0.5) * 2.5);
    c *= 1.0 + 0.2 * step(0.55, g);
  }
  return c;
}

void main() {
  // Every screen pixel shows its cell's colour exactly: cells are crisp
  // squares at any size. Light (glow, dye) is sampled smoothly on top.
  vec2 cf = vUv * uSim;
  ivec2 p = clamp(ivec2(floor(cf)), ivec2(0), ivec2(uSim) - 1);
  vec4 px = texelFetch(uFrame, p, 0);
  // nearest, on purpose: at 2-3 screen pixels a cell, any edge blending is
  // half the picture and reads as blur; a cell one pixel wider is not visible
  vec3 c = px.rgb;
  if (liquidAt(p)) c = waterFx(c, p);

  if (uSoft > 0.5) {
    // eight taps on two rings of the emission map: only light sources bleed
    // light (fire, lava, embers, flames, sparks), never sand or snow
    vec3 g = vec3(0.0);
    vec2 t = uTexel;
    g += texture(uEmit, vUv + vec2( t.x,  0.0) * 1.5).rgb;
    g += texture(uEmit, vUv + vec2(-t.x,  0.0) * 1.5).rgb;
    g += texture(uEmit, vUv + vec2( 0.0,  t.y) * 1.5).rgb;
    g += texture(uEmit, vUv + vec2( 0.0, -t.y) * 1.5).rgb;
    g += texture(uEmit, vUv + vec2( t.x,  t.y) * 3.0).rgb;
    g += texture(uEmit, vUv + vec2(-t.x,  t.y) * 3.0).rgb;
    g += texture(uEmit, vUv + vec2( t.x, -t.y) * 3.0).rgb;
    g += texture(uEmit, vUv + vec2(-t.x, -t.y) * 3.0).rgb;
    g *= 0.125;
    // only what is already bright is allowed to bleed, so the dark tube stays
    // dark instead of turning into grey fog
    g = max(g - 0.30 - uBgLift, 0.0);
    c += g * uGlow;
  }

  c += texture(uDye, vUv).rgb * uDyeGain;

  if (uCine > 0.5) {
    // into linear light, for the tone mapper downstream
    c = pow(max(c, 0.0), vec3(2.2));
    float a = px.a;
    if (abs(a - 253.0 / 255.0) < 0.002) {
      // A wall: dim on its own, lit by whatever glows nearby - but kept below
      // the bloom threshold. Lit by last frame's bloom and allowed to bloom
      // itself, a wall beside a bright source fed itself until the float
      // buffer overflowed and NaN spread black across the screen.
      vec3 L = min(texture(uLight, vUv).rgb, vec3(1.0));
      c = min(c * (0.28 + 2.4 * L), vec3(0.6));
    } else {
      // particles are light sources: push bright cores past 1.0 so they bloom
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= 1.0 + 3.0 * l;
    }
  }
  // CRT: one dark line along the foot of every row of cells, so the lines
  // follow the pixel art instead of striping through it
  // (only where a cell is 3+ pixels tall: on a smaller one the lines would be half the picture)
  if (uCrt > 0.5 && uCellPx >= 3.0 && fract(cf.y) < 1.0 / uCellPx) c *= 0.8;
  frag = vec4(c, 1.0);
}`;

/**
 * The emission map: each cell's colour times how much it is a light source,
 * at cell resolution. The composite samples it smoothly for the glow, so
 * light is soft while the cells stay crisp.
 */
const EMIT = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uFrame;
uniform sampler2D uMatInfo;
uniform vec2 uSim;
void main() {
  ivec2 p = ivec2(floor(vUv * uSim));
  vec4 px = texelFetch(uFrame, p, 0);
  int id = int(px.a * 255.0 + 0.5);
  // 255 is not a cell: the background (dark, below the bloom threshold) and
  // flying debris, whose sparks should glow
  float e = id < 128 ? texelFetch(uMatInfo, ivec2(id, 0), 0).g : 1.0;
  frag = vec4(px.rgb * e, 1.0);
}`;

/** Materials that give off light: their glow bleeds into the cells around them. */
const LIGHTS = new Set<number>([Mat.FIRE, Mat.EMBER, Mat.LAVA, Mat.TORCH, Mat.NEON_GLOW, Mat.IODINE_GAS, ...FLAMES]);

/** What the composite needs to know about each material, by id: r = liquid, g = light source. */
export function materialInfo(): Uint8Array {
  const lut = new Uint8Array(128 * 4);
  for (let m = 0; m < NMATS; m++) {
    const d = MATS[m];
    if (!d) continue;
    // lava is a light source, not a pool: it keeps its own look
    if (d.cat === Cat.LIQUID && m !== Mat.LAVA) lut[m * 4] = 255;
    if (LIGHTS.has(m)) lut[m * 4 + 1] = 255;
  }
  return lut;
}

/**
 * Fluid tuning, all per-frame (see Fluid.step on why that matters).
 *
 * Velocity is in velocity-grid texels per frame. With VEL_FADE 0.02 a constant
 * force f settles at f/0.02 texels/frame, which is how these were chosen:
 * a plume terminal of ~4 texels/frame reads as rising smoke, much more and it
 * teleports off the top of the screen in a few frames.
 */
const CURL = 0.4;
const BUOYANCY = 0.08;
/** CPU wind is cells/frame; 4 cells make one velocity texel. */
const WIND_GAIN = 0.03;
const VEL_FADE = 0.02;
const DYE_FADE = 0.012;
const EMIT_GAIN = 0.12;
const DYE_GAIN = 0.85;
const GLOW = 0.95;

/**
 * What each material contributes to the dye field: rgb colour, plus a strength
 * in alpha that also drives buoyancy. Gases emit strongly - they are the thing
 * the fluid exists to make look good. Lava and embers smoulder. Everything
 * solid emits nothing, so a wall does not fog up the screen.
 */
function emissionTable(): Uint8Array {
  const lut = new Uint8Array(EMIT_LUT * 4);
  const put = (id: number, hex: number, strength: number) => {
    lut[id * 4] = (hex >> 16) & 255;
    lut[id * 4 + 1] = (hex >> 8) & 255;
    lut[id * 4 + 2] = hex & 255;
    lut[id * 4 + 3] = Math.round(Math.max(0, Math.min(1, strength)) * 255);
  };
  for (let m = 0; m < NMATS; m++) {
    const d = MATS[m];
    if (!d) continue;
    if (d.cat !== Cat.GAS) continue;
    // default for gases: their own ramp colour, unpacked from ABGR
    const abgr = d.ramp[0];
    const rgb = ((abgr & 255) << 16) | (((abgr >>> 8) & 255) << 8) | ((abgr >>> 16) & 255);
    put(m, rgb, 0.5);
  }
  put(Mat.FIRE, 0xff8a2e, 1.0);
  put(Mat.SMOKE, 0x50505c, 0.45);
  put(Mat.STEAM, 0x9fb4cc, 0.5);
  put(Mat.LAVA, 0xd8481c, 0.32);
  put(Mat.EMBER, 0xc8461e, 0.28);
  put(Mat.TORCH, 0xffcf5a, 0.18);
  // CHEM LAB: the elemental gases fill the lab for good, so they only tint
  // the air (chlorine, the one you can see, most); flames burn in their own
  // colour; glowing neon and iodine vapour are the show
  put(Mat.H, 0xc4e6fa, 0.06);
  put(Mat.O, 0x7aa6f2, 0.06);
  put(Mat.N, 0x8a8aa8, 0.05);
  put(Mat.NE, 0x7a5c64, 0.04);
  put(Mat.CL, 0xb4d43a, 0.22);
  put(Mat.HE, 0xfbe9f0, 0.03);
  put(Mat.F, 0xe8e070, 0.08);
  put(Mat.NEON_GLOW, 0xff4a2a, 0.9);
  put(Mat.IODINE_GAS, 0x9c40e0, 0.55);
  for (const m of FLAMES) {
    const abgr = MATS[m].ramp[1];
    put(m, ((abgr & 255) << 16) | (((abgr >>> 8) & 255) << 8) | ((abgr >>> 16) & 255), 1.0);
  }
  return lut;
}

export class GLRenderer implements SimRenderer {
  private gl: WebGL2RenderingContext;
  private stage: HTMLElement;
  private frame: HTMLElement | null;

  private frameTex: WebGLTexture;
  private matInfo: WebGLTexture;
  private composite: Program;
  private emitP: Program;
  private emit: Target;
  private fluid: Fluid;
  private blocks = new Blockifier();

  private block: number | null = null;
  private t0 = performance.now();
  private cine: Cinematic | null = null;
  private cineOn = false;

  /**
   * The playground's film look (bloom, filmic tone mapping, lit walls).
   * Built on first use; if the GPU cannot make the float targets, the
   * playground just keeps the plain composite.
   */
  setCinematic(on: boolean): void {
    this.cineOn = on;
    if (on && !this.cine) {
      try {
        this.cine = new Cinematic(this.gl, SIM_W, SIM_H);
      } catch (err) {
        console.warn('cinematic pipeline unavailable:', err);
        this.cineOn = false;
      }
    }
  }
  private soft = true;
  /** RG pairs at chunk resolution, rebuilt per frame from the worker's field */
  private windBuf = new Float32Array(CHUNKS_X * CHUNKS_Y * 2);

  constructor(
    private canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
  ) {
    this.gl = gl;
    bindDummyVao(gl);
    this.stage = document.getElementById('stage')!;
    this.frame = document.getElementById('viewport');

    canvas.width = SIM_W;
    canvas.height = SIM_H;

    this.frameTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // the sim buffer is top-down; flipping on upload puts +y up everywhere, so
    // buoyancy in the fluid shaders means what it says
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SIM_W, SIM_H, 0, gl.RGBA,
      gl.UNSIGNED_BYTE, null);

    this.matInfo = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.matInfo);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 128, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, materialInfo());
    // the frame (and the fluid's inputs) upload flipped, as before
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // the CSS CRT layer keeps only its vignette: the scanlines are drawn per cell row here
    document.body.classList.add('gl-render');

    this.composite = new Program(gl, COMPOSITE);
    this.emitP = new Program(gl, EMIT);
    this.emit = makeTarget(gl, SIM_W, SIM_H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.fluid = new Fluid(gl, SIM_W, SIM_H);
    this.fluid.setEmissionTable(emissionTable());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setSoft(on: boolean): void {
    this.soft = on;
    this.canvas.classList.toggle('hard-pixels', !on);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    const f = on ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    if (!on) this.fluid.reset();
  }

  isSoft(): boolean {
    return this.soft;
  }

  setBlockSize(n: number | null): void {
    this.block = n;
  }

  getBlockSize(): number | null {
    return this.block;
  }

  resize(): void {
    const { w, h } = fitSize(this.stage, this.frame);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // draw at the screen's own resolution, so every cell is a crisp square
    // (capped at 2x: past that the art has nothing more to show)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(SIM_W, Math.round(w * dpr));
    this.canvas.height = Math.max(SIM_H, Math.round(h * dpr));
  }

  /** Clears the fluid, e.g. on world clear or a level load. */
  reset(): void {
    this.fluid.reset();
  }

  /** The composite reads the background every frame (uBgLift): nothing to repaint. */
  refreshBackground(): void {}

  /**
   * Feeds the frame's material map and the CPU wind field into the fluid.
   * Both are optional: with neither, the dye field just decays and the view
   * degrades to the plain composited frame.
   */
  setFluidInputs(mat: Uint8Array | null, matW: number, matH: number, wind: Float32Array | null): void {
    if (!this.soft) return;
    if (mat) this.fluid.setMaterials(mat, matW, matH);
    if (wind) {
      // CPU vy is positive downward; GL y is up, so it flips on the way in
      const n = Math.min(wind.length / 2, this.windBuf.length / 2);
      for (let i = 0; i < n; i++) {
        this.windBuf[i * 2] = wind[i * 2];
        this.windBuf[i * 2 + 1] = -wind[i * 2 + 1];
      }
      this.fluid.setWind(this.windBuf, CHUNKS_X, CHUNKS_Y);
    }
  }

  present(buf: ArrayBuffer): void {
    const gl = this.gl;
    const img = this.block ? this.blocks.apply(buf, this.block) : null;
    const pixels = img
      ? new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
      : new Uint8Array(buf);

    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SIM_W, SIM_H, gl.RGBA,
      gl.UNSIGNED_BYTE, pixels);

    if (this.soft) {
      this.fluid.step(1, {
        curl: CURL,
        buoyancy: BUOYANCY,
        windGain: WIND_GAIN,
        dyeFade: DYE_FADE,
        emitGain: EMIT_GAIN,
        velFade: VEL_FADE,
      });
    }

    if (this.soft) {
      this.emitP.use();
      this.emitP.tex('uFrame', this.frameTex, 0).tex('uMatInfo', this.matInfo, 1).v2('uSim', SIM_W, SIM_H);
      blit(gl, this.emit);
    }

    this.composite.use();
    this.composite
      .tex('uFrame', this.frameTex, 0)
      .tex('uEmit', this.emit.tex, 4)
      .tex('uDye', this.fluid.dyeTexture, 1)
      .v2('uTexel', 1 / SIM_W, 1 / SIM_H)
      .f('uGlow', GLOW)
      .f('uDyeGain', this.soft ? DYE_GAIN : 0)
      .f('uSoft', this.soft ? 1 : 0)
      .f('uTime', (performance.now() - this.t0) / 1000)
      .tex('uMatInfo', this.matInfo, 3)
      .v2('uSim', SIM_W, SIM_H);
    const cine = this.cineOn ? this.cine : null;
    // the cinematic pipeline composites at cell resolution, then scales up itself
    this.composite
      .f('uCellPx', cine ? 1 : this.canvas.width / SIM_W)
      .f('uCrt', document.body.classList.contains('crt-on') ? 1 : 0);
    const lift = bgLift();
    this.composite.v3('uBgLift', lift[0], lift[1], lift[2]);
    this.composite
      .f('uCine', cine ? 1 : 0)
      .tex('uLight', cine ? cine.light : this.fluid.dyeTexture, 2);
    blit(gl, cine ? cine.scene : null);
    cine?.render();
  }

  dispose(): void {
    this.cine?.dispose();
    this.fluid.dispose();
    this.composite.dispose();
    this.emitP.dispose();
    this.gl.deleteFramebuffer(this.emit.fbo);
    this.gl.deleteTexture(this.emit.tex);
    this.gl.deleteTexture(this.frameTex);
    this.gl.deleteTexture(this.matInfo);
  }
}

/**
 * WebGL2 with float render targets, or null.
 *
 * The fluid solver writes to RG16F/R16F/RGBA16F framebuffers, which WebGL2
 * only guarantees are *renderable* with EXT_color_buffer_float. Without it the
 * FBOs come back incomplete and every pass silently draws nothing, so this is
 * a hard requirement rather than a nice-to-have.
 */
export function tryWebGL2(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
  } catch {
    return null;
  }
  if (!gl) return null;
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  return gl;
}
