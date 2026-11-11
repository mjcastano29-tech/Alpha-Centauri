// Atmósfera de Elyndra: dirección de los dos soles de Alfa Centauri, niebla por altura (más densa en los valles, se aclara
// con la altitud y se tiñe de rosa hacia el sol) y esporas suspendidas que el viento grabado arrastra.
// La niebla sustituye a los fragmentos de niebla de three.js, así la aplican todos los materiales estándar.
import * as THREE from 'three'
import { glsl, glslV, mulberry32 } from './ruido'

export const SOL_A = new THREE.Vector3(-0.84, 0.25, 0.48).normalize() // Alfa Centauri A, baja: atardecer largo
export const SOL_B = new THREE.Vector3(0.62, 0.3, -0.72).normalize() // Alfa Centauri B, más lejana y anaranjada
export const NIEBLA = { lejos: 0x474c82, sol: 0xb47c9c, halo: 0xffc49a, densidad: 0.0003, caida: 0.0012 }

/** Color de la bruma en una dirección y espesor óptico de la niebla por altura (integral analítica a lo largo del rayo). */
export const GLSL_NIEBLA = `
  const vec3 ELY_SOL = ${glslV(SOL_A)};
  vec3 elyColorNiebla(vec3 rd){
    float s = max(dot(rd, ELY_SOL), 0.0);
    vec3 c = mix(${glsl(NIEBLA.lejos)}, ${glsl(NIEBLA.sol)}, pow(s, 4.0));
    return c + ${glsl(NIEBLA.halo)} * pow(s, 28.0) * 0.6;
  }
  float elyNiebla(vec3 ro, vec3 rd, float dist, float dens){
    float b = ${NIEBLA.caida.toFixed(6)};
    float k = rd.y * b;
    float f = abs(k) < 1e-6 ? dist : (1.0 - exp(-dist * k)) / k;
    return 1.0 - exp(-dens * exp(-max(ro.y, 0.0) * b) * f);
  }
`
let parcheado = false
/** Una sola vez por sesión: los materiales se compilan después, ya con la niebla de Elyndra. */
export function parchearNiebla() {
  if (parcheado) return
  parcheado = true
  const C = THREE.ShaderChunk as Record<string, string>
  C.fog_pars_vertex = '#ifdef USE_FOG\n varying vec3 vElyRayo;\n#endif'
  C.fog_vertex = '#ifdef USE_FOG\n vElyRayo = mvPosition.xyz * mat3( viewMatrix );\n#endif' // rayo cámara → punto en el mundo
  C.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor;
    varying vec3 vElyRayo;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #else
      uniform float fogNear; uniform float fogFar;
    #endif
    ${GLSL_NIEBLA}
  #endif`
  C.fog_fragment = `#ifdef USE_FOG
    #ifdef FOG_EXP2
      float elyD = fogDensity;
    #else
      float elyD = 0.0003;
    #endif
    float elyDist = length(vElyRayo);
    vec3 elyDir = vElyRayo / max(elyDist, 1e-3);
    vec3 elyC = elyColorNiebla(elyDir);
    #ifdef TONE_MAPPING
      elyC = toneMapping(elyC);
    #endif
    elyC = linearToOutputTexel(vec4(elyC, 1.0)).rgb;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, elyC, elyNiebla(cameraPosition, elyDir, elyDist, elyD));
  #endif`
}

/** Esporas y plancton aéreo alrededor de la cámara: dan profundidad y escala. Las mueve el viento del vuelo y
 *  el chorro del motor las aparta. Todo el movimiento ocurre en la GPU. */
export class Esporas {
  readonly points: THREE.Points
  readonly material: THREE.ShaderMaterial
  private readonly n: number
  private readonly deriva = new THREE.Vector3()
  constructor(n: number, uTime: { value: number }, uBlast: { value: THREE.Vector4 }) {
    this.n = n
    const rnd = mulberry32(5150), semilla = new Float32Array(n * 3), fase = new Float32Array(n)
    for (let i = 0; i < n; i++) { semilla.set([rnd(), rnd(), rnd()], i * 3); fase[i] = rnd() }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    geo.setAttribute('semilla', new THREE.BufferAttribute(semilla, 3)); geo.setAttribute('fase', new THREE.BufferAttribute(fase, 1))
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime, uBlast, uCam: { value: new THREE.Vector3() }, uDeriva: { value: this.deriva }, uCaja: { value: 260 }, uEscala: { value: 500 }, uOpacidad: { value: 1 } },
      vertexShader: `attribute vec3 semilla; attribute float fase;
        uniform float uTime, uCaja, uEscala; uniform vec3 uCam, uDeriva; uniform vec4 uBlast;
        varying float vA; varying float vTono;
        void main(){
          vec3 p = semilla * uCaja + uDeriva + vec3(sin(uTime * 0.31 + fase * 6.28) * 2.5, sin(uTime * 0.23 + fase * 4.1) * 1.6, cos(uTime * 0.27 + fase * 5.3) * 2.5);
          p = mod(p - uCam + uCaja * 0.5, uCaja) - uCaja * 0.5 + uCam;
          p.y = max(p.y, 0.6);
          vec3 aw = p - uBlast.xyz; float d = length(aw);
          p += aw / max(d, 0.01) * uBlast.w * 28.0 * exp(-d / 40.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          vA = smoothstep(uCaja * 0.5, uCaja * 0.32, length(p - uCam)) * smoothstep(0.8, 5.0, dist) * (0.55 + 0.45 * sin(uTime * 1.7 + fase * 31.0));
          vTono = fase;
          gl_PointSize = clamp((0.18 + fase * 0.32) * uEscala / dist, 1.0, 7.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform float uOpacidad; varying float vA; varying float vTono;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c) * 4.0; if (d > 1.0) discard;
          vec3 col = vTono < 0.6 ? vec3(0.32, 0.95, 0.88) : vTono < 0.93 ? vec3(0.72, 0.52, 1.0) : vec3(0.9, 0.95, 1.0);
          gl_FragColor = vec4(col * 1.3, vA * (1.0 - d) * uOpacidad * 0.5);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    this.points = new THREE.Points(geo, this.material)
    this.points.frustumCulled = false
  }
  setCantidad(k: number) { this.points.geometry.setDrawRange(0, Math.floor(this.n * k)) }
  setEscala(pixelesPorRadian: number) { this.material.uniforms.uEscala.value = pixelesPorRadian }
  actualizar(dt: number, camara: THREE.Vector3, wx: number, wy: number, wz: number) {
    this.deriva.x += wx * dt * 0.35; this.deriva.y += wy * dt * 0.35; this.deriva.z += wz * dt * 0.35
    this.material.uniforms.uCam.value.copy(camara)
  }
}
