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
