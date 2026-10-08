# Encargo para una sesión de RiskGuard — avisar a Flujos de cada asegurado nuevo (webhook)

> Origen: HermesAI Flow, 06/10/2026. Decisión de Hermes: **cuando una persona da
> de alta un asegurado en RiskGuard, RiskGuard avisa a Flujos en ese momento**, y
> Flujos lo cruza con las listas restrictivas y manda la alerta al instante, sin
> esperar a la criba del día siguiente.
> Este documento se abre desde la carpeta de RiskGuard. Desde Flujos no se toca
> RiskGuard. Aquí van los **requisitos y el contrato**; el diseño concreto lo
> decide la sesión de RiskGuard contra su código y su base.
>
> **Es el segundo encargo de este tipo.** El primero
> (`ENCARGO_RISKGUARD_WEBHOOK_SINIESTROS.md`, cerrado el 04/10/2026) ya construyó
> en RiskGuard todo el mecanismo de envío: outbox, marca `app.flujos_acto`,
> enviador `enviar-avisos-flujos`, secreto `FLUJOS_WEBHOOK_DESTINOS`, panel de
> avisos con «Reencolar». **Este encargo lo reutiliza.** Solo añade un evento
> nuevo y un destino nuevo. Todas las reglas de entrega del primero (§4 —
> Idempotency-Key, qué hacer con 202/200/409/429/4xx, ventana de reintentos)
> valen aquí igual y no se repiten.

---

## 1. El objetivo, y lo que NO cambia

Hoy un asegurado nuevo se criba a las 05:00 UTC del día siguiente. Con este
encargo se criba **en el momento del alta**: Flujos recibe el nombre y el
documento, los pasa por el mismo núcleo de screening que RiskGuard
(`screeningNucleo.ts`, copia literal) y, si hay coincidencia, manda un correo de
alerta.

**Lo que NO cambia:**
- La criba diaria de RiskGuard sigue igual. **La decisión sigue siendo de
  RiskGuard**: la persona entra en la cola de Cumplimiento con la criba
  siguiente y el Oficial confirma o descarta allí. El aviso de Flujos es una
  alerta temprana, no una decisión ni una segunda cola.
- Flujos **no** contesta a RiskGuard con el resultado. RiskGuard termina su
  responsabilidad en el 202, igual que con los siniestros.

---

## 2. Qué hechos avisan (y cuáles no)

| `evento` | Cuándo sale |
|---|---|
| `asegurado_creado` | Una persona da de alta un asegurado **a mano** en RiskGuard |
| `asegurado_identidad_cambiada` | Una persona cambia el **nombre o el documento** de un asegurado |

**No avisan:**
- Las cargas y sincronizaciones de SIRWeb, los rellenos, las migraciones y
  cualquier proceso automático. Esos los cubre la criba diaria. Una carga masiva
  por webhook además chocaría con el límite de Flujos (60 llamadas por minuto).
- Cambios de otros campos del asegurado (dirección, teléfono, póliza…).
- Bajas y borrados.

Misma regla que en siniestros: **lo que decide si se avisa es que lo hizo una
persona desde la aplicación**, y se distingue con la marca `app.flujos_acto` que
ya existe, puesta solo por las RPC del acto.

⚠️ **Solo la empresa «Seguros HermesAI».** El flujo de Flujos criba contra la
lista LOCAL de esa empresa (lo fija el nodo). Un asegurado de otra empresa —Demo
incluida— **no** se envía a este destino: se cribaría contra la lista local
equivocada y podría salir limpio sin estarlo.

---

## 3. El contrato

### 3.1 La llamada

```
POST https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/webhook-in/b6af0a8a-03dc-48ee-a6e1-9e76abc5686d
Content-Type: application/json
x-webhook-secret: hfw_…
Idempotency-Key: rg:asegurado:<asegurado_id>:<evento>:<id de la fila del outbox>
```

- El flujo destino es **«Score AML Automático»**. Es un destino **distinto** del
  de siniestros: va como una entrada nueva en `FLUJOS_WEBHOOK_DESTINOS`.
