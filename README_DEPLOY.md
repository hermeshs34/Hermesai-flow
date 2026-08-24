# README_DEPLOY.md — Guía de Despliegue HermesAI Flow

> **Última actualización:** 10 Junio 2026  
> Para usar con el proyecto Supabase: `kbscaxcokxwdbnrltkup`

---

## Requisitos Previos

- [ ] Cuenta Supabase con proyecto creado
- [ ] Supabase CLI instalado (`npm install -g supabase`)
- [ ] Netlify CLI o acceso al dashboard (para frontend)
- [ ] API Keys disponibles: Resend, Anthropic, Twilio (opcional)

---

## Paso 1 — Variables de Entorno Locales

Copia `.env.example` a `.env.local` y rellena:

```bash
cp .env.example .env.local
```

Valores requeridos para desarrollo:
```env
VITE_SUPABASE_URL=https://kbscaxcokxwdbnrltkup.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhb...  (del dashboard Supabase → Settings → API)
VITE_APP_ENV=development
```

---

## Paso 2 — Schema de Base de Datos

### 2.1 Schema Base (ejecutar primero, una sola vez en Supabase nuevo)

En el **SQL Editor de Supabase**, ejecutar el contenido completo de:

```
database/schema.sql
```

Este archivo contiene **todas las tablas**, funciones RLS, políticas básicas y es la fuente de verdad sincronizada con todas las migraciones.

> ⚠️ **Si ya tienes datos en Supabase**, NO ejecutes `schema.sql`. Ve directamente al paso 2.2 con las migraciones pendientes.

### 2.2 Migraciones Incrementales (en orden cronológico)

Si el proyecto ya existe en Supabase y necesitas aplicar cambios, ejecuta **solo las migraciones que no hayas aplicado** en este orden:

| # | Archivo | Qué hace | Aplicar si... |
|---|---------|----------|---------------|
| 1 | `20260528_branch_column.sql` | Columna `branch` en `workflow_connections` | No tienes la columna |
| 2 | `20260528_execution_runs.sql` | Tabla `execution_runs` + campos pausa | No tienes la tabla |
| 3 | `20260531_f1_gobierno.sql` | Roles BPM, `audit_log`, `matriz_aprobacion`, `tareas_aprobacion`, funciones `my_role()` | No tienes F1 |
| 4 | `20260601_f2_aprobaciones.sql` | Columnas en `tareas_aprobacion` para aprobador y estado | Si `tareas_aprobacion` existe sin esas cols |
| 5 | `20260601_f2_timeout_cron.sql` | Cron pg para timeout de tareas vencidas | Si no tienes el cron de vencimiento |
| 6 | `20260601_fix_rls_all_bpm_roles.sql` | RLS para roles BPM en nodes/connections | Si hay errores de permisos en Canvas |
| 7 | `20260601_fix_rls_nodes_connections.sql` | Políticas write en nodes y connections | Si hay errores al guardar nodos |
| 8 | `20260601_fix_rls_workflows.sql` | Políticas write en workflows para BPM | Si hay errores al crear flujos |
| 9 | `20260601_notification_settings.sql` | Columnas `notif_*` en `organizations` | Si Settings → Notificaciones falla |
| 10 | `20260601_org_update_policy.sql` | Política UPDATE para admin en organizations | Si admin no puede actualizar su org |
| 11 | `20260602_f3_matriz_autorización.sql` | Columnas avanzadas en `matriz_aprobacion` | Si Gobierno → Matriz falla |
| 12 | `20260602_rol_cumplimiento.sql` | Agrega rol `cumplimiento` al CHECK de profiles | Si no puedes crear usuarios cumplimiento |
| 13 | `20260609_kpi_params.sql` | Columnas `kpi_*` en `organizations` | Si Dashboard KPIs da error |

---

## Paso 3 — Supabase Secrets (Edge Functions)

En **Supabase → Edge Functions → Secrets**, configurar:

```
# Email transaccional
RESEND_API_KEY=re_...

# Inteligencia Artificial
ANTHROPIC_API_KEY=sk-ant-...

# WhatsApp (Twilio) — opcional
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Integraciones con los 4 sistemas HermesAI
# Formato NUEVO (sb_secret_). Las claves legacy (eyJ...) se estan apagando
# proyecto a proyecto: no pongas una aunque el sistema origen todavia la acepte.
# health-check informa la familia de cada credencial en el campo `credenciales`.
RISKGUARD_SUPABASE_URL=https://xxxx.supabase.co
RISKGUARD_SERVICE_ROLE_KEY=sb_secret_...

EEFF_SUPABASE_URL=https://xxxx.supabase.co
EEFF_SERVICE_ROLE_KEY=sb_secret_...

INDICADORES_SUPABASE_URL=https://xxxx.supabase.co
INDICADORES_SERVICE_ROLE_KEY=sb_secret_...

LEGALTECH_SUPABASE_URL=https://xxxx.supabase.co
LEGALTECH_SERVICE_ROLE_KEY=sb_secret_...
```

> ⚠️ NUNCA poner estas claves en `.env.local`, en el código frontend, ni en `config_json` de la tabla `integrations`.

