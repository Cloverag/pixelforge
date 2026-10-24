import { bindDummyVao, blit, Program } from '../render/glutil';

/**
 * The ASCII filter: the vector picture becomes coloured text. The screen is
 * cut into cells; each cell takes the average colour of the picture under it
 * (a mipmap read), picks a character by how bright that is - from ' ' through
 * '.:-=+*#%@' - and draws that character in that colour. The characters come
 * from a small atlas drawn once with the browser's own monospace font.
 */

/** dark to bright: how much ink each character has */
export const RAMP = ' .:-=+*#%@';

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uPic;
uniform sampler2D uAtlas;
uniform vec2 uRes;
uniform float uCell;
uniform float uGlyphs;
uniform float uAscii;
uniform sampler2D uMask;
uniform float uMasked;
uniform float uMaskW;
void main() {
  vec2 px = vUv * uRes;
  if (uAscii < 0.5) {
    frag = vec4(texture(uPic, vUv).rgb, 1.0);
    return;
  }
  vec2 cell = floor(px / uCell);
  vec2 centre = (cell + 0.5) * uCell / uRes;
  // with a mask, only what is there turns to text: the rest (the sky) shows as it is
  if (uMasked > 0.5) {
    float cover = textureLod(uMask, vec2(centre.x, 1.0 - centre.y), log2(max(1.0, uCell * uMaskW / uRes.x))).r;
    if (cover < 0.3) {
      frag = vec4(texture(uPic, vUv).rgb, 1.0);
      return;
    }
  }
  // the cell's average colour: the mip level about one cell across
  vec3 c = textureLod(uPic, centre, log2(uCell)).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // brighter cells get denser characters; strong gamma, and anything that is
  // there at all gets at least a ':' - the flowers read as solid text
  float idx = floor(clamp(pow(lum, 0.42), 0.0, 0.999) * uGlyphs);
  if (lum > 0.02) idx = max(idx, 2.0);
  vec2 f = fract(px / uCell);
  // the atlas is one row of glyphs, cell-shaped
  float ink = texture(uAtlas, vec2((idx + f.x) / uGlyphs, 1.0 - f.y)).r;
  // the character in the cell's colour, pushed toward full saturation so it reads as light
  vec3 col = c / max(max(c.r, max(c.g, c.b)), 0.08);
  frag = vec4(min(col * ink * (0.55 + 1.1 * sqrt(lum)), vec3(1.0)), 1.0);
}`;

export class AsciiFilter {
  private gl: WebGL2RenderingContext;
  private prog: Program;
  private pic: WebGLTexture;
  private atlas: WebGLTexture;
  private mask: WebGLTexture;
  private maskW = 0;
  ascii = true;
  /** a character cell's size in screen pixels */
  cell = 8;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl;
    bindDummyVao(gl);
    this.prog = new Program(gl, FRAG);
    this.pic = gl.createTexture()!;
    this.atlas = gl.createTexture()!;
    this.mask = gl.createTexture()!;
    this.buildAtlas();
  }

  /** Which parts of the picture are things (255) and which are background (0), one byte each, rows top down; null: all of it is text. */
  setMask(cover: Uint8Array | null, w: number, h: number): void {
    this.maskW = cover ? w : 0;
    if (!cover) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, cover);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  /** One row of the ramp's characters, white on black, each 32 x 48. */
  private buildAtlas(): void {
    const w = 32;
    const h = 48;
    const c = document.createElement('canvas');
    c.width = w * RAMP.length;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.font = `bold ${h * 0.9}px ui-monospace, Menlo, Consolas, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < RAMP.length; i++) g.fillText(RAMP[i], i * w + w / 2, h / 2 + 2);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Show `src` (the vector picture) through the filter, at the canvas's size. */
  render(src: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.pic);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.prog.use();
    this.prog
      .tex('uPic', this.pic, 0)
      .tex('uAtlas', this.atlas, 1)
      .tex('uMask', this.mask, 2)
      .f('uMasked', this.maskW > 0 ? 1 : 0)
      .f('uMaskW', this.maskW)
      .v2('uRes', this.canvas.width, this.canvas.height)
      .f('uCell', this.cell)
      .f('uGlyphs', RAMP.length)
      .f('uAscii', this.ascii ? 1 : 0);
    blit(gl, null);
  }

  dispose(): void {
    this.prog.dispose();
    this.gl.deleteTexture(this.pic);
    this.gl.deleteTexture(this.atlas);
  }
}
