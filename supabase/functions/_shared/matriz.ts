// ═══════════════════════════════════════════════════════════════════════════
// Matriz de aprobación — a quién le toca autorizar
//
// ⚠️ GEMELO COPIADO de src/utils/matrizAprobacion.ts. Si cambias uno,
// cambia el otro. Está duplicado por el mismo motivo que `fecha.ts` y que
// `ROLES_QUE_EJECUTAN` (CLAUDE.md §6, §9.3): una Edge Function corre en Deno y
// no alcanza el árbol de `src/`.
//
// ESTE es el que MANDA — es el que crea la tarea. El de `src/` solo
// alimenta el simulador de Gobierno. Y ese es justo el motivo de que sean
// idénticos: un simulador que empareja con otras reglas que el motor no es un
// simulador, es una segunda opinión que nadie pidió. Este proyecto ya se ha
// quemado con instrumentos que dicen «bien» sin medir lo mismo que el sistema
// (el `succeeded` de pg_cron, el `✓ Guardado` sin escritura).
// ═══════════════════════════════════════════════════════════════════════════

export interface ReglaMatriz {
    id:                       string;
    nombre:                   string;
    categoria:                string | null;
    operador:                 string;
    umbral_monto:             number;
    umbral_max:               number | null;
    moneda?:                  string;
    rol_aprobador:            string;
    nivel:                    number;
    /** Ausente ⇒ activa: solo un `false` explícito la apaga. */
    activa?:                  boolean;
    aprobadores_multiples:    number;
    escalamiento_horas:       number;
    aplica_automatico:        boolean;
    condicion_extra:          string | null;
    descripcion_regulatoria?: string | null;
}

export type Resolucion =
    | { ok: true;  regla: ReglaMatriz; empatadas: ReglaMatriz[] }
    | { ok: false; motivo: string; empatadas?: ReglaMatriz[] };

/**
 * La ÚNICA normalización de categorías que hay, y por eso se exporta: el
 * formulario de Gobierno la aplica **al guardar**, para que lo que se almacena
 * sea exactamente lo que luego se compara. Normalizar solo al comparar tapaba el
 * síntoma y dejaba en la tabla etiquetas humanas como «Sanciones OFAC», que un
 * auditor lee sin saber qué hay que teclear en el nodo.
 */
export const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * ¿Habla esta regla de la categoría del nodo?
 *
 * Una regla SIN categoría es comodín: vale para cualquier nodo. Una regla CON
 * categoría solo vale si el nodo declara esa misma categoría — y un nodo que no
 * declara ninguna **no** hereda las reglas de nadie. Lo contrario sería asignar
 * una aprobación de AML a un flujo que nunca dijo ser de AML.
 *
 * La comparación ignora mayúsculas y espacios porque la matriz de producción ya
 * tiene una categoría escrita «Sanciones OFAC», con espacio y mayúsculas: los
 * valores los teclea una persona, no un desplegable.
 */
export function casaCategoria(regla: ReglaMatriz, categoria: string | null): boolean {
    const dela = norm(regla.categoria);
    return dela === '' ? true : dela === norm(categoria);
}

/**
 * ¿Habla esta regla del importe del nodo?
 *
 * Una regla con `umbral_monto = 0` y operador `>=` no restringe nada: es la
 * forma que tiene la pantalla de decir «cualquier importe», y así están las tres
 * reglas que hay hoy en producción. Cualquier otra combinación SÍ restringe, y
 * entonces un nodo sin importe no puede casar: comparar contra un importe que no
 * existe es la trampa del `'' === ''` del §9.4 con otro disfraz.
 */
export function casaMonto(regla: ReglaMatriz, monto: number | null): boolean {
    const umbral   = Number(regla.umbral_monto ?? 0);
    const operador = regla.operador ?? '>=';
    const restringe = umbral > 0 || operador !== '>=';
    if (!restringe) return true;
    if (monto === null || Number.isNaN(monto)) return false;

    switch (operador) {
        case '>=':    return monto >= umbral;
        case '>':     return monto >  umbral;
        case '<=':    return monto <= umbral;
        case '<':     return monto <  umbral;
        case '==':    return monto === umbral;
        case 'entre': return monto >= umbral && monto <= Number(regla.umbral_max ?? Infinity);
        // Operador desconocido ⇒ no casa. Un CHECK lo impide en la base, pero
        // si algún día entra otro por migración, que no case es lo seguro.
        default:      return false;
    }
}

