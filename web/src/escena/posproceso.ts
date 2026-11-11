// Posproceso: brillo controlado de las luces intensas (emisión bioluminiscente, sol, motor), tone mapping y, al final,
// gradación de color (sombras hacia el azul espacial, altas luces algo cálidas), viñeta, grano y aberración de lente.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

const FINAL_SHADER = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, time: { value: 0 }, grain: { value: 0.028 }, aberracion: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, grain, aberracion; varying vec2 vUv;
    float rnd(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d); vec2 off = d * r2 * 0.012 * aberracion;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, c * vec3(0.9, 0.97, 1.1), (1.0 - l) * 0.35);
      c = mix(c, c * vec3(1.04, 1.0, 0.96), smoothstep(0.5, 1.0, l) * 0.3);
      c = max(c, vec3(0.03, 0.035, 0.06) * (1.0 - l));
      c *= 1.0 - smoothstep(0.14, 0.7, r2) * 0.5;
      c += (rnd(gl_FragCoord.xy + fract(time) * 917.0) - 0.5) * grain;
      gl_FragColor = vec4(c, 1.0); }`,
}

export class Posproceso {
  readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly final: ShaderPass
  private readonly fuerza: number
  constructor(renderer: THREE.WebGLRenderer, escena: THREE.Scene, camara: THREE.Camera, msaa: number) {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa })
    this.composer = new EffectComposer(renderer, rt)
    this.composer.addPass(new RenderPass(escena, camara))
    this.fuerza = 0.62
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), this.fuerza, 0.62, 1.0)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.final = new ShaderPass(FINAL_SHADER); this.composer.addPass(this.final)
  }
  /** Intensidad de efectos (0..1,5): brillo, grano y aberración. */
  setIntensidad(k: number) { this.bloom.strength = this.fuerza * (0.35 + 0.65 * k); this.final.uniforms.grain.value = 0.028 * k; this.final.uniforms.aberracion.value = k }
  setTamano(w: number, h: number, pr: number) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h) }
  render(dt: number, t: number) { this.final.uniforms.time.value = t; this.composer.render(dt) }
  dispose() { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); this.bloom.dispose(); this.composer.dispose() }
}
