# CLAUDE.md — HermesAI Flow
> Instrucciones permanentes para Claude Code. Leer en cada sesión antes de cualquier tarea.

---

## 1. Identidad del Proyecto

**Nombre:** HermesAI Flow  
**Versión:** 1.0 — Mayo 2026  
**Dominio:** Automatización de Flujos de Trabajo — Hub central del ecosistema HermesAI  
**Clasificación:** Confidencial  
**CIO / Director:** Hermes Sánchez  
**Equipo técnico:** HermesAI Engineering  

Este sistema es el **hub de automatización** que conecta los 4 sistemas del ecosistema HermesAI:
- **RiskGuard Insurance** — Riesgos, Siniestros, Cumplimiento AML
- **Estados Financieros** — EE.FF. bajo NIIF/IFRS, Ley de Benford
- **Sistema de Indicadores** — KPIs, BSC, OKR
- **LegalTech Compliance VE** — Firma Legal, RGPD, AML/CFT

Cualquier flujo que afecte notificaciones, alertas o generación de informes en producción tiene impacto real en los 4 sistemas. Priorizar **corrección y seguridad sobre velocidad**.

---

## 2. Stack Tecnológico

```
Frontend:    React 18 + Vite + TypeScript (strict mode)
Estilos:     Tailwind CSS (utility-first)
Estado:      Zustand (store centralizado)
Validación:  Zod (schemas runtime)
Base datos:  Supabase (PostgreSQL 15 + Auth + RLS + Edge Functions)
Email:       Resend API (envío transaccional — NUNCA nodemailer en frontend)
IA:          Anthropic API — claude-opus-4-7 para informes complejos
                           — claude-sonnet-4-6 para clasificación/extracción
Ejecución:   Supabase Edge Functions (Deno) — motor de ejecución de nodos
Scheduling:  pg_cron (triggers por tiempo) + Supabase Scheduled Functions
Deploy:      Netlify (CI/CD desde main branch)
```

---

## 3. Concepto Central — Qué es un Flujo

Un flujo en HermesAI Flow es una cadena de nodos conectados que se ejecuta automáticamente:

```
[TRIGGER] → [PROCESSOR(ES)] → [OUTPUT(S)]

Ejemplo:
[Cron: diario 8am] → [Leer KPIs de Indicadores] → [Agente IA: redactar informe] → [Email: enviar a Hermes]
```

### Tipos de Nodos

| Categoría | Nodos | Descripción |
|-----------|-------|-------------|
| **Triggers** | `cron`, `webhook`, `event` | Inician el flujo |
| **Connectors** | `riskguard`, `eeff`, `indicadores`, `legaltech` | Leen datos de los 4 sistemas |
| **Processors** | `ai-report`, `ai-classify`, `filter`, `transform` | Procesan datos |
| **Outputs** | `email`, `notification`, `alert`, `webhook-out` | Envían resultados |

---

## 4. Estructura del Workspace

```
project/
├── CLAUDE.md                        ← este archivo
├── ARCHITECTURE.md                  ← decisiones de arquitectura
├── DATA_MODEL.md                    ← modelo de datos completo
├── SECURITY.md                      ← políticas RLS y seguridad
├── INTEGRATIONS.md                  ← contratos con los 4 sistemas
├── ROADMAP.md                       ← estado actual de fases
├── database/
│   ├── schema.sql                   ← espejo del esquema REAL (ver §5.1)
│   ├── functions/                   ← funciones PostgreSQL / Edge Functions
│   ├── policies/                    ← políticas RLS (una por tabla)
│   ├── seeds/                       ← datos demo
│   └── migrations/                  ← migraciones incrementales YYYYMMDD_desc.sql
├── src/
│   ├── core/
│   │   ├── supabase.ts              ← cliente singleton — NO instanciar en otro lugar
│   │   ├── auth.service.ts          ← autenticación y gestión de roles
│   │   └── user.types.ts            ← tipos de usuario y roles
│   ├── modules/
│   │   ├── canvas/                  ← editor visual de flujos (drag & drop)
│   │   ├── dashboard/               ← métricas y estado de flujos
│   │   ├── monitoring/              ← logs de ejecución en tiempo real
│   │   ├── settings/                ← configuración de integraciones
│   │   └── shared/                  ← servicios compartidos
│   ├── types/
│   │   ├── workflow.types.ts        ← tipos de flujos, nodos, conexiones
│   │   └── integration.types.ts    ← tipos de integraciones con los 4 sistemas
│   ├── services/
│   │   ├── workflow.service.ts      ← CRUD de flujos (Supabase)
│   │   ├── execution.service.ts     ← invocación de Edge Functions
│   │   └── integration.service.ts  ← conectores a los 4 sistemas
│   ├── store/
│   │   └── workflow.store.ts        ← Zustand store
│   └── utils/
│       ├── toast.ts                 ← notificaciones Sonner
│       └── helpers.ts               ← funciones utilitarias
├── supabase/
│   └── functions/                   ← Edge Functions Deno (motor de ejecución)
│       ├── _shared/email.ts         ← ÚNICO punto de salida de correo (ver §9.1)
│       ├── execute-workflow/        ← el motor: ejecuta TODOS los tipos de nodo
│       ├── cron-runner/             ← pg_cron cada minuto: dispara y escala (F4)
│       ├── resolve-approval/        ← aprobar / rechazar una tarea
│       ├── health-check/            ← estado de integraciones (lo llama el Sidebar)
│       ├── admin-create-user/       ← alta de usuarios
│       ├── admin-reset-password/    ← clave temporal por olvido — solo admin (§6.4)
│       ├── request-password-reset/  ← enlace de recuperación — PÚBLICA (§6.4)
│       ├── design-assistant/        ← asistente de diseño de flujos
│       └── get-bcv-rate/            ← tasa BCV
└── .claude/
    ├── settings.json                ← hooks y permisos Claude Code
    └── hooks/                       ← scripts de seguridad pre-commit
```

> **Ojo: no hay una Edge Function por tipo de nodo.** Existen las carpetas
> `execute-node/`, `node-email/`, `node-ai-report/`, `node-riskguard/`,
> `node-indicadores/`, `node-eeff/` y `node-legaltech/`, y **las siete están
> vacías**. Nunca se escribieron: todos los nodos se ejecutan dentro del
> `switch` de `execute-workflow/index.ts`. Este árbol las daba por hechas
> —igual que `schema.sql` daba por hechas columnas que no existían (§5.1)— y
> `connectionService.ts` todavía remite a una `node-email` inexistente.
> Corregido el 07/08/2026.

---

## 5. Modelo de Datos — Tablas Principales

### Regla crítica de multi-tenancy
**TODA tabla de negocio DEBE tener `organization_id UUID NOT NULL`.**  
**TODA query DEBE filtrar por `organization_id` del usuario autenticado.**  
El RLS es la segunda línea de defensa, no la única.

### Tablas core

```sql
-- Tenant raíz
organizations     (id, name, slug, plan, is_active, created_at)

-- Usuarios del sistema
profiles          (id, organization_id, email, name, role, is_active, created_at)

-- Flujos de trabajo
workflows         (id, organization_id, name, description, is_active,
                   schedule_type, schedule_value, created_by, created_at, updated_at)

-- Nodos de un flujo
workflow_nodes    (id, workflow_id, organization_id, type, category,
                   title, position_x, position_y, config_json, created_at)

-- Conexiones entre nodos
workflow_connections (id, workflow_id, source_node_id, target_node_id, created_at)

-- Log de ejecuciones
execution_logs    (id, workflow_id, organization_id, node_id, status,
                   message, details_json, duration_ms, executed_at)

-- Configuración de integraciones por organización
integrations      (id, organization_id, system_name, config_json,
                   is_active, created_at, updated_at)

-- Ejecuciones (raíz de cada run; execution_logs es su detalle por nodo)
execution_runs    (id, organization_id, workflow_id, triggered_by, status,
                   started_at, finished_at, context_json, paused_node_id, ...)

-- Gobierno (F1–F4)
audit_log         (id, organization_id, usuario_id, usuario_email, accion,
                   entidad, entidad_id, descripcion, ...)   -- OJO: usuario_id, NO actor_id
tareas_aprobacion (id, organization_id, workflow_id, execution_run_id, node_id,
                   rol_aprobador, estado, vence_at, resolved_at,
                   nivel_escalamiento, ...)                 -- OJO: resolved_at, NO resuelto_at
matriz_aprobacion (id, organization_id, nombre, categoria, umbral_monto,
                   operador, rol_aprobador, nivel, ...)
delegaciones      (id, organization_id, usuario_id, suplente_id, desde, hasta, motivo)
```

Las columnas de arriba son un resumen. **La lista completa y exacta está en
`database/schema.sql`**, y las abreviadas con `...` no caben aquí a propósito.

### 5.1 `schema.sql` describe la base, no la dirige

`database/schema.sql` es un **espejo** del esquema de producción, regenerado
desde el catálogo. No es una especificación: si difiere de la base, el que está
mal es el archivo.

Durante meses fue al revés —se editaba a mano y se le llamaba "fuente de
verdad"— y divergió en más de treinta puntos sin dar un solo error, porque cada
tabla se declaraba con `CREATE TABLE IF NOT EXISTS` y una declaración sobre una
tabla existente no hace nada. Costó un millón de filas basura y 743 MB
(`cron-runner` escribía `estado='vencido'` y `resuelto_at`, que solo existían en
el archivo) y dos meses de auditoría de aprobaciones perdida (`resolve-approval`
insertaba `actor_id`, columna inexistente).

