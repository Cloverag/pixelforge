import { FLAMES, MATS, Mat, NMATS, Cat } from '../sim/materials';
import { CHUNKS_X, CHUNKS_Y, SIM_H, SIM_W } from '../sim/protocol';
import { Blockifier, fitSize } from './blocks';
import { EMIT_LUT, Fluid } from './fluid';
import { Cinematic } from './cinematic';
import { bindDummyVao, blit, Program } from './glutil';
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
// cinematic (playground) mode: write HDR, and light walls from last frame's bloom
uniform float uCine;
uniform sampler2D uLight;

// The rasterizer marks liquid pixels with alpha 250 (LIQUID_ALPHA); every
// other pixel is 255. Read with texelFetch so linear filtering cannot blur
// the flag, at 1:1 because the canvas is exactly SIM_W x SIM_H.
bool liquidAt(ivec2 p) {
  return texelFetch(uFrame, p, 0).a < 0.99;
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
  vec3 c = texture(uFrame, vUv).rgb;
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (liquidAt(p)) c = waterFx(c, p);

  if (uSoft > 0.5) {
    // eight taps on two rings: enough of a bloom for embers and lava to bleed
    // into their neighbours, far cheaper than a separate blur pass
    vec3 g = vec3(0.0);
    vec2 t = uTexel;
    g += texture(uFrame, vUv + vec2( t.x,  0.0) * 1.5).rgb;
    g += texture(uFrame, vUv + vec2(-t.x,  0.0) * 1.5).rgb;
    g += texture(uFrame, vUv + vec2( 0.0,  t.y) * 1.5).rgb;
    g += texture(uFrame, vUv + vec2( 0.0, -t.y) * 1.5).rgb;
    g += texture(uFrame, vUv + vec2( t.x,  t.y) * 3.0).rgb;
    g += texture(uFrame, vUv + vec2(-t.x,  t.y) * 3.0).rgb;
    g += texture(uFrame, vUv + vec2( t.x, -t.y) * 3.0).rgb;
    g += texture(uFrame, vUv + vec2(-t.x, -t.y) * 3.0).rgb;
    g *= 0.125;
    // only what is already bright is allowed to bleed, so the dark tube stays
    // dark instead of turning into grey fog
    g = max(g - 0.30, 0.0);
    c += g * uGlow;
  }

  c += texture(uDye, vUv).rgb * uDyeGain;

  if (uCine > 0.5) {
    // into linear light, for the tone mapper downstream
    c = pow(max(c, 0.0), vec3(2.2));
    float a = texelFetch(uFrame, p, 0).a;
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
  frag = vec4(c, 1.0);
}`;

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
  private bezel: HTMLElement | null;

  private frameTex: WebGLTexture;
  private composite: Program;
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
    this.bezel = document.getElementById('bezel');

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

    this.composite = new Program(gl, COMPOSITE);
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
    const { w, h } = fitSize(this.stage, this.bezel);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** Clears the fluid, e.g. on world clear or a level load. */
  reset(): void {
    this.fluid.reset();
  }

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

    this.composite.use();
    this.composite
      .tex('uFrame', this.frameTex, 0)
      .tex('uDye', this.fluid.dyeTexture, 1)
      .v2('uTexel', 1 / SIM_W, 1 / SIM_H)
      .f('uGlow', GLOW)
      .f('uDyeGain', this.soft ? DYE_GAIN : 0)
      .f('uSoft', this.soft ? 1 : 0)
      .f('uTime', (performance.now() - this.t0) / 1000);
    const cine = this.cineOn ? this.cine : null;
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
    this.gl.deleteTexture(this.frameTex);
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
