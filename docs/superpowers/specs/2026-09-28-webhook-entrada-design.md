# Webhook de entrada por flujo — Diseño

**Fecha:** 28/09/2026
**Estado:** ✅ implementado y en producción (28/09/2026; primera llamada real `lanzada` → `success`). Aprobado por Hermes el mismo día. Plan: `docs/superpowers/plans/2026-09-28-webhook-entrada.md`. **Donde este documento y la §12 difieran, manda la §12.**
**Entrega:** 1 del punto 1 del plan de reingeniería (disparadores por evento + nodos genéricos)

---

## 1. Objetivo

Que **cualquier sistema** —los cuatro productos HermesAI o uno de terceros—
pueda arrancar un flujo con una llamada HTTP y pasarle datos, sin sesión de
usuario y sin que Flujos tenga que conocer a ese sistema de antemano.

Hoy el nodo **Webhook Entrante** existe en la paleta (`NodePalette.tsx`) y en
el motor (`case 'trigger:webhook'`), pero **no hay ninguna puerta por la que
llegue una llamada**: el nodo devuelve `{ triggered: true }` y nada más. En
producción no hay ningún nodo de ese tipo (medido el 28/09/2026), así que el
cambio no afecta a ningún flujo vivo.

## 2. Fuera de alcance (anotado para no perderlo)

- Reintentos automáticos y botón «Relanzar» → entrega 2 (cola). Esta entrega
  ya guarda los datos que la cola necesitará.
- Firmas específicas de proveedores (Stripe, GitHub…) → cuando un proceso real
  lo pida.
- Validar la forma del cuerpo recibido (esquema por flujo) → más adelante.
- Periodo de gracia al rotar el secreto → si un integrador lo necesita.

## 3. Piezas

| Pieza | Qué es |
|---|---|
| `supabase/functions/webhook-in/` | Edge Function **pública** (`--no-verify-jwt`). La puerta. No ejecuta nodos. |
| `workflow_webhooks` | Una fila por flujo: huella del secreto y configuración. |
| `webhook_recepciones` | Registro de cada llamada **autenticada**: sirve para duplicados, límite por minuto y la lista del panel. Base de la futura cola. |
| `execute-workflow` (ajuste) | Acepta los datos recibidos **solo por la vía interna** y los expone como `{{webhook.campo}}`. |
| Constructor (`NodeConfigPanel.tsx`) | Sección «Entrada por webhook» en el panel del nodo. |
| Migración `2026MMDD_webhook_entrada.sql` | Tablas, RLS, RPCs, CHECK de `audit_log`, job de purga. |

**Dirección de un flujo:**
`https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/webhook-in/<workflow_id>`

## 4. Modelo de datos

### 4.1 `workflow_webhooks`

| Columna | Tipo | Notas |
|---|---|---|
| `workflow_id` | uuid PK, FK → `workflows(id)` ON DELETE CASCADE | una fila por flujo |
| `organization_id` | uuid NOT NULL | regla de multi-tenancy (§5) |
| `secreto_hash` | text NOT NULL | `sha256` hex del secreto; **el valor no se guarda nunca** |
| `permite_secreto_url` | boolean NOT NULL DEFAULT false | opt-in, ver §5.2 de este documento |
| `generado_por` | uuid, sin FK | quien generó o rotó por última vez (misma razón que `delegacion_id`, §6.6) |
| `generado_email` | text | legible aunque se borre el usuario |
| `generado_at` | timestamptz NOT NULL | |
| `ultimo_aviso_fallo_at` | timestamptz | limita el correo de «fallo al lanzar» a uno por hora |

RLS: `SELECT` para la organización (patrón de §7). **Sin políticas de
escritura ni GRANT de INSERT/UPDATE/DELETE** a `authenticated`: se escribe solo
por las RPCs (DEFINER) y por las Edge Functions con clave de servicio. Mismo
criterio que `tareas_aprobacion` desde el 25/09 — sin política **y** sin GRANT.

La columna `secreto_hash` **no** se expone en el `SELECT` de la organización
(permisos por columna): una huella de 256 bits no es reversible, pero no hay
ningún motivo para enseñarla.

