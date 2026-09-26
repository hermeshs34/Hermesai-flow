# Encargo para una sesión de RiskGuard — cola de revisión de asegurados

> Origen: HermesAI Flow, 25/09/2026. Decisión de Hermes: **opción B**. La
> decisión persona por persona sobre una coincidencia en listas restrictivas
> vive en **RiskGuard**, y Flujos solo la **lee**.
> Este documento se abre desde la carpeta de RiskGuard. Desde Flujos no se toca
> RiskGuard (CLAUDE.md de Flujos, §8: Flujos nunca escribe en un sistema origen).

---

## 1. El problema

El flujo "Alerta de Siniestro" de Flujos hace lo siguiente:
1. Lee los siniestros de RiskGuard.
2. Resuelve el asegurado, por la captura manual o por el padrón `oracle_asegurados`.
3. Criba cada persona con la RPC `screening_candidatos` de RiskGuard.
4. Pide una aprobación al Oficial de Cumplimiento.

Tiene tres defectos:

- **La decisión es por lote, no por persona.** Nohemy aprueba o rechaza un
  correo con 13 personas. No hay manera de decir *«esta sí, esta no, y por qué»*.
- **No hay memoria.** Una persona que ya se revisó y se descartó como falso
  positivo vuelve a salir en cada ejecución, cada día.
- **La evidencia queda en el sitio equivocado.** Flujos conserva una aprobación
  del lote. El expediente, los casos AML y el camino a la UNIF están en RiskGuard.

RiskGuard ya tiene casi todo lo necesario:
- `screening_coincidencias` (`20260625b_screening_fuzzy_fundaciones.sql`), con
  `estado` pendiente / confirmada / descartada, `revisado_por`, `revisado_at` y
  `decision_motivo`.
- Los casos AML, que llegan hasta `reportado`.

Falta una cosa: el `CHECK` de `sujeto_tipo` solo admite
`'caso', 'beneficiario', 'cliente_ddc', 'ros'`, y **no admite asegurados de
siniestros**.

## 2. Lo que hay que construir en RiskGuard

Los requisitos están aquí; el diseño concreto lo decide la sesión de RiskGuard
contra su propio código y su base.

1. **Nuevo sujeto `asegurado`** en `screening_coincidencias`, con migración
   nueva (el `CHECK` no se edita en la migración ya aplicada). Cada fila tiene
   que conservar de qué siniestro o siniestros salió: número de siniestro y,
   si existe, `asegurado_oracle_id`. Puede hacerse con una columna o con una
   tabla de enlace. Una misma persona puede tener varios siniestros; eso es
   una sola decisión, no siete.
2. **El cribado de asegurados lo hace RiskGuard**, con su propio
   `screening_candidatos` y su propio criterio. Puede dispararse al registrar
   un siniestro o con un job diario. Tiene que cubrir las dos fuentes del
   asegurado:
   - captura manual: `asegurado_nombre` / `asegurado_documento`;
   - SIRWeb: `asegurado_oracle_id` → `oracle_asegurados`, por la clave
     `empresa_id + id_oracle`.

   Flujos ya hace ese cruce en `execute-workflow/index.ts` (case
   `processor:riskguard`) y sirve de referencia.
3. **Supresión de falsos positivos.** Si la pareja *(persona, entrada de lista)*
   ya está `descartada`, no se crea otra fila `pendiente`. Se vuelve a
   alertar en dos casos:
   - cambia la entrada de lista (nuevo alias, documento o sanción);
   - vence la supresión (el plazo lo decide Hermes o Cumplimiento, ver §4).

   Una `confirmada` tampoco se duplica: pasa al caso AML.
4. **Pantalla de la cola, filtrada por asegurados.** Para cada fila:
   **Confirmar** / **Descartar**, con el motivo obligatorio al descartar.
   Desde una confirmada, **abrir un caso AML**.
5. **Criterio de iniciales.** Hoy un nombre con solo una inicial («José A.
   Rodríguez») alcanza la banda alta (87) contra «José Antonio …» o «José
   Alexis …» sin que case el documento. Una inicial no debería bastar para la
   banda alta sin documento. Es el criterio de `screening_candidatos`; su
   gemelo en Flujos (`_shared/screeningNucleo.ts`) se copia después, porque
   manda el de RiskGuard.