- ⚠️ **Hoy `flujos_destinos` da un destino por empresa**, y «Seguros HermesAI»
  pasa a tener **dos**: siniestros → su flujo, asegurados → este. El destino
  tiene que elegirse por **empresa y tipo de aviso**; si no, los asegurados
  acabarían en el flujo de siniestros (o al revés). La sesión de RiskGuard
  decide cómo, y le dice a Hermes **qué nombre (`destino_ref`) poner** en el
  secreto antes de que lo toque.
- El secreto `hfw_…` lo genera Hermes en Flujos y lo pega él directamente en el
  secreto de RiskGuard. **No pasa por ningún documento ni por ninguna sesión.**

### 3.2 El cuerpo

```json
{
  "version": 1,
  "evento": "asegurado_creado",
  "ocurrido_at": "2026-10-06T10:15:00-04:00",
  "empresa": "Seguros HermesAI",
  "asegurado_id": "5f1c2a90-0000-4000-8000-000000000123",
  "nombre": "María Pérez González",
  "documento": "V-12345678",
  "nombre_anterior": null,
  "documento_anterior": null,
  "enlace": "https://<RiskGuard>/asegurados?asegurado=<id>"
}
```

### 3.3 Campo por campo

| Campo | Regla |
|---|---|
| `nombre` | **Obligatorio y no vacío**, tal como está en RiskGuard (sin normalizar: Flujos normaliza igual que RiskGuard). Va **en la raíz**, no dentro de un objeto: el flujo lo lee como `{{webhook.nombre}}`. |
| `documento` | En la raíz (`{{webhook.documento}}`). Si no se conoce, `null`, **nunca** `""` ni `"0"`. Un documento inventado daría una coincidencia exacta falsa (score 100) o ninguna. |
| `nombre_anterior`, `documento_anterior` | Solo en `asegurado_identidad_cambiada`; en el alta, `null`. |
| `empresa` | Siempre `"Seguros HermesAI"` (§2). |
| `ocurrido_at` | ISO 8601 con desfase de Venezuela (`-04:00`). |
| `enlace` | Abre el asegurado en RiskGuard. Si no hay pantalla de asegurado, `null`. |

⚠️ **Sin `nombre` no se envía.** Si el alta llega sin nombre, el aviso queda
`fallido` en el panel con ese motivo. Si llegara a Flujos sin nombre ni
documento, el nodo se detiene con un error que remite a la criba por lotes, que
no es lo que pasó, y confundiría a quien lo lea.

### 3.4 Idempotencia

Un alta = una llamada. Un reintento manda **el mismo cuerpo, byte a byte**, con
la misma `Idempotency-Key`. Si Flujos contesta `200 {duplicada, estado_original:
"fallo_al_lanzar"}`, se reenvía con la clave más `#2`, `#3`… exactamente como en
siniestros.

---

## 4. Lo que hay que construir en RiskGuard

1. Las RPC del alta y de la edición de asegurado ponen `app.flujos_acto`, igual
   que `siniestro_crear`. Si hoy la pantalla escribe directo en la tabla, pasa a
   llamar a la RPC.
2. El trigger del asegurado encola **solo** con la marca, **solo** para
   «Seguros HermesAI» y, en una edición, **solo** si cambió `nombre` o
   `documento`.
3. El outbox, el enviador, los reintentos y el panel son los del primer
   encargo. Si el panel filtra por tipo de evento, que muestre también estos.
4. Pruebas, como mínimo:
   - un alta a mano ⇒ una fila en el outbox, con el cuerpo de §3.2;
   - una carga de SIRWeb que crea asegurados ⇒ **cero** filas;
   - un cambio de teléfono ⇒ cero filas; un cambio de documento ⇒ una;
   - un asegurado de la empresa Demo ⇒ cero filas;
   - un alta sin nombre ⇒ fila `fallido` con el motivo a la vista.

---

## 5. Lo que hace Flujos (ya está hecho)

El flujo «Score AML Automático» ya está configurado: disparador Webhook →
«Verificar OFAC/ONU» con `{{webhook.nombre}}` y `{{webhook.documento}}` y la
empresa «Seguros HermesAI» → Decisión `{{previous.en_lista}} == true` → correo
«⚠️ Alerta Listas Restrictivas» si hay coincidencia, y solo un registro si no la
hay. Hermes lo autoriza, lo activa y genera el secreto.

