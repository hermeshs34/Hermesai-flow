/**
 * screeningNucleo.ts — NUCLEO PURO del motor de screening difuso.
 *
 * POR QUE VIVE EN `supabase/functions/_shared/` Y NO EN `src/lib/services/`.
 * Porque es el unico sitio que alcanzan los dos. El CLI de Supabase empaqueta
 * la funcion siguiendo su grafo de imports y `_shared/` es la carpeta que TODAS
 * las funciones ya usan; un import a `src/` no tiene precedente en este repo y
 * solo se sabria si empaqueta o no el dia del despliegue. Al reves si funciona:
 * la app lo importa por ruta relativa y queda dentro de `tsc --noEmit`, de
 * vitest y del build de Vite, o sea que se verifica ANTES de desplegar. Es una
 * excepcion consciente a la estructura de CLAUDE.md 3.
 *
 * Sin imports, sin cliente de Supabase, sin DOM: solo texto y aritmetica. Eso
 * es deliberado, para que lo pueda importar TAL CUAL tanto la app (Vite) como
 * la Edge Function `sync-listas-restrictivas` (Deno), que es quien re-criba la
 * cartera cada lunes.
 *
 * POR QUE EXISTE ESTE FICHERO (12/09/2026). Habia DOS motores: este y una
 * copia a mano dentro de la Edge Function. El 12/09 se arreglo la formula de
 * `similitudNombres` en la app —medir tambien el lado LARGO del nombre— y la
 * copia del cron se quedo con la formula vieja, la que daba 100 a "Hermes
 * Sanchez" contra la entrada OFAC "HERMES". Resultado medido en la cola: el
 * lunes siguiente el cron reescribia con la formula vieja lo que la app habia
 * corregido. Una sola fuente, importada por los dos, es la unica forma de que
 * no vuelva a separarse; `src/tests/services/screeningMotorUnico.test.ts` lo
 * vigila leyendo el fichero de la Edge Function.
 *
 * Los 28 tests de `screeningSimilitud.test.ts` cubren este fichero y, por
 * tanto, cubren tambien al cron.
 */

// ── Tipos ───────────────────────────────────────────────────────────────────

export type BandaScreening = 'alta' | 'media' | 'baja'
export type MetodoScreening = 'documento' | 'nombre_fuzzy'

export interface CandidatoLista {
  id: string
  tipo_lista: string
  nombre: string
  documento: string | null
  pais: string | null
  motivo: string | null
  /** individual | entidad | buque | aeronave. NULL si la fuente no lo dice. */
  tipo_entidad: string | null
  sim_trgm: number
  doc_exacto: boolean
}

export interface CoincidenciaScreening {
  lista_id: string
  lista_tipo: string
  lista_nombre: string
  lista_documento: string | null
  lista_pais: string | null
  lista_motivo: string | null
  /**
   * Que es la entrada: persona, entidad, buque o aeronave. SE MUESTRA, NO SE
   * FILTRA — en AML el error caro es el falso negativo, y del sujeto de un
   * `caso` o un `ros` no sabemos con certeza si es natural o juridico.
   */
  lista_tipo_entidad: string | null
  score: number // 0–100
  banda: BandaScreening
  metodo: MetodoScreening
}

// ── Umbrales / bandas (configurables a futuro vía parametros_aml) ────────────

/** Similitud trigram mínima para que la BD considere un candidato (0–1). */
export const UMBRAL_TRGM = 0.3
/** Score mínimo (0–100) para reportar una coincidencia por nombre. */
export const SCORE_MINIMO = 60
/** Documento exacto => certeza máxima. */
export const SCORE_DOCUMENTO = 100

/** Score (0–100) desde el que una coincidencia es de banda alta. */
export const SCORE_BANDA_ALTA = 85

/** Bandas de revisión por score (0–100). */
export function bandaPorScore(score: number): BandaScreening {
  if (score >= SCORE_BANDA_ALTA) return 'alta'
  if (score >= 72) return 'media'
  return 'baja'
}

