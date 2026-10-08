---
name: desplegar-flujos
description: Use when about to deploy an Edge Function, apply a migration, or commit a change in HermesAI Flow that touches roles, permissions, approval rules, node types, twin files (fecha, matriz, modelosFinancieros, delegaciones, screeningNucleo) or RLS policies — or when asked whether something "is deployed", "is live" or "is done" in this project.
---

# Desplegar en HermesAI Flow

## Principio

En este proyecto casi todos los incidentes fueron **un paso que dijo «hecho» sin medir nada**: un cron `succeeded` con 401, un `✓ Guardado` sin escritura, un `tsc` que compila un programa vacío, un despliegue que reactivó `verify_jwt`. Cada paso de abajo termina en una **medición** cuyo resultado se pega en la respuesta. Si no hay salida que enseñar, el paso no está hecho.

## Orden — no se reordena

1. **Verificar copias y despliegue actual**
   ```
   node .claude/skills/desplegar-flujos/verificar.mjs
   ```
   Compara los gemelos, cada lista de roles copiada (TS ↔ Deno ↔ funciones SQL ↔ RLS **leídas de la base**), los nodos publicables contra los `case` del motor y el `verify_jwt` de cada función desplegada. Solo vale `Veredicto: VERDE`. `INCOMPLETO` no es verde. Un `FALLO` que ya estaba antes de tu cambio se **dice**, no se ignora.
   Si cambiaste una lista, cambia **todas** sus copias en el mismo commit — el script te dice cuáles son.

2. **Tipos**
   ```
   npm run typecheck
   npx -y deno@2 check supabase/functions/<funcion>/index.ts
   ```
   `npx tsc --noEmit` **no comprueba nada** aquí (tsconfig raíz con `"files": []`).

3. **Columnas contra la base, no contra `schema.sql`**
   Cada columna nueva que escriba una Edge Function:
   ```
   npx supabase db query --linked -o table "select column_name from information_schema.columns where table_name='<tabla>'"
   ```
   Y cada llamada nueva de supabase-js lee su `{ error }`.

4. **Migración ANTES que funciones** (si hay migración)
   - Ensayo dentro de `BEGIN … ROLLBACK` con pruebas de comportamiento, no solo de que «corre».
   - `REVOKE … FROM anon` **por su nombre**; `REVOKE FROM PUBLIC` no basta.
   - Defecto en una migración ya aplicada ⇒ migración nueva (`CREATE OR REPLACE`), nunca editar la vieja.
   - Aplicarla es decisión de Hermes: pedir confirmación.

5. **Desplegar respetando el `verify_jwt` que tiene hoy cada función**
   ```
   npx supabase functions deploy <funcion> --no-verify-jwt
   ```
   Lleva `--no-verify-jwt` toda función que `verificar.mjs` lista con `verify_jwt=false`. No hay `config.toml`: **sin la bandera vuelve a `true`** y el cron muere en silencio. Un secreto nuevo **no** exige redesplegar.

6. **Sondear después — la forma del 401 dice quién rechaza**
   ```
   curl -s -X POST https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/<funcion> -H "Content-Type: application/json" -d "{}"
   ```
   | Respuesta | Significa |
   |---|---|
   | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` en una función que debe ser `false` | la puerta rechaza: **roto**, redesplegar con la bandera |
   | un error propio de la función (`…son requeridos`, `No autorizado`) | el código responde: bien |

   Volver a correr `verificar.mjs` y pegar el veredicto. Si tocaste el reloj: `database/runbooks/VERIFICAR_CRON.sql` (la verdad está en `net._http_response`, no en `cron.job_run_details`).

7. **Cerrar**
   - Migración aplicada ⇒ regenerar `database/schema.sql` (§5.1; Docker en marcha).
   - `git add` y `git commit` en **llamadas separadas** (el hook mira el índice antes de que se llene).
   - Netlify despliega desde el push: el frontend no está en producción hasta `git push`.
   - Fase o regla que cambia ⇒ actualizar la sección de CLAUDE.md que la describe.

## Señales de que te estás saltando algo

| Lo que piensas | Lo que pasó la última vez |
|---|---|
| «Solo cambio un texto, despliego rápido» | 12/08: cambiar un mensaje reactivó `verify_jwt` y tumbó el cron |
| «Ya lo dice `schema.sql`» | 01/08: columnas que solo existían en el archivo, 743 MB de basura |
| «El cambio está en la pantalla» | 11/08: la regla AML solo estaba en el navegador; por API se saltaba |
| «Lo despliego todo» | 28/09: se desplegó todo menos `webhook-in` |
| «El script da FALLO pero no es mío» | Se informa igual. No se dice «verde» sobre un rojo |

## Deuda conocida (avisar, no arreglar de paso)

- Carpetas vacías `execute-node/` y `node-*`; `connectionService.ts` remite a una `node-email` inexistente.
- LegalTech sin conector; Indicadores apunta a un proyecto inactivo.
- `database/migrations/20260807_restaurar_pg_cron.sql`: **no se ejecuta** (deja el planificador a cero).
- `schema.sql` usa `CREATE TABLE IF NOT EXISTS` en las 14 tablas: es un espejo, no un guion.
