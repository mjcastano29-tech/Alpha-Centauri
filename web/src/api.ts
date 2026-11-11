// Cliente tipado de la API (api/main.py). Python es la autoridad: aquí no hay reglas ni física.
export const API = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000').replace(/\/$/, '')

export interface Resultados { [resultado: string]: number }
export interface Evaluacion {
  episodios: number
  aterrizajes: number
  velocidad_contacto: number | null
  error_posicion: number
  combustible: number
  resultados: Resultados
}
export interface Obstaculo { tipo?: 'torre' | 'pasarela'; nombre: string; x: number; y: number; radio: number; altura: number; radio_abertura?: number; grosor?: number }
export interface Ambiente {
  id: string; version: string; nivel: string; obstaculos: Obstaculo[]
  resumen?: string; novedad?: string; ficha?: string | null; observacion?: number; accion?: number; resultados?: string[]
  viento_max?: number | null; rafagas?: number | null; pasos?: number; altitud_salida?: number; radio_plataforma?: number; familia?: string; vigente?: boolean
}
export interface Experimento { id: string; numero: number; titulo: string; nivel: string; ambiente: string; pregunta: string; variables: string }
export interface Resumen {
  run_id: string
  experimento: string | null
  nivel: string
  ambiente_id: string
  obstaculos: Obstaculo[]
  agente: { clase: string; nombre: string | null; accion: string | null; red: string | null }
  ambiente: string
  ambiente_version: string
  fecha: string
  git: { commit: string | null; branch: string | null; cambios_sin_commit: boolean }
  config: Record<string, unknown>
  epocas: number | null
  primer_aterrizaje: number | null
  mejor_epoca: number | null
  evaluacion: Evaluacion
  perturbado: { viento: number; aterrizajes: number; velocidad_contacto: number | null; error_posicion: number; resultados: Resultados } | null
  sha256: { config: string; archivos: Record<string, string> } | null
  mlflow: { modelo: string; version: number; run_uuid?: string; experimento_id?: string; url?: string | null } | null
  mlflow_ui: string | null
  diseno: Diseno | null
  manifiesto: string | null
  checkpoint: boolean
  estado: 'recomendado' | 'anterior' | 'historico'
}
/** Diseño experimental de la configuración (configs/<run_id>.json): qué se probó y qué se decidió. */
export interface Diseno {
  hipotesis: string | null
  cambio: string | null
  baseline: string | null
  comparacion_principal?: string | null
  presupuesto: Record<string, string | number> | null
  suite: string | null
  estado: 'seleccionado' | 'rechazado' | 'referencia' | string | null
  decision: string | null
  fecha_decision: string | null
}
export interface Suite {
  id: string
  descripcion: string
  episodios: number
  semilla_base: number | string
  condiciones: { id: string; viento: number | null; descripcion?: string }[]
}
export interface Catalogo {
  catalogo: {
    version: number
    actualizado: string | null
    recomendado: string | null
    anterior: string | null
    niveles: Record<string, { recomendado: string | null; anterior: string | null }>
    historial: { version: number; fecha: string; accion: string; nivel?: string; run_id: string; motivo: string; commit_base: string | null }[]
  }
  ejecuciones: Resumen[]
  outcomes: string[]
  rewards: Record<string, number>
  ambientes: Ambiente[]
  experimentos?: Experimento[]
}
export interface Detalle extends Resumen {
  manifest: Record<string, unknown> & { resultado: { evaluacion: { outcomes: Resultados } } }
  curva: { x: number[]; recompensa: number[]; aterrizajes: number[]; tramo: number }
  checks: { epoch: number[]; landings: number[] }
  check_episodes: number
}
export interface Vuelo {
  agent: string
  epoch: number | null
  epoca_evaluacion?: number
  reason: string
  steps: number
  reward: number
  duration: number
  landed: boolean
  f: Record<'t' | 'x' | 'y' | 'z' | 'vx' | 'vy' | 'vz' | 'wx' | 'wy' | 'wz' | 'wh' | 'air_t' | 'p' | 'eng_t' | 'fuel' | 'on' | 'thr' | 'dx' | 'dy' | 'dz', number[]>
  step_marks: { i: number; label: string; r: number }[]
}
export interface Version {
  api: string
  commit: string | null
  arranque: string
  ambiente: { id: string; version: string }
  ambientes: Ambiente[]
  mlflow_ui: string | null
  suites: string[]
  catalogo: { version: number; actualizado: string | null; recomendado: string | null; anterior: string | null }
  modelos_cargados: string[]
  software: Record<string, string>
}
export interface ResultadoEvaluacion {
  modo: 'evaluacion'
  modelo: { run_id: string; agente: string | null; accion: string | null; commit: string | null; sha256: Record<string, string> | null; mlflow: { modelo: string; version: number } | null }
  ambiente: Ambiente & { entrenado_en: string; entrenado_con: string; nivel_entrenado?: string; compatible: boolean; adaptador: boolean; misma_familia?: boolean }
  suite: { id: string | null; condicion: string | null; episodios: number; semilla_base: number; viento: number | null; deterministico: boolean }
  resumen: Evaluacion
  episodios: { epoca: number; semilla: number; resultado: string; recompensa: number; pasos: number; duracion_s: number; vz: number; vh: number; distancia: number; inclinacion: number; combustible: number; viento: number; toca_suelo: boolean }[]
  vuelos: Vuelo[]
  latencia: { total_ms: number; por_paso_ms: number; pasos: number }
  servido_por: { api: string; commit: string | null }
}