⚠️ **Este párrafo decía que el archivo «usa `CREATE TABLE` a secas: si vuelve a
desviarse, que reviente». Es falso, y comprobado el 14/08/2026:** las doce tablas
siguen declaradas con `CREATE TABLE IF NOT EXISTS`, porque eso es lo que emite
`supabase db dump` y la regeneración del 12/08 lo devolvió tal cual. La red de
seguridad que este documento daba por puesta no existe. **Da igual mientras el
archivo no se ejecute** —es un espejo, no un guion—, y por eso el mecanismo real
sigue siendo la regla 1 de abajo: comprobar contra la base, no contra el archivo.
Se anota porque una salvaguarda que solo está escrita aquí es otra vez el patrón
del `succeeded` de pg_cron.

**Reglas:**
1. Antes de escribir una columna desde una Edge Function, **comprobarla contra
   la base**, no contra este archivo ni contra CLAUDE.md.
2. **Comprobar siempre el `{ error }` de `supabase-js`.** No lanza excepción, la
   devuelve. Un `error` que nadie lee convierte un fallo en silencio, y los tres
   incidentes anteriores son exactamente eso.
3. Tras aplicar una migración, regenerar el archivo:
   ```
   supabase link --project-ref kbscaxcokxwdbnrltkup
   supabase db dump --linked --schema public --keep-comments -f database/schema.sql
   ```
   (la conexión directa es solo IPv6; `link` configura el pooler IPv4)

   Dos cosas que cuestan un rato si no se saben:
   - **`db dump` necesita Docker en marcha.** Corre `pg_dump` dentro de un
     contenedor, así que sin el demonio levantado falla con
     `LegacyDockerRunError` — que no tiene nada que ver con el `LegacyDbConfigIpv6Error`
     de la línea de arriba, aunque los dos salgan del mismo comando.
   - **Desde el 12/08/2026 el fichero es salida literal de `pg_dump`, sin
     cabecera propia.** Hasta esa fecha estaba reconstruido a mano desde
     `pg_attribute`/`pg_policies` y llevaba encima un comentario largo con estas
     mismas reglas; se quitó porque una cabecera que hay que volver a pegar
     después de cada regeneración es justo el tipo de paso manual que hizo
     divergir el archivo la primera vez. Las reglas viven aquí, en §5.1, y solo
     aquí. **No le añadas nada al fichero: se sobrescribe entero.**

---

## 6. Roles y Permisos

El `CHECK` real de `profiles.role` admite **diez** valores. Los cuatro primeros
de la tabla original de este documento eran los legacy; los roles BPM llegaron
en F1 y nadie actualizó esta sección.

```typescript
type Role =
  // Roles BPM (F1) — los que se ofrecen en la UI
  | 'admin'          // CRUD completo + gestión de usuarios + integraciones
  | 'dueno_proceso'  // Dueño del proceso: crea y edita sus flujos
  | 'supervisor'     // Supervisa ejecución, edita flujos
  | 'operador'       // Ejecuta y actualiza flujos, sin crear
  | 'autorizador'    // Aprueba tareas de la matriz de aprobación
  | 'cumplimiento'   // Cumplimiento normativo
  | 'auditor'        // Solo lectura, incluida auditoría
  // Roles legacy — NO ofrecer en la UI, mantener por usuarios existentes
  | 'editor'
  | 'operator'
  | 'viewer'         // DEFAULT de profiles.role en la base
```

### Lectura de `audit_log` — `view_audit` manda en las dos capas

Solo `admin`, `dueno_proceso`, `cumplimiento` y `auditor` leen la auditoría.
Esa lista vive en **dos sitios que tienen que moverse juntos**:

1. `ROLE_PERMISSIONS` → permiso `view_audit` (`src/core/user.types.ts`), que
   gobierna el sidebar y la pestaña Auditoría de `Governance.tsx`.
2. La política `audit_read_org` de `audit_log`
   (`migrations/20260803_audit_read_por_rol.sql`).

**Si cambias una, cambia la otra.** Hasta el 03/08/2026 estaban descoordinadas
en sentidos opuestos: la RLS no filtraba por rol —cualquier `viewer` leía la
auditoría por API— mientras la UI bloqueaba el módulo entero a quien no tuviera
`manage_users` o `approve_tasks`, dejando fuera al propio `auditor`.

`audit_insert` sigue abierta a todo usuario autenticado de la organización, a
propósito: cada uno debe poder escribir su propia traza. No necesita `SELECT`
porque el INSERT no encadena `.select()`.

⚠️ Al restringir un `SELECT` por RLS, recuerda que **Postgres filtra filas, no
da error**. Una vista sin permiso no falla: sale vacía, y un vacío que miente es
indistinguible de "no hay datos". Comprueba el permiso antes de consultar, no
después.

### Ejecución de flujos — `execute_workflows` manda en las dos capas

Mismo caso que `view_audit`, y con el mismo desenlace. La lista de roles que
pueden lanzar un flujo vive en **dos sitios que tienen que moverse juntos**:

1. `ROLE_PERMISSIONS` → permiso `execute_workflows` (`src/core/user.types.ts`),
   que gobierna el botón Ejecutar de la pantalla.
2. La constante `ROLES_QUE_EJECUTAN` de `execute-workflow/index.ts`. Está
   copiada, no importada: una Edge Function corre en Deno y no alcanza `src/`.

Hoy son **tres**: `admin`, `dueno_proceso` y `autorizador`. Es una decisión de
negocio del 08/08/2026 — *«la ejecución de los procesos es del dueño del
proceso y el administrador o quien autoriza el proceso que está definido»*.
Hasta entonces la lista incluía también `supervisor`, `operador` y los legacy
`editor`/`operator`.

Fuera quedan `supervisor` y `operador` (supervisan y operan, pero lanzar es del
dueño), `cumplimiento` (aprueba, no ejecuta), `auditor`, `viewer` y los legacy.
`autorizador` sí ejecuta, y la **segregación de funciones sigue intacta**:
`resolve-approval` rechaza con 403 a quien intente aprobar una tarea del flujo
que él mismo lanzó (`solicitante_id === approverId`).

⚠️ Al estrecharlo, los dos `supervisor` que había dejaron de poder ejecutar y se
les reasignó el rol. **Censo contrastado contra la base el 13/08/2026 —
7 personas, todas activas:** 2 `admin` (Hermes Sánchez, Daniel Sanchez),
1 `dueno_proceso` (Abraham Espejo), 1 `supervisor` (Nahum Azevedo, alta el
12/08 18:38 UTC), 1 `autorizador` (**Khris Azevedo**, alta el 12/08 19:06 UTC),
1 `cumplimiento` (Nohemy Romero) y 1 `operador` (Katherine Sanchez). El único
rol vacío es `auditor`. Contrastar el censo antes de razonar sobre roles: media
docena de notas de este documento han hablado de usuarios que ya no estaban.

⚠️ **El alta del `autorizador` enciende su rama, como la del supervisor.** Gana
el botón de Ejecutar (`ROLES_QUE_EJECUTAN`), entra en `ROLES_APROBADORES` y
escala a `admin` al vencer — pero **nadie escala hacia él**: solo aprueba lo que
se le asigne a dedo en un nodo, o lo que le mande la matriz de aprobación (§6.5).

✅ **`authorize_critical` ya no existe** (13/08/2026). Era un permiso concedido a
`admin` y `autorizador` que **no leía ni una línea de código**: un candado
pintado en la pared. Borrarlo no quitó capacidad a nadie porque no daba ninguna,
y dejarlo era peor que no tenerlo — un permiso decorativo se lee como una
garantía. Lo que sí gobierna la autorización de un paso crítico es
`matriz_aprobacion`, conectada ese mismo día (§6.5). ✅ **`delegaciones` se
conectó el 14/08/2026 (§6.6)** — y resultó que no tenía «CRUD y cero lectores»
como decía esta nota: **no tenía tampoco el CRUD**. Ni una pantalla la escribía.

⚠️ **El alta de ese `supervisor` encendió dos comportamientos que llevaban
meses inertes**, y ninguno avisó:
1. `ESCALA_A.operador = 'supervisor'` (`cron-runner`): una aprobación de
   `operador` que vence ya escala **a una persona real**, no al vacío.
2. `cfg.approver ?? 'supervisor'` (`execute-workflow`, `case
   'processor:aprobacion'`): un nodo de aprobación **sin aprobador configurado**
   ya no crea una tarea huérfana — se la asigna en silencio al supervisor. El
   defecto no era inofensivo, solo estaba desactivado por falta de censo.
   ✅ **Ese `??` murió el 13/08/2026** al conectar `matriz_aprobacion` (§6.5):
   sin regla que case, el nodo revienta.

**Regla general: dar de alta a alguien en un rol vacío activa todas las ramas
de código que apuntaban a ese rol.** Antes de crear un rol nuevo, buscar el
slug en el código y ver qué se enciende.

Hasta el 07/08/2026 la Edge Function **no miraba el rol**: leía solo
`organization_id` del perfil, así que cualquier sesión válida de la organización
—un `viewer`, un `auditor`— podía ejecutar cualquier flujo llamando a la función
directamente. La pantalla escondía el botón; la API no lo impedía.

⚠️ **`cron-runner` no entra en esta matriz.** No es un endpoint de ejecución: es
el reloj, y su único llamante legítimo es el job de pg_cron. Exige `CRON_SECRET`
(§6.1) y rechaza todo lo demás con 401. Hasta el 07/08/2026 no comprobaba nada
y bastaba la clave anon —pública, va en el bundle del navegador— para disparar
el ciclo completo desde fuera.

