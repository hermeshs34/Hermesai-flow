# VISIÓN DE PRODUCTO — HermesAI Flow
> Guía maestra para escalar de "editor de flujos" a **plataforma de orquestación de procesos de clase empresarial**.
> Documento de arquitectura y roadmap. Elaborado desde la óptica de reingeniería de procesos (BPM).

**Versión:** 1.0 — 30 Mayo 2026
**Autor:** HermesAI Engineering
**Clasificación:** Estratégico / Confidencial
**Referencia de madurez:** Camunda · Appian · Pega · Power Automate

---

## 0. Propósito

HermesAI Flow es el **hub central de automatización de procesos** del ecosistema HermesAI (RiskGuard, Estados Financieros, Indicadores de Gestión, LegalTech). El objetivo de esta visión es definir QUÉ debe tener el sistema para:

1. Ser operado por usuarios **no técnicos** (look & feel amigable, programación sin código).
2. Permitir **mejora continua** de procesos (mapear, medir, optimizar inicio→fin).
3. Tener **gobierno y control** (quién aprueba, quién autoriza, segregación de funciones).
4. Cumplir **seguridad y ciberseguridad** de nivel financiero regulado (SUDEASEG/SUDEBAN, ISO 27001).

---

## 1. Las 7 capas de madurez

### Capa 1 — MODELADO ("diseñar el proceso, no solo el flujo")
Distinguir **flujo técnico** (lo que ejecuta la máquina) de **proceso de negocio** (lo que entiende el gerente).

- Notación **BPMN 2.0 ligera**: eventos (inicio/fin/temporizador), tareas (automática vs humana), compuertas (exclusiva/paralela), carriles.
- **Swimlanes por rol** — cada carril muestra el responsable de cada paso.
- **Mapa SIPOC / end-to-end** — Proveedor → Entrada → Proceso → Salida → Cliente.
- **Versionado de procesos** (v1/v2/v3) con diff visual → habilita mejora continua medible.
- **Simulación pre-producción** — correr con datos de prueba sin disparar acciones reales.

### Capa 2 — EJECUCIÓN ("orquestación robusta")
*Estado actual: motor DAG, cron, webhook, ramificación SI/NO ya operativos.*

- **Reintentos con backoff** + **compensación** (patrón Saga: deshacer pasos previos ante fallo).
- **Human-in-the-loop real** — pausar flujo, crear tarea en bandeja del aprobador, esperar decisión.
- **Timeouts y escalamiento** — "si no responde en 24h, escalar".
- **Idempotencia** — reejecutar no duplica emails ni operaciones.
- **Estado persistente de instancia** — cada ejecución es una instancia con estado propio.

### Capa 3 — GOBIERNO ("quién puede qué") ← **PUNTO MÁS CRÍTICO**
*Estado actual: el sistema NO tiene administración de usuarios.*

**Modelo de roles mínimo:**

| Rol | Permisos |
|---|---|
| Operativo | Ejecutar flujos, completar tareas, ver su cola de trabajo |
| Supervisor/Control | Aprobar, reasignar, monitorear, reintentar errores |
| Dueño de Proceso | Diseñar y optimizar flujos de su área |
| Administrador | Configurar sistema, gestionar usuarios, conectar integraciones |
| Auditor | Solo lectura total + trazabilidad (nunca modifica) |
| Autorizador Máximo | Aprueba operaciones sobre umbral crítico |

**Reglas de autorización:**
- **Matriz de aprobación por monto/criticidad** (ej: <$10K → Supervisor; >$10K → Autorizador Máximo).
- **Segregación de funciones (SoD)** — quien crea NO aprueba. Control anti-fraude.
- **Delegación y suplencia** — reasignación automática por ausencia.
- **Escalamiento automático** por tiempo.
- **Audit trail inmutable** — quién creó/modificó/ejecutó/aprobó, con timestamp, no editable.

### Capa 4 — ANALÍTICA DE PROCESOS ("Process Intelligence")
Convierte el sistema en herramienta de **mejora**, no solo ejecución.

**KPIs de proceso (estándar BPM):**

| KPI | Qué responde |
|---|---|
| Tiempo de ciclo | ¿Cuánto tarda inicio→fin? |
| Tiempo espera vs trabajo | ¿Dónde se estanca? ← cuello de botella |
| Throughput | Instancias procesadas por período |
| Tasa de reproceso | ¿Cuántos vuelven atrás por error? |
| Straight-Through Processing | % completado sin intervención humana |
| Cumplimiento de SLA | % dentro del tiempo objetivo |
| Costo por proceso | tiempo × tarifa de cada paso |
| First-Time-Right | % bien a la primera |

- **Detección de cuellos de botella:** medir tiempo en CADA nodo, marcar en rojo el de mayor espera, sobre el mismo diagrama (heatmap de tiempos).
- **Mejora continua:** comparar tiempo de ciclo v1 vs v2 → reingeniería medible.

### Capa 5 — DASHBOARD ("pirámide por audiencia")
Cuatro vistas según rol:

