# Encargo para una sesión de RiskGuard — avisar a Flujos de los siniestros (webhook)

> Origen: HermesAI Flow, 29/09/2026. Decisión de Hermes: **RiskGuard avisa a
> Flujos en el momento en que pasa algo con un siniestro**, en vez de esperar a
> que Flujos lo lea al día siguiente. RiskGuard **envía**; Flujos **recibe** por
> su webhook de entrada, que está en producción desde el 28/09/2026.
> Este documento se abre desde la carpeta de RiskGuard. Desde Flujos no se toca
> RiskGuard (CLAUDE.md de Flujos, §8: Flujos nunca escribe en un sistema origen).
> Aquí van los **requisitos y el contrato**. El diseño concreto —tablas,
> funciones, pantallas— lo decide la sesión de RiskGuard contra su propio código
> y su propia base.

---

## 1. El objetivo

Hoy Flujos se entera de los siniestros **leyendo** RiskGuard a una hora fija.
Lo que ocurre a las 10:00 se sabe a las 07:00 del día siguiente.

Con este encargo, cuando una persona hace algo en RiskGuard con un siniestro,
RiskGuard llama a Flujos en ese momento con los datos del caso. Flujos arranca
un flujo, que decide a quién avisar y cómo; en el primer uso es un correo.

Tres cosas se tienen que cumplir siempre:

1. **Si Flujos está caído, RiskGuard sigue funcionando.** La persona guarda el
   siniestro igual y no espera a nadie. El aviso sale después.
2. **Un aviso no se pierde en silencio.** O llega, o queda a la vista en
   RiskGuard como no entregado.
3. **Un hecho produce un aviso, y uno solo.** Un reintento no produce un segundo
   correo.

---

## 2. Qué hechos avisan (y cuáles no)

| `evento` | Cuándo sale | Quién lo provoca |
|---|---|---|
| `siniestro_creado` | Una persona da de alta un siniestro **a mano** en RiskGuard (`origen = 'riskguard'`) | una persona |
| `estado_cambiado` | Una persona cambia el estado de un siniestro | una persona |
| `pago_registrado` | Una persona registra un pago (una fila de `siniestros_pagos`) | una persona |

**Regla que gobierna la tabla: un acto de una persona = una llamada.**
- Si al registrar un pago el estado cambia (por ejemplo, `aprobado → pago_parcial`),
  sale **solo** `pago_registrado`, con `estado` y `estado_anterior` rellenos. No
  sale además un `estado_cambiado`.
- Un alta sale como `siniestro_creado`. No sale además un `estado_cambiado`.

**No avisan:**
- Las cargas y sincronizaciones de SIRWeb, aunque creen o cambien siniestros.
  Esas las cubre el flujo diario que ya lee RiskGuard.
- Las migraciones, los rellenos (*backfills*) y cualquier proceso automático.
- Las anulaciones de pagos, los borrados y las ediciones de montos o reservas
  que no cambian el estado. Quedan fuera de esta primera versión.

⚠️ **Lo que decide si se avisa es quién hizo el acto, no de dónde viene el
siniestro.** Un siniestro que entró por SIRWeb y al que una persona le cambia el
estado en RiskGuard **sí** avisa.

⚠️ **Un trigger `AFTER UPDATE` sobre `siniestros`, sin más, no sirve.** Salta
igual con una carga de SIRWeb, un relleno o una migración, y la prueba 5 de la
§7 lo tumbaría. El aviso tiene que colgar del camino que usa la persona desde la
aplicación (la función o RPC que llama la pantalla). Si va en un trigger, este
necesita una marca que distinga el acto de una persona de todo lo demás.

---

## 3. El contrato — qué viaja en cada llamada

### 3.1 La llamada

```
POST https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/webhook-in/<workflow_id>
Content-Type: application/json
x-webhook-secret: hfw_…
Idempotency-Key: <ver §4>
```

- `<workflow_id>` y el secreto los da Flujos al configurar el flujo que recibe
  (§6). El secreto empieza por `hfw_` y **solo se muestra una vez**.
- El cuerpo tiene que ser un objeto JSON de 256 KB como máximo. Un aviso de estos
  ocupa unos 2 KB.
- Flujos admite 60 llamadas por minuto por flujo.

### 3.2 El cuerpo — ejemplo completo (`pago_registrado`)

