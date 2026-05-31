# TAREAS_PENDIENTES.md — HermesAI Flow
> Backlog activo del proyecto. Actualizar al inicio y fin de cada sesión.

**Última actualización:** 31 Mayo 2026 — Fin de sesión
**Fase actual:** F1 Gobierno completado ✅ — Próximo: F2 (aprobaciones reales / human-in-the-loop)

---

## ✅ Completado 31 Mayo 2026 — F1 GOBIERNO

**Modelo de roles BPM** (`src/core/user.types.ts`)
- [x] 6 roles: admin, dueno_proceso, supervisor, operador, autorizador, auditor (+ legacy compat)
- [x] 9 permisos granulares + matriz rol→permisos + ROL_META con colores y descripción

**Migración SQL** (`database/migrations/20260531_f1_gobierno.sql`) — EJECUTADA en Supabase
- [x] `audit_log` INMUTABLE (RLS solo INSERT, sin UPDATE/DELETE)
- [x] `matriz_aprobacion` + `delegaciones` (suplencia)
- [x] Funciones `my_org_id()` e `is_admin()` (SECURITY DEFINER, evitan recursión RLS)
- [x] RLS con aislamiento por organización

**Servicio + UI de Gobierno**
- [x] `governance.service.ts`: audit log, CRUD usuarios, SoD (creador≠aprobador), matriz
- [x] `Governance.tsx`: 3 tabs (Usuarios/Matriz/Auditoría), acceso solo admin
- [x] Sidebar: item Gobierno condicional + badge de rol bajo avatar

**Gestión de usuarios (Edge Functions)**
- [x] `admin-create-user`: crea usuario seguro (service_role en servidor, valida admin, rollback, audit) — DESPLEGADA
- [x] Crear usuario con clave temporal autogenerada (modal con copiar)
- [x] Salvaguarda último admin en auto-cambio de rol
- [x] Audit log cableado a acciones reales: login, crear/ejecutar flujo

**Cambio de contraseña self-service**
- [x] `ChangePasswordModal.tsx`: verifica clave actual + requisitos en vivo + audit
- [x] Botón 🔑 en sidebar para cualquier usuario
- [x] Probado end-to-end: admin crea usuario → entra con temporal → cambia su clave ✅

**Verificaciones:** tsc 0 err · lint 0 err · build OK · todo commiteado y pusheado (`8bd3dc0`)

---

## ✅ Completado 30 Mayo 2026

### Sprint S4 — Cron + EE.FF. + Dashboard Cockpit Empresarial

**Cron automático**
- [x] Edge Function `cron-runner` (se ejecuta cada minuto vía pg_cron)
- [x] pg_cron configurado en Supabase con `net.http_post` cada minuto
- [x] Flujo Indicadores con trigger Cron `0 8 * * 1` (lunes 8am)

**Integración EE.FF. (Estados Financieros — proyecto ieuxpyodbqqhnxcfdflf)**
- [x] Nodo `processor:eeff` conectado al schema real
- [x] Usa tabla `financial_entries` (company_id + period_id) — NO income_statement_entries (vacía)
- [x] Agrupa por category: Activos/Pasivos/Patrimonio/Ingresos/Gastos
- [x] Secrets `EEFF_SUPABASE_URL` + `EEFF_SERVICE_ROLE_KEY` configurados
- [⚠️] PENDIENTE: cifras salen más altas que el dashboard (doble conteo por niveles de cuenta)

**Dashboard Cockpit Empresarial (respondiendo evaluación experta BPM)**
- [x] Header de salud con gradiente dinámico + círculo de tasa de éxito
- [x] Filtro de período 24h/7d/30d/todo con query real por cutoff
- [x] KPIs operacionales: ejecuciones, exitosas, errores, activos, tiempo promedio
- [x] KPIs ejecutivos: SLA (<30s), ahorro estimado USD, bloqueados, % automatización
- [x] Bandeja Operativa (componente propio): criticidad por flujo + aprobaciones/bloqueados + reintentar
- [x] Plantillas que CREAN flujos completos (nodos + conexiones) vía saveNodes/saveConnections
- [x] localStorage reader en WorkflowCanvas — abre el flujo creado desde plantilla
- [x] Banner de validación de campos vacíos (con estado React, no DOM)
- [x] Campo responsable derivado de created_by → profiles
- [x] Flujos programados dinámicos (query real workflow_nodes cron)

