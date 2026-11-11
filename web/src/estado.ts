// Estado compartido entre vistas durante la sesión: el catálogo (se pide una vez) y la última evaluación en vivo.
import * as api from './api'
import type { Catalogo, ResultadoEvaluacion, SesionVivo } from './api'

let catalogoCache: Catalogo | null = null
export async function cargarCatalogo() {
  catalogoCache ??= await api.catalogo()
  return catalogoCache
}
/** Última evaluación ejecutada en vivo, para poder reproducir sus vuelos. */
export const sesion: { ultimaEvaluacion: ResultadoEvaluacion | null; vivo: SesionVivo | null } = { ultimaEvaluacion: null, vivo: null }