6. **Una entrada de lista ficticia está generando alertas.** En el correo del
   25/09, «Omar E. Bracho» (4 asegurados) casó con **87 (banda alta)** contra la
   entrada LOCAL «Omar Enrique Bracho Aguilar». Su propio motivo dice que es una
   entrada DEMO **ficticia** sembrada por la migración `20260912`, que no
   corresponde a ninguna persona real y que se puede borrar sin afectar a
   producción. Hay que decidir si se borra.

   Con este punto y el 5, **las dos únicas personas del correo** vienen de
   defectos de RiskGuard, no de coincidencias reales.

## 3. El contrato con Flujos — lo único que Flujos necesita LEER

Flujos lee con la service role de RiskGuard que ya tiene en sus secretos.
Hace falta una lectura estable: una vista, o bien las columnas acordadas de la tabla.

| Dato | Para qué lo usa Flujos |
|---|---|
| filas `sujeto_tipo='asegurado'` con `estado='pendiente'` | avisar a Cumplimiento de que hay trabajo, con el total por banda |
| `created_at` de las pendientes | **escalar** una coincidencia de banda alta pendiente más de N horas |
| filas nuevas desde la última ejecución | el correo diario: «hoy entraron X, Y de banda alta» |
| enlace al registro en la pantalla de RiskGuard | que el correo lleve a donde se decide, no a una aprobación de Flujos |

Con eso, en Flujos:
- el nodo de lote deja de cribar;
- la aprobación del lote desaparece del flujo;
- el correo pasa a ser **«tienes N personas por revisar en RiskGuard»**.

Hasta que RiskGuard lo tenga en producción, Flujos **sigue como está**.

## 4. Decisiones de Hermes (25/09/2026)

1. **Quién decide: el Oficial de Cumplimiento, igual que en Flujos.** Como
   RiskGuard es un sistema más grande, **el administrador puede cubrir
   incidencias**.

   ⚠️ Esa cobertura tiene que ser una excepción visible, no una segunda puerta.
   En Flujos, el escalamiento a `admin` dejaba saltarse la regla del Oficial
   con solo esperar 48 h (CLAUDE.md de Flujos, §6.2). Hoy la política
   `screening_coinc_write` deja decidir a `admin` exactamente igual que a
   `cumplimiento`, sin rastro de que fue una cobertura. La sesión de RiskGuard
   debe proponer a Hermes una de estas dos formas:
   - **a) Por delegación.** El admin decide solo mientras exista una
     delegación que **creó el propio Oficial**, como en Flujos §6.6.
   - **b) Por contingencia.** El admin puede decidir, pero con el motivo
     obligatorio, y la fila queda marcada como *decidida por contingencia*.
     El Oficial la ve después y la ratifica o la revoca.

   En los dos casos la decisión dice **quién la tomó y en calidad de qué**.
2. **Supresión de un descarte: 6 meses** (recomendación de Hermes). Se vuelve
   a alertar antes si cambia la entrada de lista.
3. **Plazo antes de escalar: 15 días como máximo, menos según la
   criticidad.** Propuesta para que Hermes la confirme:

   | Coincidencia | Escala a los |
   |---|---|
   | documento exacto (score 100) | 2 días |
   | banda alta por nombre | 5 días |
   | banda media | 15 días |

   ⚠️ **Escalar es avisar, no traspasar la decisión.** Si al vencer el plazo
   la coincidencia pasara a manos del admin, sería la misma puerta que se
   cerró en Flujos el 11/08. Al vencer se avisa al Oficial, a los
   administradores y a Hermes, y la decisión sigue siendo del Oficial, salvo
   la cobertura del punto 1. Este aviso es el que mandará Flujos (§3).

## 5. Estado — 26/09/2026

✅ **RiskGuard lo tiene en producción** (vista `v_cola_asegurados_pendientes`,
cribado diario 05:00 UTC y los lunes tras las listas, `screening_candidatos`
con `p_empresa_id`). **Lado de Flujos hecho en código** — ver CLAUDE.md §8.2:
nodo nuevo `processor:cola_aml`, `processor:aml` sin modo lote, filtro por
`empresa_id` en todas las lecturas de RiskGuard y `screeningNucleo.ts` copiado
literal. Falta el despliegue (migración `20260926_publicar_nodo_cola_aml.sql`,
secreto `RISKGUARD_APP_URL`, `execute-workflow`) y rehacer el flujo.

