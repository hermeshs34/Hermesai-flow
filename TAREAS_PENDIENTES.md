# TAREAS_PENDIENTES.md — HermesAI Flow
> Backlog activo del proyecto. Actualizar al inicio y fin de cada sesión.

**Última actualización:** 27 Octubre 2026 — Fin de sesión (ver «MAÑANA»)
**Fase actual:** F1 Gobierno completado ✅ — Próximo: F2 (aprobaciones reales / human-in-the-loop)

---

## ▶️ MAÑANA (28/10/2026) — seguir el blindaje por aquí

Estado al cerrar el 27/10: pasos 1–3 en producción y empujados (commit `34fd0dc`),
más el administrador de plataforma protegido (`20261027d`, ensayo ROJA 4/10 → VERDE
10/10, aplicada 10/10; `admin-set-active` v2 desplegada). Hermes lo probó en pantalla.

En este orden, una cosa por mensaje:
1. [x] **`exigirMfa` en las Edge Functions con clave de servicio** (paso 5 de abajo).
   ✅ 28/10: las 3 `admin-*` (`e680339`), `resolve-approval` + `design-assistant`
   (`664f637`, la pantalla manda `apikey` en el fetch crudo) y `execute-workflow`
   solo en la rama de usuario (`0f0c1d9`). Todas sondeadas; Hermes probó Gobierno,
   aprobar y el asistente. El reloj siguió 10/10 y el BCV + Cola AML corrieron solos
   a las 11:00 UTC con la versión nueva. `health-check` se queda fuera a propósito
   (no actúa por un usuario).
2. [ ] **`_aal2` piloto en `matriz_aprobacion`** (paso 4): ensayo ROJA/VERDE, Hermes
   prueba en Gobierno (con código ve filas; solo con contraseña, vacío); luego el resto.
3. [ ] **CSP** (paso 6): primero Report-Only, se prueba en Netlify (no en localhost).
4. [ ] **Turnstile** bien hecho (paso 7) + revisión final de XSS y service worker.
5. [ ] **CLAUDE.md**: §6.8 al día, sección nueva de MFA (aal2, 6 h, `exigir_mfa`,
   sesiones) y la regla del admin de plataforma (`profiles_admin_plataforma_guard` +
   control en `admin-set-active`; restablecerle la clave sí se permite).

---

## 🔐 Blindaje de seguridad (/blindar-seguridad) — en curso (27/10/2026)

**Un solo entorno: solo PRODUCCIÓN** (`kbscaxcokxwdbnrltkup`), y Netlify despliega
desde `main` ⇒ cada push es producción. Referencia: RiskGuard (no EE.FF.). Cada SQL
con ensayo ROJA/VERDE que se deshace solo, antes de aplicarlo.

Diagnóstico de producción (27/10/2026, `supabase db query --linked`, solo lectura):
16 tablas con RLS, ninguna sin RLS, **ninguna con `_aal2`**; `mfa_satisfecho`,
`mis_sesiones` y `cerrar_sesiones` no existen; 7 usuarios, **0 con factor**; sin
buckets de Storage (0 objetos). Sin `netlify.toml` en el repo (ni CSP), sin
`sw.js` en toda la historia, sin `innerHTML`/`dangerouslySetInnerHTML` en `src/`.

Orden (cada paso, aplicado solo, no le cambia nada a nadie o se deshace en un minuto):

1. [x] **Agujeros previos** — ✅ aplicada 27/10/2026
   (`20261027_sin_truncate_ni_anon_en_funciones_rls.sql`; ensayo ROJA 2/11 → VERDE 11/11,
   11/11 fuera de la transacción; diagnóstico: `truncate_para_authenticated` y
   `definer_ejecutables_por_anon` vacíos). Quitó `TRUNCATE` a `anon` y `authenticated` en
   todas las tablas (11 lo tenían; PostgREST no lo expone, pero el RLS no lo cubre) y de
   los permisos por defecto de `postgres`; y `EXECUTE` de `anon` en `is_admin`,
   `my_organization_id`, `my_role`. `schema.sql` regenerado el mismo día.
   `vigilante_reloj_read` (`using true`, solo lectura, `authenticated`) es deliberado: se queda.
2. [x] **01 — funciones + interruptor** (`20261027b_mfa_funciones_e_interruptor.sql`):
   `mfa_satisfecho`, `mis_sesiones`, `cerrar_sesiones`, `es_admin_plataforma` y la tabla
   `politicas_seguridad.exigir_mfa` (encendido = MFA obligatorio para todos, como en
   RiskGuard; solo lo cambia quien tenga `app_metadata.admin_plataforma` y aal2). Sin
   políticas que las usen y sin pantalla que lea el interruptor, no cambian nada.
   ✅ Aplicada 27/10/2026 con el sí de Hermes: ensayo ROJA 0/25 → VERDE 25/25, sin
   residuo; APLICADA 25/25 fuera de la transacción; `schema.sql` regenerado.
   Falta: poner `app_metadata.admin_plataforma=true` a Hermes (permiso aparte).
3. [x] **MFA en pantalla** ✅ 27/10/2026 (commit `34fd0dc`, probado por Hermes): alta del factor, código tras la contraseña, cierre a las
   6 h, comprobación de sesión viva cada minuto, panel de sesiones abiertas, quitar el
   factor de otro (admin). Hermes da de alta su factor primero.
4. [ ] **02 — `_aal2` piloto** en `matriz_aprobacion` (2 filas, se ve en Gobierno);
   luego el resto con lista explícita. **Sin `_aal2`**: `profiles` (lo lee el login),
   `audit_log` (`App.tsx` inserta el `login`) y `organizations` (revisar el arranque).
5. [ ] **`exigirMfa` en Edge Functions** con clave de servicio que actúan por el
   usuario: `execute-workflow` (rama de usuario), `resolve-approval`, `admin-create-user`,
   `admin-reset-password`, `admin-set-active`, `design-assistant`, `health-check`.
   Fuera: `cron-runner`, `vigilante-reloj`, `webhook-in` (internas) y
   `request-password-reset` (pública).
6. [ ] **CSP**: `netlify.toml` nuevo, solo `[[headers]]`, primero Report-Only → barrera.
7. [ ] **CAPTCHA Turnstile** en login. ⚠️ El restablecimiento va por
   `request-password-reset` (`generateLink`), que **no pasa por el CAPTCHA de GoTrue**:
   la función tiene que verificar el token ella misma (secreto en Edge Secrets).

**Se salta:** restablecer contraseña (ya hecho y más estricto, §6.4), Storage (no hay
buckets), service worker (nunca hubo), XSS en `src/` (no hay HTML crudo). Queda anotado
el riesgo ya conocido de §8.3: texto de IA que vuelva como HTML en un correo.

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
