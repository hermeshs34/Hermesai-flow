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
- `supervisor`: ~~**pierde** `manage_workflows`~~ ✅ hecho el 12/08/2026;
  **gana** `authorize_workflows` — pendiente.
- `operador`: **gana** `execute_workflows`.
- ~~Actualizar la política RLS de edición para sacar a `supervisor`.~~
  ✅ Hecho: `20260812_supervisor_no_edita.sql`, las **cuatro** políticas
  (`nodes_editor_write`, `connections_editor_write`, `workflows_editor_update`
  y `workflows_editor_write`) en `admin, dueno_proceso, editor`.

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

1. ~~**No hay ningún `supervisor`.**~~ **Resuelto el 12/08/2026:** Hermes dio de
   alta a **Nahum Azevedo** como `supervisor`. Censo actual: 6 personas —
   2 `admin` (Hermes, Daniel), 1 `dueno_proceso` (Abraham), 1 `supervisor`
   (Nahum), 1 `cumplimiento` (Nohemy), 1 `operador` (Katherine). El esquema ya
   tiene a alguien en las tres puntas.

   ✅ **Y se le quitó la edición el mismo día** (decisión de Hermes:
   *«el supervisor no edita el flujo, solo lo autoriza, porque se pierde el
   control; él debe remitir al dueño para su edición y corrección»*).
   `supervisor` pierde `manage_workflows` en `ROLE_PERMISSIONS` y sale de las
   políticas RLS de edición (`20260812_supervisor_no_edita.sql`, aplicada en
   producción). Le quedan `approve_tasks` y `view_logs`.

   Eran **cuatro** políticas, no tres: al aplicarla se comprobó contra la base
   que `workflows_editor_write` (INSERT) también admitía `supervisor` — crear un
   flujo es editarlo. Las cuatro quedan en `admin, dueno_proceso, editor`.

   ⚠️ Queda el hueco al revés: hasta que exista `authorize_workflows` y los
   estados de abajo, **Nahum no tiene todavía nada que autorizar** a nivel de
   definición. Aprueba tareas de ejecución y mira logs. Es el hueco correcto
   —falta permiso, no sobra— pero es un motivo más para hacer §3.
2. **¿`autorizador` también autoriza definiciones?** En la matriz de arriba sí,
   por coherencia con su nombre. Hoy tampoco tiene a nadie.
3. ~~**¿Qué pasa con un flujo publicado que está corriendo cuando se edita?**~~
   **Resuelto — decisión de Hermes del 12/08/2026: el esquema debe respetar si
   un flujo está en ejecución o programado.** Ver §6.
4. **¿Se puede publicar un flujo con nodos sin configurar?** Hoy los hay —un
   `Decisión (Si/No)` vacío va siempre por la rama `true` (CLAUDE.md §9.4). La
   autorización es el sitio natural para exigir que no queden nodos a medias.
   Con parámetros (§7) esto deja de ser opcional: cada parámetro nuevo es una
   cosa más que se puede quedar sin configurar **en silencio**.

---

## 6. Un flujo vivo no se toca

> *«este esquema de aprobación y flujos debe respetar si un flujo está en
> ejecución o programado, porque si cambia puede dañar»* — Hermes, 12/08/2026.

Son tres peligros distintos y solo uno es leve.

### 6.1 Run en curso (`status='running'`) — leve

El motor carga nodos y conexiones **una vez, al arrancar**
(`execute-workflow/index.ts:1246`) y ejecuta desde memoria. Una edición a mitad
de run no cambia lo que ese run está haciendo, y el timeout de la Edge Function
son 150 s: la ventana es corta. No hace falta protegerlo por sí solo.

### 6.2 Run pausado esperando aprobación — GRAVE. ✅ Cerrado el 12/08/2026

La carga de la línea 1246 ocurre **antes** de bifurcar a `resume` (línea 1263).
O sea: **un run reanudado relee la definición actual de la base**, no la que
tenía al pausarse. Con el vencimiento por defecto en 48 h, esa ventana es de dos
días.