### 4.2 `webhook_recepciones`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid NOT NULL | |
| `workflow_id` | uuid NOT NULL, FK ON DELETE CASCADE | |
| `recibido_at` | timestamptz NOT NULL DEFAULT now() | |
| `evento_id` | text NULL | cabecera `Idempotency-Key`, máx. 200 caracteres |
| `estado` | text NOT NULL, CHECK | `aceptada`, `lanzada`, `fallo_al_lanzar`, `rechazada_inactivo`, `frenada_limite`, `duplicada` |
| `motivo` | text | legible para una persona |
| `payload` | jsonb | solo en `aceptada`/`lanzada`/`fallo_al_lanzar` |
| `bytes` | int | tamaño del cuerpo |
| `execution_run_id` | uuid, sin FK | la ejecución que lanzó (o la original, si es `duplicada`) |

Índices:
- `UNIQUE (workflow_id, evento_id) WHERE evento_id IS NOT NULL AND estado IN ('aceptada','lanzada','fallo_al_lanzar')`
  — la base decide la carrera entre dos llamadas iguales simultáneas.
- `(workflow_id, recibido_at DESC)` — límite por minuto y lista del panel.

RLS: `SELECT` para la organización; escritura solo con clave de servicio.

**Retención: 90 días**, con un job de pg_cron puramente SQL
(`purgar-webhook-recepciones`, diario). ⚠️ Su nombre y su comando **no
contienen `cron-runner`** (§6.1.1). La ventana de duplicados es, por tanto, de
90 días.

### 4.3 `audit_log`

Se añade `'webhook'` al CHECK de `entidad`. Las acciones usan los valores que
ya admite el CHECK de `accion`: `crear` (primer secreto), `modificar` (rotar,
encender o apagar el secreto en la URL). **Se registra el hecho, nunca el
secreto.**

## 5. El secreto

### 5.1 Generación — `generar_secreto_webhook(p_workflow_id uuid) → text`

`SECURITY DEFINER`, `search_path` fijo, `REVOKE` a `PUBLIC` **y a `anon` por su
nombre** (§6.4), `GRANT` solo a `authenticated`. En orden:

1. sesión (`auth.uid()`) → perfil activo;
2. **organización del flujo = organización del llamante** (DEFINER se salta la RLS);
3. rol con `manage_workflows`: `admin`, `dueno_proceso`, `editor`. La lista va
   **copiada** de `ROLE_PERMISSIONS`; si cambia una, cambia la otra (como
   `transicionar_flujo`, §6.7);
4. genera `hfw_` + 64 hex a partir de dos `gen_random_uuid()` en un CTE
   `AS MATERIALIZED` (mismo método que `ROTAR_CRON_SECRET.sql`, sin depender
   de pgcrypto);
5. guarda `sha256(convert_to(secreto,'UTF8'))` en hex (`INSERT … ON CONFLICT
   (workflow_id) DO UPDATE`); **rotar invalida el anterior en el acto**;
6. escribe en `audit_log`;
7. devuelve el secreto. Es la **única** vez que existe fuera de quien lo recibe.

El prefijo `hfw_` hace que un secreto pegado por error en un documento o un
repositorio se reconozca a simple vista y lo encuentren los escáneres.

### 5.2 Secreto en la URL — `configurar_webhook_url(p_workflow_id uuid, p_permitir boolean)`

Mismas comprobaciones 1–3 que §5.1. Cambia `permite_secreto_url` y lo audita.
Falla si el flujo no tiene aún secreto.

### 5.3 Lo que NO hacen estas operaciones

- **No despublican el flujo.** El secreto no está en nodos ni conexiones y no
  cambia lo que hace el flujo (criterio de §6.7). Si rotar obligara a pedir
  autorización, dejaría de rotarse.
- **Duplicar un flujo no copia el secreto.** La copia nace sin fila en
  `workflow_webhooks`: dos flujos no comparten llave.

## 6. La puerta — `webhook-in`

### 6.1 Autenticación

- **Por defecto:** cabecera `x-webhook-secret`.
- **Opcional por flujo:** parámetro `?secreto=` en la URL, solo si
  `permite_secreto_url = true`. Si llega por la URL y el flujo no lo permite,
  se rechaza igual que un secreto erróneo.
- Se calcula `sha256` del valor recibido y se compara con `secreto_hash` en
  **tiempo constante**.
- **Sin CORS, a propósito.** Es una llamada entre servidores; un navegador que
  la hiciera estaría exponiendo el secreto a quien abra la página.