⚠️ **Reanudar tampoco entra en esta matriz — y estrechar la lista la rompió.**
`action='resume'` no lanza nada: continúa un run que arrancó otra persona, y lo
que lo autoriza es **la aprobación que se acaba de conceder**, no el rol de
quien aprueba. Hasta el 11/08/2026 lo hacía el navegador llamando a
`execute-workflow` con el JWT del aprobador, así que pasaba por
`ROLES_QUE_EJECUTAN`: un `cumplimiento` aprobaba la tarea, se comía un 403 al
reanudar y **el run se quedaba en `esperando_aprobacion` para siempre**. Se vio
en producción con el flujo "Prueba Flujo 02032026" (tarea `aprobado`, run
paralizado). Hoy reanuda `resolve-approval` por la vía interna `x-cron-secret`.
Ojo: la frase que justificaba la vuelta por el frontend —*«las llamadas
inter-función tienen problemas de JWT»*— era cierta hasta el 07/08 y dejó de
serlo sin que nadie repasara lo que dependía de ella.

### 6.2 Aprobaciones — `ROLES_REGULATORIOS` manda en DOS capas

Los procesos de **cumplimiento y legitimación de capitales** los autoriza solo
el Oficial de Cumplimiento, **ni siquiera un admin**. Es decisión de negocio de
Hermes. El resto de tareas las resuelve el rol de `rol_aprobador` o un `admin`.

✅ **Desde el 14/08/2026 la lista vive en dos sitios, no en cuatro.**
`WorkQueue.tsx`, `Governance.tsx` y `Sidebar.tsx` tenían cada uno su copia de la
lista **y de la regla que la usa**; hoy las tres llaman a `puedeResolverTarea`
de `src/core/user.types.ts`, que es donde vive `ROLES_REGULATORIOS` en el
frontend. Quedan **`user.types.ts`** y **`resolve-approval/index.ts`, que es el
único que manda de verdad** — el primero solo decide qué botón se pinta. Esa
copia sí es irreducible: una Edge Function corre en Deno y no alcanza `src/`.

No era duplicación cosmética: las tres copias podían responder cosas distintas a
la misma pregunta, y la de la pantalla es la que decide si a alguien se le ofrece
un botón que luego se come un 403 (§12.2).

Hasta el 11/08/2026 la Edge Function **no miraba `rol_aprobador` ni una vez**:
validaba organización y segregación de funciones y nada más. La regla del
Oficial de Cumplimiento existía solo en el navegador, así que por API cualquier
usuario autenticado de la organización que no fuera el solicitante podía
aprobar una tarea de AML. Tercera vez que aparece el mismo patrón, después de
`audit_log` y de `execute-workflow`: **si una regla solo está en la pantalla,
no está.**

⚠️ **El escalamiento era la ventana de al lado.** `ESCALA_A` de `cron-runner`
llevaba `cumplimiento: 'admin'`: la tarea de AML vencía a las 48 h, pasaba a
`admin` y entonces sí la aprobaba un admin por la rama no regulatoria. La regla
se saltaba sola **con esperar**, sin tocar nada. Quedaron 7 tareas en la base
con `rol_aprobador_original='cumplimiento'` y `rol_aprobador='admin'`. Desde el
11/08/2026 `cumplimiento` **no escala**: al vencer se cancela el flujo y hay que
relanzarlo. Al cerrar una regla, repasa **todos** los caminos que escriben el
campo, no solo el que la comprueba.

### 6.3 El rol de un nodo de aprobación se guarda por su SLUG

`workflow_nodes.config_json.approver` guarda `'admin'`, no `'Administrador'`.
El motor lo copia tal cual a `tareas_aprobacion.rol_aprobador` y la UI lo
compara contra `profiles.role`, así que una etiqueta ahí crea una tarea que
**no puede resolver nadie** — ni el rol que creías haber elegido. Pasó con
"Flujo F2 NR" (`approver: "Administrador"`), y sobrevivía porque `canResolve`
tiene una salida «o eres admin» que disimulaba el dato roto.

Hoy lo valida `ROLES_APROBADORES` en `execute-workflow`: un rol que no exista
**revienta el nodo con un mensaje claro** en vez de pausar un flujo que nace
muerto. La lista —`admin`, `supervisor`, `autorizador`, `cumplimiento`— son los
roles reales con permiso `approve_tasks`, y está **copiada** de la constante
`ROLES` de `NodeConfigPanel.tsx`. Si cambias una, cambia la otra. Ese
desplegable ofrecía además `gerente_riesgos` y `actuario`, que no existen en
`profiles.role`: retirados el 11/08/2026.

⚠️ **Desde el 13/08/2026 el campo puede ir vacío, y vacío significa «que lo
decida la matriz» (§6.5)** — es la primera opción del desplegable, con ese texto.
No es lo mismo que «sin configurar»: antes el `<select>` **pintaba `'admin'`
sobre un campo que nadie había guardado**, así que el flujo prometía un aprobador
que el motor no iba a usar. Otro instrumento que dice algo sin haberlo medido,
como el `✓ Guardado` de §12.2. Y `getAutoDefaults` ponía `approver = 'admin'` a
un nodo de aprobación colgado de uno de AML, **saltándose la regla del Oficial de
Cumplimiento** (§6.2) desde el propio asistente: hoy pone `categoria = 'aml'` y
deja que la matriz decida.

### 6.4 Recuperación de contraseña — dos caminos, una sola marca

Hasta el 13/08/2026 **un olvido de contraseña dejaba a la persona fuera para
siempre**: no había autoservicio (cero llamadas a `resetPasswordForEmail` en
todo `src/`), `ChangePasswordModal` solo servía estando ya dentro, y
`admin-create-user` generaba clave temporal **únicamente en el alta**. Con un
solo `cumplimiento`, si la que se quedaba fuera era Nohemy se paraba **toda**
aprobación de AML (§6.2). Encargo de Hermes.

Dos vías, y las dos acaban en el mismo sitio:

1. **El administrador asigna una clave temporal** — `admin-reset-password`.
   Solo `admin`, y la organización sale del **perfil del llamante, nunca del
   cuerpo**. Rechaza restablecerse a uno mismo: para eso está «Cambiar mi
   contraseña», que **sí pide la actual**; saltarse esa comprobación desde
   Gobierno le daría a cualquiera con una sesión de admin abierta una forma de
   cambiar su propia clave sin conocerla. La clave vuelve **una vez** y no se
   guarda en ningún sitio: la auditoría registra **el hecho, jamás el secreto**.
2. **El usuario se lo pide él mismo** — `request-password-reset`, endpoint
   **público** (`--no-verify-jwt`). Responde **exactamente lo mismo** exista la
   cuenta, esté inactiva o haya superado el límite: si distinguiera, sería un
   comprobador de «¿trabaja fulano aquí?» abierto a internet. Máximo 3 peticiones
   por cuenta cada 15 minutos, contadas sobre `audit_log`
   (`entidad='sesion'`) — sin tabla nueva y a la vista de un auditor.

⚠️ **El enlace lo manda Resend, no el mailer de Supabase.** Se usa
`generateLink({type:'recovery'})` para *fabricar* el enlace y se envía por
`_shared/email.ts`. `resetPasswordForEmail` habría abierto un segundo canal de
salida —otro remitente, otra plantilla, otra reputación de dominio— contra §9.1.
Necesita el secreto **`APP_URL`** (Edge Functions → Secrets) y esa misma URL en
*Authentication → URL Configuration → Redirect URLs*, o Supabase descarta el
`redirectTo`. Sin `APP_URL` la función **falla con 500 y lo dice**: un correo con
un enlace roto es peor que un error en pantalla.

⚠️ **El enlace de recuperación NO inicia sesión — `detectSessionInUrl: false`.**
`createClient` viene con esa opción activada, y así supabase-js canjea los tokens
del hash y **guarda la sesión antes de que corra una línea de la aplicación**. La
persona queda dentro: cierra la pestaña, vuelve a entrar y sigue dentro **sin
haber recordado nunca su contraseña**. Un enlace de correo que hace eso vale
tanto como la clave, y entonces olvidarla deja de importar. Se vio el 13/08/2026
en la primera prueba real de Hermes.

Cómo queda, y por qué cada pieza:
- El cliente arranca con `detectSessionInUrl: false` (`src/core/supabase.ts`).
  Ese hash pasa a ser texto. Se puede apagar porque aquí **solo se entra con
  usuario y contraseña**: ni OAuth ni enlaces mágicos.
- `App.tsx` lee los tokens en el cuerpo del módulo y **borra el hash de la barra
  de direcciones acto seguido** — dentro va un `refresh_token`, y dejarlo en el
  historial del navegador es dejar una credencial escrita en la pared. Después
  solo viven en memoria: un refresco obliga a pedir otro enlace, y eso es lo
  correcto.
- `authService.setNewPassword(tokens, clave)` abre la sesión, cambia la clave y
  **la cierra en un `finally`**. El cierre no es limpieza, es el control: si el
  enlace caducó, si la clave se rechaza o si se cae la red, tampoco puede quedar
  una sesión abierta. `signOut()` es `scope: 'global'` por defecto, así que
  además echa a las demás sesiones de esa cuenta — cambiar la contraseña debe
  hacer eso.
- Se retiró el escuchador de `PASSWORD_RECOVERY`: ese evento **lo dispara
  `detectSessionInUrl`**, así que apagada la opción no puede saltar nunca. Una
  red de seguridad que ya no puede atrapar nada es de la familia del `succeeded`
  de pg_cron (§6.1) y del `✓ Guardado` sin escritura (§12.2).

**La marca: `profiles.debe_cambiar_clave`.** Mientras una clave la conozca quien
la generó, la cuenta tiene **dos dueños**. La columna es `NOT NULL DEFAULT
false` y el frontend la lee `p.debe_cambiar_clave !== false`: **ausente ⇒
obligar el cambio**. Misma familia que `token !== ''` (§6.1), `'' === ''` (§9.4)
y la huella `NULL` (§9.5) — lo que no se puede comprobar no puede acabar
diciendo que sí. Con la marca puesta **no se pinta la aplicación**: el modal
sale sin X, sin cancelar y sin cerrarse al pulsar fuera, y la única salida es
cerrar sesión.

