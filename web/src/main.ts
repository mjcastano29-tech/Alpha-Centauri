// PROJECT ELYNDRA (Alpha Centauri · Rocket Landing): catálogo de experimentos, modelos históricos, evaluación en vivo y replay 3D.
// Rutas por hash: #/ (cohete) · #/inicio/<experimento>[/<run>] · #/catalogo · #/experimentos[/<id>] · #/ejecucion/<id> · #/comparar/<a,b> · #/replay/<id> · #/replay/<id>/evaluacion · #/incidente
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './estilos.css'
import * as api from './api'
import { corto, esc } from './ui'
import { vistaCatalogo, vistaComparar, vistaEjecucion, vistaExperimentos, vistaIncidente, vistaInicio, vistaMonitoreo, vistaReplay } from './vistas'

const app = document.querySelector<HTMLElement>('#app')!
const estadoApiEl = document.querySelector<HTMLDetailsElement>('#estado-api')!
let limpiar: (() => void) | null = null

/** Indicador de conexión de la cabecera; al desplegarlo muestra commit, catálogo, recomendado y ambientes que sirve la API. */
async function estadoApi() {
  const resumen = estadoApiEl.querySelector('summary span')!, cuerpo = estadoApiEl.querySelector<HTMLElement>('.estado-api-cuerpo')!
  try {
    const v = await api.version()
    estadoApiEl.classList.add('ok')
    resumen.textContent = `API conectada · catálogo v${v.catalogo.version}`
    cuerpo.innerHTML = `<dl>
        <dt>Estado</dt><dd><span class="ok">API conectada</span></dd>
        <dt>Commit</dt><dd><code>${corto(v.commit)}</code></dd>
        <dt>Catálogo</dt><dd>v${v.catalogo.version}</dd>
        <dt>Recomendado</dt><dd><b>${esc(v.catalogo.recomendado ?? '—')}</b></dd>
        <dt>Ambientes</dt><dd>${v.ambientes.map((a) => `${esc(a.nivel)} ${esc(a.id)} v${esc(a.version)}`).join('<br>')}</dd>
      </dl>
      <p><a href="${esc(api.API)}/docs" target="_blank" rel="noopener">Documentación de la API →</a></p>`
  } catch (e) {
    estadoApiEl.classList.add('error')
    resumen.textContent = 'Sin conexión con la API'
    cuerpo.innerHTML = `<p class="error">Sin conexión con la API en <code>${esc(api.API)}</code></p><p>${esc((e as Error).message)} · configura <code>VITE_API_BASE_URL</code></p>`
  }
}
document.addEventListener('click', (e) => { if (estadoApiEl.open && !estadoApiEl.contains(e.target as Node)) estadoApiEl.open = false })

async function enrutar() {
  limpiar?.(); limpiar = null
  estadoApiEl.open = false
  const ruta = location.hash.replace(/^#\/?/, '')
  const partes = ruta.split('/').map(decodeURIComponent)
  const seccion = !ruta || ['inicio', 'replay'].includes(partes[0]) ? '#/' : ['ejecucion', 'comparar'].includes(partes[0]) ? '#/catalogo' : `#/${partes[0]}`
  document.querySelectorAll<HTMLAnchorElement>('.nav a').forEach((a) => { if (a.getAttribute('href') === seccion) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current') })
  app.innerHTML = '<p class="estado">Cargando…</p>'
  try {
    if (!ruta) limpiar = await vistaInicio(app)
    else if (partes[0] === 'inicio') limpiar = await vistaInicio(app, partes[1], partes[2])
    else if (partes[0] === 'catalogo') await vistaCatalogo(app)
    else if (partes[0] === 'ejecucion' && partes[1]) await vistaEjecucion(app, partes[1])
    else if (partes[0] === 'comparar' && partes[1]) await vistaComparar(app, partes[1].split(','))
    else if (partes[0] === 'experimentos') await vistaExperimentos(app, partes[1])
    else if (partes[0] === 'incidente') await vistaIncidente(app)
    else if (partes[0] === 'monitoreo') limpiar = await vistaMonitoreo(app)
    else if (partes[0] === 'replay' && partes[1]) limpiar = await vistaReplay(app, partes[1], partes[2] === 'evaluacion' ? 'evaluacion' : 'grabados')
    else app.innerHTML = `<p class="error">Ruta desconocida: ${esc(ruta)}</p><p><a href="#/">Ir al inicio</a></p>`
  } catch (e) {
    const err = e as api.ErrorApi
    const quien = !ruta ? 'No se pudo cargar el catálogo desde la API (revisa VITE_API_BASE_URL).' : err.status === 404 ? 'No existe.' : 'Error de la API.'
    app.innerHTML = `<p class="error">${quien} ${esc(err.message)}</p><p><a href="#/">Volver al inicio</a></p>`
  }
  window.scrollTo(0, 0)
}

window.addEventListener('hashchange', enrutar)
estadoApi()
enrutar()
