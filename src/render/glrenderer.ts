import { MATS, Mat, NMATS, Cat } from '../sim/materials';
import { CHUNKS_X, CHUNKS_Y, SIM_H, SIM_W } from '../sim/protocol';
import { Blockifier, fitSize, shakeOffset } from './blocks';
import { Fluid } from './fluid';
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

void main() {
  vec3 c = texture(uFrame, vUv).rgb;

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
  const lut = new Uint8Array(64 * 4);
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
  return lut;
}

export class GLRenderer implements SimRenderer {
  private gl: WebGL2RenderingContext;
  private stage: HTMLElement;
  private bezel: HTMLElement | null;
  private shakeTarget: HTMLElement;

  private frameTex: WebGLTexture;
  private composite: Program;
  private fluid: Fluid;
  private blocks = new Blockifier();

  private block: number | null = null;
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
    this.shakeTarget = this.bezel ?? canvas;

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

  present(buf: ArrayBuffer, shake: number): void {
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
      .f('uSoft', this.soft ? 1 : 0);
    blit(gl, null);

    const off = shakeOffset(shake);
    this.shakeTarget.style.translate = off
      ? `${off.dx.toFixed(1)}px ${off.dy.toFixed(1)}px`
      : '0px 0px';
  }

  dispose(): void {
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