```json
{
  "version": 1,
  "evento": "pago_registrado",
  "ocurrido_at": "2026-09-29T14:05:00-04:00",
  "empresa": "Seguros HermesAI",
  "siniestro": {
    "id": "5f1c2a90-0000-4000-8000-000000000481",
    "numero": "SIN-2026-00481",
    "poliza": "AUTO-0012345",
    "ramo": "Automóvil",
    "estado": "pago_parcial",
    "estado_anterior": "aprobado"
  },
  "asegurado": { "nombre": "María Pérez" },
  "montos": {
    "moneda": "VES",
    "reclamado": 277000.00,
    "aprobado": 250000.00,
    "pagado": 100000.00,
    "reclamado_usd": 500.00,
    "tasa_bcv": 554.00,
    "tasa_fecha": "2026-09-20"
  },
  "fechas": {
    "ocurrencia": "2026-09-18",
    "notificacion": "2026-09-19",
    "ultimo_pago": "2026-09-29",
    "cierre": null
  },
  "pago": {
    "tipo": "parcial",
    "monto": 100000.00,
    "moneda": "VES",
    "monto_usd": 180.51,
    "fecha": "2026-09-29"
  },
  "para_leer": {
    "titulo": "Pago registrado — Siniestro SIN-2026-00481 — María Pérez",
    "asegurado": "María Pérez",
    "estado": "Pago parcial (antes: Aprobado)",
    "reclamado": "Bs. 277.000,00 (USD 500,00 a tasa BCV 554,00 del 20/09/2026)",
    "aprobado": "Bs. 250.000,00",
    "pagado": "Bs. 100.000,00",
    "pago": "Bs. 100.000,00 (USD 180,51) el 29/09/2026",
    "ocurrencia": "18/09/2026",
    "ultimo_pago": "29/09/2026"
  },
  "enlace": "https://<RiskGuard>/…/siniestros/5f1c2a90-0000-4000-8000-000000000481"
}
```

Un `siniestro_creado` lleva la misma forma con `"estado_anterior": null`,
`"pago": null`, `"ultimo_pago": null` y, en `para_leer`, `"pago": "—"` y
`"ultimo_pago": "sin pagos"`. Un `estado_cambiado`, igual pero con
`estado_anterior` relleno.

### 3.3 Campo por campo

**Cabecera**

| Campo | Regla |
|---|---|
| `version` | `1`. **Añadir** un campo nuevo no cambia la versión. **Renombrar** un campo o cambiar lo que significa pasa a `2`, y hay que avisar a Flujos antes. |
| `evento` | Uno de los tres de la §2, escrito exactamente así. |
| `ocurrido_at` | Cuándo hizo la persona el acto. ISO 8601 **con el desfase** (`-04:00`), nunca sin zona. |
| `empresa` | Nombre de la empresa en RiskGuard, tal como se ve en su pantalla. |
| `enlace` | Abre la ficha de ese siniestro en RiskGuard. Si la aplicación necesita tener la empresa seleccionada para abrirla, el enlace la lleva. |

**`siniestro`**

| Campo | Regla |
|---|---|
| `id` | El `id` de `siniestros`. |
| `numero` | `numero_siniestro`, el que ve la gente. |
| `poliza` | El número de póliza **que se ve en la pantalla de RiskGuard**. Si solo existe el id de Oracle, ese. Lo confirma la sesión de RiskGuard. |
| `ramo` | Texto legible. |
| `estado` | El estado **después** del acto. Uno de los 15 de RiskGuard, por su slug: `abierto`, `en_ajuste`, `en_evaluacion`, `aprobado`, `pagado`, `rechazado`, `cerrado`, `reabierto`, `aviso`, `asignado`, `inspeccion`, `dictamen`, `pago_parcial`, `pago_final`, `apelacion`. |
| `estado_anterior` | El estado de antes **solo si este acto lo cambió**. Si no lo cambió, `null`. |

⚠️ **Si RiskGuard añade o renombra un estado, avisa a Flujos.** Flujos tiene
copiada la lista de los 15 (`ESTADOS_SINIESTRO` en `processor:riskguard`).

**`asegurado`**

| Campo | Regla |
|---|---|
| `nombre` | La captura manual (`asegurado_nombre`) si existe. Si no, **el nombre del padrón** `oracle_asegurados` (clave `empresa_id` + `id_oracle` = `asegurado_oracle_id`). Si tampoco está, `null`. |

⚠️ **El padrón no es opcional.** Los siniestros de SIRWeb no traen el nombre, y
sin esa búsqueda dos de cada tres salían sin identificar. Un `null` tiene que
ser la excepción, y el correo lo dirá: «asegurado sin identificar».

**`montos`** — la foto del siniestro **después** del acto, en su moneda

| Campo | Regla |
|---|---|
| `moneda` | `"VES"` o `"USD"`, la del siniestro. |
| `reclamado`, `aprobado`, `pagado` | En la moneda del siniestro. `pagado` es el acumulado **incluido** el pago de este acto. `null` si no hay valor. |
| `reclamado_usd` | `monto_usd`, el equivalente en dólares que **ya calcula RiskGuard**. En un siniestro en USD es igual a `reclamado`. En uno en VES sin tasa registrada, `null`. |
| `tasa_bcv`, `tasa_fecha` | La tasa **congelada al registrar** (`tasa_registro_bcv`, `tasa_registro_fecha`). En un siniestro en USD, las dos `null`. |

⚠️ **Los importes van como números JSON, no como texto.** `277000.00` y no
`"277.000,00"`. Van con punto decimal y sin separador de miles. Un texto con
formato no se puede comparar: la Decisión de Flujos lo convierte con `Number()`
y un `"277.000,00"` da `NaN`.

⚠️ **Flujos nunca convierte monedas.** Toda conversión la hace RiskGuard y viaja
ya hecha. Si falta la tasa, se manda `null`; **nunca otra tasa en su lugar**.

**`fechas`**

