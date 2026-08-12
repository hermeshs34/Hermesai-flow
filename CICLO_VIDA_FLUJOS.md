# Ciclo de vida de un flujo — propuesta

> Estado: **propuesta, pendiente de aprobación de Hermes.** Nada de esto está
> implementado. Decisión de negocio del 12/08/2026.

---

## 1. El problema

Hoy un flujo no tiene versión ni estado de definición. `workflows.status` existe,
pero es el estado de la **última ejecución** (`idle | running | error | paused`,
con `CHECK` en la base): no sirve para esto y no debe reutilizarse — mezclar
«cómo fue la última corrida» con «está aprobado» es exactamente el tipo de
columna sobrecargada que a este proyecto ya le ha costado caro.

Consecuencia: **un flujo activo corre siempre la última definición guardada.** Si
alguien edita un flujo ya revisado, el cambio entra en el siguiente disparo sin
que nadie lo vuelva a mirar. Cualquier esquema de «diseñar → autorizar →
ejecutar» es decorativo mientras eso siga así.

Y editar no es un acto administrativo: desde el lienzo se cambia el destinatario
de un correo, el `rol_aprobador` de un nodo de aprobación —o sea, quién
autoriza— y hacia dónde va cada rama de una decisión.

---

## 2. Los tres actos y quién los hace

| Acto | Riesgo | Rol |
|---|---|---|
| **Diseñar** — define a quién se escribe, quién aprueba, por dónde va cada rama | Alto | `dueno_proceso` |
| **Autorizar** — da por bueno lo diseñado | Control | `supervisor` |
| **Ejecutar** — lanza algo ya fijado; manda en el *cuándo*, no en el *qué* | Bajo | `operador` |

Regla que sostiene el esquema: **quien autoriza no edita.** Si el supervisor
puede modificar lo que revisa, los cuatro ojos se rompen igual, solo que en el
otro sentido. Cuando encuentra un problema **no corrige: rechaza y devuelve al
dueño**, y ese rechazo es una transición del flujo con motivo escrito, no un
mensaje por fuera del sistema.

### Matriz objetivo

| Rol | Diseñar | Autorizar | Ejecutar borrador | Ejecutar publicado |
|---|---|---|---|---|
| `dueno_proceso` | ✅ | ❌ | ✅ | ❌ |
| `supervisor` | ❌ | ✅ | ❌ | ❌ |
| `operador` | ❌ | ❌ | ❌ | ✅ |
| `admin` | ✅ | ✅ | ✅ | ✅ |
| `autorizador` | ❌ | ✅ | ❌ | ✅ |
| `cumplimiento`, `auditor` | ❌ | ❌ | ❌ | ❌ |

**El diseñador tiene que poder probar.** Por eso la ejecución se separa por
**estado del flujo**, no solo por rol: el dueño ejecuta borradores (pruebas), el
operador ejecuta publicados (producción). Es la separación de siempre entre
prueba y producción.

---

## 3. Máquina de estados

```
                   ┌──────────────────────────────────────┐
                   │                                      │
                   ▼                                      │
             ┌───────────┐   enviar a revisión    ┌──────────────┐
   crear ──▶ │ borrador  │ ─────────────────────▶ │ en_revision  │
             └───────────┘   (dueño)              └──────────────┘
                   ▲                                 │        │
                   │  rechazar (supervisor,          │        │ autorizar
                   │  con motivo obligatorio) ───────┘        │ (supervisor)
                   │                                          ▼
                   │                                   ┌─────────────┐
                   └────── cualquier edición ───────── │  publicado  │
                           (vuelve a borrador          └─────────────┘
                            y se desactiva)                   │
                                                              ▼
                                                     lo ejecuta el operador
                                                     y lo dispara el cron
```

**La transición que hace que todo esto valga algo:** *cualquier edición de un
flujo publicado lo devuelve a `borrador` y lo desactiva.* Sin ella no hay forma
de garantizar que lo que corre es lo que se autorizó.

Es deliberadamente conservador: **ante la duda, el flujo se para.** Un flujo
detenido se nota y se arregla; un flujo que corre una versión que nadie revisó,
no.

### Por qué no versionado completo (todavía)