// ── Normalización ────────────────────────────────────────────────────────────

const RE_ACENTOS = new RegExp('[\\u0300-\\u036f]', 'g')

/**
 * Siglas punteadas: dos o mas letras sueltas con punto. "c.a." -> "ca",
 * "s.a. de c.v." -> "sa de cv". Se aplica ANTES de barrer la puntuacion,
 * porque despues "c.a." ya seria "c a": dos tokens de UNA letra que comparte
 * practicamente toda sociedad venezolana. Una inicial suelta ("Omar E. Bracho")
 * no entra aqui —hace falta una segunda letra punteada— y sigue siendo inicial.
 */
const RE_SIGLAS = /(?:\b[a-z]\.){2,}/g

/** minúsculas + sin acentos + espacios colapsados. */
export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(RE_ACENTOS, '')
    .toLowerCase()
    .replace(RE_SIGLAS, m => m.replace(/\./g, ''))
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Clave ESTABLE de una entrada de lista, para recordar una decision humana.
 *
 * No se puede usar el `id`: el sincronizador semanal BORRA la lista entera y la
 * reinserta (`sync-listas-restrictivas` hace `delete().eq('tipo_lista','OFAC')`
 * y luego `insert`), asi que cada entrada renace con otro UUID y el `lista_id`
 * de la decision vieja se queda en NULL por el `ON DELETE SET NULL`. Medido el
 * 12/09/2026 sobre la cola real: el MISMO falso positivo contra la entrada OFAC
 * "HERMES" se habia descartado a mano CINCO veces —el 25/06, el 02/07, el
 * 14/07, el 21/07 y el 31/08— y el lunes siguiente reaparecia intacto. El
 * Oficial de Cumplimiento estaba trabajando gratis.
 *
 * El nombre de la entrada SI sobrevive: se copia dentro de cada fila de
 * `screening_coincidencias` (`lista_tipo`, `lista_nombre`), y por eso esta
 * clave funciona tambien hacia atras, sobre las decisiones ya tomadas.
 */
export function claveEntradaLista(tipo: string | null, nombre: string | null): string {
  return `${(tipo ?? '').trim().toUpperCase()}|${normalizarNombre(nombre ?? '')}`
}

/**
 * Formas juridicas. NO identifican a nadie: "C.A." va en el nombre de casi
 * toda sociedad venezolana y "S.A. de C.V." en casi toda mexicana. Medido el
 * 12/09/2026, dejarlas dentro subia "Inversiones Cardon C.A." contra
 * "CORPOMEDIOS GV INVERSIONES, C.A." de 40 a 90 y metia seis entidades
 * inocentes en la cola. Se descartan solo si queda algo detras: una razon
 * social que fuera unicamente su forma juridica se sigue comparando entera.
 */
const FORMAS_JURIDICAS = new Set([
  'ca', 'sa', 'cv', 'srl', 'sas', 'saica', 'ltda', 'ltd', 'llc', 'inc', 'corp',
  'co', 'sc', 'scs', 'eirl', 'gmbh', 'bv', 'nv', 'plc', 'spa', 'sl',
])

function tokens(s: string): string[] {
  const todos = [...new Set(normalizarNombre(s).split(' ').filter(t => t.length >= 1))]
  const utiles = todos.filter(t => !FORMAS_JURIDICAS.has(t))
  return utiles.length > 0 ? utiles : todos
}

// ── Jaro-Winkler ─────────────────────────────────────────────────────────────