La quita `marcar_clave_cambiada()`, **`SECURITY DEFINER` sin parámetros**, porque
`profiles` solo lo escribe un admin y debe seguir así: una política de «edita tu
propia fila» dejaría a cualquiera cambiarse el `role`. Toca una columna de una
fila, la de `auth.uid()`.

⚠️ **`REVOKE ... FROM PUBLIC` NO quita un permiso concedido por nombre**, y el
ensayo de la migración lo demostró: Supabase tiene `ALTER DEFAULT PRIVILEGES`
que dan EXECUTE a `anon`, `authenticated` y `service_role` sobre cada función
nueva de `public`, así que tras el REVOKE **`anon` seguía con EXECUTE**. Hay que
nombrarlo. Ensaya siempre con `ROLLBACK` antes de un `COMMIT`.

### 6.5 La matriz de aprobación ya DECIDE — y falla cerrado

Hasta el 13/08/2026 `matriz_aprobacion` tenía CRUD completo en Gobierno y **no
la leía ninguna Edge Function**. La parametrización estaba pagada y desconectada:
el usuario configuraba reglas en una pantalla y el motor seguía usando
`config_json.approver` con aquel `?? 'supervisor'`. Cuarta variante del patrón de
siempre —`audit_log`, `execute-workflow`, `resolve-approval`— pero al revés: **la
regla no estaba ni en la pantalla ni en el motor; estaba en una tabla que nadie
consultaba.**

**Cómo decide ahora un `processor:aprobacion`:**

1. Si el nodo trae `config_json.approver` con un rol, **manda el nodo**. Es lo
   que hacen los 6 nodos de aprobación que hay en producción (4 `cumplimiento`,
   2 `admin`), así que conectar la matriz **no cambió el comportamiento de ni un
   flujo vivo**.
2. Si el campo va **en blanco** (nueva opción «— Según la matriz de aprobación —»
   del Constructor), se consulta la matriz con la `categoria` y el `monto` del
   nodo, dos campos que el formulario **no tenía**: sin ellos un nodo no podía
   dirigirse a la matriz aunque quisiera.
3. **Sin regla que case, el nodo revienta** con un mensaje escrito para una
   persona. No hay aprobador por defecto, y no puede haberlo: el defecto anterior
   es exactamente lo que convertía un flujo mal configurado en uno que parecía
   funcionar. Misma familia que `token !== ''` (§6.1), `'' === ''` (§9.4) y la
   huella `NULL` (§9.5).

**Precedencia** (mayor gana): nivel → categoría concreta por encima de comodín →
umbral más alto. Una regla sin categoría es comodín; un nodo sin categoría **no**
hereda las reglas de nadie, o una aprobación de AML acabaría colgada de un flujo
que nunca dijo ser de AML.

⚠️ **Un empate con efectos distintos es un error, no un desempate.** Si dos
reglas compiten con la misma precedencia y piden cosas distintas —rol, horas de
escalamiento o número de aprobadores— el nodo se detiene y las nombra. Elegir una
al azar sería una configuración rota en silencio. Producción tuvo ese caso el
mismo día que se conectó la matriz: dos reglas «Verificación OFAC/PEP —
Cumplimiento» idénticas en nivel, categoría y umbral que diferían en
`escalamiento_horas` (48 vs 24). **Hermes borró la duplicada el 13/08/2026.**

**Estado de la matriz al 13/08/2026 — dos reglas, las dos activas y de
`cumplimiento`, nivel 1, sin umbral:** `aml` («Verificación OFAC/PEP», 24 h,
`aplica_automatico`, condición *solo si en_lista = true*) y `ofac` («Listas
Restrictivas», 48 h). Categorías distintas ⇒ no pueden empatar.

**Las categorías también se guardan por SLUG**, como los roles (§6.3), y desde el
13/08/2026 el formulario **las normaliza al guardar** (`norm`, exportada del
gemelo): lo que se almacena es lo que el motor compara. Antes solo se normalizaba
**al comparar**, que tapaba el síntoma y dejaba en la tabla rótulos humanos —
había una regla con `categoria = "Sanciones OFAC"`, con espacio y mayúsculas, que
casaba de milagro y que un auditor leía sin saber qué teclear en el nodo. Se
corrigió a `ofac`, el slug que ya nombraba el propio asesor de `Governance.tsx`.

⚠️ **`src/utils/matrizAprobacion.ts` y `supabase/functions/_shared/matriz.ts` son
gemelos copiados**, como `fecha.ts` (§9.3): Deno no alcanza `src/`. **El de Deno
manda** —es el que crea la tarea—; el de `src/` solo alimenta el simulador de
Gobierno. Y son idénticos a propósito: un simulador que empareja con otras reglas
que el motor no es un simulador, es una segunda opinión que nadie pidió. Se
verifican con `diff` a partir de la línea 16 (todo salvo la cabecera). Por lo
mismo se retiró `resolverAprobador` de `governance.service.ts`: un segundo
emparejador con otro criterio y cero llamantes es una respuesta distinta
esperando a que alguien la invoque por error.

Tocar la matriz deja rastro en `audit_log` (`entidad='matriz_aprobacion'`, valor
añadido al CHECK por `20260813_audit_matriz_aprobacion.sql`). En cuanto una tabla
gobierna un control interno, editarla es un hecho auditable.

### 6.6 Delegaciones — una suplencia acotada, y la puerta de §6.2 cerrada

Hasta el 14/08/2026 `delegaciones` era una tabla con RLS, claves foráneas y
**cero referencias en todo el código**: ni una línea que la leyera ni una
pantalla que la escribiera. (Esta sección decía que sí tenía CRUD; no lo tenía.)

Lo que arregla conectarla es concreto: hay **un** `cumplimiento` (Nohemy Romero),
las tareas de AML no las resuelve nadie más —ni un admin (§6.2)— y desde el
11/08 tampoco escalan: al vencer **cancelan el flujo**. Que esa persona esté de
baja una semana no era un contratiempo, era la parada de todas las aprobaciones
regulatorias.

**La decisión que gobierna el diseño.** Una delegación **sí** alcanza a las
tareas regulatorias — si no las alcanzara no resolvería nada, porque el único
punto único de fallo real es justo ese. Pero eso la convierte en la puerta de al
lado de §6.2, y este proyecto ya sabe cómo acaba eso (el escalamiento rodeaba la
regla del Oficial de Cumplimiento con solo esperar 48 h). Así que la puerta se
cierra **en la base, no en la pantalla**:

> **Una delegación de alguien con rol regulatorio solo puede crearla esa misma
> persona.** Un admin no puede nombrarse suplente del Oficial de Cumplimiento; si
> pudiera, §6.2 sería decorativa — bastaría un clic.

La RLS que ya había (`deleg_write`: `is_admin() OR usuario_id = auth.uid()`) **no
basta** para eso: deja al admin escribir cualquier fila. Por eso hay un trigger,
`delegaciones_validar()` (`20260814_delegaciones_operativas.sql`), que además
rechaza delegar en uno mismo, fechas invertidas, suplente desactivado, personas
de otra organización y **solapes con otra delegación viva de la misma persona**
—dos suplentes a la vez es una ambigüedad, y §6.5 ya enseñó que un empate con
efectos distintos se resuelve mal solo—. Es `SECURITY DEFINER` porque necesita
leer `profiles` de otros, con `search_path` fijo y EXECUTE retirado **a `anon`
por su nombre** (§6.4).

**Dónde entra la suplencia — son TRES sitios, no uno.** Esto es lo que hay que
recordar si algún día se toca:

1. **Quién puede resolver** — `resolve-approval/index.ts`, la única capa que
   manda. Un rol delegado cuenta igual que el propio; la **segregación de
   funciones no la levanta ninguna delegación** (quien lanzó el flujo sigue sin
   poder aprobarlo).
2. **A quién se avisa cuando un flujo se pausa** — `execute-workflow`.
3. **A quién se avisa al escalar** — `cron-runner`.

Los dos últimos filtraban con un `.eq('role', …)` a secas. Sin tocarlos, el
suplente habría sido **la única persona del sistema a la que nadie avisaba de que
tenía algo que aprobar**: la delegación funcionaría y no serviría de nada. Hoy
los tres pasan por `destinatariosDelRol` / `delegacionesVigentes`, y el correo al
suplente dice de parte de quién le llega.

**Qué queda registrado.** `tareas_aprobacion.delegacion_id` guarda la delegación
usada, **adrede sin clave foránea**: un `ON DELETE SET NULL` borraría el hecho al
limpiar la delegación, y un control cuya evidencia se puede borrar no es un
control. El registro legible vive además en `audit_log`, cuya descripción termina
en `[por delegación de …]`. Tocar `delegaciones` es auditable
(`entidad='delegacion'`), por lo mismo que `matriz_aprobacion`.

⚠️ **`src/utils/delegaciones.ts` y `supabase/functions/_shared/delegaciones.ts`
son gemelos**, como `fecha.ts` (§9.3) y `matriz.ts` (§6.5): **manda el de Deno**.
Aquí, a diferencia de los otros pares, **el manejo de errores es distinto a
propósito**: el de Deno **lanza** —un `{ error }` sin leer convertiría un fallo
de lectura en un 403 mentiroso—, y el del navegador se lo traga y devuelve `[]`.
El peor caso del navegador es que un botón no se pinte; nunca que se pinte de
más.

**No hay cadenas de delegación.** Si A delega en B y B delega en C, C no hereda
el rol de A: una cadena es una autorización que no tomó nadie.

