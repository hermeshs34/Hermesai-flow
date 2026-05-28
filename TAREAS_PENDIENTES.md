# TAREAS_PENDIENTES.md — HermesAI Flow
> Backlog activo del proyecto. Actualizar al inicio y fin de cada sesión.

**Última actualización:** 28 Mayo 2026 — Fin de sesión  
**Fase actual:** Sprint S2 completado ✅ — Próximo: S3 (EE.FF. + Indicadores + Plantillas industria)

---

## ✅ Completado hoy (28 Mayo 2026)

### Sprint S1
- [x] Motor de ejecución Edge Function `execute-workflow` (DAG + logging)
- [x] WorkflowCanvas migrado a Supabase (auto-save debounced)
- [x] NodePalette 27 nodos de industria
- [x] Dashboard y Monitoring con datos reales + Realtime
- [x] Fix UUID, float→int, NodeConfigPanel, duplicados, conexión UX

### Sprint S2
- [x] Ramificación visual SI/NO en nodo Decisión (flechas verde/roja con etiquetas)
- [x] Motor de ejecución respeta ramas — omite nodos en rama no activa
- [x] Nodo Aprobación Humana (processor:aprobacion) + form configuración
- [x] Email profesional: variables `{{previous.campo}}` y `{{summary}}`
- [x] Plantilla BCV con 1 clic en NodeConfigPanel
- [x] API BCV con 3 fuentes + fallback (pydolarve → dolarapi → dolartoday)
- [x] Edge Function `get-bcv-rate` para test desde Settings sin CORS
- [x] Settings reescrito: estado sistema, APIs, notificaciones, guía de nodos
- [x] Migración DB: columna `branch` en `workflow_connections`

---

## 🔴 PENDIENTE INMEDIATO

- [ ] Ejecutar migración en Supabase SQL Editor:
  ```sql
  ALTER TABLE workflow_connections
      ADD COLUMN IF NOT EXISTS branch TEXT CHECK (branch IN ('true', 'false'));
  ```
- [ ] Netlify deploy:
  - app.netlify.com → Import from Git → hermeshs34/Hermesai-flow
  - Env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_ENV=production

---

## 🟠 MAÑANA — Sprint S3: Integración EE.FF. + Indicadores de Gestión

### 1. Análisis de automatización con Estados Financieros
- [ ] Revisar qué procesos del sistema EE.FF. son automatizables
- [ ] Nodos candidatos:
  - `trigger:eeff` — detectar nuevo cierre contable / período fiscal
  - `processor:eeff_kpi` — calcular KPIs: ROE, ROA, liquidez, solvencia, EBITDA
  - `processor:eeff_variacion` — comparar período actual vs anterior → % cambio
  - `output:eeff_reporte` — generar y enviar informe PDF ejecutivo
- [ ] Plantilla de flujo "Cierre Mensual EE.FF." pre-configurada
- [ ] Plantilla "Alerta KPI fuera de rango" (si ROE < umbral → email gerencia)

### 2. Indicadores de Gestión
- [ ] Analizar viabilidad de conectar sistema Indicadores
- [ ] Nodos candidatos:
  - `processor:indicadores_dashboard` — leer KPIs actuales desde Supabase
  - `processor:semaforo` — evaluar si indicador está en rojo/amarillo/verde
  - `output:alerta_kpi` — notificar responsable cuando indicador entra en zona roja
- [ ] Plantilla "Monitor Semanal de Indicadores"

### 3. Verificar flujos existentes end-to-end
- [ ] Probar flujo BCV completo con ramificación SI/NO
  - Crear: Cron → BCV → Decisión (bcv_rate > 40) → SI: Email ALERTA → NO: Email Normal
  - Verificar que el nodo Decisión realmente bifurca la ejecución
- [ ] Probar las flechas de conexión y confirmar que el UX es claro
- [ ] Documentar flujos de demostración para presentar el sistema

---

## 🟡 Sprint S4 — Plantillas de Proceso por Industria

- [ ] **Seguros: Proceso de Siniestro completo** (trigger → score fraude → reaseguro → notificación)
- [ ] **Banca: Alerta AML** (score → OFAC → congelar → notificar SUDEBAN)
- [ ] **Manufactura: Reposición de Stock** (stock bajo → OC → aprobación → proveedor)
- [ ] **EE.FF.: Cierre Mensual** (trigger → calcular KPIs → informe → email dirección)

---

## 🟡 Sprint S5 — Agente IA + Reportes Automáticos

- [ ] Edge Function `node-ai-analysis` con Claude Opus 4.7 + adaptive thinking
- [ ] Nodo IA que analiza datos del contexto y genera resumen ejecutivo
- [ ] Streaming de respuesta IA al frontend

---

## 📋 Decisiones técnicas pendientes

| Pregunta | Urgencia |
|---|---|
| ¿Sub-agentes Claude para análisis complejos en flujos? | S5 — evaluar con usuario |
| ¿Resend domain propio o subdomain Resend? | Antes de go-live |
| ¿Cron jobs via pg_cron en Supabase o Scheduled Functions? | S3 |
| ¿Aprobación humana por email (link) o solo desde la app? | S3 |

---

## 🔗 Referencias

- GitHub: https://github.com/hermeshs34/Hermesai-flow
- Supabase: https://kbscaxcokxwdbnrltkup.supabase.co
- Edge Functions desplegadas: `execute-workflow`, `get-bcv-rate`
- Modelo IA planificado: `claude-opus-4-7` (Sprint S5)