**Salud de integraciones REAL**
- [x] Edge Function `health-check` — latencia real en ms + prueba de credenciales
- [x] Sidebar consulta health-check al montar y cada 60s
- [x] Estados: ok (verde+latencia), error (rojo+mensaje), unconfigured (amarillo), loading
- [x] Tooltip con latencia + último chequeo al hacer hover

**Identidad y calidad**
- [x] Tutorial rebrandeado de "FlowMaster" → "HermesAI Flow" (6 pasos con tips reales)
- [x] Tutorial reconectado en App.tsx (botón ? en Sidebar)
- [x] Sidebar rediseñado dark theme + avatar usuario
- [x] BUG CRÍTICO resuelto: activar/pausar usaba wf.id como organizationId → ahora orgId real
- [x] Lint: 0 errores (antes 109) — no-explicit-any a warn, _params ignorados, supabase/functions excluido
- [x] tsc 0 errores · build exitoso (124 kB gzip)

---

## 🔴 PENDIENTE INMEDIATO — Mañana 31 Mayo 2026

### 1. EE.FF. — Cuadrar cifras (PRIORIDAD ALTA)
- [ ] Las cifras salen más altas que el dashboard de EE.FF. por doble conteo de niveles de cuenta
- [ ] Dashboard EE.FF. muestra: Activos 392.951.710,07 / Pasivos 113.226.605,96 / Patrimonio 47.664.974,08 / Ingresos 121.252.820,55 / Utilidad 10.090.274,23
- [ ] Investigar cómo el sistema EE.FF. filtra niveles (probablemente usa solo cuentas hoja o solo nivel raíz)
- [ ] Revisar si hay un campo `level` o `parent_account_code` en financial_entries para evitar sumar padres+hijos
- [ ] El usuario advirtió: cuadrar EE.FF. tomó meses, no es trivial

### 2. Revisión completa del sistema
- [ ] Probar todas las plantillas end-to-end (crear → completar campos → ejecutar)
- [ ] Verificar health-check con tooltip de latencia en producción
- [ ] Confirmar que Bandeja Operativa aparece cuando hay errores reales
- [ ] Validar campo responsable muestra el nombre correcto del creador

### 3. Netlify deploy (pendiente desde S4)
- [ ] Conectar repo `hermeshs34/Hermesai-flow` a Netlify
- [ ] Env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_ENV=production
- [ ] Verificar build en CI

### 4. Conectores RiskGuard
- [ ] Agregar secrets RISKGUARD_SUPABASE_URL + RISKGUARD_SERVICE_ROLE_KEY
- [ ] Verificar schema real RiskGuard (igual que Indicadores y EE.FF.)
- [ ] Probar plantilla "Alerta de Siniestro" end-to-end

---

## 🟡 Mejoras pendientes de la evaluación BPM (menor prioridad)

- [ ] Gobierno: rol del usuario visible, auditoría, historial de cambios (quién creó/modificó/ejecutó)
- [ ] Constructor: zoom, minimapa, auto-layout, snap-to-grid, undo/redo, versionado
- [ ] Criticidad configurable por flujo (no solo derivada de errores)
- [ ] Calidad de tipos: reducir los 75 warnings de `any` con tipos de Supabase generados

---

## 🟢 Sprint S5 — Agente IA (futuro)

- [ ] Nodo `processor:ia_analisis` — Claude Opus analiza contexto y genera resumen
- [ ] Plantilla "Análisis ejecutivo semanal con IA"
- [ ] Recomendaciones IA de optimización en el dashboard

---

## 🔗 Referencias

- GitHub: https://github.com/hermeshs34/Hermesai-flow
- Supabase HermesAI Flow: kbscaxcokxwdbnrltkup.supabase.co
- Supabase Indicadores: fciaudxeuycqtuzyurnb.supabase.co
- Supabase EE.FF.: ieuxpyodbqqhnxcfdflf.supabase.co
- Edge Functions: `execute-workflow`, `get-bcv-rate`, `cron-runner`, `health-check`
- Último commit: 6f29318
- Verificaciones: `npm run lint` (0 err), `npx tsc --noEmit` (0 err), `npm run build` (OK)
