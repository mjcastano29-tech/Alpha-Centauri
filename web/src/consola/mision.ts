// Lógica de la misión que muestra la consola, derivada solo de la trayectoria grabada: fase del vuelo, medidas en cada
// muestra, criterios de aterrizaje y resumen final. El resultado (éxito o fallo) es siempre el que grabó el ambiente.
import type { Vuelo } from '../api'

/** Límites de aterrizaje del ambiente (MAX_LANDING_* en rocket_env/rocket_landing.py); el radio de la plataforma viene de la API. */
export const CRITERIO = { vertical: 3, horizontal: 2, inclinacion: 10 }
export const MOTOR_T_MAX = 900 // K: el motor se apaga al superarla (MAX_ENGINE_TEMP)
/** Umbrales de fase (m): por debajo de 80 m el replay entra en cámara lenta; los últimos 20 m son el último paso del agente (STEP_ALTITUDE). */
export const UMBRAL = { aproximacion: 80, aterrizaje: 20 }

export type Fase = 'preparando' | 'ascenso' | 'descenso' | 'aproximacion' | 'aterrizaje' | 'completada' | 'fallida'
export const TEXTO_FASE: Record<Fase, string> = {
  preparando: 'Preparando misión', ascenso: 'Ascenso', descenso: 'Descenso', aproximacion: 'Aproximación', aterrizaje: 'Aterrizaje', completada: 'Misión completada', fallida: 'Misión fallida',
}
export function faseMision(v: Vuelo, i: number): Fase {
  const n = v.f.t.length
  if (i >= n - 1) return v.reason === 'aterrizaje' ? 'completada' : 'fallida'
  if (i === 0) return 'preparando'
  if (v.f.vz[i] > 0.5) return 'ascenso'
  if (v.f.z[i] <= UMBRAL.aterrizaje) return 'aterrizaje'
  if (v.f.z[i] <= UMBRAL.aproximacion) return 'aproximacion'
  return 'descenso'
}

export interface Medida { z: number; vz: number; vh: number; incl: number; dist: number }
/** Medidas exactas de una muestra (sin interpolar), con las mismas fórmulas que el ambiente. */
export function medir(f: Vuelo['f'], i: number): Medida {
  return {
    z: f.z[i], vz: f.vz[i], vh: Math.hypot(f.vx[i], f.vy[i]), dist: Math.hypot(f.x[i], f.y[i]),
    incl: (Math.acos(Math.max(-1, Math.min(1, f.dz[i]))) * 180) / Math.PI,
  }
}

/** cumple: dentro del límite · precaución: fuera del límite en vuelo (aún no se juzga) · falla: incumplido al tocar suelo ·
 *  neutral: el vuelo terminó sin tocar suelo y el ambiente no llegó a juzgarlo. */
export type EstadoCriterio = 'cumple' | 'precaucion' | 'falla' | 'neutral'
export interface Criterio { id: string; nombre: string; valor: number; unidad: string; limite: string; ok: boolean; estado: EstadoCriterio }
export function criterios(m: Medida, radio: number, fin: boolean, contacto: boolean): Criterio[] {
  const c = (id: string, nombre: string, valor: number, unidad: string, limite: string, ok: boolean): Criterio =>
    ({ id, nombre, valor, unidad, limite, ok, estado: ok ? 'cumple' : !fin ? 'precaucion' : contacto ? 'falla' : 'neutral' })
  return [
    c('vz', 'Velocidad vertical', Math.abs(m.vz), 'm/s', `≤ ${CRITERIO.vertical} m/s`, Math.abs(m.vz) <= CRITERIO.vertical),
    c('vh', 'Velocidad horizontal', m.vh, 'm/s', `≤ ${CRITERIO.horizontal} m/s`, m.vh <= CRITERIO.horizontal),
    c('incl', 'Inclinación', m.incl, '°', `≤ ${CRITERIO.inclinacion}°`, m.incl <= CRITERIO.inclinacion),
    c('dist', 'Distancia al centro', m.dist, 'm', `≤ ${radio} m`, m.dist <= radio),
  ]
}

/** Resumen del final del vuelo para la pantalla de misión: medidas en el último fotograma y el resultado del ambiente. */
export function resumenMision(v: Vuelo, radio: number) {
  const f = v.f, i = f.t.length - 1, m = medir(f, i), contacto = f.z[i] <= 0.5
  const lista = criterios(m, radio, true, contacto)
  return {
    exito: v.reason === 'aterrizaje', resultado: v.reason, contacto, medida: m, criterios: lista, cumplidos: lista.filter((c) => c.ok).length,
    combustible: f.fuel[i], usado: f.fuel[0] - f.fuel[i], duracion: f.t[i], recompensa: v.reward, pasos: v.steps,
  }
}
