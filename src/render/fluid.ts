import { blit, makeTarget, pingPong, PingPong, Program, Target } from './glutil';

/**
 * A GPU fluid solver, the thing that makes Sandspiel's smoke look like smoke.
 *
 * The cell simulation is discrete and local: a grain of smoke either occupies
 * a cell or it does not, and it moves at most one cell per frame. No amount of
 * blur makes that look like flowing gas. So the *look* of gas is handled by a
 * second, continuous field that lives entirely on the GPU - a velocity field
 * and a dye field advected through it - which the cell world seeds but does
 * not otherwise interact with.
 *
 * This is a standard Stam-style solver:
 *
 *   advect velocity through itself
 *   add vorticity confinement (puts back the curl that advection smears out)
 *   compute divergence -> solve for pressure (Jacobi) -> subtract its gradient
 *   advect dye through the now divergence-free velocity
 *
 * The pressure projection is the step that makes it swirl rather than streak:
 * without it the field compresses and dye piles into blobs.
 */

/** Velocity/pressure grid. Coarse is fine - it is interpolated on read. */
const SIM_SCALE = 4;
/** Dye grid, finer because it is what you actually look at. */
const DYE_SCALE = 2;
/** Jacobi iterations for the pressure solve. Below ~12 it visibly compresses. */
const PRESSURE_ITERS = 16;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 frag;
`;

const ADVECT = `${HEAD}
uniform sampler2D uVel;
uniform sampler2D uSrc;
uniform vec2 uTexel;      // texel size of the velocity field
uniform float uDt;
uniform float uDissipate;
void main() {
  // semi-Lagrangian: look back along the velocity to find what arrives here
  vec2 back = vUv - uDt * texture(uVel, vUv).xy * uTexel;
  frag = texture(uSrc, back) / (1.0 + uDissipate * uDt);
}`;

const DIVERGENCE = `${HEAD}
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float l = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;
  float t = texture(uVel, vUv + vec2(0.0, uTexel.y)).y;
  // reflect the field at the walls so fluid does not leak out of the box
  vec2 c = texture(uVel, vUv).xy;
  if (vUv.x - uTexel.x < 0.0) l = -c.x;
  if (vUv.x + uTexel.x > 1.0) r = -c.x;
  if (vUv.y - uTexel.y < 0.0) b = -c.y;
  if (vUv.y + uTexel.y > 1.0) t = -c.y;
  frag = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`;

const PRESSURE = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  float d = texture(uDivergence, vUv).x;
  frag = vec4((l + r + b + t - d) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT = `${HEAD}
