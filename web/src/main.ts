// Aplicación web de Alpha Centauri: catálogo de experimentos, modelos históricos, evaluación en vivo y replay 3D.
// Rutas por hash: #/ · #/ejecucion/<id> · #/comparar/<a,b> · #/replay/<id> · #/replay/<id>/evaluacion
import './estilos.css'
import * as api from './api'
import { corto, esc } from './ui'
import { vistaCatalogo, vistaComparar, vistaEjecucion, vistaReplay } from './vistas'

const app = document.querySelector<HTMLElement>('#app')!
const cabecera = document.querySelector<HTMLElement>('#estado-api')!
let limpiar: (() => void) | null = null

async function estadoApi() {
  try {
    const v = await api.version()
    cabecera.innerHTML = `<span class="ok">API conectada</span> · commit <code>${corto(v.commit)}</code> · catálogo v${v.catalogo.version} · recomendado <b>${esc(v.catalogo.recomendado ?? '—')}</b> · ambiente ${esc(v.ambiente.id)} v${esc(v.ambiente.version)} · <a href="${esc(api.API)}/docs" target="_blank" rel="noopener">docs de la API</a>`
  } catch (e) {
    cabecera.innerHTML = `<span class="error">Sin conexión con la API en <code>${esc(api.API)}</code></span> · ${esc((e as Error).message)} · configura <code>VITE_API_BASE_URL</code>`
  }
}

async function enrutar() {
  limpiar?.(); limpiar = null
  const ruta = location.hash.replace(/^#\/?/, '')
  const partes = ruta.split('/').map(decodeURIComponent)
  app.innerHTML = '<p class="estado">Cargando…</p>'
  try {
    if (!ruta) await vistaCatalogo(app)
    else if (partes[0] === 'ejecucion' && partes[1]) await vistaEjecucion(app, partes[1])
    else if (partes[0] === 'comparar' && partes[1]) await vistaComparar(app, partes[1].split(','))
    else if (partes[0] === 'replay' && partes[1]) limpiar = await vistaReplay(app, partes[1], partes[2] === 'evaluacion' ? 'evaluacion' : 'grabados')
    else app.innerHTML = `<p class="error">Ruta desconocida: ${esc(ruta)}</p><p><a href="#/">Ir al catálogo</a></p>`
  } catch (e) {
    const err = e as api.ErrorApi
    const quien = !ruta ? 'No se pudo cargar el catálogo desde la API (revisa VITE_API_BASE_URL).' : err.status === 404 ? 'No existe.' : 'Error de la API.'
    app.innerHTML = `<p class="error">${quien} ${esc(err.message)}</p><p><a href="#/">Volver al catálogo</a></p>`
  }
  window.scrollTo(0, 0)
}

window.addEventListener('hashchange', enrutar)
estadoApi()
enrutar()
