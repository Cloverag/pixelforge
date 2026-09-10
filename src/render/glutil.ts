/**
 * Minimal WebGL2 helpers.
 *
 * Everything the fluid and the compositor need is a full-screen triangle with
 * a fragment shader reading one or more textures, so this file is deliberately
 * small: compile a program, bind a framebuffer, draw a triangle.
 */

/** A single oversized triangle beats a quad: no diagonal seam, one less vert. */
const VERT = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? 'unknown';
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

export class Program {
  readonly handle: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, frag: string) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p) ?? 'unknown';
      gl.deleteProgram(p);
      throw new Error(`program link failed: ${log}`);
    }
    this.handle = p;
  }

  use(): void {
    this.gl.useProgram(this.handle);
  }

  private loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.locs.set(name, l);
    }
    return l;
  }

  f(name: string, v: number): this {
    this.gl.uniform1f(this.loc(name), v);
    return this;
  }

  v2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y);
    return this;
  }

  v3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.loc(name), x, y, z);
    return this;
  }

  /** Binds `tex` to a texture unit and points the sampler uniform at it. */
  tex(name: string, tex: WebGLTexture, unit: number): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.handle);
  }
}

export interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

/** An off-screen render target. `internal`/`format`/`type` pick the precision. */
export function makeTarget(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  internal: number,
  format: number,
  type: number,
  filter: number = gl.LINEAR,
): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  // EXT_color_buffer_float says these formats *can* be renderable; whether a
  // given driver actually does them is a separate question, and an incomplete
  // framebuffer fails silently - every pass draws nothing and the screen just
  // looks like the effect was never wired up
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error(`framebuffer incomplete (0x${status.toString(16)}) for ${w}x${h} internal 0x${internal.toString(16)}`);
  }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { fbo, tex, w, h };
}

/** Two targets that swap, for solvers that cannot read and write one texture. */
export class PingPong {
  constructor(
    private gl: WebGL2RenderingContext,
    public read: Target,
    public write: Target,
  ) {}

  swap(): void {
    const t = this.read;
    this.read = this.write;
    this.write = t;
  }

  dispose(): void {
    for (const t of [this.read, this.write]) {
      this.gl.deleteFramebuffer(t.fbo);
      this.gl.deleteTexture(t.tex);
    }
  }
}

export function pingPong(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  internal: number,
  format: number,
  type: number,
): PingPong {
  return new PingPong(
    gl,
    makeTarget(gl, w, h, internal, format, type),
    makeTarget(gl, w, h, internal, format, type),
  );
}

/**
 * Ensures a vertex array object is bound.
 *
 * The full-screen triangle is generated from gl_VertexID and reads no
 * attributes, so in principle the default VAO is fine - but some drivers
 * refuse to draw without one bound, and the failure is silent.
 */
export function bindDummyVao(gl: WebGL2RenderingContext): void {
  gl.bindVertexArray(gl.createVertexArray());
}

/** Draws the full-screen triangle into `t`, or the canvas when `t` is null. */
export function blit(gl: WebGL2RenderingContext, t: Target | null): void {
  if (t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