Consecuencia: el aprobador da el visto bueno a la versión A y el flujo continúa
con la versión B. Puede cambiar el destinatario del correo, la rama de una
decisión o el propio `rol_aprobador` de un nodo posterior. Y no queda registrado
en ningún sitio: **lo aprobado y lo ejecutado dejan de ser lo mismo, en
silencio.** Es la firma de los incidentes de este proyecto.

Dos arreglos posibles:

| | Coste | Qué hace |
|---|---|---|
| **Huella de definición** (recomendado) | Bajo | Al pausar se guarda un hash de nodos+conexiones. Al reanudar, si no coincide, **no reanuda**: deja el run en error con «el flujo cambió después de aprobarse; hay que volver a aprobarlo». |
| **Instantánea** | Alto | Al pausar se guarda la definición entera y el resume ejecuta la instantánea. Más potente; es el versionado del §3 por la puerta de atrás. |

**Recomendación: la huella.** Falla cerrado, es una columna, y no obliga a
decidir hoy lo del versionado. La instantánea, si hace falta, después.

✅ **Implementada el 12/08/2026** — `execution_runs.definicion_huella`
(`20260812_huella_definicion_al_pausar.sql`) y la comprobación en
`execute-workflow`, desplegada. Al reanudar con la definición cambiada el run
pasa a `error`, se registra un `execution_logs` con las dos huellas y la función
devuelve 409 con un motivo legible, que `resolve-approval` reenvía al toast del
aprobador. Detalles finos en CLAUDE.md §9.5 — entre ellos que **la huella cubre
el `branch` de cada conexión pero no la posición en el lienzo**, y que un
`NULL` (runs anteriores a la migración) cuenta como fallo, no como permiso.

⚠️ Sigue siendo un **rechazo**, no una reanudación de la versión aprobada. Eso
es la instantánea, y sigue siendo el §3.

### 6.3 Flujo programado — el daño es por omisión

Aquí la regla del §3 («cualquier edición devuelve a borrador y desactiva») se
vuelve en contra: un flujo con cron se **deja de disparar** y nadie se entera,
porque la ausencia de una ejecución no genera ningún aviso. Es la misma familia
que el `succeeded` de pg_cron: **el silencio parece normalidad.**

Reglas:

1. **No se edita un flujo con un run vivo** (`running` o `esperando_aprobacion`).
   El lienzo pasa a solo lectura con el motivo y desde cuándo. Se aplica **en la
   base**, no solo en la pantalla — un `TRIGGER` con `RAISE EXCEPTION` y mensaje
   en claro, porque ese texto llega al usuario (§12.2 de CLAUDE.md). Repetir el
   error de dejar la regla solo en el navegador ya nos ha costado tres veces.
2. **Despublicar es un acto visible, nunca un efecto secundario.** Antes de
   guardar, avisar nombrando **el próximo disparo en hora de Venezuela**
   («dejará de ejecutarse mañana a las 09:00»). Después, fila en
   `workflow_autorizaciones` y en `audit_log`.
3. **Que la parada se vea sin buscarla:** contador en el Dashboard de flujos que
   estaban publicados y hoy están en borrador. Un flujo parado tiene que doler a
   la vista.
4. La edición, el cambio de estado y la desactivación van **en la misma
   transacción**. Hoy `saveNodes`/`saveConnections` ya son un `delete`+`insert`
   no atómico (CLAUDE.md §12.1): esto refuerza la RPC transaccional que ya está
   pendiente, no añade trabajo nuevo.

---

## 7. ¿Se puede hacer paramétrico?

> *«el esquema del flujo de procesos y aprobaciones se puede hacer paramétrico
> para que no se tenga que hacer tantas modificaciones a nivel de programación,
> ¿es muy complejo?»* — Hermes, 12/08/2026.

**Sí en su mayor parte, y menos complejo de lo que parece — pero no todo debe
serlo, y lo más valioso ya está construido y sin conectar.**

### 7.1 Lo que ya está pagado y no se usa — barato y de alto valor

> ✅ **HECHO el 13/08/2026.** La matriz ya decide. Lo que sigue es el diagnóstico
> original; el detalle de cómo quedó está en `CLAUDE.md` §6.5. De este apartado
> queda abierto solo **`delegaciones`** (último párrafo).