/** Distancia Jaro (0–1). */
function jaro(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length
  const lb = b.length
  if (la === 0 || lb === 0) return 0

  const ventana = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aMatch = new Array<boolean>(la).fill(false)
  const bMatch = new Array<boolean>(lb).fill(false)

  let coincidencias = 0
  for (let i = 0; i < la; i++) {
    const desde = Math.max(0, i - ventana)
    const hasta = Math.min(i + ventana + 1, lb)
    for (let j = desde; j < hasta; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue
      aMatch[i] = true
      bMatch[j] = true
      coincidencias++
      break
    }
  }
  if (coincidencias === 0) return 0

  // transposiciones
  let transposiciones = 0
  let k = 0
  for (let i = 0; i < la; i++) {
    if (!aMatch[i]) continue
    while (!bMatch[k]) k++
    if (a[i] !== b[k]) transposiciones++
    k++
  }
  transposiciones /= 2

  const m = coincidencias
  return (m / la + m / lb + (m - transposiciones) / m) / 3
}

/** Jaro-Winkler (0–1): premia prefijos comunes (hasta 4 chars). */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b)
  if (j === 0) return 0
  let prefijo = 0
  const max = Math.min(4, a.length, b.length)
  while (prefijo < max && a[prefijo] === b[prefijo]) prefijo++
  return j + prefijo * 0.1 * (1 - j)
}

/** Un token se considera "fuertemente" coincidente a partir de este Jaro-Winkler. */
const UMBRAL_TOKEN_FUERTE = 0.9

/** Peso de una inicial que abre un token del otro nombre ("E." ~ "Enrique"). */
const SIM_INICIAL = 0.9

/**
 * Similitud entre DOS tokens. Una inicial casa con el token que empieza por
 * ella: en el padron venezolano "Omar E. Bracho Aguilar" y "Omar Enrique
 * Bracho" son la misma persona. Medido el 12/09/2026: descartando la inicial
 * ese par puntuaba 55, por DEBAJO de SCORE_MINIMO, o sea que no se reportaba.
 */
function similitudToken(a: string, b: string): number {
  if (a.length === 1 || b.length === 1) {
    if (a === b) return 1
    const [inicial, palabra] = a.length === 1 ? [a, b] : [b, a]
    return palabra.startsWith(inicial) ? SIM_INICIAL : 0
  }
  return jaroWinkler(a, b)
}

/** ¿`a` y `b` casan SOLO porque una inicial abre la otra palabra? ("e" ~ "enrique") */
function casaPorInicial(a: string, b: string): boolean {
  return (a.length === 1) !== (b.length === 1) && similitudToken(a, b) === SIM_INICIAL
}

/**
 * Promedio Monge-Elkan y cobertura de `desde` medidos contra `hacia`, y si
 * algun token de `desde` debe su mejor pareja a una inicial expandida.
 */
function ladoMongeElkan(
  desde: string[], hacia: string[],
): { promedio: number; cobertura: number; porInicial: boolean } {
  let suma = 0
  let fuertes = 0
  let porInicial = false
  for (const t of desde) {
    let mejor = 0
    let pareja = ''
    for (const u of hacia) {
      const s = similitudToken(t, u)
      if (s > mejor) { mejor = s; pareja = u }
      if (mejor === 1) break
    }
    suma += mejor
    if (mejor >= UMBRAL_TOKEN_FUERTE) fuertes++
    if (mejor < 1 && casaPorInicial(t, pareja)) porInicial = true
  }
  return { promedio: suma / desde.length, cobertura: fuertes / desde.length, porInicial }
}

/**
 * Techo (0-1) de un nombre que casa gracias a una inicial expandida: el punto
 * justo por debajo de SCORE_BANDA_ALTA, o sea el alto de la banda media.
 *
 * POR QUE (25/09/2026). El correo de Flujos de ese dia llevaba «Omar E. Bracho»
 * a 87 (alta) contra la entrada LOCAL «Omar Enrique Bracho Aguilar», y «José A.
 * Rodríguez» igual contra cualquier «José Antonio …», sin que casara el
 * documento. «E.» puede ser Enrique o Eduardo: la inicial basta para SOSPECHAR
 * (por eso SIM_INICIAL sigue en 0.9 y el par no cae bajo SCORE_MINIMO, que era
 * el falso negativo del 12/09), no para IDENTIFICAR. La banda alta queda para
 * nombres que casan palabra por palabra o para el documento exacto, que no
 * pasa por aqui (SCORE_DOCUMENTO en screenSujeto).
 *
 * La misma inicial en los dos lados no es expansion y no lleva techo: es el
 * nombre tal como lo publica la lista.
 */