| Campo | Regla |
|---|---|
| `ocurrencia` | `fecha_ocurrencia`. |
| `notificacion` | `fecha_notificacion`. |
| `ultimo_pago` | La `fecha_pago` más reciente de `siniestros_pagos`. `null` si no hay pagos. |
| `cierre` | `fecha_cierre`. `null` si no está cerrado. |

⚠️ **Las cuatro van como `AAAA-MM-DD`, sin hora, y en fecha de Venezuela.** Si
alguna columna es un `timestamp`, primero se pasa a hora de Caracas
(`AT TIME ZONE 'America/Caracas'`) y luego se corta. **Nunca se corta la cadena
UTC.** Entre las 20:00 y las 24:00 de Venezuela, el UTC ya va por el día
siguiente. Flujos lo sufrió (su CLAUDE.md, §9.3): un siniestro del 18 aparecía
fechado el 19.

**`pago`** — solo en `pago_registrado`; en los otros dos eventos es `null`

| Campo | Regla |
|---|---|
| `tipo` | `parcial`, `final`, `anticipado` o `complemento`. |
| `monto`, `moneda` | Los del pago, que pueden estar en otra moneda que el siniestro. |
| `monto_usd` | El equivalente que ya guarda RiskGuard. `null` si no lo hay. |
| `fecha` | `fecha_pago`, con la misma regla de fechas de arriba. |

**`para_leer`** — el texto que se pinta en el correo

Flujos no formatea importes ni fechas: pega estos textos tal cual. Por eso:

- Se construye **con los mismos valores del mismo aviso**, nunca con otra
  consulta. Si no, el número y su texto pueden decir cosas distintas.
- Todos los campos van **siempre**, y siempre como texto. Nunca van `null` ni
  vacíos. Cuando falta un dato, el texto lo dice: «asegurado sin identificar»,
  «sin pagos», «—».
- Importes al estilo venezolano: `Bs. 277.000,00`, `USD 500,00`.
- Fechas como `18/09/2026`.
- En VES sin tasa, `reclamado` dice «Bs. 277.000,00 (sin tasa BCV registrada)».

Motivo: en Flujos, un `{{webhook.campo}}` que llega `null` se pinta **en blanco,
sin avisar**. Un correo con un hueco no se distingue de un correo sin dato.

**Lo que NO viaja, a propósito:** cédula o RIF, banco, cuenta de destino,
beneficiario, notas y `fraude_score`. El correo no los necesita, y un dato
personal que no viaja no se puede filtrar.

### 3.4 El aviso es una foto

- El cuerpo se construye **en el momento del acto** y se guarda. Cada reintento
  manda **ese mismo cuerpo**, byte a byte. Un reintento cinco horas después no
  puede mostrar el estado de cinco horas después.
- El orden de llegada **no está garantizado**: un reintento puede llegar después
  de un aviso posterior del mismo siniestro. No pasa nada, porque cada aviso se
  explica solo (lleva `ocurrido_at`, `estado` y `estado_anterior`) y Flujos no
  acumula estado entre avisos.

---

## 4. Idempotency-Key y reintentos

### 4.1 La clave

La clave nace del **hecho**, no del intento:

| Evento | `Idempotency-Key` |
|---|---|
| `siniestro_creado` | `rg:sin:<siniestro_id>:creado` |
| `estado_cambiado` | `rg:sin:<siniestro_id>:estado:<estado_nuevo>:<ocurrido_at en ISO>` |
| `pago_registrado` | `rg:pago:<id de siniestros_pagos>` |

- **Mismo hecho ⇒ misma clave**, se mande una vez o diez. Flujos contesta a la
  repetida sin volver a ejecutar nada, y no sale un segundo correo.
- **Hecho nuevo ⇒ clave nueva.**
- Como máximo 200 caracteres, sin caracteres de control. Las de arriba rondan
  los 90.

### 4.2 Qué hacer con cada respuesta

| Respuesta de Flujos | Qué significa | Qué hace RiskGuard |
|---|---|---|
| **202** `{recibido, recepcion_id}` | Recibido. | **Entregado.** |
| **200** `{duplicada: true, estado_original}` con `estado_original` distinto de `fallo_al_lanzar` | Ya se había recibido (por ejemplo, se perdió la respuesta del primer envío). | **Entregado.** |
| **200** `{duplicada: true, estado_original: "fallo_al_lanzar"}` | Flujos lo recibió pero no llegó a ejecutarlo. | **Reenviar con una clave nueva**: la misma más `#2`, `#3`… (`rg:pago:<id>#2`), dentro de la misma ventana de reintentos. |
| **409** | El flujo que recibe está en revisión o desactivado. | **Reintentar.** |
| **429** | Más de 60 llamadas en un minuto. | Esperar lo que diga `Retry-After` (60 s) y reintentar. |
| **5xx**, sin respuesta, tiempo agotado | Flujos caído o con un problema. | **Reintentar.** |
| **400, 401, 405, 413, 415** | La llamada está mal hecha: secreto erróneo, cuerpo inválido… | **No reintentar solo.** Marcar como **fallido** y avisar. |