### 6.7 Ciclo de vida de la definición — `borrador → en_revision → publicado`

✅ **EN PRODUCCIÓN desde el 14/08/2026.** Ensayada primero con 18 de 18 pruebas
de comportamiento dentro de una transacción con `ROLLBACK`, aplicada después, y
comprobada contra la base **fuera** de la transacción: 1 flujo `publicado`, 12 en
`borrador`, la RPC con EXECUTE solo para `authenticated` (`anon` fuera, §6.4),
los cinco triggers y la fila de convalidación con `actor_id NULL`.

⚠️ **El orden del despliegue no es indiferente, y quedó anotado porque la próxima
vez no se ve venir: la migración va ANTES que las Edge Functions.**
`execute-workflow` y `cron-runner` leen `estado_definicion`, y `cron-runner` la
pide dentro del `select` de nodos cron — sin la columna PostgREST tumba la
consulta **entera** y el reloj deja de disparar todo, no solo lo nuevo. Aquí se
hizo en ese orden y se comprobó en `net._http_response` que las corridas
siguientes seguían dando 200 con `checked: 3`.

Hasta hoy un flujo pasaba de la cabeza de quien lo diseñaba a producción sin que
nadie más lo mirara: el `dueno_proceso` lo dibujaba, lo activaba y lo ejecutaba
él mismo. Los mismos ojos en las dos puntas. Esto es lo que ocupa el hueco que
dejó sacar a `supervisor` de la edición (§12.2): *quien autoriza no edita*, pero
hasta ahora tampoco tenía nada que autorizar a nivel de definición.

**`workflows.estado_definicion`**, columna propia. **No se reutiliza
`workflows.status`**, que es cómo acabó la última ejecución: sobrecargar esa
columna es lo que hizo que `status='paused'` no significara nunca nada.

**Quién mueve qué** — la lista vive en `ROLE_PERMISSIONS` → `authorize_workflows`
(`src/core/user.types.ts`) **y repetida dentro de `transicionar_flujo()`**,
porque es SQL y no puede importar TypeScript. Otro par que se mueve junto, como
`execute_workflows` (§6) y `view_audit` (§6). Hoy: envía a revisión quien tiene
`manage_workflows` (`admin`, `dueno_proceso`, `editor`); autoriza o rechaza quien
tiene `authorize_workflows` (`admin`, `supervisor`, `autorizador`).

**Todo lo decide `transicionar_flujo(workflow_id, accion, motivo)`**, una RPC
`SECURITY DEFINER` — con `search_path` fijo, `REVOKE` a `anon` **por su nombre**
(§6.4) y `GRANT` solo a `authenticated`. El frontend no repite ni una regla:
`WorkflowService.transicionar` transporta la respuesta y ya. Lo que comprueba, en
orden: sesión → perfil activo → **organización** (DEFINER se salta la RLS, así
que la comprobación tiene que estar escrita) → rol → estado de origen → **cuatro
ojos: quien envió a revisión no autoriza** → motivo obligatorio al rechazar →
validaciones de publicación.

**Las validaciones de publicación no son teóricas.** Un flujo no se publica si no
tiene nodos, si no tiene ningún `type='trigger'`, o si le queda un
`processor:decision` sin configurar —el `'' === ''` que va siempre por la rama
`true` (§9.4)—, y el mensaje **nombra los nodos culpables**. Medido sobre los 13
flujos de producción: **4 no pasarían** (3 con una decisión sin configurar, entre
ellos "Prueba Flujo 02032026"; 1 sin disparador, "Score AML Automático").

**Dos triggers, porque la pantalla no es una capa de seguridad:**

1. `workflows_estado_guard` — un `UPDATE` normal **no puede promover** un flujo
   (hace falta el marcador de sesión que solo pone la RPC), y **no se puede
   activar lo que no está publicado**. Degradar sí se permite siempre: un control
   que estorba para *apagar* algo se aprende a rodear.
2. `workflow_definicion_cambiada` — tocar nodos o conexiones de un flujo
   publicado lo **devuelve a borrador y lo desactiva**, y deja traza. Va sobre la
   tabla y no dentro de `guardar_lienzo()` porque `nodes_editor_write` deja
   escribir por API sin pasar por la RPC.
3. `workflow_run_vivo_guard` — no se edita la definición de un flujo con un run
   `running` o `esperando_aprobacion`. Complementa la huella de §9.5: aquella
   **rechaza al reanudar**, esta impide llegar a ese punto.

⚠️ **Qué cuenta como «cambio de la definición»: lo que cambia el comportamiento.**
Mover una caja por el lienzo (`position_x/y`) y escribir `status` **no** degradan
ni bloquean — es el mismo criterio de la huella de §9.5, y los tres triggers
comparten una sola definición de «cambio» a propósito. Tampoco degradan `name`,
`description` ni `is_active`: renombrar un flujo no es rediseñarlo.

**La traza vive en `workflow_autorizaciones`** (`accion`, `actor_id`,
`actor_email`, `motivo`, estado desde/hasta). `actor_id` va **sin FK y anulable**
adrede, igual que `tareas_aprobacion.delegacion_id` (§6.6): borrar a un usuario no
puede borrar el hecho de que autorizó. La tabla tiene RLS con **solo una política
de SELECT**: nadie escribe en ella desde fuera —que no haya política *es* la
política—, solo la RPC, que es DEFINER. El registro legible va además a
`audit_log`.

⚠️ **La migración deja en `publicado` los flujos que ya estaban activos, y en
`borrador` todos los demás.** Los activos se convalidan con una fila de traza de
`actor_id NULL` cuyo motivo dice que es una convalidación de migración, **no la
autorización de una persona**. Consecuencia real y no menor: de los 13 flujos de
producción solo uno está activo, así que **los otros 12 no se podrán activar sin
pasar por revisión** — y quien los envía no puede autorizarlos él mismo.

⚠️ **Reanudar (`action='resume'`) está exento del requisito de `publicado`**, a
propósito. Lo que protege un run pausado es la huella de §9.5, que compara
definiciones; exigir aquí el estado dejaría colgado para siempre cualquier run
que estuviera esperando una aprobación cuando su flujo se despublicó — que es
exactamente como se paralizó "Prueba Flujo 02032026" (§6).

⚠️ **`estado_definicion` solo RESTRINGE la ejecución, nunca la concede.**
`CICLO_VIDA_FLUJOS.md` §4 propone darle `execute_workflows` a `operador` sobre lo
publicado; **no está hecho**, porque revierte la decisión de Hermes del
08/08/2026 (§6) y eso es suyo, no mío. Es aditivo: una línea en
`ROLE_PERMISSIONS` y otra en su gemelo de Deno.

### 6.1 Llamadas internas: `x-cron-secret`, NUNCA comparar `Authorization`

**El secreto de las Edge Functions está en el formato NUEVO.**
`SUPABASE_SERVICE_ROLE_KEY` vale `sb_secret_…` — 41 caracteres, **no es un
JWT**.

El proyecto convive con los dos formatos: existen las cuatro claves
(`anon` y `service_role` legacy en JWT, más `sb_publishable_…` y `sb_secret_…`),
y **el frontend todavía arranca con la anon legacy** (`VITE_SUPABASE_ANON_KEY`
empieza por `eyJ`). O sea: las legacy siguen vivas y aceptadas. Lo que cambió es
qué formato hay puesto en el secreto de las funciones.

De ahí la regla que costó ocho días de cron muerto:

> **Una llamada interna se reconoce por la cabecera `x-cron-secret`, no por que
> `Authorization` traiga la service_role key.** supabase-js manda las claves del
> formato nuevo en `apikey` y deja `Authorization` **vacía**, así que
> `token === SERVICE_ROLE_KEY` da siempre falso.

`cron-runner` invocaba `execute-workflow` y este, al no reconocer la llamada
como interna, se iba por la rama de usuario del navegador, no encontraba sesión
y devolvía 401 en **cada** disparo. Hoy `execute-workflow` acepta las dos vías
—`x-cron-secret` o la clave— y `CORS['Access-Control-Allow-Headers']` incluye
`x-cron-secret`: si falta ahí, el preflight la tumba.

Reglas que se desprenden:

1. **`CRON_SECRET` es un secreto propio del disparador**, 64 caracteres hex, en
   *Edge Functions → Secrets*. No lleva caracteres que un copiar-pegar pueda
   estropear en silencio, que es exactamente lo que pasó dos veces con la
   service_role key. **El comando del job se escribe desde dentro de la base,
   con el secreto como parámetro (`$1`)**, no concatenado: así no cruza ninguna
   capa de comillas.
