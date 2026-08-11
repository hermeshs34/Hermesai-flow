// ═══════════════════════════════════════════════════════════════════════════
// Formato de fechas — TODA hora que ve el usuario es hora de Venezuela
// ═══════════════════════════════════════════════════════════════════════════
//
// El locale ('es-VE') fija solo el IDIOMA y el formato (dd/mm, "a. m."). El huso
// no lo fija: si no se pasa `timeZone`, cada navegador usa el suyo. La misma
// ejecución se veía a las 09:00 desde Caracas y a las 15:00 desde Madrid —
// mientras el Constructor etiquetaba esas horas como "hora de Venezuela".
// Detectado el 11/08/2026, con el flujo BCV disparando correctamente y la
// pantalla contando otra cosa.
//
// Se usa `Intl` y no una resta fija de cuatro horas por lo mismo que en
// cron-runner: Venezuela no tiene horario de verano, pero cambió de huso en 2007
// y en 2016, y una resta a mano se queda vieja sin avisar.
//
// ⚠️ Este fichero tiene un gemelo en `supabase/functions/_shared/fecha.ts`. Una
// Edge Function corre en Deno y no alcanza `src/`, así que está copiado, no
// importado — el mismo caso que `ROLES_QUE_EJECUTAN` (CLAUDE.md §6).
// **Si cambias uno, cambia el otro.**

export const ZONA_VE   = 'America/Caracas';
export const LOCALE_VE = 'es-VE';

type Fecha = string | number | Date;

/** Fecha y hora de Venezuela. Ej.: `11/08/2026, 09:00` */
export function fechaHoraVE(valor: Fecha, opciones: Intl.DateTimeFormatOptions = {}): string {
    return new Date(valor).toLocaleString(LOCALE_VE, { timeZone: ZONA_VE, ...opciones });
}

/** Solo la fecha, en el día de Venezuela. Ej.: `11/08/2026` */
export function fechaVE(valor: Fecha, opciones: Intl.DateTimeFormatOptions = {}): string {
    return new Date(valor).toLocaleDateString(LOCALE_VE, { timeZone: ZONA_VE, ...opciones });
}

/** Solo la hora de Venezuela. Ej.: `09:00:05` */
export function horaVE(valor: Fecha, opciones: Intl.DateTimeFormatOptions = {}): string {
    return new Date(valor).toLocaleTimeString(LOCALE_VE, { timeZone: ZONA_VE, ...opciones });
}