⚠️ **El 409 se reintenta, y puede durar horas.** En Flujos, tocar un flujo
publicado lo devuelve a borrador y lo desactiva hasta que otra persona lo vuelva
a autorizar (los cuatro ojos, CLAUDE.md de Flujos, §6.7). Mientras tanto, Flujos
contesta 409. Tratarlo como error definitivo perdería los avisos de ese rato.

**Ventana y ritmo:**
- Reintentos espaciados: 1 min, 5 min, 15 min, 1 h, y luego cada hora hasta
  **24 horas** desde el acto.
- Pasadas las 24 horas sin entregar: **fallido**, a la vista en RiskGuard y con
  aviso a sus administradores.
- Tiempo máximo de espera por llamada: 30 s. Flujos contesta el 202 **antes** de
  ejecutar el flujo, así que lo normal es menos de un segundo.
- No más de 30 llamadas por minuto al mismo destino, la mitad del límite de
  Flujos. Cuenta sobre todo al vaciar la cola después de una caída.

**Un fallido se puede volver a poner en cola**, con el mismo cuerpo y la misma
clave. Esto cubre, por ejemplo, un 401 porque se rotó el secreto en Flujos y
todavía no se había cambiado en RiskGuard. Lo hace un administrador de RiskGuard.
Sin esta salida, «fallido» querría decir «perdido».

**Dónde acaba la responsabilidad de RiskGuard:** en el 202. Si después el flujo
falla dentro de Flujos, eso lo vigila Flujos (avisa a sus administradores y lo
muestra en su panel). RiskGuard no tiene que consultar nada después.

---

## 5. Lo que hay que construir en RiskGuard — requisitos

El diseño lo decide la sesión de RiskGuard. Estos son los requisitos:

1. **El envío sale del servidor, nunca del navegador.** El secreto no puede
   llegar a la pantalla ni al código del frontend.
2. **El aviso se anota en la misma transacción que el acto** (una cola de salida,
   *outbox*). Si el acto se guarda, el aviso existe; si el acto se deshace, el
   aviso tampoco existe.
3. **El envío va aparte, después del commit y sin bloquear a la persona.** Un
   Flujos caído no puede retrasar ni impedir que alguien guarde un siniestro.
4. **Cada aviso de la cola tiene un estado visible:** pendiente, entregado,
   fallido. Se guarda la **respuesta HTTP que de verdad llegó** (código y
   cuerpo), el número de intentos y la hora del último.
5. **El secreto y la dirección de Flujos van en los secretos de RiskGuard**
   (Supabase → Edge Functions → Secrets, o Vault), por ejemplo
   `FLUJOS_WEBHOOK_URL` y `FLUJOS_WEBHOOK_SECRETO`. Nunca en una tabla que lea
   el navegador, nunca en el código y nunca dentro de la cola.
6. **Cada empresa tiene su destino.** Una empresa sin destino configurado **no
   emite nada, ni lo encola.** Así Demo no manda nunca.
7. **El nombre del asegurado se resuelve con el padrón** cuando no hay captura
   manual (§3.3).
8. **Ni SIRWeb, ni rellenos, ni migraciones emiten** (§2).
9. **Un acto, una llamada** (§2).
10. **Antes de escribir una columna, se comprueba contra la base de RiskGuard.**
    Los nombres de este documento salen de los ficheros de migraciones de
    RiskGuard, **no** de su base. Flujos perdió dos meses de auditoría por fiarse
    de un `schema.sql` que no era la base (su CLAUDE.md, §5.1).

⚠️ **Si el envío va por `pg_net`, `net.http_post` no devuelve la respuesta:
devuelve un número de cola.** pg_cron dice `succeeded` aunque el HTTP haya dado
401. La respuesta real está en `net._http_response`, y esa tabla **se vacía con
cada reinicio de la base**. Flujos pasó ocho días con el reloj muerto por
fiarse de ese `succeeded` (su CLAUDE.md, §6.1). Si se usa pg_net, el estado del
aviso tiene que salir del código HTTP leído; si no, mejor una Edge Function que
haga el `fetch` y escriba ella misma el resultado.

---

## 6. Lo que hace Flujos — solo configuración, sin código

El receptor ya existe. En Flujos, Hermes (con ayuda de la sesión de Flujos):

1. Crea un flujo nuevo, por ejemplo «Avisos de siniestros RiskGuard»:
   **Webhook Entrante → Email**. Si hace falta, con una Decisión en medio sobre
   `{{webhook.evento}}`.
2. El Email usa, por ejemplo:
   - Asunto: `{{webhook.para_leer.titulo}}`
   - Cuerpo: `{{webhook.para_leer.asegurado}}`, `{{webhook.para_leer.estado}}`,
     `{{webhook.para_leer.reclamado}}`… y el enlace `{{webhook.enlace}}`.
3. Genera el secreto del webhook. Se muestra **una vez**; Hermes lo copia él
   mismo a los secretos de RiskGuard. No pasa por ningún chat.
4. Lo envía a revisión, lo autoriza **otra cuenta** y lo activa.
5. **Antes de que RiskGuard emita nada**, lo prueba con un aviso simulado:
   `curl -d @ejemplo.json` con el cuerpo de la §3.2.