**Prueba de punta a punta:** dar de alta en RiskGuard un asegurado de prueba
cuyo nombre esté en una lista (el mismo que dio coincidencia en la prueba
manual de Flujos del 06/10/2026). El aviso debe salir `entregado` en el panel de RiskGuard y el
correo de alerta debe llegar en menos de un minuto.

---

## 6. Estado y respuestas de la sesión de RiskGuard

*(Para que la sesión de RiskGuard anote aquí qué construyó, dónde y qué
difiere de este documento.)*

**06/10/2026 — sesión de RiskGuard. ENCARGO CERRADO: en producción, pruebas 9/9.**

Las del §4: alta a mano ⇒ 1 fila con el cuerpo del §3.2; insert sin marca (SIRWeb) ⇒ 0;
edición de otros campos ⇒ 0; empresa Demo ⇒ 0 avisos de asegurado; documento sin nombre ⇒
`fallido` con el motivo a la vista. «Cambio de documento ⇒ una» no aplica: no hay edición de
identidad (opción A). Además, un documento «V-0000» viaja `null`.

**Prueba de punta a punta (06/10, 09:14 VE):** alta a mano en Seguros HermesAI del
siniestro SIN-202610-457612 con el asegurado «Jorge Rodriguez». Dos avisos `entregado`
con 202 al primer intento, cada uno a su destino. La alerta de «Score AML Automático»
llegó a las 09:15:11 (OFAC, 87, banda alta).
Ese siniestro era de prueba y **se borró de RiskGuard el mismo 06/10** (migración
`20261006b_borrar_siniestro_prueba_jorge.sql`, con respaldo): el `asegurado_id` de esa
ejecución ya no existe allí. No afecta a nada de Flujos.

**Secreto, distinto de lo previsto:** el destino nuevo **no** va dentro del JSON
`FLUJOS_WEBHOOK_DESTINOS` (se rompía al editarlo). Son dos secretos sueltos:
`URL_FLUJOS_ASEGURADOS_PRODUCCION` y `HFW_FLUJOS_ASEGURADOS_PRODUCCION`. Cualquier destino
futuro, igual: `URL_<DESTINO_REF>` y `HFW_<DESTINO_REF>` en mayúsculas.

**Qué es «el alta de un asegurado» (decisión de Hermes: opción A).** RiskGuard
no tiene alta ni edición de asegurados. La única captura a mano de una identidad
es el asegurado (`asegurado_nombre`, `asegurado_documento`) que se escribe al dar
de alta un siniestro, por la RPC `siniestro_crear`, que ya pone la marca. Por eso:

- `asegurado_creado` sale **del mismo acto** que `siniestro_creado`: un alta a
  mano deja dos avisos, cada uno hacia su destino.
- **`asegurado_identidad_cambiada` no se emite.** Ninguna pantalla edita la
  identidad después del alta. La base admite el evento para el día en que exista
  esa edición, que irá por una RPC con marca.
- **`asegurado_id` es el id del siniestro.** La persona no tiene id propio en
  RiskGuard hasta que la criba diaria (05:00 UTC) la crea en
  `asegurados_screening`.
- **`enlace` = `null`**, porque no hay pantalla de asegurado (§3.3).
- **Documento:** si está vacío o no tiene ningún dígito distinto de cero, viaja
  `null`. Con documento y **sin nombre**, el aviso queda `fallido`, sin cuerpo y
  con el motivo a la vista. Sin nombre ni documento, el siniestro no da de alta a
  nadie y no se avisa.

**Destino por empresa y tipo.** `flujos_destinos` pasa a tener la clave
`(empresa_id, tipo)`, con `tipo` = `siniestros` | `asegurados`.
- Nombre en el secreto: **`destino_ref` = `flujos_asegurados_produccion`**.
- Que avise «solo Seguros HermesAI» lo decide que solo esa empresa tenga la fila
  `asegurados`. Atlántida (Demo) no la tiene y no envía nada.

**Dónde está:**
- `database/migrations/20261006_avisos_flujos_asegurados.sql`;
- función `internal.flujos_encolar_aviso_asegurado`;
- trigger `trg_flujos_aviso_siniestro`;
- el panel de **Administración → Avisos a Flujos** muestra un destino por tipo.

El envío, los reintentos, la clave `#n` y el correo a los admins son los del
primer encargo.