export interface ResumenSuite { episodios: number; aterrizajes: number; velocidad_contacto: number | null; error_posicion: number; combustible: number; resultados: Resultados }
export interface MedidaIncidente {
  run_id: string
  fecha: string
  suite: string
  episodios: number
  viento: number
  entrenado_en: string
  nivel_entrenado: string
  ambiente: { id: string; version: string; nivel: string; viento_max: number; rafagas: number }
  adaptador: boolean
  estado: string
  antes: { normal: ResumenSuite; perturbado: ResumenSuite }
  despues: { normal: ResumenSuite; perturbado: ResumenSuite }
}
export interface Incidentes {
  medidas: MedidaIncidente[]
  intervenciones: Record<string, Pick<Resumen, 'run_id' | 'evaluacion' | 'perturbado' | 'diseno' | 'estado' | 'mlflow'>[]>
  outcomes: string[]
}
export class ErrorApi extends Error {
  status: number
  constructor(status: number, mensaje: string) { super(mensaje); this.status = status }
}

async function leer<T>(respuesta: Response): Promise<T> {
  if (!respuesta.ok) {
    let detalle = respuesta.statusText
    try { detalle = (await respuesta.json()).detail ?? detalle } catch { /* sin cuerpo JSON */ }
    throw new ErrorApi(respuesta.status, `${respuesta.status}: ${detalle}`)
  }
  return respuesta.json() as Promise<T>
}

export const get = <T>(ruta: string) => fetch(API + ruta).then((r) => leer<T>(r))
export const post = <T>(ruta: string, cuerpo: unknown) =>
  fetch(API + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }).then((r) => leer<T>(r))