Para las pruebas de la §7, lo mejor es un flujo **de prueba** cuyo correo vaya
solo a Hermes, no a Cumplimiento ni a la gerencia.

Lo que Flujos hace con el contenido: lo guarda **90 días**, legible solo por el
motor, no por el navegador (CLAUDE.md de Flujos, §8.3). El nombre del asegurado
es un dato personal y se trata así.

**Pendiente en Flujos, fuera de este encargo:** la Decisión de Flujos compara
números con `Number()`, y un campo que llega `null` se lee como **0**. Una regla
«`{{webhook.montos.reclamado_usd}}` < 1000» daría **sí** en un siniestro en VES
sin tasa. Es la misma familia que el `'' === ''` de Flujos (su CLAUDE.md, §9.4).
Hasta corregirlo en Flujos, **no se decide por importe** en este flujo.
✅ Corregido en el código el 05/10/2026 (CLAUDE.md de Flujos, §9.4). Ahora el nodo
elige qué hacer con un valor no numérico: detener el flujo, que es lo que pasa
por defecto, o seguir por la rama Sí o por la rama No. Solo vale en producción
cuando se despliegue `execute-workflow`.

---

## 7. Pruebas de aceptación

Contra el flujo de prueba de Flujos. «Llega» quiere decir: RiskGuard recibe
202, en Flujos hay una ejecución `success` con `triggered_by='webhook'`, y el
correo está en el buzón.

1. **Alta a mano** de un siniestro → exactamente **1** llamada, `siniestro_creado`, llega.
2. **Cambio de estado** → 1 llamada, `estado_cambiado`, con `estado_anterior` correcto.
3. **Pago que cambia el estado** → exactamente **1** llamada (no 2),
   `pago_registrado`, con el bloque `pago`, `ultimo_pago` y `estado_anterior`.
4. **Reenvío del mismo aviso** (misma clave) → 200 `duplicada`, **sin** segundo correo.
5. **Carga de SIRWeb o relleno** que toca siniestros → **0** llamadas.
6. **Flujos no disponible** (flujo de prueba desactivado ⇒ 409) → la persona
   guarda igual, el aviso queda pendiente y reintenta; al reactivar el flujo, llega.
   **Secreto erróneo** (401) → fallido a la vista, sin reintentos, y se puede
   volver a poner en cola.
7. **Siniestro de SIRWeb sin captura manual** al que una persona le cambia el
   estado → avisa, con el **nombre sacado del padrón**.
8. **Monedas:** uno en VES con tasa, uno en VES sin tasa (`reclamado_usd: null`,
   texto «sin tasa BCV registrada») y uno en USD (`tasa_bcv: null`).
9. **Fecha límite:** un acto hecho después de las 20:00 de Venezuela sale con la
   fecha **de Venezuela** en `fechas` y con `-04:00` en `ocurrido_at`.

---

## 8. Decisiones de Hermes (29/09/2026)

1. **Aprobado el contrato** de la §3: nombre del asegurado, número de siniestro,
   montos en su moneda más el equivalente en USD y la tasa, estado y estado
   anterior, y las fechas de ocurrencia, notificación, último pago y cierre.
2. **Aprobados los tres eventos** de la §2. Las cargas de SIRWeb **no** avisan.
3. **No viajan** cédula o RIF, datos bancarios, beneficiario, notas ni
   `fraude_score`.
4. **El 409 se reintenta** (§4.2) — ajuste posterior a la primera aprobación,
   **aprobado por Hermes el 29/09/2026** junto con el documento completo:
   mientras un flujo se vuelve a autorizar, Flujos contesta 409, y no
   reintentar perdería esos avisos.

Cuerpos de ejemplo listos para `curl -d @…` en el repositorio de Flujos:
`docs/webhook-siniestros/ejemplo-pago.json` y `ejemplo-alta.json` (este último,
VES sin tasa y asegurado sin identificar).

---

## 9. Estado y respuestas de la sesión de RiskGuard

*Rellenado por la sesión de RiskGuard el 01/10/2026; cerrado el 04/10/2026.*

**Estado: ✅ ENCARGO CERRADO (04/10/2026).** Desplegado el 01/10 y las 9 pruebas
del §7 superadas contra el flujo de prueba, todas en la empresa demo de
RiskGuard (Atlántida, J-DEMO-0001). Detalle en el §9.4. Hoy **sólo Atlántida**
tiene destino: la empresa real de RiskGuard (Seguros HermesAI) no encola nada
hasta que tenga fila en `flujos_destinos` (ver §9.5).

### 9.1 Qué se construyó y dónde (repositorio RiskGuard_Insurance)