## 6. «Revisar →» lleva a un administrador a la Bandeja de entrada (26/09/2026)

**Síntoma (Hermes, admin):** el enlace `/cumplimiento?coincidencia=<id>` del
correo abre RiskGuard en `/inicio`, no en Cumplimiento.

**Causa, leída en el código de RiskGuard (no tocado desde Flujos):**

1. `AuthContext` lanza `permisosService.cargarPermisos(...)` **sin esperar**
   (`void …`) y pone `loading=false` antes de que termine.
2. `RutaGuard` decide en ese primer render. Con el cache aún `null`,
   `rutasDelRol('admin')` **no** devuelve un conjunto vacío: le añade
   `ADMIN_PROTECTED_ROUTES` (`/admin`, `/usuarios`, `/dashboard`).
3. Como el tamaño es > 0, `canAccessRoute` va por la rama dinámica en vez del
   respaldo `navigationItems`, `/cumplimiento` no está en esas tres, y
   `<Navigate to="/inicio" replace />` se lleva la URL **y el `?coincidencia`**.

Dentro de la app no se nota porque, cuando uno navega por el menú, el cache ya
cargó. Solo pasa al **entrar en frío por un enlace** — justo lo que hace el
correo. Para los roles que no son `admin` el cache `null` da conjunto vacío y cae
al respaldo, que sí deja pasar a `cumplimiento`: **Nohemy debería llegar bien**
(pendiente de comprobar).

**Arreglo sugerido:** que `RutaGuard` **no decida mientras los permisos no
hayan cargado** (exponer un estado `permisosCargados` y pintar el cargador
entretanto), en vez de decidir con un cache vacío. Denegar con datos que aún no
han llegado es la misma familia que el `'' === ''`: una comprobación que nadie
preparó no puede contestar.

## 7. El enlace lleva a una cola de OTRA empresa y no lo dice (26/09/2026)

Con el usuario de Cumplimiento el enlace ya llega a `/cumplimiento` (el §6 solo
afecta al admin). Pero la cola sale **vacía** («No hay coincidencias pendientes
de revisión»), la Lista LOCAL también, y el aviso dice que **ninguno** de los siniestros
tiene asegurado identificable. Debajo, la tabla de casos AML muestra a
«Jorge Rodríguez»: es un caso AML, no la coincidencia enlazada.

**Causa, leída en `ColaScreeningPanel.tsx`:** la cola se carga con el
`empresa_id` **de la sesión**, no con el de la coincidencia del enlace. El correo
de prueba era de «Aseguradora Atlántida C.A. (Demo)», y el usuario de Cumplimiento
pertenece a otra empresa (la Lista LOCAL vacía lo delata: la de Atlántida tiene
la entrada ficticia de Omar Bracho). Que no se vean los datos de otra empresa es
**correcto**. Lo que falla es que la pantalla **no avise**: el `?coincidencia=`
no casa con ninguna fila cargada y la pantalla lo ignora en silencio, así que
«no hay pendientes» se lee como «todo limpio».

(La primera versión de esta sección culpaba al desplazamiento automático. Era
falso: se escribió antes de ver la pantalla.)

**Propuesta:**
1. Si llega un `?coincidencia=` que no está entre las filas cargadas, avisar:
   «Esta coincidencia no pertenece a su empresa o ya fue decidida».
2. Si sí está, mostrar **solo el expediente de esa persona** con todas sus
   coincidencias y un botón «Ver toda la cola». Así no depende del
   `scrollIntoView` y cumple lo que promete el correo: un enlace por persona.

✅ **Causa confirmada por Hermes el 26/09/2026:** con un usuario de Cumplimiento
de «Aseguradora Atlántida C.A. (Demo)», «Revisar →» abre la cola y **muestra a
la persona**. El enlace funciona; lo que falta en RiskGuard es solo el aviso del
punto 1 para cuando la coincidencia es de otra empresa.