/**
 * Orden de precedencia entre dos reglas que ya casan. Mayor = gana.
 *
 * 1. **Nivel** — es lo que la pantalla ya promete: «se usa la de mayor nivel».
 * 2. **Categoría concreta por encima de comodín** — la regla que nombra el caso
 *    sabe más que la que vale para todo.
 * 3. **Umbral más alto** — entre dos escalones, manda el más exigente.
 */
export function comparar(a: ReglaMatriz, b: ReglaMatriz): number {
    if (Number(a.nivel) !== Number(b.nivel)) return Number(a.nivel) - Number(b.nivel);
    const ea = norm(a.categoria) ? 1 : 0;
    const eb = norm(b.categoria) ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return Number(a.umbral_monto ?? 0) - Number(b.umbral_monto ?? 0);
}

/**
 * Lo que una regla PROVOCA. Dos reglas empatadas en precedencia solo son
 * intercambiables si esto coincide; si no, la matriz no dice una cosa, dice dos.
 */
export function efecto(r: ReglaMatriz): string {
    return `${norm(r.rol_aprobador)}|${Number(r.escalamiento_horas ?? 48)}|${Number(r.aprobadores_multiples ?? 1)}`;
}

/**
 * Elige la regla que decide, o explica por qué no hay ninguna.
 *
 * **Falla cerrado, siempre.** Sin regla que case no hay aprobador por defecto:
 * el nodo revienta con un mensaje que se puede leer. El `?? 'supervisor'` que
 * vivía aquí antes convertía un flujo mal configurado en uno que parecía
 * funcionar, asignando la tarea a un rol que durante meses no tuvo a nadie.
 */
export function resolverRegla(
    reglas:    ReglaMatriz[],
    monto:     number | null,
    categoria: string | null,
): Resolucion {
    const activas    = reglas.filter(r => r.activa !== false);
    const candidatas = activas.filter(r => casaCategoria(r, categoria) && casaMonto(r, monto));

    if (candidatas.length === 0) {
        return {
            ok: false,
            motivo:
                `Ninguna regla de la matriz de aprobación cubre este paso ` +
                `(categoría: ${categoria ? `«${categoria}»` : 'sin categoría'}, ` +
                `importe: ${monto === null ? 'sin importe' : monto}). ` +
                `Añade una regla que lo cubra en Gobierno → Matriz de aprobación, ` +
                `o elige un rol aprobador concreto en el nodo desde el Constructor.`,
        };
    }

    const ordenadas = [...candidatas].sort((a, b) => comparar(b, a));
    const mejor     = ordenadas[0];
    const empatadas = ordenadas.filter(r => comparar(r, mejor) === 0);

    // Empate con efectos distintos: la matriz se contradice. Elegir una al azar
    // es exactamente la configuración rota en silencio contra la que avisa
    // CICLO_VIDA_FLUJOS §7.4 — cada parámetro es algo más que puede quedar mal
    // puesto sin que nadie se entere.
    if (new Set(empatadas.map(efecto)).size > 1) {
        return {
            ok: false,
            empatadas,
            motivo:
                `La matriz de aprobación se contradice: ${empatadas.length} reglas ` +
                `compiten con la misma precedencia y piden cosas distintas ` +
                `(${empatadas.map(r => `«${r.nombre}» → ${r.rol_aprobador}, ${r.escalamiento_horas}h, ` +
                    `${r.aprobadores_multiples} aprobador(es)`).join(' / ')}). ` +
                `Ajusta el nivel de una de ellas o desactiva la que sobre en ` +
                `Gobierno → Matriz de aprobación.`,
        };
    }

    return { ok: true, regla: mejor, empatadas };
}
