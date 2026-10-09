---
name: cerrar-una-regla
description: Use when adding, tightening or changing a permission or business rule in HermesAI Flow — who may approve, execute, edit, publish, read or delegate; which role a task goes to; a new category, threshold or role list — or when asked "¿queda cerrada?", "¿quedó fuera de verdad?", "dale un sí o no al auditor", or when a rule seems to live only in the screen, only in RLS or only in one Edge Function.
---

# Cerrar una regla

## Principio

**Una regla está cerrada cuando nadie puede saltársela por ningún camino, y eso se prueba intentándolo.** Que el código de una capa la compruebe no es lo mismo. En este proyecto la regla casi nunca se rompe donde se escribe: se rompe en la puerta de al lado (escalamiento, delegación, matriz, escritura directa, un campo vacío).

## 1. ¿Quién enciende la regla?

Antes de tocar código, contesta:

- **¿Qué dato decide que la regla aplica?** (rol, `categoria`, monto, estado...)
- **¿Quién escribe ese dato y qué vale por defecto?** Mídelo en producción con `supabase db query --linked`, en **una** sentencia `jsonb_build_object`.
- Si el defecto es vacío/NULL y vacío significa «no aplica», **quien quiere saltarse la regla solo tiene que no rellenar el campo**. Eso es una regla abierta, no un detalle pendiente (familia `'' === ''`, §9.4).

## 2. Mapa de caminos — una fila por camino, sin saltarse ninguna

| Camino | Dónde mirar |
|---|---|
| Pantalla | `ROLE_PERMISSIONS` / `puedeResolverTarea` (`src/core/user.types.ts`), botones y consultas que deciden qué se pinta |
| Edge Function que manda | `resolve-approval`, `execute-workflow` (`ROLES_QUE_EJECUTAN`, `ROLES_APROBADORES`), la que toque |
| Creación del dato | quién crea la tarea/fila y con qué valores (nodo, matriz §6.5) |
| Escalamiento | `ESCALA_A` de `cron-runner`: ¿al vencer, el dato llega a un rol que la regla excluye? |
| Delegación | `_shared/delegaciones.ts` (§6.6): ¿un suplente hereda lo que la regla prohíbe? |
| Escritura directa por API | RLS + GRANT de la tabla (`pg_policies`, permisos por columna) |
| Triggers / RPC DEFINER | ¿alguno escribe el campo saltándose la regla? |
| Gemelos y copias | `_shared/*` ↔ `src/utils/*`, listas copiadas en SQL; `verificar.mjs` |
| Edición de la definición | ¿quitar el campo del nodo despublica (§6.7) o pasa sin revisión? |

Busca el campo y el slug con Grep en `src/`, `supabase/functions/` y `database/`. Un camino que no aparece en tu mapa no lo has mirado.

## 3. Intento de salto por cada fila

Para cada camino escribe **cómo intentarías saltártela** y **qué pasó**, con evidencia: prueba ejecutada, línea de código citada o consulta a la base. «Lo leí y parece bien» no es evidencia para una puerta de escritura.

## 4. Veredicto — solo tres respuestas

- **Cerrada**: todas las filas con evidencia, y el dato que la enciende no se puede dejar vacío para esquivarla.
- **Cerrada en código, inerte o esquivable**: el código está, pero hoy no aplica a nada (medido) o un campo vacío la evita. **Esto no es «cerrada».** Dilo con esas palabras y con la cifra medida.
- **Abierta**: cualquier fila sin evidencia o con salto posible.

Nunca digas «en el código sí queda cerrada». Es la frase que convierte la tercera respuesta en la primera.

## 5. Antes de dar el trabajo por hecho

- **Choque con otra regla** (p. ej. §6.2 «solo cumplimiento» contra la nueva): no elijas tú cuál gana. Pregunta a Hermes con los flujos afectados por su nombre.
- **Lo que se mueve junto, se mueve junto**: si añades una lista o regla copiada, actualiza su gemelo, añádela a `verificar.mjs` y deja la sección de CLAUDE.md al día (§6, §6.2, §6.5...).
- **Hallazgos de otros caminos** (otra regla abierta que veas de paso): repórtalos, no los arregles de rebote.
- No despliegues ni hagas commit sin que te lo pidan; si toca desplegar, `--no-verify-jwt` y sondeo después (§6.1).

## Señales de que te lo estás saltando

| Lo que piensas | Realidad |
|---|---|
| «La Edge Function ya lo comprueba» | ¿Y el escalamiento, la delegación y el campo vacío? |
| «Hoy ninguna tarea tiene esa categoría, no pasa nada» | Entonces la regla no protege nada todavía: «inerte», no «cerrada» |
| «El diseñador pondrá la categoría» | Quien quiere saltársela es justo quien no la pone |
| «Es un cambio pequeño» | Las cinco reglas rotas de CLAUDE.md también lo eran |
| «Elijo la regla más restrictiva y sigo» | Es una decisión de negocio: pregunta |