| Pieza | Dónde |
|---|---|
| Destino por empresa + cola de salida (outbox) + trigger + 3 RPC del acto | `database/migrations/20261001_avisos_flujos_siniestros.sql` |
| Cron cada minuto que llama al enviador | `database/migrations/20261001b_cron_avisos_flujos.sql` (se corre **después** de desplegar la función) |
| Enviador: `fetch`, decisión por respuesta, reintentos, correo a admins | `supabase/functions/enviar-avisos-flujos/index.ts` + lógica pura en `supabase/functions/_shared/avisosFlujos.ts` |
| La pantalla deja de escribir directo y pasa por las RPC | `src/lib/services/siniestros.ts` (`crearSiniestro`), `src/lib/services/liquidacion.ts` (`avanzarEstado`, `registrarPago`) |
| Panel del admin: pendientes, entregados, fallidos con código y cuerpo HTTP reales, botón **Reencolar** | `src/components/AvisosFlujosPanel.tsx` en Administración |
| Enlace que abre el siniestro | `src/pages/GestionSiniestros.tsx` (`/siniestros?siniestro=<id>`) |
| Pruebas (43; las 5 últimas, el diagnóstico de un destino que no está en el secreto) | `src/tests/services/avisosFlujos.test.ts` |

**Cómo se cumple «solo personas, un acto = una llamada» (§2, §5.8, §5.9):** el
trigger `AFTER INSERT OR UPDATE` de `siniestros` sólo encola si la transacción
lleva la marca local `app.flujos_acto`, y esa marca sólo la ponen las RPC
`siniestro_crear`, `siniestro_cambiar_estado` y `siniestro_registrar_pago`. El
ETL de SIRWeb, los rellenos y las migraciones no la ponen y no avisan. El
navegador no puede ponerla a mano: PostgREST no expone `set_config`. El pago
y su cambio de estado van en **una** RPC y salen en **un** aviso
`pago_registrado` con `estado_anterior`.

**Outbox (§5.2, §5.3):** el aviso se escribe en la misma transacción que el acto.
Si construir el aviso falla, el acto **no** se deshace: queda una fila
`fallido` con el error a la vista. El envío lo hace la Edge Function, con su
propio `fetch` y escribiendo ella el código HTTP leído, no con `pg_net` (§5,
aviso final). El cuerpo se guarda como **texto** y se reenvía byte a byte.

**Secretos (§5.1, §5.5):** la URL y el `hfw_…` viven en el secreto de Edge
Functions `FLUJOS_WEBHOOK_DESTINOS`. En la base sólo hay `destino_ref`, la clave
dentro de ese secreto.

### 9.2 Columnas comprobadas

Los nombres salen de las migraciones de RiskGuard y se probaron contra un
esquema simulado en PostgreSQL 17 local. *(01/10: Hermes corrió la migración en
la base real y la guarda 0 pasó, así que las columnas quedan medidas contra la
base real.)* El conector de Supabase no está autorizado. Para cumplir el
§5.10 sin fiarse de eso, la **guarda 0 de la migración** consulta
`information_schema.columns` de la base real antes de crear nada. Aborta, sin
dejar nada a medias, si falta cualquiera de estas columnas:

- `siniestros`: `id`, `empresa_id`, `numero_siniestro`, `ramo`, `estado`,
  `moneda`, `monto_reclamado`, `monto_aprobado`, `monto_pagado`, `monto_usd`,
  `tasa_registro_bcv`, `tasa_registro_fecha`, `fecha_ocurrencia`,
  `fecha_notificacion`, `fecha_cierre`, `asegurado_nombre`,
  `asegurado_oracle_id`, `poliza_oracle_id`, `origen`, `updated_at`.
- `siniestros_pagos`: `id`, `empresa_id`, `siniestro_id`, `tipo`, `monto`,
  `moneda`, `monto_usd`, `fecha_pago`.
- `oracle_asegurados`: `empresa_id`, `id_oracle`, `nombre`.
- `oracle_polizas`: `empresa_id`, `id_oracle`, `numero_poliza`.
- `poliza_analitica`: `empresa_id`, `id_core`, `numero_poliza`,
  `es_vigente_snapshot`, `snapshot_desde`.
- `empresas`: `id`, `nombre`.
- `usuarios`: `id`, `auth_user_id`, `empresa_id`, `rol`, `activo`.

También aborta si alguna de las cinco fechas no es `date` ni `timestamptz`,
porque entonces no podría pasarse a hora de Caracas.

### 9.3 Qué difiere de este documento

1. **Secreto:** es un único JSON `FLUJOS_WEBHOOK_DESTINOS`
   (`{"<destino_ref>": {"url": …, "secreto": "hfw_…"}}`) en vez de
   `FLUJOS_WEBHOOK_URL` y `FLUJOS_WEBHOOK_SECRETO`. Así cada empresa puede
   tener su destino (§5.6).
2. **`enlace`:** RiskGuard no tiene ruta de ficha de siniestro. El enlace es
   `<app>/siniestros?siniestro=<id>`, que abre el detalle en la pantalla de
   siniestros (se añadió para esto). No lleva empresa: hoy un login es una
   empresa, y si el siniestro no es de la sesión, la pantalla lo dice.
3. **`poliza`:** la pantalla de siniestros **no muestra póliza**, así que no
   hay «la que se ve». Se manda el número del read-model `poliza_analitica`,
   si no el del espejo `oracle_polizas`, si no el id Oracle, y si no `null`.
4. **Etiquetas de estado en `para_leer`:** las mismas que pinta RiskGuard
   (`ETIQUETAS_ESTADO`), con su mayúscula: «Pago Parcial (antes: Aprobado)»,
   no «Pago parcial». Un test compara el SQL con la pantalla. Los 15 slugs de
   `siniestro.estado` son los del documento.