uniform sampler2D uPressure;
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float l = texture(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uPressure, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uPressure, vUv + vec2(0.0, uTexel.y)).x;
  vec2 v = texture(uVel, vUv).xy - vec2(r - l, t - b);
  frag = vec4(v, 0.0, 1.0);
}`;

const CURL = `${HEAD}
uniform sampler2D uVel;
uniform vec2 uTexel;
void main() {
  float l = texture(uVel, vUv - vec2(uTexel.x, 0.0)).y;
  float r = texture(uVel, vUv + vec2(uTexel.x, 0.0)).y;
  float b = texture(uVel, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uVel, vUv + vec2(0.0, uTexel.y)).x;
  frag = vec4(0.5 * ((r - l) - (t - b)), 0.0, 0.0, 1.0);
}`;

const VORTICITY = `${HEAD}
uniform sampler2D uVel;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uCurlAmount;
uniform float uDt;
void main() {
  float l = texture(uCurl, vUv - vec2(uTexel.x, 0.0)).x;
  float r = texture(uCurl, vUv + vec2(uTexel.x, 0.0)).x;
  float b = texture(uCurl, vUv - vec2(0.0, uTexel.y)).x;
  float t = texture(uCurl, vUv + vec2(0.0, uTexel.y)).x;
  float c = texture(uCurl, vUv).x;
  // push along the gradient of |curl|, which re-injects the small eddies
  // that semi-Lagrangian advection numerically smears away
  vec2 force = 0.5 * vec2(abs(t) - abs(b), abs(l) - abs(r));
  force /= length(force) + 1e-4;
  force *= uCurlAmount * c;
  vec2 v = texture(uVel, vUv).xy + force * uDt;
  frag = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`;

/**
 * Reads the downsampled material map and turns hot / gaseous cells into dye
 * and upward velocity, so plumes rise out of fire without anyone aiming them.
 *
 * The material id arrives in the red channel as a byte; the emission table is
 * a 1D lookup so the CPU decides what each material emits.
 */
/** Emission table width: one texel per possible material id (cells are bytes). */
export const EMIT_LUT = 256;

const EMIT = `${HEAD}
uniform sampler2D uMat;        // material id per cell, R8
uniform sampler2D uEmitLut;    // per-material rgb + strength, one texel per id
uniform sampler2D uDye;
uniform float uDt;
uniform float uGain;
void main() {
  float id = texture(uMat, vUv).r * 255.0;
  vec4 e = texture(uEmitLut, vec2((id + 0.5) / ${EMIT_LUT}.0, 0.5));
  vec3 add = e.rgb * e.a * uDt * uGain;
  frag = vec4(texture(uDye, vUv).rgb + add, 1.0);
}`;

const EMIT_VEL = `${HEAD}
uniform sampler2D uMat;
uniform sampler2D uEmitLut;
uniform sampler2D uVel;
uniform float uDt;
uniform float uBuoyancy;
void main() {
  float id = texture(uMat, vUv).r * 255.0;
  vec4 e = texture(uEmitLut, vec2((id + 0.5) / ${EMIT_LUT}.0, 0.5));
  vec2 v = texture(uVel, vUv).xy;
  // hot cells push their own dye upward; +y is up in texture space
  v.y += e.a * uBuoyancy * uDt;
  frag = vec4(v, 0.0, 1.0);
}`;

/** Adds the CPU wind field into the velocity field, so the brush drives it. */
const WIND = `${HEAD}
uniform sampler2D uWind;   // RG16F, CPU wind field at chunk resolution
uniform sampler2D uVel;
uniform float uDt;
uniform float uGain;
void main() {
  vec2 w = texture(uWind, vUv).xy;
  frag = vec4(texture(uVel, vUv).xy + w * uGain * uDt, 0.0, 1.0);
}`;

const CLEAR = `${HEAD}
uniform sampler2D uSrc;
uniform float uAmount;
void main() { frag = texture(uSrc, vUv) * uAmount; }`;

export class Fluid {
  private vel: PingPong;
  private dye: PingPong;
  private pressure: PingPong;
  private divergence: Target;
  private curl: Target;

  private pAdvect: Program;
  private pDivergence: Program;
  private pPressure: Program;
  private pGradient: Program;
  private pCurl: Program;
  private pVorticity: Program;
  private pEmit: Program;
  private pEmitVel: Program;
  private pWind: Program;
  private pClear: Program;

  /** material id per cell, uploaded from the worker snapshot */
  private matTex: WebGLTexture;
  private matW = 0;
  private matH = 0;
  /** per-material emission colour + strength */
  private lutTex: WebGLTexture;
  /** CPU wind field */
  private windTex: WebGLTexture;
  private windW = 0;
  private windH = 0;

  private simW: number;
  private simH: number;
  private dyeW: number;
  private dyeH: number;

  constructor(
    private gl: WebGL2RenderingContext,
    width: number,
    height: number,
  ) {
    this.simW = Math.max(1, Math.floor(width / SIM_SCALE));
    this.simH = Math.max(1, Math.floor(height / SIM_SCALE));
    this.dyeW = Math.max(1, Math.floor(width / DYE_SCALE));
    this.dyeH = Math.max(1, Math.floor(height / DYE_SCALE));

    const RG = gl.RG16F;
    const R = gl.R16F;
    const RGBA = gl.RGBA16F;
    this.vel = pingPong(gl, this.simW, this.simH, RG, gl.RG, gl.HALF_FLOAT);
    this.pressure = pingPong(gl, this.simW, this.simH, R, gl.RED, gl.HALF_FLOAT);
    this.divergence = makeTarget(gl, this.simW, this.simH, R, gl.RED, gl.HALF_FLOAT);
    this.curl = makeTarget(gl, this.simW, this.simH, R, gl.RED, gl.HALF_FLOAT);
    this.dye = pingPong(gl, this.dyeW, this.dyeH, RGBA, gl.RGBA, gl.HALF_FLOAT);

    this.pAdvect = new Program(gl, ADVECT);
    this.pDivergence = new Program(gl, DIVERGENCE);
    this.pPressure = new Program(gl, PRESSURE);
    this.pGradient = new Program(gl, GRADIENT);
    this.pCurl = new Program(gl, CURL);
    this.pVorticity = new Program(gl, VORTICITY);
    this.pEmit = new Program(gl, EMIT);
    this.pEmitVel = new Program(gl, EMIT_VEL);
    this.pWind = new Program(gl, WIND);
    this.pClear = new Program(gl, CLEAR);

    this.matTex = this.makeDataTex();
    this.lutTex = this.makeDataTex();
    this.windTex = this.makeDataTex();
  }

  private makeDataTex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** The texture the compositor draws over the sim frame. */
  get dyeTexture(): WebGLTexture {
    return this.dye.read.tex;
  }

  /**
   * Per-material emission: rgb is the dye colour, alpha the strength. Uploaded
   * once as an EMIT_LUT x 1 RGBA texture indexed by material id.
   */
  setEmissionTable(rgba: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, EMIT_LUT, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  /** Uploads the downsampled material map for this frame. */
  setMaterials(cells: Uint8Array, w: number, h: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.matTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (w !== this.matW || h !== this.matH) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, cells);
      this.matW = w;
      this.matH = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, cells);
    }
  }

  /** Uploads the CPU wind field (chunk resolution, RG float pairs). */
  setWind(field: Float32Array, w: number, h: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.windTex);
    if (w !== this.windW || h !== this.windH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.FLOAT, field);
      this.windW = w;
      this.windH = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RG, gl.FLOAT, field);
    }
  }

  private simTexel(): [number, number] {
    return [1 / this.simW, 1 / this.simH];
  }

  /**
   * One solver step.
   *
   * `dt` is **one frame**, not a fraction of a second. The reference WebGL
   * fluid solvers this is modelled on pass real seconds (~0.016), so every
   * rate constant published for them is ~60x too strong here. Velocity is in
   * texels of the velocity grid per frame, which is what the advection step
   * assumes when it multiplies by uTexel. Getting this wrong is not subtle:
   * at the borrowed dye dissipation of 0.55 the dye had a 1.6-frame half-life
   * and the whole effect was invisible.
   */
  step(
    dt: number,
    opts: {
      curl: number;
      buoyancy: number;
      windGain: number;
      dyeFade: number;
      emitGain: number;
      velFade: number;
    },
  ): void {
    const gl = this.gl;
    const [tx, ty] = this.simTexel();

    // ---- forces in ----
    if (this.windW > 0) {
      this.pWind.use();
      this.pWind.tex('uWind', this.windTex, 0).tex('uVel', this.vel.read.tex, 1)
        .f('uDt', dt).f('uGain', opts.windGain);
      blit(gl, this.vel.write);
      this.vel.swap();
    }
    if (this.matW > 0) {
      this.pEmitVel.use();
      this.pEmitVel.tex('uMat', this.matTex, 0).tex('uEmitLut', this.lutTex, 1)
        .tex('uVel', this.vel.read.tex, 2).f('uDt', dt).f('uBuoyancy', opts.buoyancy);
      blit(gl, this.vel.write);
      this.vel.swap();
    }

    // ---- vorticity confinement ----
    this.pCurl.use();
    this.pCurl.tex('uVel', this.vel.read.tex, 0).v2('uTexel', tx, ty);
    blit(gl, this.curl);

    this.pVorticity.use();
    this.pVorticity.tex('uVel', this.vel.read.tex, 0).tex('uCurl', this.curl.tex, 1)
      .v2('uTexel', tx, ty).f('uCurlAmount', opts.curl).f('uDt', dt);
    blit(gl, this.vel.write);
    this.vel.swap();

    // ---- projection ----
    this.pDivergence.use();
    this.pDivergence.tex('uVel', this.vel.read.tex, 0).v2('uTexel', tx, ty);
    blit(gl, this.divergence);

    this.pClear.use();
    this.pClear.tex('uSrc', this.pressure.read.tex, 0).f('uAmount', 0.8);
    blit(gl, this.pressure.write);
    this.pressure.swap();

    this.pPressure.use();
    for (let i = 0; i < PRESSURE_ITERS; i++) {
      this.pPressure.tex('uPressure', this.pressure.read.tex, 0)
        .tex('uDivergence', this.divergence.tex, 1).v2('uTexel', tx, ty);
      blit(gl, this.pressure.write);
      this.pressure.swap();
    }

    this.pGradient.use();
    this.pGradient.tex('uPressure', this.pressure.read.tex, 0)
      .tex('uVel', this.vel.read.tex, 1).v2('uTexel', tx, ty);
    blit(gl, this.vel.write);
    this.vel.swap();

    // ---- advect ----
    this.pAdvect.use();
    this.pAdvect.tex('uVel', this.vel.read.tex, 0).tex('uSrc', this.vel.read.tex, 1)
      .v2('uTexel', tx, ty).f('uDt', dt).f('uDissipate', opts.velFade);
    blit(gl, this.vel.write);
    this.vel.swap();

    this.pAdvect.use();
    this.pAdvect.tex('uVel', this.vel.read.tex, 0).tex('uSrc', this.dye.read.tex, 1)
      .v2('uTexel', tx, ty).f('uDt', dt).f('uDissipate', opts.dyeFade);
    blit(gl, this.dye.write);
    this.dye.swap();

    // ---- dye in, after advection so a source is not smeared on arrival ----
    if (this.matW > 0) {
      this.pEmit.use();
      this.pEmit.tex('uMat', this.matTex, 0).tex('uEmitLut', this.lutTex, 1)
        .tex('uDye', this.dye.read.tex, 2).f('uDt', dt).f('uGain', opts.emitGain);
      blit(gl, this.dye.write);
      this.dye.swap();
    }
  }

  /** Wipes the fields, e.g. when the world is cleared or a level loads. */
  reset(): void {
    const gl = this.gl;
    for (const t of [this.vel.read, this.vel.write, this.dye.read, this.dye.write,
                     this.pressure.read, this.pressure.write, this.divergence, this.curl]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.w, t.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    this.vel.dispose();
    this.dye.dispose();
    this.pressure.dispose();
    for (const t of [this.divergence, this.curl]) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    for (const p of [this.pAdvect, this.pDivergence, this.pPressure, this.pGradient,
                     this.pCurl, this.pVorticity, this.pEmit, this.pEmitVel,
                     this.pWind, this.pClear]) p.dispose();
    for (const t of [this.matTex, this.lutTex, this.windTex]) gl.deleteTexture(t);
  }
}