### 6.2 Recorrido (se detiene en el primer fallo)

| # | Comprobación | Respuesta si falla | ¿Se registra en `webhook_recepciones`? |
|---|---|---|---|
| 1 | `POST`, `Content-Type: application/json`, ≤ 256 KB, JSON válido | 405 / 415 / 413 / 400 con motivo | **No** |
| 2 | Flujo existe, tiene fila en `workflow_webhooks`, el secreto casa | **401 genérico** («No autorizado»), igual para los tres casos: no revela qué flujos existen | **No** (solo `console.warn` sin el secreto) |
| 3 | Flujo `publicado` + `is_active` + tiene un nodo `trigger`/`webhook` | 409 con motivo | Sí, `rechazada_inactivo` — como máximo una fila por flujo y minuto |
| 4 | ≤ 60 recepciones `aceptada`/`lanzada`/`fallo_al_lanzar` en el último minuto para ese flujo | 429 | Sí, `frenada_limite` — como máximo una fila por flujo y minuto |
| 5 | `Idempotency-Key` no recibida antes | 200 `{ duplicada: true, execution_run_id }` | Sí, `duplicada` |
| 6 | ✅ Inserta `aceptada` con `payload`, responde **202** `{ recibido: true, recepcion_id }` y lanza el motor en segundo plano (`EdgeRuntime.waitUntil`) | — | Sí, `aceptada` |

**Los intentos con secreto erróneo no se guardan en la base.** Si se
guardaran, cualquiera podría llenarla mandando basura: es justo lo que la
puerta tiene que impedir (lección del 01/08, 743 MB).

El tope de «una fila por flujo y minuto» en los pasos 3 y 4 impide que quien
tiene el secreto llene la tabla a base de llamadas rechazadas: el usuario ve
que hubo rechazos, no cada uno de ellos.

Una violación del índice único en el paso 6 (dos llamadas iguales a la vez) se
convierte en el paso 5: se responde `duplicada`, no error.

### 6.3 Lanzar el motor

`supabase.functions.invoke('execute-workflow', …)` con `x-cron-secret`, como
`cron-runner` y `resolve-approval`, y cuerpo:

```json
{ "workflowId": "…", "organizationId": "…", "triggeredBy": "webhook",
  "webhookPayload": { … }, "recepcionId": "…" }
```

`organizationId` sale de la fila del flujo, **nunca del cuerpo recibido**.

- Si `invoke` devuelve error: la recepción pasa a `fallo_al_lanzar` con el
  motivo **leído de `err.context`** (§12.2), y se avisa por correo a los
  `admin` activos vía `_shared/email.ts` (§9.1), **como máximo uno por flujo y
  hora** (`ultimo_aviso_fallo_at`).
- Todo `{ error }` de supabase-js se comprueba (§5.1 regla 2).

### 6.4 Por qué el motor anota su propia ejecución

Un flujo puede durar hasta 150 s. Si la puerta esperara al final para escribir
`execution_run_id`, podría agotar su propio tiempo y dejar la recepción sin
enlazar aunque el flujo corriera bien. Por eso **`execute-workflow`, al crear
el run, actualiza la recepción** (`estado='lanzada'`, `execution_run_id`).
Quien conoce el dato es quien lo escribe.

Una recepción que siga en `aceptada` más de 5 minutos se muestra en el panel
como **«sin confirmar»**: es visible, no silenciosa.

## 7. Cambios en `execute-workflow`

1. **Leer `webhookPayload` y `recepcionId` solo si `esLlamadaInterna`.** En una
   llamada de usuario se ignoran; si no, cualquier sesión podría inyectar datos
   haciéndose pasar por un sistema externo.
2. `triggered_by = 'webhook'` en `execution_runs` (la columna no tiene CHECK).
3. Guardar el payload en el contexto bajo la clave reservada **`__webhook`**, con
   `_evento_id` y `_recibido` añadidos. Así viaja en `context_json` y **sobrevive
   a una pausa por aprobación** sin tocar la huella de §9.5 (que solo cubre la
   definición).
4. Tras crear el run, `UPDATE webhook_recepciones SET estado='lanzada',
   execution_run_id=…` comprobando `{ error }`.