2. **`cron-runner` y `execute-workflow` se despliegan con `--no-verify-jwt`.**
   Su autorización es el bloque de código, no la puerta de Supabase: con
   verificación de JWT activada el gateway rechaza al llamante *antes* y
   devuelve un 401 que no explica nada.

   ⚠️ **La bandera NO se recuerda sola: no hay `config.toml`, así que cada
   `functions deploy` sin ella vuelve a poner `verify_jwt=true`.** Es decir, un
   despliegue rutinario de `execute-workflow` —aunque solo cambie un texto—
   reintroduce el fallo de los ocho días de cron muerto, porque `cron-runner`
   invoca con `functions.invoke` pasando solo `x-cron-secret` y supabase-js deja
   `Authorization` vacía. Pasó el 12/08/2026 al desplegar un mensaje de error.

   **La forma del 401 dice quién rechaza**, y hay que sondearlo *después* de
   cada despliegue, no antes:

   | Respuesta a un POST sin cabeceras | Significa |
   |---|---|
   | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` | la **puerta** — `verify_jwt=true`, el cron está roto |
   | un error propio de la función (`{"error":"workflowId y organizationId son requeridos"}`) | el **código** — correcto |
3. **Comparar contra un secreto exige `token !== ''`.** Si la variable llegara
   vacía por un despliegue mal configurado, `'' === ''` haría interna toda
   petición **sin** cabecera. En `resolve-approval` eso es grave: una llamada
   interna elige a dedo quién aprueba. Guardado en las tres funciones.

⚠️ **`net.http_post` es asíncrono.** Encola y devuelve un id — ese id es el
`"1 row"` de `cron.job_run_details.return_message`. pg_cron dice `succeeded`
aunque el HTTP haya dado 401. **La verdad está en `net._http_response`**
(`status_code`, `content`, `timed_out`). Ese instrumento que informaba de salud
sin medirla es lo que escondió el fallo ocho días. Y el timeout por defecto de
pg_net son 5 s: el job lleva `timeout_milliseconds := 30000` porque disparar un
flujo y mandar correos pasa de cinco segundos.

---

## 7. Políticas RLS — Reglas Absolutas

1. **Aislamiento total entre organizaciones** — usuario de org A nunca ve datos de org B
2. **Patrón estándar:**

```sql
CREATE POLICY "tenant_isolation" ON nombre_tabla
  USING (organization_id = (
    SELECT organization_id FROM profiles
    WHERE id = auth.uid()
  ));
```

3. **Edge Functions:** Validar `organization_id` del JWT antes de ejecutar cualquier nodo
4. **Credenciales de integraciones:** Almacenadas en `integrations.config_json` encriptado — NUNCA en el frontend
5. **Audit trail:** Toda ejecución registrada en `execution_logs`

---

## 8. Integraciones con los 4 Sistemas

Cada sistema tiene su propio Supabase. HermesAI Flow se conecta como cliente **solo lectura** usando la Service Role Key de cada sistema (guardada en Supabase Secrets, nunca en frontend).

```
HermesAI Flow Edge Function
    → Supabase Client con service_role de RiskGuard
    → Lee: siniestros, riesgos, KRIs, alertas AML
    → NUNCA escribe en el sistema origen
```

### Contrato de integración por sistema

| Sistema | Datos que lee | Trigger posible |
|---------|--------------|-----------------|
| RiskGuard | siniestros, riesgos, KRIs, alertas AML, tasas BCV | webhook post-update |
| EE.FF. | balances, indicadores financieros, alertas Benford | cron diario |
| Indicadores | KPIs, OKRs, tableros BSC | cron / umbral |
| LegalTech | expedientes, vencimientos, honorarios, alertas RGPD | webhook / cron |

---

## 9. Motor de Ejecución — Edge Functions

El frontend **NUNCA ejecuta nodos directamente**. Todo pasa por Edge Functions:

```
Frontend → invoke('execute-node', { nodeId, workflowId, payload })
               ↓
         Edge Function valida JWT + organization_id
               ↓
         Ejecuta el nodo (email, IA, lectura, etc.)
               ↓
         Registra en execution_logs
               ↓
         Retorna resultado al frontend
```

**Límites a respetar:**
- Timeout Edge Functions: 150 segundos máximo
- Para flujos largos: encadenar llamadas, no una sola función monolítica
- Informes IA complejos: usar streaming de Claude API

### 9.1 El correo sale por un solo sitio — `_shared/email.ts`

**Canal único: Resend.** Sin respaldo. Migrado desde SMTP de Gmail el 07/08/2026
(punto 4 del orden de trabajo de la plataforma).

```
REMITENTE = 'HermesAI Flow <no-responder@avisos.hermesaitech.com>'
```

`avisos.hermesaitech.com` está verificado **a nivel de plataforma** (Resend,
`eu-west-1`) y lo comparten TurnoGuard, RiskGuard y Estados Financieros. De ahí
salen tres reglas:

1. **El remitente va en el código, en la constante `REMITENTE`. Nunca en un
   secreto.** `NOTIF_EMAIL_FROM` es de TurnoGuard; llegó a estar puesto en este
   proyecto sin que lo leyera nadie, y antes en el de RiskGuard. Borrado el
   07/08/2026. Si aparece otra vez, sobra.
2. **El campo «De:» de un nodo Email no gobierna el `From`** — se degrada a
   Reply-To. Si llegara tal cual a la API, cualquiera con permiso para editar un
   flujo podría enviar como `facturacion@avisos.hermesaitech.com` sobre el
   subdominio de los cuatro productos.
3. **Varios destinatarios ⇒ envío en lote** (`POST /emails/batch`): una sola
   petición, un correo separado por persona. El límite de Resend son **2
   peticiones por segundo**, así que un bucle con un envío por destinatario
   empieza a recibir 429; y metiéndolos a todos en el mismo `to`, cada uno ve
   las direcciones de los demás. Máximo 100 mensajes por lote y 50 direcciones
   por mensaje. **El lote es atómico:** una dirección mal escrita tumba el envío
   entero, por eso se valida antes de salir.

El único secreto es `RESEND_API_KEY`, en *Supabase → Edge Functions → Secrets*.
Cuatro funciones mandan correo (`execute-workflow`, `cron-runner`,
`resolve-approval` y el nodo Email dentro del motor) y **las cuatro pasan por
este fichero**. No abrir un segundo camino: en concreto, este producto **no
lleva Netlify Functions** — eso es de Estados Financieros, que sí las necesitaba
porque su correo salía del navegador.

⚠️ **El correo aquí lo dispara el motor, no siempre una sesión.** `cron-runner`
corre por pg_cron sin nadie delante. Por eso la validación de JWT que lleva la
función de correo de Estados Financieros **no se replica aquí y no hace falta**:
el correo no tiene endpoint propio, sale desde dentro de funciones que ya
autentican en su puerta (`execute-workflow` reconoce la llamada del cron por
`x-cron-secret` —§6.1— o contrasta un JWT de usuario contra su
`organization_id`).

### 9.2 El cron se evalúa en hora de Venezuela, no en UTC

Las Edge Functions corren en UTC. Un `0 9 * * 1-5` interpretado en UTC dispara
a las 05:00 de Caracas: el usuario programa a las 9 y el flujo sale de noche.
`cron-runner` convierte la hora antes de comparar:

```ts
const ZONA_HORARIA = 'America/Caracas';
```

Con `Intl.DateTimeFormat` y **`hourCycle: 'h23'`** — sin `h23`, medianoche se
formatea como `24` y ningún cron con `0` en la hora casa nunca. Se usa `Intl` y
no «restar cuatro horas» a propósito: Venezuela no tiene horario de verano pero
**sí cambió de huso en 2007 y en 2016**, y una resta a mano se queda vieja sin
avisar.

La UI etiqueta las horas como *hora de Venezuela* por lo mismo. `matchesCron`
entiende `*`, rangos (`1-5`), pasos (`*/5`), listas (`1,3,5`) y valores exactos.

⚠️ **`workflow_nodes` guarda `type='trigger'` y `category='cron'` en columnas
separadas.** `trigger:cron` es el nombre del `case` del motor, que compone las
dos — **no** es el valor de ninguna columna, y filtrar por él no casa ni una
fila.

### 9.3 `'es-VE'` es el idioma, NO el huso — toda fecha pasa por `fecha.ts`

El motor disparaba bien y la pantalla contaba otra cosa. `toLocaleString('es-VE')`
fija el **idioma y el formato** (dd/mm, «a. m.»); **el huso lo toma del entorno**
si no se le pasa `timeZone`. Resultado, medido el 11/08/2026 con el flujo BCV:

| Ejecución real | Pantalla en Caracas | Pantalla en Madrid | En un correo (Edge Function) |
|---|---|---|---|
| 13:00 UTC = **09:00 VE** | 09:00 ✅ | **15:00** ❌ | **13:00** ❌ |

Desde Caracas acertaba por casualidad, así que el fallo solo aparece cuando el
que mira está en otro huso — y el CIO trabaja desde España. En el correo era
peor porque **sale del sistema**: al aprobador le llegaba un «Vence» **cuatro
horas adelantado**, y las Edge Functions corren en UTC siempre, mire quien mire.

Hay además un efecto de fecha, no solo de hora: entre las 20:00 y las 24:00 de
Venezuela el UTC ya va por el día siguiente, así que un evento de las 22:30
aparecía fechado mañana. Es el mismo motivo por el que `partesLocales` saca el
día de la semana de la fecha **local** ya resuelta.

**Regla: ninguna fecha se formatea a mano.** Todo pasa por los helpers, que son
los únicos sitios donde aparece `timeZone`:

- `src/utils/fecha.ts` → `fechaHoraVE`, `fechaVE`, `horaVE` (frontend)
- `supabase/functions/_shared/fecha.ts` → `fechaHoraVE`, `fechaVE` (Deno)

⚠️ **Son gemelos copiados, no importados** — Deno no alcanza `src/`, igual que
`ROLES_QUE_EJECUTAN` (§6). **Si cambias uno, cambia el otro.**

Los `toLocaleString('es-VE')` que quedan en el código son de **importes**, no de
fechas, y ahí el locale sí es lo único que hace falta.

### 9.4 Un `processor:decision` sin configurar va SIEMPRE por la rama `true`

Con `config_json = {}` el motor evalúa `'' === ''`: verdadero siempre. No es
aleatorio, es determinista — y por eso engaña: el flujo se ejecuta entero, sin
un solo error, y **la rama `false` no se recorre jamás**. Un nodo colgado de esa
rama parece instalado y es código muerto.

Es la misma familia que la regla `token !== ''` de §6.1: la cadena vacía casa
con la cadena vacía, y una comparación que nadie configuró se convierte en un
«sí» permanente.

⚠️ Al revisar un flujo, **un `Decisión (Si/No)` sin configurar es un hallazgo**,
no un detalle pendiente. Se detectó así el 12/08/2026 en `Prueba Flujo 02032026`.

### 9.5 Se aprueba una versión y se ejecuta esa — huella al pausar

`execute-workflow` carga nodos y conexiones **antes** de bifurcar a `resume`.
Con eso, un run pausado esperando aprobación —hasta 48 h— reanudaba releyendo la
definición **actual** del flujo: se aprobaba la versión A y continuaba la B.
Podía haber cambiado el destinatario de un correo, la rama de una decisión o el
`rol_aprobador` de un nodo posterior, y no quedaba registro en ningún sitio. Lo
aprobado y lo ejecutado dejaban de ser lo mismo **en silencio**, que es el
mismo mal de siempre: el sistema no mentía, es que nadie estaba midiendo.

Desde el 12/08/2026, al pausar se guarda `execution_runs.definicion_huella` —un
SHA-256 de la definición— y al reanudar se recalcula. Si no coincide, **no se
reanuda**: el run pasa a `error`, se deja un `execution_logs` con las dos
huellas y la función devuelve **409** con un motivo escrito para una persona.

Detalles que no son accesorios:

1. **La huella cubre lo que cambia el comportamiento** (id, tipo, categoría,
   título y `config_json` de cada nodo; origen, destino y **`branch`** de cada
   conexión) y **deja fuera la posición en el lienzo**. Mover un nodo no cambia
   lo que hace, y un control que salta por arrastrar una caja es un control que
   la gente aprende a ignorar. `branch` sí entra: mover una conexión de la rama
   `true` a la `false` no cambia qué nodos hay, pero cambia todo lo que pasa.
2. **Las claves de los objetos se ordenan antes de serializar** (`canonico`).
   `JSON.stringify` respeta el orden de inserción, así que sin eso un
   `config_json` reescrito con los mismos valores en otro orden daría una huella
   distinta y bloquearía un flujo que no cambió.
3. **Un `NULL` es un fallo, no un permiso.** Los runs anteriores a la migración
   no tienen huella; eso significa «no se puede comprobar», y se rechaza igual.
   Misma familia que el `token !== ''` de §6.1 y el `'' === ''` de §9.4: la
   comparación que nadie preparó no puede acabar diciendo que sí.
4. **El run tiene que ir a `error`, no quedarse en `esperando_aprobacion`.** La
   expiración de `cron-runner` solo mira tareas con `estado='pendiente'`, y a
   estas alturas la tarea ya está `aprobado`: dejarlo pausado lo cuelga para
   siempre, que es exactamente como se paralizó "Prueba Flujo 02032026".

Esto **rechaza**, no reanuda la versión aprobada. Guardar la definición entera
—que sí permitiría continuar la buena— es el versionado de
`CICLO_VIDA_FLUJOS.md` §3; la huella cuesta una columna y falla cerrado.

---

## 10. Nodo IA — Claude API

**Modelo informes complejos:** `claude-opus-4-7` (con `thinking: { type: 'adaptive' }`)  
**Modelo clasificación/extracción:** `claude-sonnet-4-6`

```typescript
// Tipos de informes soportados
type ReportType =
  | 'kpi_summary'          // Resumen ejecutivo de KPIs
  | 'financial_statement'  // Análisis EE.FF. bajo NIIF
  | 'risk_report'          // Informe de riesgos y cumplimiento
  | 'claims_report'        // Análisis de siniestralidad
  | 'aml_report'           // Reporte AML/CFT
  | 'custom'               // Prompt personalizado por el usuario
