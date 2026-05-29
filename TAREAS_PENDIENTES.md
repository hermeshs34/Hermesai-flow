# TAREAS_PENDIENTES.md — HermesAI Flow
> Backlog activo del proyecto. Actualizar al inicio y fin de cada sesión.

**Última actualización:** 29 Mayo 2026 — Fin de sesión  
**Fase actual:** Sprint S3 completado ✅ — Próximo: S4 (Cron automático + Netlify + RiskGuard)

---

## ✅ Completado hoy (29 Mayo 2026)

### Sprint S3 — Integración Indicadores de Gestión
- [x] 5 nodos nuevos sección "Gestión Empresarial": Leer Indicadores, Alerta KPI, Semáforo, EE.FF., Reporte Gerencial
- [x] Edge Function actualizada con schema real: `indicadores_definicion` + `indicadores_valores` + `alertas`
- [x] Settings: sección de secrets para Indicadores, EE.FF. y RiskGuard con links directos
- [x] Fix columnas reales `execution_logs`: `details_json` y `executed_at` (logs en Monitoreo funcionando)
- [x] Fix comparación Decisión case-insensitive (`rojo == Rojo` ahora funciona)
- [x] Fix email `buildContextSummary`: arrays muestran conteo, timestamps formateados, sin `[object Object]`
- [x] Eliminar conexiones con clic en la flecha
- [x] Flujo demostración completo validado end-to-end:
  - `Inicio Manual → Leer Indicadores → Semáforo → Decisión → Reporte Gerencial (email) / Log`
  - 50 indicadores leídos, 6 en riesgo, 44 logrados, 10 alertas críticas
  - Email ejecutivo llega correctamente con datos formateados

### Bugs resueltos
- [x] `execution_logs` vacía — columnas `details`/`timestamp` no existían en schema real
- [x] `[object Object]` en email — arrays no se formateaban
- [x] Decisión siempre FALSA — comparación case-sensitive (`rojo` vs `Rojo`)
- [x] Sin logs en Monitoreo — query usaba nombres de columna incorrectos
- [x] DNS error Indicadores — proyecto Supabase incorrecto en secrets

---

## 🔴 PENDIENTE INMEDIATO

- [ ] Ejecutar migración `branch` en Supabase SQL Editor (si no se hizo):
  ```sql
  ALTER TABLE workflow_connections
      ADD COLUMN IF NOT EXISTS branch TEXT CHECK (branch IN ('true', 'false'));
  ```
- [ ] Restaurar umbral rojo del Semáforo a `1` (se cambió a `0` para pruebas)

---

## 🟠 MAÑANA — Sprint S4

### 1. Programar flujo con Cron
- [ ] Cambiar trigger de "Inicio Manual" a "Programado (Cron)" en flujo Indicadores
- [ ] Configurar: `0 8 * * 1` (lunes 8am) para reporte semanal automático
- [ ] Verificar que pg_cron o Supabase Scheduled Functions estén disponibles

### 2. Netlify deploy
- [ ] Conectar repo `hermeshs34/Hermesai-flow` a Netlify
- [ ] Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV=production`
- [ ] Verificar que el build pase sin errores

### 3. Conectores RiskGuard completos
- [ ] Agregar secrets `RISKGUARD_SUPABASE_URL` + `RISKGUARD_SERVICE_ROLE_KEY`
- [ ] Verificar schema real de RiskGuard (igual que hicimos con Indicadores)
- [ ] Probar flujo: `Alerta Siniestro → Score Fraude → Decisión → Reporte`

### 4. Mejorar plantilla email Reporte Gerencial
- [ ] Incluir tabla de indicadores en riesgo (nombre + valor + meta + % cumplimiento)
- [ ] Incluir lista de alertas críticas sin reconocer
- [ ] Diseño más ejecutivo con logo HermesAI

---

## 🟡 Sprint S5 — Agente IA

- [ ] Nodo `processor:ia_analisis` — Claude Opus 4.7 analiza contexto y genera resumen
- [ ] Streaming de respuesta al frontend
- [ ] Plantilla "Análisis ejecutivo semanal con IA"

---

## 🔗 Referencias

- GitHub: https://github.com/hermeshs34/Hermesai-flow
- Supabase HermesAI Flow: https://kbscaxcokxwdbnrltkup.supabase.co
- Supabase Indicadores: https://fciaudxeuycqtuzyurnb.supabase.co
- Edge Functions: `execute-workflow` (f730799), `get-bcv-rate`
- Último commit: f730799
