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
│       ├── execute-node/            ← ejecutor genérico de nodos
│       ├── node-email/              ← nodo: enviar email via Resend
│       ├── node-ai-report/          ← nodo: generar informe con Claude
│       ├── node-riskguard/          ← nodo: leer datos de RiskGuard
│       ├── node-indicadores/        ← nodo: leer KPIs de Indicadores
│       ├── node-eeff/               ← nodo: leer EE.FF.
│       └── node-legaltech/          ← nodo: leer datos LegalTech
└── .claude/
    ├── settings.json                ← hooks y permisos Claude Code
    └── hooks/                       ← scripts de seguridad pre-commit
```

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
insertaba `actor_id`, columna inexistente). Por eso ahora usa `CREATE TABLE` a
secas: si vuelve a desviarse, que reviente.

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

⚠️ `audit_log` no restringe lectura por rol: la política `audit_read_org` solo
filtra por `organization_id`, así que **cualquier usuario autenticado de la
organización lee la auditoría completa**, no solo admin/auditor/cumplimiento.
Está documentado en `schema.sql`; corregirlo es un cambio pendiente.

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

---

## 13. Fases del Proyecto

| Fase | Descripción | Estado |
|------|-------------|--------|
| F0 | Fundaciones: Supabase, auth, estructura, CLAUDE.md | 🔄 En curso |
| F1 | Motor de ejecución: Edge Functions, nodo Email, nodo BCV | ⏳ Pendiente |
| F2 | Conectores 4 sistemas: RiskGuard, EE.FF., Indicadores, LegalTech | ⏳ Pendiente |
| F3 | Agente IA: informes automáticos por dominio | ⏳ Pendiente |
| F4 | Alertas inteligentes: umbrales, escalamiento, multi-canal | ⏳ Pendiente |
| F5 | QA, hardening, go-live | ⏳ Pendiente |

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

### Al hacer commits
- Después de cada `git commit`, reportar explícitamente el resultado del hook de seguridad

### Qué NO hacer
- ❌ Instalar `imap`, `nodemailer` u otras librerías Node.js-only en el frontend
- ❌ Ejecutar nodos directamente desde el frontend (siempre via Edge Functions)
- ❌ Guardar credenciales de integraciones en el frontend o localStorage
- ❌ Hacer queries sin filtro de `organization_id`
- ❌ Exponer API Keys de Resend o Anthropic en código cliente
- ❌ Escribir en los sistemas origen (RiskGuard, EE.FF., Indicadores, LegalTech)

---

*Última actualización: Mayo 2026 — HermesAI Engineering*
