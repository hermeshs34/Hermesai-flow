# ROADMAP.md — HermesAI Flow

> **Última actualización:** 10 de junio de 2026
> Stack real: React 18 + Vite + TypeScript · Supabase (PostgreSQL + Auth + RLS + Edge Functions Deno) · Resend · Twilio · Anthropic API
> (El plan original de Bolt.new de dic-2025 con Express/Bull/Redis/Docker quedó obsoleto y fue descartado — la arquitectura real es serverless sobre Supabase.)

---

## Estado General — Junio 2026

| Fase | Descripción | Estado |
|------|-------------|--------|
| F0 | Fundaciones: Supabase, auth multi-tenant, RLS, estructura, CLAUDE.md | ✅ Completada |
| F1 | Motor de ejecución (Edge Functions) + Gobierno BPM (roles, audit log, usuarios) | ✅ Completada (31/05) |
| F2 | Aprobaciones humanas con pausa/reanudación + conectores 4 sistemas (RiskGuard, EE.FF., Indicadores, LegalTech) | ✅ Completada (01/06) |
| F3 | Agente IA (Claude), Asistente de Diseño en canvas, Matriz de autorización, Reporte regulatorio | ✅ Completada (03/06) |
| F4 | Alertas inteligentes multi-canal | 🔄 En curso — WhatsApp/Twilio ✅ (10/06); falta escalamiento automático por umbral/SLA |
| F5 | QA, hardening, go-live | 🔄 Iniciada — fix seguridad JWT en Edge Functions (10/06) |

---

## Hitos recientes (junio 2026)

- **10/06** — Nodo EE.FF. cuadrado al céntimo contra el sistema Estados Financieros (dos pipelines: Balance y P&L réplicas exactas de DataContext)
- **10/06** — Nodo "Enviar WhatsApp" vía Twilio: palette + formulario con plantillas + handler `output:whatsapp` (probado end-to-end)
- **10/06** — Hardening: `execute-workflow` y `resolve-approval` validan el JWT del llamante; `organization_id` y `approverId` se derivan del token, nunca del body; frontend envía token de sesión (no anon key)
- **09/06** — WorkQueue con SoD, Undo/Redo en canvas, parámetros KPI configurables
- **08/06** — Sprints S1–S6: Design System, Cola de Trabajo, Timeline, Dashboard por rol

---

## Pendientes F4/F5

### F4 — Alertas inteligentes
- [ ] Escalamiento automático: si una aprobación vence (`vence_at`), notificar al siguiente nivel
- [ ] Umbrales de alerta por KPI con disparo de flujo automático
- [ ] Canal Telegram (opcional, evaluar demanda)

### F5 — QA y hardening
- [x] Validación JWT + tenant en Edge Functions críticas (10/06)
- [ ] Verificar pg_cron/`cron-runner` activo en Supabase (Dashboard → Integrations → Cron) — **manual Hermes**
- [ ] Producción WhatsApp: número Twilio propio aprobado (sandbox caduca cada 72h)
- [ ] Aplicar migraciones SQL pendientes en Supabase (ver `database/migrations/`)
- [ ] Refactor componentes grandes (Dashboard 96KB, WorkflowCanvas 52KB) — posponer hasta que duela
- [ ] Encadenamiento de invocaciones para flujos >5 nodos con IA (límite ~150s Edge Functions) — posponer hasta tener flujos así
- [ ] Tests con Vitest para motor de ejecución y servicios

---

## Deuda técnica registrada

- `connectionService.ts`: reescrito a validación local (10/06, agente externo) pero ningún componente lo usa todavía — conectar a Settings o eliminar
- `src/modules/` casi vacío vs componentes en `src/components/` — decidir estructura definitiva antes del go-live
- Códigos de cuenta truncados en `financial_entries` del sistema EE.FF. (60 cuentas colapsadas bajo `2.205.2.2`) — limitación del origen, documentada

---

## Documentos relacionados

- `README_DEPLOY.md` — orden de deploy (schema + migraciones + Edge Functions + secrets)
- `CLAUDE.md` — arquitectura y convenciones
- Memoria de sesiones — `~/.claude/projects/...Sistema-Flujos-de-Trabajo/memory/`