5. **`para_leer.titulo`:** «Siniestro nuevo / Cambio de estado / Pago registrado
   — Siniestro <número> — <asegurado>».
6. **Campos añadidos en `para_leer`** (añadir no cambia la versión, §3.3):
   `numero`, `poliza`, `ramo`, `notificacion` y `cierre`, siempre como texto
   («—» si falta).
7. **VES con tasa pero sin `monto_usd` guardado:** `reclamado_usd: null` y el
   texto lo dice, «Bs. … (sin equivalente en USD registrado; tasa BCV … del …)».
   Nunca se calcula un USD que RiskGuard no tenga. Igual con un pago en VES
   sin `monto_usd`.
8. **Respuestas que el §4.2 no enumera:** cualquier otro 2xx cuenta como
   entregado, 408 y 425 se reintentan, y cualquier otro 4xx es fallido. Un 429
   detiene ese destino durante el resto de la pasada.
9. **Efecto colateral bueno:** el pago y la actualización del siniestro eran
   dos llamadas sueltas y ahora son una transacción. El cambio de estado da
   error si no actualizó ninguna fila, cuando antes podía «guardar» sin
   guardar.
10. **Aviso al admin de un fallido:** un correo por empresa y pasada al buzón
    admin configurado en RiskGuard (`email_config`), una sola vez por aviso. El
    envío se registra en `email_log` con `tipo_alerta = 'flujos_aviso_fallido'`.
11. **`ocurrido_at`** se toma al segundo. Si una misma persona cambiase dos veces
    al mismo estado dentro del mismo segundo, saldría un aviso y no dos (misma
    clave).

### 9.4 Cierre del encargo (04/10/2026)

Los tres pasos que faltaban están hechos:

1. ✅ 01/10 · Hermes corrió `20261001` y `20261001b` (cron cada minuto, jobid 15),
   puso el secreto `FLUJOS_WEBHOOK_DESTINOS` a mano en el panel, añadió la fila
   de `flujos_destinos` (`flujos_prueba` → Atlántida) y desplegó
   `enviar-avisos-flujos` por CLI.
2. ✅ 01/10 · Flujos creó el flujo de prueba (workflow
   `e76ce72b-5cb7-4447-8801-adec24ff4743`); el `hfw_…` pasó por el panel, no
   por chat.
3. ✅ 9/9 pruebas del §7, con la parte HTTP:

| # | Prueba | Fecha | Resultado |
|---|---|---|---|
| 1 | Alta | 02/10 | 1 sola fila `siniestro_creado`, 202 al primer intento, correo recibido |
| 2 | Cambio de estado | 01/10 | 202 y ejecución `success` en Flujos; correo y enlace correctos. Los 7 primeros intentos fallaron por el JSON del secreto (una comilla), no por el envío. El 02/10, cinco cambios más con `estado_anterior` bien encadenado |
| 3 | Pago que cambia el estado | 02/10 | SIN-DEMO-2022-0194, de pago_parcial a pago_final: **un solo** aviso `pago_registrado`, con bloque `pago` y último pago |
| 4 | Reenvío de la misma clave | 02/10 | 200 `duplicada: true` (`estado_original: lanzada`) y ningún segundo correo |
| 5 | UPDATE directo sin RPC | 02/10 | Marca vacía, 0 avisos (en un `DO` que se deshace) |
| 6 | 409 y 401 | 02/10 | 409 (flujo desactivado): el aviso queda pendiente y se reintenta; al reactivar el flujo, 202 al segundo intento. 401 (secreto rotado en Flujos): fallido sin reintentos y correo de alerta al admin; con el secreto nuevo y **Reencolar**, 202 |
| 7 | Nombre del padrón | 02/10 | Un siniestro sin nombre, enlazado a `ASEG-DEMO-0001`, trae «María Gabriela Pérez Rondón». Restaurado después |
| 8 | Monedas | 02/10 | USD con `tasa_bcv` vacía; VES con tasa (Bs 50.000 → USD 57,70 a 866,5612 del 02/10); VES sin tasa: `reclamado_usd: null` y el texto lo dice |
| 9 | Acto después de las 20:00 VET | 04/10 | Disparado por un pg_cron de un solo uso, porque Hermes está en Europa. Con `created_at` 2026-10-04 00:30 UTC se obtuvo `ocurrido_at` **`2026-10-03T20:30:00-04:00`**, entregado 202 y el trabajo se desprogramó solo |

**Hallazgos de las pruebas que no bloquean el cierre:**

- **Fecha del pago.** `fecha_pago` la propone el formulario con la fecha del
  **navegador**, y el aviso la copia tal cual. Desde Venezuela es la correcta.
  Desde Europa, después de las 20:00 VET, el formulario sugiere la fecha de
  mañana; se corrige a mano en el campo.
- **`pago_final` sin pagos.** El workflow de RiskGuard deja llevar un siniestro
  a `pago_final` sin ningún pago registrado. Es una regla de negocio de
  RiskGuard que está por decidir; para Flujos no cambia nada.

### 9.5 Lo único que queda — producción

