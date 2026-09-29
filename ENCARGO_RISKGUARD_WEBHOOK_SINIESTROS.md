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

*(Lo rellena la sesión de RiskGuard: qué construyó, dónde, qué columnas
comprobó contra la base y qué difiere de este documento.)*