5. `resolveValue`:
   - nueva rama `{{webhook.ruta.al.campo}}` que lee de `context.__webhook`;
   - `__webhook` se **excluye** de la búsqueda de `{{previous.…}}` (igual que
     `__lastNodeId`) y de `{{summary}}`: el dato externo solo entra donde el
     diseñador lo pide explícitamente;
   - los valores se sustituyen **una sola vez**: un `"{{summary}}"` dentro del
     payload se escribe literal, no se vuelve a interpretar.
6. **Escape HTML:** al resolver el **cuerpo** de `output:email`, los valores de
   `{{webhook.…}}` pasan por `escaparHtml`. El resto de valores no cambia (hay
   nodos que producen HTML propio a propósito, p. ej. `cola_html`). Asunto y
   destinatario van como texto.
7. `case 'trigger:webhook'` devuelve además `{ recibido: true, evento_id }`
   cuando hay payload.
8. `CORS['Access-Control-Allow-Headers']` no cambia: la puerta llama con
   `x-cron-secret`, que ya está.

⚠️ **Destinatario desde el webhook.** Un nodo Email puede usar
`{{webhook.email}}` en «Para»: es un caso legítimo (confirmar a quien envió un
formulario). El riesgo lo acota el secreto —solo lo usa quien lo tiene—, pero
el panel del nodo Email mostrará un aviso cuando «Para» contenga `{{webhook.`.

## 8. Constructor — sección «Entrada por webhook»

En el panel del nodo Webhook:

1. **Dirección** del flujo con botón *Copiar*.
2. **Estado:** «Sin secreto — el flujo no acepta llamadas» o «Activo · generado
   por {email} el {fechaHoraVE}» (fechas por `utils/fecha.ts`, §9.3).
3. **Generar secreto / Rotar secreto.** Rotar pide confirmación («el sistema que
   llama dejará de funcionar hasta que actualices el secreto»). El secreto se
   muestra **una vez** en una ventana con *Copiar* y el aviso «Guárdalo ahora;
   no se volverá a mostrar».
4. **Interruptor «Permitir el secreto en la URL»**, apagado; al encenderlo pide
   confirmación con el aviso de que la dirección quedará en historiales y
   registros del sistema que llama. Encendido, la sección se pinta en ámbar.
5. **Ejemplo curl** listo para copiar, con `x-webhook-secret` e
   `Idempotency-Key`, y la recomendación de mandar siempre esta última.
6. **Últimas 10 llamadas:** hora, estado, motivo y enlace a la ejecución.
7. Sin `manage_workflows` la sección es de solo lectura, con el distintivo y el
   texto de `rolesQuePueden` (§12.2). Los errores de las RPCs pasan por
   `mensajeDeEscritura`.

Un flujo **sin guardar** (recién creado, sin fila en `workflows`) no puede
tener secreto: el botón explica que primero hay que guardar.

## 9. Despliegue (orden)

1. **Migración** (la aplica Hermes en el SQL Editor, tras ensayo con `ROLLBACK`).
2. `execute-workflow` → `supabase functions deploy execute-workflow --no-verify-jwt`.
   Sondeo: POST sin cabeceras con `-d "{}"` debe dar
   `{"error":"workflowId y organizationId son requeridos"}`.
3. `webhook-in` → `supabase functions deploy webhook-in --no-verify-jwt`.
   Sondeo: POST sin cabeceras a `webhook-in/<uuid-cualquiera>` con `-d "{}"`
   debe dar el 401 **propio** (`{"error":"No autorizado"}`), **no**
   `UNAUTHORIZED_NO_AUTH_HEADER`.
4. Frontend → push a `main` (Netlify).
5. Regenerar `database/schema.sql` (§5.1 regla 3).
6. CLAUDE.md: árbol de §4 (`webhook-in/`), nueva subsección del webhook, y la
   lista de `case` si cambia.

## 10. Pruebas

**Migración (en transacción con `ROLLBACK`, antes de aplicar):**
- `anon` sin EXECUTE en las dos RPCs; `authenticated` con EXECUTE.
- Un `operador` y un usuario de otra organización reciben error al generar.
- Generar dos veces: el hash cambia, hay dos filas en `audit_log`, ninguna
  contiene el secreto.
- `authenticated` no puede `INSERT/UPDATE/DELETE` en las dos tablas nuevas.
- Rotar el secreto de un flujo `publicado` **no** lo devuelve a `borrador`.
- El índice único rechaza dos `aceptada` con el mismo `evento_id`.