const TECHO_CON_INICIAL = (SCORE_BANDA_ALTA - 1) / 100

/**
 * Suelo del factor que aporta el nombre LARGO. Con 0.6, un nombre largo cuyos
 * tokens sobrantes no casan con nada conserva el 60 % del score en vez de
 * desplomarse. El suelo NO es adorno: sin el, "PDVSA" contra "PDVSA PETROLEO
 * S.A." cae a 30 (media geometrica de los dos lados, medido el 12/09/2026) y
 * una entidad sancionada desaparece de la cola. En AML el error caro es el
 * falso NEGATIVO, asi que se penaliza el ruido sin llegar a perder el match.
 */
const PISO_COBERTURA_LARGO = 0.6

/**
 * Similitud entre nombres completos (0-1). Mira los DOS nombres, no solo el
 * corto:
 *   - lado corto: promedio Monge-Elkan × cobertura de sus tokens. Penaliza el
 *     falso positivo donde un apellido calza exacto y el resto solo se parece
 *     ("Hermes Sánchez" vs "Herrera Sánchez" → 36), sin castigar typos reales.
 *   - lado largo: cuánto del nombre MÁS LARGO queda sin casar, amortiguado por
 *     PISO_COBERTURA_LARGO.
 *
 * El segundo factor es el que faltaba. Sin él bastaba con que TODOS los tokens
 * del nombre corto aparecieran en el largo para dar 1.0 exacto, sin importar
 * cuánto del largo se ignoraba. Medido en la cola de Atlántida (Demo) el
 * 12/09/2026, con siete filas al 100 %: "Hermes Sanchez" vs "HERMES",
 * "Milagros Victoria Sosa Bracho" vs "VICTORIA" y "Jose Castillo" vs
 * "590211 CASTILLO CASTILLO Orlando Jose CASTILLO CASTILLO" marcaban todas 100,
 * igual que la coincidencia buena por documento, y el Oficial de Cumplimiento
 * no tenía por dónde priorizar. Con este factor bajan a 80, 70 y 80.
 */
export function similitudNombres(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.length === 0 || tb.length === 0) return 0

  const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  const desdeCorto = ladoMongeElkan(corto, largo)
  const desdeLargo = ladoMongeElkan(largo, corto)

  const base = desdeCorto.promedio * desdeCorto.cobertura
  const sim = base * (PISO_COBERTURA_LARGO + (1 - PISO_COBERTURA_LARGO) * desdeLargo.cobertura)
  return desdeCorto.porInicial || desdeLargo.porInicial ? Math.min(sim, TECHO_CON_INICIAL) : sim
}

// ── Memoria de las decisiones humanas (20260926) ─────────────────────────────

/**
 * Huella del CONTENIDO de una entrada de lista: tipo, nombre, documento, pais,
 * motivo y tipo de entidad, normalizados. Se guarda en cada fila de la cola
 * (`screening_coincidencias.lista_huella`) para saber si la entrada contra la
 * que se descarto sigue diciendo lo mismo.
 *
 * `claveEntradaLista` dice QUIEN es la entrada (sobrevive a la resincronizacion
 * que le cambia el id); la huella dice QUE dice. Si OFAC anade un documento o
 * cambia el programa, la clave es la misma y la huella no: el descarte deja de
 * suprimir y la coincidencia vuelve a la cola. `fecha_actualizacion` NO entra:
 * cambia en cada sincronizacion aunque la entrada sea identica.
 *
 * FNV-1a de 32 bits: sin imports, igual en la app y en el cron. No es criptografica
 * ni lo necesita — una colision solo haria que un descarte siguiera valiendo.
 */