---

## Paso 4 — Desplegar Edge Functions

```bash
# Autenticar con Supabase CLI
supabase login

# Vincular al proyecto
supabase link --project-ref kbscaxcokxwdbnrltkup

# Desplegar todas las Edge Functions
supabase functions deploy execute-workflow
supabase functions deploy execute-node
supabase functions deploy admin-create-user
supabase functions deploy node-email
supabase functions deploy node-ai-report
supabase functions deploy node-riskguard
supabase functions deploy node-indicadores
supabase functions deploy node-eeff
supabase functions deploy node-legaltech
supabase functions deploy resolve-approval
supabase functions deploy cron-runner
supabase functions deploy health-check
supabase functions deploy get-bcv-rate
supabase functions deploy design-assistant
```

---

## Paso 5 — Configurar pg_cron (Flujos Programados)

Para que los flujos con `schedule_type = 'cron'` se disparen automáticamente:

1. En Supabase → **Extensions**, activar `pg_cron`
2. En el SQL Editor, ejecutar:

```sql
-- Ejecutar cron-runner cada minuto para disparar flujos programados
SELECT cron.schedule(
    'hermesai-flow-cron-runner',
    '* * * * *',
    $$
    SELECT net.http_post(
        url := 'https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/cron-runner',
        headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}'::jsonb,
        body := '{}'::jsonb
    );
    $$
);

-- Verificar que está activo
SELECT * FROM cron.job WHERE jobname = 'hermesai-flow-cron-runner';
```

> Si `net.http_post` no está disponible, usar `pg_net` extension o Supabase Scheduled Functions desde el dashboard.

---

## Paso 6 — Crear el Primer Usuario Admin

El primer usuario admin debe crearse directamente en Supabase Auth, luego insertar su perfil:

```sql
-- 1. Crear organización raíz
INSERT INTO public.organizations (name, slug, plan)
VALUES ('Mi Empresa', 'mi-empresa', 'pro')
RETURNING id;

-- 2. Insertar perfil del admin (después de crear el usuario en Auth)
-- Reemplazar los UUIDs con los valores reales
INSERT INTO public.profiles (id, organization_id, email, name, role)
VALUES (
    '<auth.users.id del admin>',
    '<organization.id creado arriba>',
    'admin@miempresa.com',
    'Administrador',
    'admin'
);
```

---

## Paso 7 — Deploy Frontend (Netlify)

```bash
# Instalar dependencias
npm install

# Build de producción
npm run build

# Deploy a Netlify (si tienes Netlify CLI)
netlify deploy --prod --dir=dist
```

O conectar el repositorio a Netlify y configurar:
- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Environment variables:** las mismas de `.env.local`

---

## Verificación Post-Deploy

```bash
# Comprobar que las Edge Functions responden
curl -X POST https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/health-check \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json"
```

Respuesta esperada: `{ "status": "ok", "timestamp": "..." }`

---

## Diagnóstico de Problemas Comunes

| Síntoma | Causa probable | Solución |
|---------|---------------|----------|
| Login falla con "perfil no configurado" | El usuario de Auth no tiene perfil en `profiles` | Insertar perfil con `organization_id` correcto |
| Canvas no guarda nodos | RLS de `workflow_nodes` demasiado restrictivo | Ejecutar `20260601_fix_rls_nodes_connections.sql` |
| Flujo con Decisión no bifurca | Falta columna `branch` en `workflow_connections` | Ejecutar `20260528_branch_column.sql` o usar `schema.sql` completo |
| Error "rol no reconocido" al crear usuario | CHECK de `profiles.role` con solo roles legacy | Ejecutar `20260602_rol_cumplimiento.sql` |
| Dashboard KPIs muestra error | Columnas `kpi_*` no existen en `organizations` | Ejecutar `20260609_kpi_params.sql` |
| Email no se envía | `RESEND_API_KEY` no configurado en Secrets | Revisar Supabase → Edge Functions → Secrets |
| Flujo cron no se dispara | `pg_cron` no activo o `cron-runner` no desplegada | Ver Paso 5 |
| Tasa BCV retorna `null` | Todas las fuentes externas no disponibles | Revisar conectividad de la Edge Function |

---

## Árbol de Archivos Clave

```
project/
├── database/
│   ├── schema.sql              ← FUENTE DE VERDAD (Supabase nuevo)
│   ├── migrations/             ← Cambios incrementales (Supabase existente)
│   ├── policies/               ← Políticas RLS detalladas por tabla
│   └── seeds/                  ← Datos de demo (opcional)
├── supabase/functions/         ← 14 Edge Functions (motor de ejecución)
├── src/
│   ├── core/supabase.ts        ← Cliente singleton (NO instanciar en otro lugar)
│   ├── core/auth.service.ts    ← Login, rate limiting, sesión
│   └── services/               ← CRUD Supabase
└── .env.example                ← Plantilla de variables de entorno
```

---

*HermesAI Flow — Hub de Automatización del Ecosistema HermesAI*  
*Versión 1.0 — Mayo/Junio 2026*
