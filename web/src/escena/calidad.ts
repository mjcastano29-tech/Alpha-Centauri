// Niveles de calidad gráfica. "Alta": sombras de 2048, posproceso con MSAA y toda la flora; "media": resolución y sombras
// reducidas y el 60 % de la flora; "baja": sin sombras ni posproceso, un tercio de la flora y nubes más simples (sigue
// viéndose el planeta entero: el brillo de los halos aditivos sustituye al bloom).
import type * as THREE from 'three'

export type NivelCalidad = 'alta' | 'media' | 'baja'
export interface Preset { pixelRatio: number; sombras: number; composer: boolean; msaa: number; flora: number; particulas: number; nubes: number; focos: boolean }
export const PRESETS: Record<NivelCalidad, Preset> = {
  alta: { pixelRatio: 2, sombras: 2048, composer: true, msaa: 4, flora: 1, particulas: 1, nubes: 5, focos: true },
  media: { pixelRatio: 1.25, sombras: 1024, composer: true, msaa: 2, flora: 0.6, particulas: 0.65, nubes: 4, focos: true },
  baja: { pixelRatio: 1, sombras: 0, composer: false, msaa: 0, flora: 0.33, particulas: 0.4, nubes: 3, focos: false },
}
export const NIVELES: NivelCalidad[] = ['alta', 'media', 'baja']

/** Primera estimación por el tipo de GPU y de equipo; después el reproductor baja de nivel si no llega a ~26 fps. */
export function calidadSugerida(renderer: THREE.WebGLRenderer): NivelCalidad {
  let gpu = ''
  try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase() : '' } catch { /* sin información de la GPU */ }
  const movil = /android|iphone|ipad|mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu) || movil) return 'baja'
  if (/intel|mali|adreno|powervr|apple gpu/.test(gpu) || (navigator.hardwareConcurrency ?? 8) <= 4) return 'media'
  return 'alta'
}
const CLAVE = 'elyndra.calidad'
/** Preferencia del visitante (solo en su navegador): "auto" o un nivel fijo. Si el almacenamiento falla, "auto". */
export function preferenciaCalidad(): NivelCalidad | 'auto' {
  try { const v = localStorage.getItem(CLAVE); return v === 'alta' || v === 'media' || v === 'baja' ? v : 'auto' } catch { return 'auto' }
}
export function guardarPreferenciaCalidad(v: NivelCalidad | 'auto') { try { localStorage.setItem(CLAVE, v) } catch { /* modo privado o almacenamiento bloqueado */ } }