La empresa real de RiskGuard (Seguros HermesAI) **no tiene destino**. Pasos:

1. Flujos crea el flujo de **producción**.
2. Pasa el `workflow_id` y el `hfw_…` por el panel, nunca por chat.
3. Hermes añade la entrada al secreto `FLUJOS_WEBHOOK_DESTINOS` y la fila
   correspondiente en `flujos_destinos` de RiskGuard.

No hace falta código ni volver a desplegar.

**Paso 1 ✅ hecho el 05/10/2026 (sesión de Flujos):**

- Flujo **«Avisos de siniestros RiskGuard»**,
  `workflow_id` **`b54a3c17-6522-4625-96d5-91f7001a271e`**: Webhook Entrante → Email,
  copia del flujo de prueba. Está `publicado` (autorizado por otra cuenta) y activo.
- Correo a los dos administradores: `hermes.hs34@gmail.com` y
  `hersan_romero@yahoo.com`. Todos los eventos van al mismo grupo, sin Decisión.
  Ninguna regla decide por importe (§6).
- URL del webhook (el secreto va aparte, en la cabecera `x-webhook-secret`):
  `https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/webhook-in/b54a3c17-6522-4625-96d5-91f7001a271e`
- Secreto `hfw_…` generado en el panel. Hermes lo copió él mismo y no pasó por chat
  ni por ningún fichero.
- Probado con `curl -d @docs/webhook-siniestros/ejemplo-pago.json` el 05/10 a las
  07:24 UTC. Resultado: ejecución `success` con `triggered_by='webhook'` y correo
  recibido en el buzón de Daniel.
- Las dos ejecuciones en `error` de las 07:14–07:15 UTC fueron pulsaciones de
  «Ejecutar» a mano. Un flujo Webhook sin datos revienta a propósito (CLAUDE.md
  de Flujos, §8.3.7).

**Pasos 2 y 3 ✅ hechos por Hermes el 05/10/2026 en RiskGuard. Hizo falta una
segunda vuelta:**

- El primer cambio de estado (08:44 UTC, siniestro 1-98-10297) **no dejó ningún
  rastro**: ni un aviso en el panel ni una recepción en Flujos. La causa era que
  la fila de Seguros HermesAI no existía en `flujos_destinos`; solo estaba la de
  Atlántida. Una empresa sin destino se descarta en silencio, y eso es lo
  esperado (§5.6). Por eso un panel vacío significa «sin destino», no «sin
  errores».
- El secreto `FLUJOS_WEBHOOK_DESTINOS` tenía tres fallos:
  - un JSON inválido, porque faltaba la clave `"url":`;
  - el trozo `-adec24ff4743` pegado al final de la URL, que es del id del flujo
    de prueba;
  - la entrada de `flujos_prueba` aparentemente perdida al sustituir el valor.

  Se reescribió entero con dos entradas: `flujos_prueba` y `flujos_produccion`.
- Fila creada: Seguros HermesAI (`5a368fc5-…`) → `flujos_produccion`. La
  `app_url` se copió de la fila de la Demo.

✅ **Primer aviso real, 05/10/2026 a las 09:08 UTC:** cambio de estado del
1-98-10297 (Dictamen → Inspección). La recepción quedó `lanzada` y la ejecución
terminó en `success` con `triggered_by='webhook'`. Se comprobó la llegada del
correo a hermes.hs34@gmail.com. **Encargo cerrado de extremo a extremo.**

Observación sobre los datos de RiskGuard, no sobre la integración: ese siniestro
llegó con «asegurado sin identificar» y montos USD 0,00. Viene de SIRWeb sin
identidad, que es el mismo hueco que cubre `v_cobertura_screening_asegurados`
(CLAUDE.md de Flujos, §8.2.6).

**Cierre del lado RiskGuard, 05/10/2026** (según su agente; no se midió desde
Flujos):

- **El USD 0,00 era un `0` falso, y ya viaja `null`** (migración RiskGuard
  `20261005`). SIRWeb carga `0` cuando no hay importe: 164 de los 256 siniestros
  SIRWeb de Seguros HermesAI lo tienen. Ahora, si el reclamado es 0 en un
  siniestro SIRWeb, `montos.reclamado` y `montos.reclamado_usd` van en `null` y
  `para_leer.reclamado` dice «sin importe informado por SIRWeb». No cambian
  `aprobado`, `pagado` ni las altas manuales. La versión del cuerpo tampoco
  cambia, porque es lo que ya decía §3.3.
- Esto hace **más urgente** el pendiente de §6: la Decisión de Flujos lee
  `null` como **0**. Hoy hay más `null` que importes reales, así que sigue sin
  poder decidirse por importe hasta corregirlo en Flujos.
- `flujos_prueba` sigue válido. Al reescribir el secreto, el JSON se rompió dos
  veces más (faltaba `"secreto":` y faltaba una comilla). Mientras estuvo roto
  no avisó ninguna empresa. Una vez corregido, los pendientes salieron solos con
  202 y llegaron los correos de la Demo y de Seguros HermesAI.
- El panel de RiskGuard ya avisa en rojo cuando una empresa no tiene destino.

Desde RiskGuard este documento ya no se toca: es de Flujos.