export function huellaEntradaLista(c: {
  lista_tipo: string | null
  lista_nombre: string | null
  lista_documento: string | null
  lista_pais: string | null
  lista_motivo: string | null
  lista_tipo_entidad: string | null
}): string {
  const doc = (c.lista_documento ?? '').replace(/\s/g, '').toUpperCase()
  const texto = [
    claveEntradaLista(c.lista_tipo, c.lista_nombre),
    doc,
    (c.lista_pais ?? '').trim().toUpperCase(),
    normalizarNombre(c.lista_motivo ?? ''),
    (c.lista_tipo_entidad ?? '').trim().toLowerCase(),
  ].join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `v1:${(h >>> 0).toString(16).padStart(8, '0')}`
}

/** Una decision previa del MISMO sujeto, tal como la guarda la cola. */
export interface DecisionPrevia {
  lista_tipo: string | null
  lista_nombre: string | null
  /** NULL en las filas anteriores a 20260926: no se sabe que decia la entrada. */
  lista_huella: string | null
  estado: 'confirmada' | 'descartada'
  revisado_at: string | null
  created_at: string
}

/** Suma meses de calendario en UTC. Un dia de mas o de menos a fin de mes no cambia nada aqui. */
function sumarMeses(ms: number, meses: number): number {
  const d = new Date(ms)
  d.setUTCMonth(d.getUTCMonth() + meses)
  return d.getTime()
}

/**
 * Que coincidencias de un sujeto entran en la cola, dadas sus decisiones previas.
 * La usan la app (`screeningCola.registrar`) y el cron (`reScreenAll`): una
 * sola regla, como el motor de similitud.
 *
 * Por entrada de lista (`claveEntradaLista`) manda la decision MAS RECIENTE:
 *   · confirmada → no se duplica nunca. Ya es un verdadero positivo; lo que
 *     toca es el caso AML, no otra fila en la cola.
 *   · descartada → suprime mientras se cumplan las DOS condiciones:
 *       - la entrada dice lo mismo (misma huella; sin huella guardada, la
 *         fila es anterior a 20260926 y se da por igual), y
 *       - no han pasado `mesesSupresion` meses desde la decision.
 *     `mesesSupresion` NULL = la empresa no lo ha declarado: el descarte no
 *     caduca (lo que hacia el sistema antes de 20260926). Nunca se lee como 0,
 *     que reabriria cada descarte en la siguiente corrida.
 *
 * Hasta el 26/09/2026 un descarte suprimia PARA SIEMPRE y sin mirar si la
 * entrada habia cambiado: si OFAC le anadia un documento a la entrada
 * descartada, el sujeto no volvia a la cola jamas.
 */
export function coincidenciasAEncolar<C extends CoincidenciaScreening>(
  coincidencias: C[],
  decisiones: DecisionPrevia[],
  mesesSupresion: number | null,
  ahora: Date,
): C[] {
  const ultima = new Map<string, DecisionPrevia>()
  // Date.parse y no comparar cadenas: PostgREST y el cliente no escriben la
  // zona igual (`+00:00` frente a `Z`).
  const fecha = (d: DecisionPrevia) => Date.parse(d.revisado_at ?? d.created_at)
  for (const d of decisiones) {
    const k = claveEntradaLista(d.lista_tipo, d.lista_nombre)
    const prev = ultima.get(k)
    if (!prev || fecha(d) > fecha(prev)) ultima.set(k, d)
  }
  return coincidencias.filter(c => {
    const d = ultima.get(claveEntradaLista(c.lista_tipo, c.lista_nombre))
    if (!d) return true
    if (d.estado === 'confirmada') return false
    if (d.lista_huella && d.lista_huella !== huellaEntradaLista(c)) return true
    if (mesesSupresion === null) return false
    return sumarMeses(fecha(d), mesesSupresion) <= ahora.getTime()
  })
}

