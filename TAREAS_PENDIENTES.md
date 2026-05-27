# TAREAS_PENDIENTES.md — HermesAI Flow
> Backlog activo del proyecto. Actualizar al inicio y fin de cada sesión.

**Última actualización:** 27 Mayo 2026  
**Fase actual:** F0 completado — pendiente debug login + deploy Netlify

---

## 🔴 AGENDA PRÓXIMA SESIÓN (27 Mayo 2026)

### PASO 1 — 🐛 Debug error de login (BLOQUEANTE)
- [ ] Identificar el error exacto (copiar mensaje completo de consola del navegador)
- [ ] Verificar que el perfil en `public.profiles` tiene el `id` correcto (debe coincidir con `auth.users.id`)
- [ ] Verificar que `organization_id` en el perfil no es null
- [ ] Verificar que la política RLS `profiles_read_own_org` permite SELECT al usuario
- [ ] Si es error 406/PGRST: verificar que `.single()` encuentra exactamente 1 fila
- [ ] Fix y validar login exitoso

### PASO 2 — Deploy Netlify
- [ ] Crear sitio en Netlify → conectar repo `hermeshs34/Hermesai-flow`
- [ ] Agregar variables de entorno en Netlify Dashboard:
  - `VITE_SUPABASE_URL` = `https://kbscaxcokxwdbnrltkup.supabase.co`
  - `VITE_SUPABASE_ANON_KEY` = (la anon key)
  - `VITE_APP_ENV` = `production`
- [ ] Verificar build exitoso y URL pública funcionando

### PASO 3 — Validar flujo completo post-login
- [ ] Login → Dashboard carga sin errores
- [ ] Crear flujo de prueba → se guarda en Supabase (no localStorage)
- [ ] Cerrar sesión → vuelve al login
- [ ] Refrescar página autenticado → syncSession() mantiene sesión

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