export const version = () => get<Version>('/version')
export const catalogo = () => get<Catalogo>('/catalogo')
export const ejecucion = (id: string) => get<Detalle>(`/ejecuciones/${encodeURIComponent(id)}`)
export const vuelos = (id: string) => get<{ episodes: Vuelo[] }>(`/ejecuciones/${encodeURIComponent(id)}/vuelos`)
export const comparar = (ids: string[]) => get<{ ejecuciones: Resumen[] }>(`/comparar?runs=${encodeURIComponent(ids.join(','))}`)
export const incidentes = () => get<Incidentes>('/incidentes')
export interface Monitoreo {
  servicio: { api: string; commit: string | null; arranque: string; uptime_s: number; python: string; modelos_cargados: string[]; evaluaciones_servidas: number; max_episodios: number; mlflow_ui: string | null; versiones_mlflow: number; ambientes_vigentes: Record<string, string> }
  catalogo: { version: number; actualizado: string | null; historial: { version: number; fecha: string; accion: string; nivel?: string; run_id: string; motivo: string; commit_base: string | null }[] }
  niveles: { nivel: string; ambiente_vigente: string | null; recomendado: string | null; anterior: string | null; ambiente_modelo?: string; aterrizajes?: number; aterrizajes_viento?: number | null; colisiones?: number; velocidad_contacto?: number | null; cambios_sin_commit?: boolean; commit?: string | null; mlflow?: { modelo: string; version: number; url?: string | null } | null; fecha?: string; modelo_cargado?: boolean }[]
  pipeline: { archivo: string; tipo: string; run_id?: string | null; ambiente?: string | null; inicio?: string; duracion_s?: number; estado?: string; etapas_completadas?: number; decision?: string | null; aceptado?: boolean | null; commit?: string | null; comprobacion?: string | null; aterrizajes?: number | null; fecha?: string | null; ok?: boolean | null; nivel?: string | null; recomendado?: string | null }[]
  evaluaciones: { fecha: string; run_id: string; ambiente: string; nivel: string; episodios: number; aterrizajes: number; total_ms: number; por_paso_ms: number; adaptador: boolean; suite: string | null }[]
  resumen: { ejecuciones: number; con_cambios_sin_commit: string[]; incidentes: number; evidencias_pipeline: number }
  alertas: { nivel: string | null; tipo: string; texto: string }[]
}
export const monitoreo = () => get<Monitoreo>('/monitoreo')
export const suites = () => get<{ suites: Record<string, Suite>; maximo_por_peticion: number }>('/suites')
export const urlManifiesto = (id: string) => `${API}/ejecuciones/${encodeURIComponent(id)}/manifiesto`
/** Misión en vivo: la API simula paso a paso con el modelo congelado; el viento se cambia entre pasos. */
export interface SesionVivo {
  sesion: string; modo: string; semilla: number; caduca_s: number
  modelo: { run_id: string; agente: string | null; accion: string | null; commit: string | null; mlflow: { modelo: string; version: number; url?: string | null } | null }
  ambiente: Ambiente & { entrenado_en: string; adaptador: boolean }
  viento: { velocidad: number; direccion_grados: number }
  vuelo: Vuelo
}
export interface PasoVivo {
  paso: number; f: Vuelo['f']; marca: { i: number; label: string; r: number }; recompensa: number; acumulada: number
  terminado: boolean; truncado: boolean; fin: boolean; resultado: string | null; viento: { velocidad: number; direccion_grados: number }; latencia_ms: number
  resumen: { reason: string; steps: number; reward: number; duration: number; landed: boolean; final_dist?: number; fuel_used?: number } | null
}
export const crearSesion = (peticion: { run_id: string; ambiente?: string | null; semilla?: number; viento?: number | null }) => post<SesionVivo>('/sesiones', peticion)
export const pasoSesion = (sesion: string, cuerpo: { viento?: number | null; direccion_grados?: number | null }) => post<PasoVivo>(`/sesiones/${encodeURIComponent(sesion)}/paso`, cuerpo)
export const cerrarSesion = (sesion: string) => fetch(`${API}/sesiones/${encodeURIComponent(sesion)}`, { method: 'DELETE' }).catch(() => null)
export const evaluar = (peticion: { run_id: string; episodios: number; viento?: number | null; semilla_base?: number; grabar?: number; suite?: string | null; condicion?: string; ambiente?: string | null }) =>
  post<ResultadoEvaluacion>('/evaluar', peticion)
