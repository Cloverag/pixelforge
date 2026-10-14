import { blit, makeTarget, Program, Target } from './glutil';

/**
 * A small real-time "film" pipeline for the particle playground - the same
 * ideas a renderer like Blender's Eevee uses, cut down to what a 640x360
 * pixel sim needs:
 *
 * 1. the frame is composited into a half-float **scene** target, where bright
 *    particle cores are pushed above 1.0 so they act as light, not colour;
 * 2. **bloom**: a dual-filter downsample/upsample chain over five mips, so
 *    light bleeds into soft, wide halos without a big blur kernel;
 * 3. **final**: filmic (ACES) tone mapping, so bright colours roll off to
 *    white instead of clipping, then vignette, faint lens fringing and grain.
 *
 * The level-1 upsample doubles as a soft light map: next frame, walls are
 * lit by it, so a firework going off lights the bricks around it.
 */

const PREFILTER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uSrc;
uniform float uThreshold;
uniform float uKnee;
void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  // soft knee: no hard edge where bloom starts
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  frag = vec4(c * w, 1.0);
}`;

/** Dual-filter downsample: centre plus four half-texel diagonals. */
const DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  vec2 o = uTexel * 0.5;
  vec3 c = texture(uSrc, vUv).rgb * 4.0;
  c += texture(uSrc, vUv + vec2(-o.x, -o.y)).rgb;
  c += texture(uSrc, vUv + vec2( o.x, -o.y)).rgb;
  c += texture(uSrc, vUv + vec2(-o.x,  o.y)).rgb;
  c += texture(uSrc, vUv + vec2( o.x,  o.y)).rgb;
  frag = vec4(c / 8.0, 1.0);
}`;

/** Dual-filter upsample (8-tap tent) of the smaller mip, plus this level. */
const UP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uSmall;
uniform sampler2D uSame;
uniform vec2 uTexel;
void main() {
  vec2 o = uTexel;
  vec3 c = vec3(0.0);
  c += texture(uSmall, vUv + vec2(-2.0 * o.x, 0.0)).rgb;
  c += texture(uSmall, vUv + vec2( 2.0 * o.x, 0.0)).rgb;
  c += texture(uSmall, vUv + vec2(0.0, -2.0 * o.y)).rgb;
  c += texture(uSmall, vUv + vec2(0.0,  2.0 * o.y)).rgb;
  c += texture(uSmall, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  c += texture(uSmall, vUv + vec2( o.x, -o.y)).rgb * 2.0;
  c += texture(uSmall, vUv + vec2(-o.x,  o.y)).rgb * 2.0;
  c += texture(uSmall, vUv + vec2( o.x,  o.y)).rgb * 2.0;
  frag = vec4(c / 12.0 + texture(uSame, vUv).rgb, 1.0);
}`;

const FINAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomGain;
uniform float uExposure;
uniform float uTime;
uniform vec2 uRes;

// Narkowicz's fit of the ACES filmic curve
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 d = vUv - 0.5;
  // faint lens fringing: red and blue sampled a hair apart, growing to the edges
  float ca = 0.0018 * dot(d, d) * 4.0;
  vec3 s;
  s.r = texture(uScene, vUv + d * ca).r;
  s.g = texture(uScene, vUv).g;
  s.b = texture(uScene, vUv - d * ca).b;
  vec3 hdr = s + texture(uBloom, vUv).rgb * uBloomGain;
  vec3 c = aces(hdr * uExposure);
  c = pow(c, vec3(1.0 / 2.2));
  // vignette: a soft darkening toward the corners
  c *= mix(1.0, smoothstep(0.85, 0.25, length(d)), 0.32);
  // grain, per pixel and per frame, too faint to see on its own
  c += (hash(vUv * uRes + fract(uTime) * 91.0) - 0.5) * 0.018;
  frag = vec4(c, 1.0);
}`;

const MIPS = 5;

export class Cinematic {
  /** composite renders into this instead of the canvas */
  readonly scene: Target;
  private down: Target[] = [];
  private up: Target[] = [];
  private prefilter: Program;
  private downP: Program;
  private upP: Program;
  private finalP: Program;
  private t0 = performance.now();

  constructor(private gl: WebGL2RenderingContext, w: number, h: number) {
    const F = gl.RGBA16F;
    this.scene = makeTarget(gl, w, h, F, gl.RGBA, gl.HALF_FLOAT);
    let mw = w >> 1;
    let mh = h >> 1;
    for (let i = 0; i < MIPS; i++) {
      this.down.push(makeTarget(gl, Math.max(1, mw), Math.max(1, mh), F, gl.RGBA, gl.HALF_FLOAT));
      this.up.push(makeTarget(gl, Math.max(1, mw), Math.max(1, mh), F, gl.RGBA, gl.HALF_FLOAT));
      mw >>= 1;
      mh >>= 1;
    }
    this.prefilter = new Program(gl, PREFILTER);
    this.downP = new Program(gl, DOWN);
    this.upP = new Program(gl, UP);
    this.finalP = new Program(gl, FINAL);
  }

  /** Soft light map from the last frame's bloom, for lighting walls. */
  get light(): WebGLTexture {
    return this.up[1].tex;
  }

  /** Bloom the scene target and tone-map it to the canvas. */
  render(): void {
    const gl = this.gl;
    this.prefilter.use();
    this.prefilter.tex('uSrc', this.scene.tex, 0).f('uThreshold', 0.85).f('uKnee', 0.45);
    blit(gl, this.down[0]);
    for (let i = 1; i < MIPS; i++) {
      const src = this.down[i - 1];
      this.downP.use();
      this.downP.tex('uSrc', src.tex, 0).v2('uTexel', 1 / src.w, 1 / src.h);
      blit(gl, this.down[i]);
    }
    // the smallest level is its own upsample
    let small = this.down[MIPS - 1];
    for (let i = MIPS - 2; i >= 0; i--) {
      this.upP.use();
      this.upP
        .tex('uSmall', small.tex, 0)
        .tex('uSame', this.down[i].tex, 1)
        .v2('uTexel', 1 / small.w, 1 / small.h);
      blit(gl, this.up[i]);
      small = this.up[i];
    }
    this.finalP.use();
    this.finalP
      .tex('uScene', this.scene.tex, 0)
      .tex('uBloom', this.up[0].tex, 1)
      .f('uBloomGain', 0.75)
      .f('uExposure', 1.15)
      .f('uTime', (performance.now() - this.t0) / 1000)
      .v2('uRes', this.scene.w, this.scene.h);
    blit(gl, null);
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of [this.scene, ...this.down, ...this.up]) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    for (const p of [this.prefilter, this.downP, this.upP, this.finalP]) p.dispose();
  }
}