**Extremo a extremo (tras desplegar), con un flujo de prueba Webhook → Email:**
1. Secreto correcto + `Idempotency-Key: prueba-1` → 202; llega el correo con
   `{{webhook.nombre}}` sustituido; la recepción queda `lanzada` y enlazada.
2. Misma llamada otra vez → 200 `duplicada` con el mismo `execution_run_id`; no
   hay segundo correo.
3. Secreto erróneo → 401 genérico; **cero** filas nuevas.
4. Secreto en la URL con el interruptor apagado → 401; encendido → 202.
5. Flujo desactivado → 409 y fila `rechazada_inactivo`.
6. Cuerpo con `"nombre": "<b>x</b> {{summary}}"` → el correo muestra el texto
   literal, escapado.
7. Cuerpo de 300 KB → 413.
8. Llamada de usuario a `execute-workflow` con `webhookPayload` → el payload
   **no** entra en el contexto.

## 11. Riesgos y decisiones registradas

- **Datos personales guardados UNA vez** (en la recepción) durante 90 días — ver §12, punto 1; antes decía «dos veces».
  Aceptado: sin guardarlos, una llamada cuyo arranque falla se pierde, y es la
  base de la cola de la entrega 2.
- **La purga depende de pg_cron**, y el vigilante (§6.1.1) no la mira. Si el
  job desaparece, la tabla crece sin avisar; el volumen esperado es bajo y el
  límite de 60/min por flujo acota el peor caso.
- **El límite por minuto se cuenta sobre la tabla**, no en memoria: dos
  llamadas simultáneas pueden pasar ambas en el borde del límite. Aceptado: es
  un freno de caudal, no un control de seguridad.
- **Rotar sin gracia** corta al integrador hasta que actualice. Aceptado para
  la primera versión.

## 12. Desviaciones al escribir el plan (28/09/2026)

Salieron al contrastar el diseño contra el código. El plan ya las incorpora.

1. **El payload no viaja en el cuerpo hacia `execute-workflow`** (§6.3 decía
   `webhookPayload`). La puerta manda solo `recepcionId`; el motor ancla la
   recepción (`aceptada → lanzada`) y lee los datos **en el mismo UPDATE**. Una
   llamada no puede lanzarse dos veces, y los datos se guardan una sola vez.
2. **`context.__webhook` es una propiedad NO enumerable** y no se guarda en
   `context_json` (§7.3 decía lo contrario). Así no lo ven `{{previous.…}}`,
   `{{summary}}`, el prompt del agente IA ni el consolidado del reporte. Al
   reanudar un run pausado se recarga de la recepción por `execution_run_id`;
   si ya no está (purgada), **no se reanuda**.
3. **Un disparador Webhook sin datos revienta** («Ejecutar» a mano, «Reintentar»
   en Monitoreo o en la bandeja). Si no, el flujo correría con todos los
   `{{webhook.…}}` en blanco.
4. **`triggeredBy:'webhook'` fuera de la vía interna → 400.** Una sesión de
   usuario no puede hacerse pasar por la puerta ni anclar una recepción ajena
   (sustituye a la prueba 8 de §10).
5. **Un cuerpo con `\u0000` → 400.** `JSON.parse` lo acepta pero `jsonb` no:
   sin esto sería un 500 opaco.
6. **Filas `duplicada`, `rechazada_inactivo` y `frenada_limite`: como mucho una
   por flujo, estado y minuto**, para que quien tenga el secreto no pueda llenar
   la tabla con llamadas rechazadas.
7. **El escape HTML de `{{webhook.…}}` se aplica también al cuerpo del nodo
   Reporte**, no solo al del Email; y el aviso de «destinatario sacado del
   webhook» sale en los dos formularios.
8. **En la RPC, una variable de plpgsql sustituye al `CTE AS MATERIALIZED`**
   de §5.1: se evalúa una vez, que es lo que se buscaba.
9. **`audit_log` no tiene CHECK sobre `accion`** (§4.3 decía que sí); solo sobre
   `entidad`, cuya lista se midió en producción el 28/09 y se reescribe entera
   con `'webhook'` añadido.
10. **El ensayo vive en `database/ensayos/`**, carpeta nueva: `runbooks/` es
    solo lectura por convención y el ensayo corre la migración (y la deshace
    con un `RAISE EXCEPTION` final).