**`matriz_aprobacion` existe, tiene pantalla de mantenimiento completa en
`Governance.tsx` (alta, edición, activar, borrar) y NINGUNA Edge Function la
lee.** El motor saca el aprobador de `config_json.approver` del nodo y punto.

Es exactamente lo que estás pidiendo, ya construido: `categoria`,
`umbral_monto`, `operador`, `rol_aprobador`, `nivel`. Hoy, para cambiar quién
autoriza una compra por encima de X, hay que abrir **cada nodo de cada flujo**.
Con la matriz conectada es **una fila en una pantalla**.

Lo que falta es el cable: en `case 'processor:aprobacion'`, si el nodo no fija
aprobador, consultar la matriz por categoría y monto. Un día de trabajo,
aditivo, sin tocar lo que hoy funciona.

⚠️ **Fallar cerrado.** Si ninguna regla casa, el nodo **revienta con mensaje
claro**; nunca un aprobador por defecto. Hoy la línea 368 tiene
`cfg.approver ?? 'supervisor'` — un rol que **no tiene a nadie** (§5.1). Es la
misma trampa del `'' === ''` del §9.4: lo que no se configuró se convierte en un
«sí» permanente.

> ✅ Cableado y desplegado el 13/08/2026, fallando cerrado tal como dice el
> párrafo de arriba. Salió además un caso que el diseño no había previsto: **dos
> reglas empatadas en precedencia que piden cosas distintas**. Elegir una al azar
> es la misma configuración rota en silencio, así que también detiene el nodo.

⚠️ **ABIERTO — `delegaciones`**: la tabla existe y no la lee ni una línea. Es lo
que convierte «solo hay una Nohemy» de riesgo en incidencia gestionable. Sigue
siendo el mismo tipo de deuda que era la matriz: pantalla sin motor.

### 7.2 Las listas copiadas — coste medio, y es la enfermedad crónica

`ROLES_QUE_EJECUTAN`, `ROLES_REGULATORIOS` (4 copias), `ROLES_APROBADORES` (2),
`ESCALA_A`. CLAUDE.md repite «si cambias una, cambia la otra» cinco veces, y el
incidente de AML del 11/08 fue exactamente eso: la copia que mandaba no tenía la
regla.

Se pueden mudar a una tabla `politicas_org (organization_id, clave, valor_json)`
que lean **las dos capas** — la Edge Function ya tiene base de datos, así que la
copia deja de ser necesaria. Dos o tres días. Tres cautelas:

1. **Si la lectura falla, denegar.** Nunca caer a un valor permisivo.
2. **Caché corta** en la función, o cada nodo añade una consulta.
3. **Quién edita las políticas es en sí una política:** solo `admin`, y **todo
   cambio a `audit_log`**. Una tabla de reglas que se toca sin dejar rastro es
   peor que una constante en el código.

### 7.3 Lo que NO debe ser paramétrico

- **La segregación de funciones** (quien lanza no aprueba). Si es una casilla en
  una pantalla, se puede apagar — y se apagará el día que estorbe. Es
  precisamente el control que viene a comprobar un auditor.
- **La máquina de estados** del §3. Las máquinas de estado configurables
  terminan siendo un segundo producto que mantener.
- **La regla del Oficial de Cumplimiento** (ni un admin aprueba AML). Hacerla
  parámetro es dejar que un admin se la conceda a sí mismo — que es justo lo que
  la puerta del escalamiento hacía sin querer hasta el 11/08.

**Regla práctica: se parametrizan los valores (quién, cuánto, cuándo, cuánto
tiempo); se dejan en código los invariantes (quién nunca, qué no se salta).**

### 7.4 Lo honesto sobre el coste

«Paramétrico del todo, que no haya que programar nada» es construir un motor de
reglas: un segundo producto. El 80 % del alivio está en **7.1 + 7.2**, que es
trabajo de días, no de meses.

Y una advertencia que este proyecto se ha ganado: **cada parámetro es una cosa
más que se puede quedar mal configurada en silencio.** Por eso la
parametrización viene atada a la validación al publicar (§5, decisión 4): un
parámetro sin valor **bloquea la publicación**, no se ejecuta con un supuesto.
