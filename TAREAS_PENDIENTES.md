# TAREAS_PENDIENTES.md — HermesAI Flow
> Backlog activo del proyecto. Actualizar al inicio y fin de cada sesión.

**Última actualización:** 26 Mayo 2026  
**Fase actual:** F0 — Fundaciones (commit inicial listo, pendiente Supabase)

---

## 🔴 PRÓXIMA SESIÓN — Prioridad Máxima

### PASO 1 — Crear proyecto Supabase (5 min — tú)
- [ ] Ir a supabase.com → New Project
- [ ] Nombre: `hermesai-flow`
- [ ] Región: la más cercana (us-east-1 o similar)
- [ ] Copiar **URL** y **Anon Key** al archivo `.env.local`
- [ ] Ejecutar `database/schema.sql` en SQL Editor
- [ ] Ejecutar `database/policies/rls_policies.sql` en SQL Editor
- [ ] Confirmar que las 6 tablas se crearon sin error

### PASO 2 — Conectar frontend a Supabase (Claude)
- [ ] Crear `src/core/supabase.ts` — cliente singleton
- [ ] Crear `src/core/user.types.ts` — tipos User, Role, Organization
- [ ] Crear `src/core/auth.service.ts` — login, logout, getCurrentUser, syncSession
- [ ] Crear login UI (`src/modules/iam/LoginView.tsx`) — two-panel dark, branding HermesAI
- [ ] Crear `src/core/auth.guard.ts` — protección de rutas por rol

### PASO 3 — Refactorizar WorkflowService (Claude)
- [ ] Reemplazar `WorkflowService` (localStorage) → queries Supabase con `organization_id`
- [ ] Migrar `workflowStore.ts` para usar el nuevo servicio
- [ ] Validar que canvas guarda/carga flujos desde Supabase

### PASO 4 — Deploy Netlify inicial (Claude + tú)
- [ ] Crear sitio en Netlify apuntando al repo GitHub
- [ ] Configurar variables de entorno en Netlify Dashboard
- [ ] Verificar build exitoso

---

## 🟠 F1 — Motor de Ejecución (Siguiente sprint)

### Edge Functions a construir
- [ ] `supabase/functions/execute-node/index.ts` — ejecutor genérico, valida JWT + org_id
- [ ] `supabase/functions/node-email/index.ts` — envía email vía Resend API
- [ ] `supabase/functions/node-bcv/index.ts` — consulta tasa BCV y notifica

### Nodos del canvas
- [ ] Nodo Trigger: `cron` — configurar expresión cron
- [ ] Nodo Trigger: `webhook` — genera URL de webhook por flujo
- [ ] Nodo Output: `email` — configurar destinatario, asunto, plantilla

---

## 🟠 F2 — Conectores 4 Sistemas (Sprint posterior)

### Por cada sistema: leer datos vía service_role key (solo Edge Functions)
- [ ] `node-riskguard` — siniestros, riesgos, KRIs, alertas AML, tasa BCV
- [ ] `node-eeff` — balances, indicadores financieros, alertas Benford
- [ ] `node-indicadores` — KPIs, OKRs, tableros BSC
- [ ] `node-legaltech` — expedientes, vencimientos, honorarios, alertas RGPD

### Prerequisito para F2
- [ ] Recopilar URLs y Service Role Keys de los 4 proyectos Supabase existentes
- [ ] Guardarlas como Supabase Secrets en hermesai-flow (nunca en código)

---

## 🟡 F3 — Agente IA (Sprint futuro)

- [ ] `node-ai-report` — Edge Function con Claude Opus 4.7 + adaptive thinking
- [ ] Plantilla: Resumen ejecutivo KPIs
- [ ] Plantilla: Análisis EE.FF. bajo NIIF
- [ ] Plantilla: Informe de Riesgos y Cumplimiento (RiskGuard)
- [ ] Plantilla: Análisis de Siniestralidad
- [ ] Plantilla: Reporte AML/CFT
- [ ] Streaming de respuesta al frontend (Server-Sent Events)

---

## 🟡 F4 — Alertas Inteligentes (Sprint futuro)

- [ ] Reglas de umbral configurables por flujo (ej: tasa BCV sin actualizar > 24h)
- [ ] Escalamiento: email → WhatsApp Business API
- [ ] Panel de alertas enviadas con historial
- [ ] Integración con sistemas: recibir webhooks de RiskGuard/LegalTech ante eventos críticos

---

## 📋 Decisiones técnicas pendientes

| Pregunta | Contexto | Urgencia |
|---|---|---|
| ¿Resend domain propio o subdomain Resend? | Para emails de HermesAI Flow | F1 |
| ¿GitHub repo nuevo o usar el existente del proyecto? | Necesario para Netlify CI/CD | Próxima sesión |
| ¿WhatsApp via Twilio, Meta API directa u otro? | Para alertas F4 | F4 |

---

## ✅ Completado en sesión 26/05/2026 (F0)

- [x] Evaluación de viabilidad del proyecto
- [x] Definición de arquitectura (hub central ecosistema HermesAI)
- [x] CLAUDE.md completo con estándar HermesAI
- [x] Limpieza proyecto Bolt.new (eliminados imap, nodemailer, docs innecesarios)
- [x] Estructura de carpetas estándar
- [x] package.json renombrado a hermesai-flow
- [x] Schema SQL: 6 tablas multi-tenant + índices + triggers updated_at
- [x] Políticas RLS: aislamiento total por organization_id, 4 roles
- [x] .gitignore y .env.example correctos
- [x] Hook pre-commit seguridad
- [x] Git inicializado correctamente en la carpeta del proyecto
- [x] Primer commit F0: `8aef472`