// ── Pertinencia por tipo de entidad (20260926, decision de Hermes) ───────────

/**
 * Cedula venezolana de persona natural: V (venezolano) o E (extranjero
 * residente), con o sin guion, puntos o espacios. J, G, P y cualquier otra
 * cosa NO cuentan: una J es juridica y de un pasaporte no se sabe nada.
 */
export function esCedulaPersonaNatural(documento: string | null): boolean {
  const d = (documento ?? '').replace(/[\s.\-]/g, '').toUpperCase()
  return /^[VE]\d+$/.test(d)
}

/**
 * Quita de las coincidencias de un sujeto las que no pueden ser el: un buque o
 * una aeronave de la lista frente a un ASEGURADO con cedula V- o E-.
 *
 * El 12/09/2026 se decidio mostrar el tipo de entidad como pista y NO filtrar,
 * porque del sujeto de un caso o de un ROS no se sabe si es persona natural o
 * juridica: en AML el error caro es el falso negativo. Del asegurado con
 * cedula V- o E- si se sabe. Medido en la re-criba de Atlantida (Demo) del
 * 25/09/2026: «DANIEL» (buque, OFAC) casaba con cada «Daniela A. Paredes»
 * y «MARIA» (buque) con «Maria G. Perez».
 *
 * Solo la coincidencia POR NOMBRE: la de documento exacto no se toca nunca.
 * Casos, beneficiarios, clientes DDC y ROS pasan intactos.
 */
export function coincidenciasPertinentes<C extends CoincidenciaScreening>(
  sujeto: { tipo: string; documento: string | null },
  coincidencias: C[],
): C[] {
  if (sujeto.tipo !== 'asegurado' || !esCedulaPersonaNatural(sujeto.documento)) return coincidencias
  return coincidencias.filter(c => {
    if (c.metodo === 'documento') return true
    const t = (c.lista_tipo_entidad ?? '').trim().toLowerCase()
    return t !== 'buque' && t !== 'aeronave'
  })
}

// ── Fecha de primera deteccion (25/09/2026) ─────────────────────────────────

/** Lo que hace falta de una pendiente anterior para conservar su fecha. */
export interface PendientePrevia {
  lista_tipo: string | null
  lista_nombre: string | null
  created_at: string
}

/**
 * Fecha de primera deteccion de cada coincidencia pendiente, por entrada de
 * lista (`claveEntradaLista`: el id de la entrada cambia en cada resync).
 *
 * Cada re-criba borra y reinserta las pendientes del sujeto. Hasta el
 * 25/09/2026 la fila reinsertada tomaba `created_at = now()`, y de esa fecha
 * cuelgan el escalado (`dias_escalado_*`) y el «entraron hoy» de Flujos: con
 * el cribado diario el reloj volvia a cero cada madrugada y NADA escalaba
 * nunca. Con esto la fila reinsertada conserva la fecha de la primera vez.
 * Si hubiera dos previas para la misma entrada, manda la mas antigua.
 */
export function fechasPrimeraDeteccion(previas: PendientePrevia[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of previas) {
    const clave = claveEntradaLista(p.lista_tipo, p.lista_nombre)
    const actual = out.get(clave)
    if (!actual || Date.parse(p.created_at) < Date.parse(actual)) out.set(clave, p.created_at)
  }
  return out
}

/**
 * `created_at` para una fila que se va a encolar: el de su primera deteccion o,
 * si es nueva, `ahoraISO`. Se escribe SIEMPRE explicito: en un insert por lotes
 * una clave ausente en algunas filas se manda como NULL, no como DEFAULT.
 */
export function fechaDeteccion(
  previas: Map<string, string>,
  c: { lista_tipo: string | null; lista_nombre: string | null },
  ahoraISO: string,
): string {
  return previas.get(claveEntradaLista(c.lista_tipo, c.lista_nombre)) ?? ahoraISO
}