La alternativa —guardar una instantánea de nodos y conexiones al publicar, y que
el motor ejecute la instantánea— es más potente y bastante más cara: tabla de
versiones, motor leyendo de ahí, y toda la UI de comparar versiones. La regla de
arriba da el 90 % del control con una columna. **Recomendación: empezar por la
regla; el versionado, si hace falta, después.**

---

## 4. Cambios necesarios

### Base de datos
- `workflows.estado_definicion TEXT NOT NULL DEFAULT 'borrador'`
  con `CHECK (estado_definicion IN ('borrador','en_revision','publicado'))`.
  **Columna nueva — no tocar `status`.**
- Tabla `workflow_autorizaciones` (traza, no estado):
  `id, organization_id, workflow_id, accion ('enviar'|'autorizar'|'rechazar'),
  actor_id, motivo, creado_at`.
  ⚠️ El campo de actor se llama `actor_id` aquí porque la tabla es nueva; **no
  confundir con `audit_log`, que usa `usuario_id`** (CLAUDE.md §5).
- RLS: `estado_definicion` solo lo escribe quien tiene el permiso de la
  transición correspondiente. La columna no puede ser editable por el mismo
  UPDATE que usa el lienzo, o el dueño se autopublica.

### Permisos (`src/core/user.types.ts`)
- Nuevo permiso `authorize_workflows`.
- `supervisor`: **pierde** `manage_workflows`, **gana** `authorize_workflows`.
- `operador`: **gana** `execute_workflows`.
- Actualizar la política RLS de edición para sacar a `supervisor`
  (la migración `20260812_rls_edicion_igual_que_manage_workflows.sql` ya lo dejó
  anotado).

### Motor
- `execute-workflow`: además del rol, mirar el estado.
  `publicado` → `operador`, `autorizador`, `admin`.
  `borrador`/`en_revision` → solo quien tiene `manage_workflows` (prueba).
  ⚠️ `ROLES_QUE_EJECUTAN` está **copiada** en la Edge Function (CLAUDE.md §6):
  al cambiarla hay que cambiar las dos.
- `cron-runner`: disparar **solo** flujos `publicado`. Hoy filtra por
  `is_active`; pasa a exigir las dos cosas.

### Pantalla
- Distintivo de estado en el Constructor y en la lista.
- Botones *Enviar a revisión* / *Autorizar* / *Rechazar* según permiso.
- El rechazo **exige motivo**; se muestra al dueño al abrir el flujo.
- Avisar al editar un flujo publicado: *«esto lo devolverá a borrador y lo
  desactivará»*, antes de guardar y no después.

### Migración de los flujos que ya existen
No pueden nacer todos en `borrador`: el que está activo dejaría de correr.
- `is_active = true` → `publicado` (heredado, con una fila en
  `workflow_autorizaciones` que diga que es una convalidación de la migración,
  no una autorización real de nadie).
- `is_active = false` → `borrador`.

---

## 5. Decisiones abiertas

1. **No hay ningún `supervisor`.** El censo son 5 personas: 2 `admin` (Hermes,
   Daniel), 1 `dueno_proceso` (Abraham), 1 `cumplimiento` (Nohemy), 1 `operador`
   (Katherine). **El rol que autoriza está vacío**, así que el esquema no
   arranca hasta nombrar a alguien.
   Si Abraham diseña y Katherine ejecuta, el autorizador natural es **Daniel** —
   pero eso deja un solo `admin`. Nohemy es la otra opción, aunque ya es el único
   Oficial de Cumplimiento y cargarla más repite un riesgo ya señalado.
2. **¿`autorizador` también autoriza definiciones?** En la matriz de arriba sí,
   por coherencia con su nombre. Hoy tampoco tiene a nadie.
3. **¿Qué pasa con un flujo publicado que está corriendo cuando se edita?** La
   propuesta lo devuelve a borrador; el run en curso termina. Alternativa: no
   dejar editar mientras hay un run vivo.
4. **¿Se puede publicar un flujo con nodos sin configurar?** Hoy los hay —un
   `Decisión (Si/No)` vacío va siempre por la rama `true` (CLAUDE.md §9.4). La
   autorización es el sitio natural para exigir que no queden nodos a medias.