- **Ejecutivo:** ahorro acumulado, ROI de automatización, salud global, procesos críticos.
- **Gerencial:** SLA por proceso, cuellos de botella, responsables, comparativa de versiones.
- **Operativo:** MI COLA DE TRABAJO — tareas pendientes, aprobaciones, errores a resolver.
- **Control/Auditoría:** trazabilidad, cumplimiento, alertas de SoD violada.

Filtros transversales: período, área, proceso, responsable, sistema, criticidad, ambiente.

### Capa 6 — INTEGRACIÓN ("el hub conectado")
*Estado actual: BCV, Indicadores, EE.FF., health-check operativos.*

- **Catálogo de conectores** con estado, latencia, última sync, credenciales.
- **Mapa visual de integraciones** — qué sistema alimenta qué proceso.
- Sistemas: RiskGuard, LegalTech, SIRWeb/Oracle, Resend, + a futuro WhatsApp/Teams y **bus de eventos** (un proceso dispara a otro).
- **Reportería:** PDF/Excel/CSV por proceso, programada, con plantillas por audiencia.

### Capa 7 — SEGURIDAD Y CIBERSEGURIDAD ("no negociable")
Arquitectónica, no parche. Orquesta sistemas financieros regulados.

**Acceso:** MFA obligatorio (AAL2), SSO corporativo, política de contraseñas, expiración de sesión.
**Autorización:** RBAC granular + least-privilege, SoD aplicada técnicamente.
**Integraciones (zero-trust):**
- Cada conexión externa usa credencial de servicio con permisos mínimos, nunca la del usuario.
- Secrets en vault (Supabase Secrets), jamás en código ni frontend.
- Verificación de firma HMAC en webhooks entrantes.
- Validación/sanitización de inputs, rate limiting.
**Trazabilidad:** audit log inmutable, cifrado en tránsito y reposo, alertas de seguridad (acceso no autorizado, ejecución fuera de horario, cambio de permisos).

---

## 2. Hoja de ruta priorizada (por impacto/riesgo)

| Fase | Foco | Por qué |
|---|---|---|
| **F1 — Gobierno** ⬅️ ARRANQUE | RBAC + matriz aprobación + audit trail + SoD | Sin esto no es desplegable en producción regulada. Mayor riesgo. |
| **F2 — Human-in-the-loop** | Aprobaciones reales + bandeja de trabajo operativa | Corazón de un sistema de procesos; hoy es maqueta. |
| **F3 — Process Intelligence** | KPIs de ciclo + heatmap de cuellos de botella | Pedido central de mejora y optimización. |
| **F4 — Modelado BPMN** | Swimlanes + versionado + simulación | Legible para no-técnicos y medible. |
| **F5 — Seguridad avanzada** | MFA + zero-trust + firma webhooks + alertas | Endurecimiento antes de exponer a producción. |
| **F6 — Reportería + mapa integraciones** | Exportación programada + diagrama de sistemas | Valor para gestión ejecutiva. |

---

## 3. F1 — GOBIERNO (detalle del arranque)

Cuando comience la implementación, F1 abarca:

### 3.1 Modelo de datos (nuevas tablas Supabase)
```
roles                (id, nombre, descripcion, permisos_json)
usuarios_roles       (usuario_id, rol_id)  -- un usuario puede tener varios
matriz_aprobacion    (id, proceso/categoria, umbral_monto, rol_aprobador, nivel)
delegaciones         (usuario_id, suplente_id, desde, hasta)
audit_log            (id, usuario_id, accion, entidad, entidad_id,
                      datos_antes, datos_despues, ip, timestamp)  -- INMUTABLE
```

### 3.2 Reglas a implementar
- [ ] CRUD de usuarios y roles (solo Administrador).
- [ ] Asignación de permisos por rol (matriz de capacidades por módulo).
- [ ] Verificación de rol antes de cada acción de escritura (centralizada, no en componentes).
- [ ] Segregación de funciones: bloquear que el creador de un flujo lo apruebe.
- [ ] Matriz de aprobación por monto/criticidad con escalamiento.
- [ ] Audit log inmutable en toda acción sensible (RLS: solo INSERT, nunca UPDATE/DELETE).
- [ ] Vista de auditoría (solo lectura) para rol Auditor.

### 3.3 UI
- [ ] Pantalla "Administración de Usuarios" (Administrador).
- [ ] Pantalla "Matriz de Autorización".
- [ ] Indicador de rol del usuario en el sidebar.
- [ ] Vista de "Historial de cambios" por flujo (quién/cuándo/qué).

### 3.4 Seguridad
- [ ] RLS en todas las tablas nuevas con aislamiento por organización.
- [ ] Least-privilege en cada rol.
- [ ] Preparar terreno para MFA (F5).

---

## 4. Principios rectores

1. **No-código para el usuario** — toda configuración vía UI amigable, nunca editando JSON o SQL.
2. **Corrección sobre velocidad** — sistema crítico de negocio.
3. **Seguridad por diseño** — cada capa nace con su control, no se parchea después.
4. **Medible** — todo proceso debe poder compararse consigo mismo en el tiempo (mejora continua).
5. **Auditable** — toda acción sensible deja rastro inmutable.

---

*Última actualización: 30 Mayo 2026 — HermesAI Engineering*
*Próximo paso: implementación F1 (Gobierno) — ver detalle §3.*