```

---

## 11. Variables de Entorno

```env
# Supabase — HermesAI Flow (propio)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Resend (email)
# ⚠️ Solo en Edge Functions — NUNCA en frontend
RESEND_API_KEY=

# URL pública de la app — a donde vuelve el enlace de recuperación (§6.4)
# ⚠️ Solo en Edge Functions. Tiene que estar además en
#    Authentication → URL Configuration → Redirect URLs, o Supabase la descarta.
APP_URL=

# Anthropic (IA)
# ⚠️ Solo en Edge Functions — NUNCA en frontend
ANTHROPIC_API_KEY=

# Service Role Keys de los 4 sistemas (Solo en Edge Functions / Supabase Secrets)
RISKGUARD_SUPABASE_URL=
RISKGUARD_SERVICE_ROLE_KEY=
EEFF_SUPABASE_URL=
EEFF_SERVICE_ROLE_KEY=
INDICADORES_SUPABASE_URL=
INDICADORES_SERVICE_ROLE_KEY=
LEGALTECH_SUPABASE_URL=
LEGALTECH_SERVICE_ROLE_KEY=

# App
VITE_APP_ENV=development
```

---

## 12. Convenciones de Código

### TypeScript
- **Strict mode activado** — sin `any` implícito
- Tipos en `src/types/` — no definir inline en componentes
- Preferir `interface` para shapes de objetos

### Componentes React
- 1 carpeta por módulo en `src/modules/`
- Props tipadas siempre con interface
- Sin prop drilling > 2 niveles — usar Zustand

### Supabase / Queries
```typescript
// ✅ CORRECTO — siempre filtrar por organization_id
const { data } = await supabase
  .from('workflows')
  .select('*')
  .eq('organization_id', user.organizationId)

