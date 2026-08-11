// ═══════════════════════════════════════════════════════════════════════════
// Formato de fechas — TODA hora que sale de aquí es hora de Venezuela
// ═══════════════════════════════════════════════════════════════════════════
//
// Las Edge Functions corren en UTC (CLAUDE.md §9.2). Un `toLocaleString('es-VE')`
// sin `timeZone` da formato venezolano con hora de Londres: al aprobador le
// llegaba por correo un "Vence" cuatro horas adelantado. El locale fija el
// idioma; el huso hay que decirlo. Corregido el 11/08/2026.
//
// ⚠️ Gemelo de `src/utils/fecha.ts`. Copiado, no importado: Deno no alcanza
// `src/`, igual que `ROLES_QUE_EJECUTAN` (CLAUDE.md §6).
// **Si cambias uno, cambia el otro.**

export const ZONA_VE   = 'America/Caracas';
export const LOCALE_VE = 'es-VE';

type Fecha = string | number | Date;

/** Fecha y hora de Venezuela. Ej.: `11/08/2026, 09:00:05` */
export function fechaHoraVE(valor: Fecha, opciones: Intl.DateTimeFormatOptions = {}): string {
    return new Date(valor).toLocaleString(LOCALE_VE, { timeZone: ZONA_VE, ...opciones });
}

/** Solo la fecha, en el día de Venezuela. Ej.: `11/08/2026` */
export function fechaVE(valor: Fecha, opciones: Intl.DateTimeFormatOptions = {}): string {
    return new Date(valor).toLocaleDateString(LOCALE_VE, { timeZone: ZONA_VE, ...opciones });
}
