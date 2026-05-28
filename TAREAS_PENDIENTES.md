# TAREAS_PENDIENTES.md — HermesAI Flow
> Backlog activo del proyecto. Actualizar al inicio y fin de cada sesión.

**Última actualización:** 28 Mayo 2026  
**Fase actual:** Sprint S1 completado ✅ — Próximo: S2 (Gateway + Aprobación humana + Conectores)

---

## ✅ Completado esta sesión (28 Mayo 2026)

- [x] Fix error 54001 — SECURITY DEFINER en helpers RLS (commit 6121ce6)
- [x] Login funciona correctamente
- [x] Motor de ejecución — Edge Function `execute-workflow` completa
- [x] WorkflowCanvas migrado a Supabase (fuera localStorage)
- [x] Selector de flujos + auto-guardado debounced 1.5s
- [x] Botón Ejecutar → llama Edge Function → muestra resultado
- [x] NodePalette: 27 nodos de industria (Seguros/Reaseguros, Banca, Manufactura, Universal)
- [x] Dashboard: datos reales desde Supabase + Realtime
- [x] Monitoring: execution_runs + logs por ejecución + Realtime
- [x] Migración DB: tabla `execution_runs` + RLS
- [x] Push a GitHub (commit 966c391)

---

## 🔴 PENDIENTE INMEDIATO — Antes de probar

- [ ] Deploy Edge Function en Supabase:
  ```
  npx supabase functions deploy execute-workflow --project-ref kbscaxcokxwdbnrltkup
  ```
- [ ] Agregar secret RESEND_API_KEY en Supabase → Settings → Edge Functions Secrets
- [ ] Configurar Netlify (cuando el usuario lo decida):
  - Site → Add new → Import from Git → hermeshs34/Hermesai-flow
  - Env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_ENV=production

---

## 🟠 Sprint S2 — Gateway + Aprobación Humana + Conectores RiskGuard

### Nodos nuevos a implementar

- [ ] **Gateway de Decisión visual** — cuando el nodo `decision` evalúa true/false,
      el canvas debe mostrar 2 ramas distintas (la conexión se bifurca visualmente)
- [ ] **Nodo Aprobación Humana** — el flujo queda en `waiting_approval`,
      notifica al aprobador por email, y reanuda cuando él aprueba/rechaza desde UI
- [ ] **Panel de Aprobaciones pendientes** — en Dashboard: lista de flujos esperando acción
- [ ] **Nodo RiskGuard completo** — leer siniestros, riesgos, KRIs en tiempo real
- [ ] **Nodo BCV con alertas** — si tasa cambia > X% desde última consulta → alertar

### Edge Functions a agregar

- [ ] `resume-workflow` — reanudar flujo después de aprobación humana
- [ ] `node-bcv` — consulta y cachea tasa BCV en Supabase

### Configuración de nodos (NodeConfigPanel)

- [ ] El panel de configuración actual es genérico — mejorar para mostrar
      campos específicos según el tipo de nodo:
      - Email: to, subject, body (con variables {{node_id.campo}})
      - Decisión: campo izquierdo, operador, valor derecho
      - Cron: expresión cron con preview próxima ejecución
      - BCV: umbral de alerta, moneda

---

## 🟠 Sprint S3 — Plantillas de Proceso por Industria

- [ ] **Plantilla Seguros: Proceso de Siniestro** (17 pasos)
  - Ingreso → Verificar póliza → Score fraude → Si válido: calcular reserva →
    Si monto > XL: escalar reaseguro → Notificar ajustador → Reporte SUDEASEG
- [ ] **Plantilla Banca: Alerta AML** 
  - Score AML → Si alto: verificar OFAC → Si en lista: congelar op → Notificar oficial
- [ ] **Plantilla Manufactura: Reposición de Stock**
  - Stock bajo → Generar OC → Solicitar aprobación → Si aprobado: enviar a proveedor

---

## 🟡 Sprint S4 — Agente IA y Reportes Automáticos

- [ ] Edge Function `node-ai-report` con Claude Opus 4.7 + adaptive thinking
- [ ] Plantillas de informe:
  - Resumen ejecutivo KPIs semanales
  - Análisis de siniestralidad mensual
  - Reporte AML/CFT para SUDEASEG/SUDEBAN
- [ ] Streaming de respuesta al frontend (Server-Sent Events o Realtime)

---

## 📋 Decisiones técnicas pendientes

| Pregunta | Urgencia |
|---|---|
| ¿Resend domain propio o subdomain Resend para emails? | S1 (deploy) |
| ¿Cron jobs via pg_cron en Supabase o Supabase Scheduled Functions? | S2 |
| ¿Aprobación humana por email (link) o solo desde la app? | S2 |

---

## 🔗 Referencias

- GitHub: https://github.com/hermeshs34/Hermesai-flow
- Supabase: https://kbscaxcokxwdbnrltkup.supabase.co
- Edge Function deployada: `execute-workflow`
- Modelo IA: claude-opus-4-7 (para S4)