// ❌ INCORRECTO
const { data } = await supabase.from('workflows').select('*')
```

### 12.1 El lienzo solo puede escribir el flujo que cargó

`saveNodes` y `saveConnections` **borran todo el flujo y reinsertan**. Con esa
forma, un guardado con la lista equivocada no es un guardado malo: es un borrado.
Por eso ambas exigen un cuarto argumento, `cargadoDe`, y **revientan** si no
coincide con el flujo que se va a escribir. Es obligatorio: el compilador no deja
llamarlas sin él.

El 12/08/2026 se perdieron los nodos de cuatro flujos sin que nadie los editara.
El autoguardado del canvas tiene `activeWorkflowId` en sus dependencias, así que
saltaba **al cambiar de flujo**, no solo al editar; el temporizador de 1,5 s se
armaba con el estado del flujo *anterior* y, si la carga del nuevo tardaba más
que eso, escribía. `Prueba Flujo 02032026` ejecutó 6 nodos a las 17:29:59Z del
11/08 y amaneció a cero.

Y **se propagaba solo**: el Constructor abre `wfs[0]` al entrar, ese flujo se
quedaba vacío, y el `nodes = []` que dejaba en memoria arrasaba el siguiente
flujo que abrieras. Cuatro flujos a cero, uno de ellos con 27 ejecuciones en su
historial.

**Reglas:**
1. **No guardes lo que no has terminado de cargar.** `cargadoPara` solo se pone
   *después* de que resuelva `getWorkflow`, y se comprueba dos veces: al armar el
   temporizador y al dispararse.
2. **Una carga fallida no puede quedarse como lienzo vacío editable**, o el
   primer autoguardado lo hace permanente. Se cierra el flujo y se avisa.
3. **Descarta las respuestas caducadas** (`peticionActiva`): al cambiar de flujo
   deprisa, una carga anterior resuelve tarde y pinta los nodos de otro flujo.
4. Un flujo **recién creado** sí está vacío de verdad: ahí se marca como cargado
   a mano (`handleCreateWorkflow`, y la plantilla del Dashboard).

✅ **El borrado y la inserción ya son atómicos** (14/08/2026,
`20260814_guardar_lienzo_transaccional.sql`). `saveNodes`/`saveConnections`
llamaban a `delete` y luego a `insert` en dos viajes distintos: si el segundo
fallaba —RLS, red, un tipo mal— el flujo se quedaba **sin nodos**, que es
exactamente el daño del incidente de arriba pero por otra puerta. Hoy las dos
escriben con una sola llamada a `supabase.rpc('guardar_lienzo', …)`, que hace el
`delete`+`insert` **dentro de una transacción**: o se guarda entero o no se toca
nada.

Dos cosas que no son accesorias:
- **`SECURITY INVOKER`, no DEFINER.** Una función que reescribe el lienzo con los
  permisos de quien la creó sería una vía para saltarse la RLS de edición que se
  estrechó dos veces el 12/08. La RLS sigue mandando, y un `cumplimiento` que
  llame a la RPC se lleva el mismo «no» que antes —bien contado por §12.2.
- **`REVOKE ... FROM PUBLIC` no basta**, hay que nombrar a `anon` (§6.4): con los
  `ALTER DEFAULT PRIVILEGES` de Supabase, `anon` se queda con EXECUTE. El GRANT
  va solo a `authenticated`.

La invariante de arriba (`cargadoDe`) **sigue haciendo falta igual**: la
atomicidad protege de un guardado a medias, no de un guardado con la lista
equivocada. Un borrado transaccional de los nodos correctos sigue siendo un
borrado.

✅ `src/services/workflowService.ts` (sin punto), duplicado muerto con su propia
copia del viejo `delete`+`insert`, **borrado el 14/08/2026**. Si reaparece en el
árbol de trabajo sin que nadie lo haya creado, sospecha del FreeFileSync contra
Box: ese mismo día restauró versiones antiguas de `CLAUDE.md` y de
`CICLO_VIDA_FLUJOS.md` encima de las buenas.

### 12.2 Un «no» legítimo mal contado sigue siendo un fallo — `utils/errores.ts`

El 12/08/2026 el Oficial de Cumplimiento vio esto al guardar un flujo:

```
Error guardando flujo: new row violates row-level security policy for table "workflow_nodes"
```

La RLS acertaba: `cumplimiento` no tiene `manage_workflows` y no edita flujos.
Lo que fallaba era todo lo demás — **el Constructor le dejaba editar, le pintaba
`✓ Guardado`, y al chocar le recitaba la frase de Postgres.** Es el reverso del
patrón de siempre: si una regla solo está en la RLS, la pantalla no la conoce y
la traduce mal.

Tres piezas, en `src/utils/errores.ts`:

1. **`rolesQuePueden(permiso)`** arma la frase «Administrador, Dueño de Proceso o
   Autorizador Máximo» **derivándola de `ROLE_PERMISSIONS`**, no a mano. Este
   proyecto ya arrastra bastantes listas copiadas (§6, §6.2, §6.3, §9.3); donde
   no hace falta duplicar, no se duplica, y así el mensaje no puede mentir.
2. **`mensajeDeEscritura`** detecta el rechazo de RLS (`42501` **o** el texto,
   porque las capas intermedias que envuelven en `new Error(error.message)`
   pierden el código) y explica quién sí puede.
3. **`mensajeDeEdgeFunction`** rescata el motivo real de una Edge Function.

⚠️ **`supabase.functions.invoke` tira el cuerpo de la respuesta.** Ante cualquier
status fuera de 2xx devuelve un `FunctionsHttpError` cuyo `.message` es siempre
la misma frase inútil:

```
No se pudo ejecutar: Edge Function returned a non-2xx status code
```

El motivo de verdad viaja en el **cuerpo JSON**, accesible en `err.context`, que
es la `Response`. O sea: `execute-workflow` **sí** explicaba el 403, y el
navegador tiraba la explicación a la basura. `cron-runner` ya leía `context`
para sus logs desde el 07/08; el frontend no. Leerlo es todo el arreglo.

⚠️ **Y leerlo no basta: hay que sacar el motivo, no el sobre.** `resolve-approval`
sí leía `context`, pero lo enseñaba crudo —`HTTP 409 — {"error":"…"}`— en el
toast «Aprobado pero error al reanudar» de `WorkQueue.tsx` y `Governance.tsx`.
Desde el 12/08/2026 extrae el campo `error` del JSON y deja el texto en bruto
solo como último recurso. Mismo criterio que la regla de abajo: lo que devuelve
un `Response` de 4xx **acaba delante de una persona**.

**Reglas:**
- El texto de un `return new Response(..., { status: 4xx })` **llega tal cual al
  usuario**. Escríbelo para quien no sabe qué es un rol de base de datos.
- Comprueba el permiso **antes** de pedirle a la base algo que va a rechazar, y
  dilo en la pantalla (distintivo *Solo lectura*). La RLS sigue mandando; esto
  solo evita el choque.
- **Un botón muerto no explica nada.** El de Ejecutar sigue pulsable sin permiso:
  gris, con `title`, y al pulsarlo dice de quién es la ejecución. Desactivarlo
  deja al usuario sin saber por qué.
- ⚠️ **Un indicador que no mide, miente.** El `✓ Guardado` se pintaba con
  `nodes.length > 0`, no con una escritura correcta: a un usuario de solo
  lectura le confirmaba un guardado que nunca ocurrió. Mismo patrón que el
  `succeeded` de pg_cron (§6.1) y que el hook aprobando un índice vacío (§15).

✅ **La RLS de edición ya no es más ancha que la UI** (12/08/2026,
`20260812_rls_edicion_igual_que_manage_workflows.sql`). `nodes_editor_write`,
`connections_editor_write` y `workflows_editor_update` admitían `operador` y
`operator`, que **no** tienen `manage_workflows`: no veían el botón y podían
escribir por API. Y no era solo escribir nodos — `workflows_editor_update`
gobierna `is_active` y `schedule_value`, así que un operador podía **activar un
flujo y cambiarle la hora del cron**.

✅ **Y `supervisor` salió esa misma tarde** (`20260812_supervisor_no_edita.sql`).
Por la mañana se le dejó dentro a propósito, anotando que debía salir «cuando
exista el ciclo de vida»: sin permiso de autorizar se quedaba sin nada que
hacer. El razonamiento valía mientras el rol estuviera **vacío**, y caducó a las
18:38 UTC del mismo día, cuando se dio de alta un supervisor real. Un solape
teórico y uno con alguien dentro no son el mismo riesgo.

Decisión de negocio de Hermes: *«el supervisor no edita el flujo, solo lo
autoriza, porque se pierde el control; él debe remitir al dueño para su edición
y corrección»*. **Quien autoriza no edita**, o los cuatro ojos se rompen en el
otro sentido. Le quedan `approve_tasks` y `view_logs`.

Son **cuatro** políticas, no tres: `nodes_editor_write`,
`connections_editor_write`, `workflows_editor_update` y —comprobado en la base,
no supuesto— `workflows_editor_write` (INSERT), porque crear un flujo es
editarlo. Las cuatro quedan en `admin, dueno_proceso, editor`, igual que los
roles con `manage_workflows` en `src/core/user.types.ts`. **`authorize_workflows`
y los estados `borrador → en_revision → publicado` son el permiso que ocupa el
hueco que deja este: están en §6.7**, en producción desde el 14/08/2026.

---

## 13. Fases del Proyecto

| Fase | Descripción | Estado |
|------|-------------|--------|
| F0 | Fundaciones: Supabase, auth, estructura, CLAUDE.md | ✅ Completa |
| F1 | Motor de ejecución: Edge Functions, nodo Email, nodo BCV | ✅ Completa |
| F2 | Conectores 4 sistemas: RiskGuard, EE.FF., Indicadores, LegalTech | ⚠️ Parcial — ver abajo |
| F3 | Agente IA: informes automáticos por dominio | ✅ Completa (03/06/2026) |
| F4 | Alertas inteligentes: umbrales, escalamiento, multi-canal | ✅ En producción (11/06, probada de extremo a extremo el 02/08/2026) |
| F5 | QA, hardening, go-live | 🔄 En curso |

**Esta tabla decía «⏳ Pendiente» en F1–F5 hasta el 07/08/2026**, con F4 corriendo en
producción desde hacía dos meses. Es el mismo patrón que `schema.sql` (§5.1) y que el
«redeploy pendiente» que se arrastró 52 días: un documento que nadie contrasta acaba
describiendo un sistema que no existe. **Si tocas una fase, actualiza la fila.**

### F2 no está completa: falta LegalTech

Los `case` reales del `switch` de `execute-workflow/index.ts` son `riskguard`, `aml`,
`indicadores`, `eeff`, `semaforo`, `bcv`, `decision`, `aprobacion`, `agente`,
`regulatorio`, `email`, `whatsapp`, `reporte` y `log`. **No hay ningún nodo LegalTech**, y
`health-check` tampoco lo sondea: sus variables `LEGALTECH_SUPABASE_URL` /
`LEGALTECH_SERVICE_ROLE_KEY` (§11) no las lee nadie. Ojo con confundirlo con
`processor:regulatorio`, que suena parecido pero no se conecta a LegalTech: arma un
informe SUDEASEG con datos que ya están en el contexto del flujo.

**Y de los tres conectores que sí existen, Indicadores está caído:** apunta a
`fciaudxeuycqtuzyurnb`, que el documento de plataforma marca como proyecto INACTIVO.
RiskGuard y EE.FF. responden bien.

---

## 14. Seguridad — Checklist Obligatorio

Antes de dar por completado cualquier módulo:

- [ ] RLS activo en todas las tablas nuevas
- [ ] `organization_id` presente y filtrado en todas las queries
- [ ] Credenciales de integraciones SOLO en Supabase Secrets / Edge Functions
- [ ] API Keys de Resend y Anthropic NUNCA en el frontend
- [ ] Audit trail en `execution_logs`
- [ ] Validación de JWT en cada Edge Function antes de ejecutar
- [ ] Sin `console.log` con datos sensibles en producción

---

## 15. Instrucciones para Claude Code

### Al comenzar una sesión
1. Leer este archivo completo
2. Revisar `ROADMAP.md` para contexto del sprint actual
3. Si la tarea involucra Supabase, revisar `SECURITY.md`
4. Si la tarea involucra integraciones, revisar `INTEGRATIONS.md`

### Al comprobar tipos

⚠️ **`npx tsc --noEmit` no comprueba NADA en este repositorio.** El
`tsconfig.json` raíz es un stub de referencias (`"files": []`), así que ese
comando compila un programa vacío, sale con 0 y no imprime una línea — y un cero
que nadie ha medido se lee igual que un cero limpio. Se citó como prueba más de
una vez antes del 14/08/2026.

Los comandos que sí miden:
```
npm run typecheck     # tsc --noEmit -p tsconfig.app.json
npm run build         # tsc -b && vite build  (el build sí typechea)
```

### Al hacer commits
- Después de cada `git commit`, reportar explícitamente el resultado del hook de seguridad
- ⚠️ **`git add` y `git commit` van en llamadas SEPARADAS.** El hook es
  `PreToolUse`: salta **antes** de que se ejecute la orden entera, y comprueba
  `git diff --cached`. Encadenar `git add -A && git commit -m …` hace que mire
  un índice todavía vacío, no encuentre nada y **apruebe sin revisar un solo
  fichero**. Pasó el 08/08/2026 y se rehízo el commit con los pasos separados.
  Es el mismo patrón del `succeeded` de pg_cron y del punto verde del Dashboard:
  un instrumento que dice «bien» sin haber medido nada.

### Qué NO hacer
- ❌ Instalar `imap`, `nodemailer` u otras librerías Node.js-only en el frontend
- ❌ Ejecutar nodos directamente desde el frontend (siempre via Edge Functions)
- ❌ Guardar credenciales de integraciones en el frontend o localStorage
- ❌ Hacer queries sin filtro de `organization_id`
- ❌ Exponer API Keys de Resend o Anthropic en código cliente
- ❌ Escribir en los sistemas origen (RiskGuard, EE.FF., Indicadores, LegalTech)

---

*Última actualización: Mayo 2026 — HermesAI Engineering*
