# SECTOR_ALIMENTOS.md — Adecuación de flujos para Elaboración y Consumo de Alimentos

> Documento de diseño. Encargo de Hermes del 15/08/2026: revisar los flujos
> asociados a «Manufactura & Textil» y adecuarlos a empresas de elaboración y
> consumo de alimentos, con foco en **inventarios, materia prima, merma y
> estados financieros** (estos últimos generados en **Profit**).
>
> Estado: **diseño aprobado en lo conceptual, sin implementar.** Nada de lo que
> hay aquí está en producción.

---

## 1. Lo que se encontró antes de diseñar nada

### 1.1 No hay «flujos de Manufactura & Textil» — hay una paleta decorativa

El grupo son 6 nodos en `src/components/NodePalette.tsx` (líneas 80-91) y una
plantilla en el Dashboard (`t6`, «Orden de Compra Automática»). El motor decide
qué ejecutar por `type:category` (`execute-workflow/index.ts:305`), y de los
seis **solo uno tiene `case`**:

| Nodo | `category` | ¿Ejecuta? |
|---|---|---|
| Alerta de Stock | `inventario` | ❌ |
| Orden de Compra | `compras` | ❌ |
| **Solicitar Aprobación** | `aprobacion` | ✅ **el único** |
| Actualizar ERP/WMS | `erp` | ❌ |
| Notificar Producción | `notificacion` | ❌ |
| Control de Calidad | `calidad` | ❌ |

Y lo que hace el motor con un nodo que no conoce **no es fallar**
(`execute-workflow/index.ts:1280`):

```ts
default:
    return { skipped: true, reason: `Tipo "${nodeKey}" — implementación pendiente` };
```

`skipped` deja el nodo en `idle`, escribe un log de nivel `warning` y **el run
termina en SUCCESS**. O sea que la plantilla `t6`, si alguien la usa hoy, se
pausa en la aprobación, alguien la aprueba, y **termina en verde sin haber
generado ninguna OC ni notificado a nadie**.

Tampoco hay formulario de configuración: `FORM_MAP` (`NodeConfigPanel.tsx:1101`)
no tiene entrada para esas categorías y caen en `GenericForm`.

⚠️ Es la misma forma que este proyecto lleva un mes cazando —el `succeeded` de
pg_cron (§6.1), el `✓ Guardado` sin escritura (§12.2), el `RETURN NEW` que
cancelaba borrados (§6.7)—: **un instrumento que dice «hecho» sin haber hecho
nada.** Con la diferencia de que esto no se rompió: nunca se escribió.

En el mismo estado están `delay` («Espera», grupo Universal), `actuarial`,
`reaseguro`, `fraude`, `operacion` y `umbral`. **La paleta no es el motor.**

**Consecuencia para el encargo:** no hay nada que adecuar. Hay que diseñar. Lo
cual es mejor noticia, porque no arrastramos decisiones de textil que en
alimentos serían erróneas.

### 1.2 Los nodos que SÍ ejecutan hoy

Esto es el material disponible, y es más de lo que parece:

`trigger:manual` · `trigger:cron` · `trigger:webhook` · `processor:decision` ·
`processor:aprobacion` · `processor:agente` (Claude) · `processor:semaforo` ·
`processor:bcv` · `processor:eeff` · `processor:riskguard` ·
`processor:aml` · `processor:indicadores` · `processor:regulatorio` ·
`processor|output:reporte` · `output:email` · `output:whatsapp` · `output:log`

---

## 2. Por qué el modelo textil no sirve para alimentos

Cuatro diferencias que **rompen** el diseño, no lo matizan.

1. **El inventario caduca.** «Stock < mínimo» es la pregunta equivocada: se
   puede estar sobre el mínimo y tenerlo todo por vencer. La unidad de control
   no es el SKU, es el **lote con fecha de vencimiento**, y la regla de salida
   es **FEFO** (primero el que expira), no FIFO.
2. **La materia prima exige trazabilidad bidireccional.** De lote de MP →
   producto terminado → cliente, y al revés. No es buena práctica: es lo que
   permite un **retiro de producto** acotado en vez de parar la planta entera.
   Textil no tiene este proceso.
3. **La merma no es desecho, es el indicador del proceso** — y hay que separarla
   por causa, porque cada una la corrige una persona distinta:

   | Tipo | Ejemplo | Naturaleza | Responsable |
   |---|---|---|---|
   | **Técnica / de proceso** | evaporación, recortes, purga de línea, arranque-parada | esperada, se presupuesta en la fórmula | Producción |
   | **Por vencimiento / deterioro** | mala rotación, cadena de frío | **evitable al 100%** | Almacén / Ventas |
   | **Por calidad** | fuera de especificación, rechazo | de proceso | Calidad |
   | **Desconocida** | físico vs teórico | control interno | Administración |

   Una alerta que dice «hubo merma» no sirve. La que sirve es **rendimiento real
   vs estándar de la receta**.
4. **El costo lo manda la materia prima, y en Venezuela lo mueve el tipo de
   cambio.** El costo histórico no es el de reposición. Aquí `processor:bcv` ya
   ejecuta y es el único conector financiero probado del sistema.

---

## 3. Arquitectura de datos — dos patas, y solo una está resuelta

### 3.1 La pata financiera YA está conectada (corrección de Hermes, 15/08/2026)

El diseño inicial proponía un agente local contra el SQL Server de Profit. **No
hace falta.** El Sistema de Estados Financieros ya importa los balances de
Profit con un perfil de importación dedicado («Profit Plus - Balance de
Comprobación - PROFIT»), y HermesAI Flow ya lee ese sistema:

```
Profit ──(perfil de importación, manual)──► Sistema Estados Financieros
                                                      │
                                            processor:eeff (ya existe)
                                                      ▼
                                              HermesAI Flow
```

`processor:eeff` lee `financial_entries` (`account_code`, `account_name`,
`balance_amount`) — que es exactamente la forma de un balance de comprobación.
La cadena está completa.

### 3.2 ⚠️ Pero el conector tiene el modelo de SEGUROS cableado a fuego

`execute-workflow/index.ts:922-1005` clasifica así:

```ts
if (code.match(/^2[\.\-]/i))       activos += v;      // 2 = Activos (SUDEASEG)
else if (code.match(/^4[\.\-]/i))  { pasivos / patrimonio }
if (mainGroup === '5') { if (val < 0) ingresos += ... }
```

Ese es el plan de cuentas **SUDEASEG**. Una empresa de alimentos en Profit usa
el plan comercial/industrial:

| Grupo | Seguros (hoy en el conector) | Alimentos (lo que hace falta) |
|---|---|---|
| 1 | — | **Activo** |
| 2 | **Activos** | **Pasivo** |
| 3 | Gastos | **Patrimonio** |
| 4 | **Pasivos / Patrimonio** | **Ingresos** |
| 5 | **Ingresos** | **Costos** |
| 6 | — | **Gastos** |
| 7-8 | — | Financieros |

Apuntar el nodo a una empresa de alimentos **hoy** devolvería el pasivo como
activo y los costos como ingresos, con formato de miles y porcentaje de margen
incluidos. Cuarta aparición del patrón: **contesta con seguridad sin haber
medido lo que dice medir.**

### 3.3 ✅ Y el arreglo ya está escrito — solo no se portó

El Sistema de Estados Financieros tiene `src/lib/industryModels.ts` con:

- `InsuranceModel` — el que sí está portado al conector.
- **`ManufacturingModel`** — 1 Activo / 2 Pasivo / 3 Patrimonio / 4 Ingresos /
  5 Costos / 6 Gastos / 7-8 Financieros. Y ya aísla `bs.inventory` por
  descripción, incluidas las palabras **«materia prima»**, «producto»,
  «proceso», «mercancia».
- `FinancialModelFactory.getModel(industry)` — selecciona por
  `companies.industry` (`'manufact' | 'industrial' | 'industri'` →
  `ManufacturingModel`), con detección heurística de respaldo.
- KPIs ya calculados por ese modelo: **`rotacion_inv`** (densidad de inventario)
  y **`margen_industrial`** (margen bruto industrial).

El conector de Flujos **ni siquiera lee la columna**: hace
`.select('id, name, currency')`.

**Trabajo real:** portar el modelo a un gemelo de Deno
(`supabase/functions/_shared/modelosFinancieros.ts`) y añadir `industry` al
`select`. Es el mismo patrón de gemelos que `fecha.ts` (§9.3), `matriz.ts`
(§6.5) y `delegaciones.ts` (§6.6) — **manda el de Deno**, y se verifican con
`diff`.

⚠️ Y con el mismo criterio de fallo cerrado del resto del proyecto: **si la
empresa no tiene `industry` reconocible, el nodo revienta con un mensaje claro
en vez de aplicar un modelo por defecto.** Un modelo por defecto aquí es
exactamente lo que produce el balance invertido de §3.2.

### 3.4 La pata operativa NO tiene fuente todavía

Un balance de comprobación tiene **una línea** para inventario. No hay lote, ni
fecha de vencimiento, ni cantidades, ni causa de merma, ni orden de producción.

Comprobado: el «Sistema de Inventario» del ecosistema es un inventario
**doméstico** (`homeinventory-pro`), no industrial. No sirve como fuente.

| Pata | Fuente | Estado |
|---|---|---|
| **Financiera** — ⑤, rotación y margen agregados | EE.FF. ← Profit | ✅ conectada, falta el modelo industrial |
| **Operativa** — lote, vencimiento, rendimiento, merma | Profit, módulo Inventario | ❌ sin puente |

Para la pata operativa siguen valiendo las tres opciones evaluadas:

| | Cómo | Veredicto |
|---|---|---|
| **A. Exportación + carga** | Profit exporta existencias por lote; se sube por API | ✅ **Puente inmediato**, funciona esta semana |
| **B. Agente local** | Servicio Windows: `SELECT` de solo lectura sobre Profit → POST al **Webhook Entrante** de Flujos | ✅ **El destino correcto** |
| **C. VPN / túnel al SQL Server** | — | ❌ Expone la contabilidad, y la Edge Function no sostiene una conexión SQL Server igualmente |

**B, con A como puente.** Y la regla del §14 aplica igual que a los otros cuatro
sistemas: **Flujos lee de Profit, nunca escribe.**

---

## 4. Nodos — retirar, rediseñar, construir

### 4.1 Mapa

| Hoy | Acción | Por qué |
|---|---|---|
| Alerta de Stock `inventario` | **Rediseñar** | La cantidad sola no dice nada en perecederos |
| Orden de Compra `compras` | **Rediseñar** → *Solicitud* de compra | Flujos no escribe en Profit |
| Solicitar Aprobación `aprobacion` | ✅ **Intacto** | Único que ejecuta, y con matriz (§6.5) y delegaciones (§6.6) detrás |
| Actualizar ERP/WMS `erp` | ❌ **Retirar** | Escribiría en el sistema origen |
| Notificar Producción `notificacion` | ❌ **Retirar** | `email` y `whatsapp` ya ejecutan y hacen eso |
| Control de Calidad `calidad` | **Construir** → *Liberación de Lote* | Es un proceso real en alimentos, no un chequeo genérico |

### 4.2 Especificación de los nodos nuevos

Notación: `config_json` = lo que guarda el formulario; `devuelve` = lo que entra
en el contexto del flujo y queda disponible como `{{previous.campo}}`.

---

#### `trigger:inventario` — **Alerta de Inventario**

```
config_json:
  modo            'reorden' | 'vencimiento' | 'inmovilizado'   (obligatorio)
  almacen         string   — vacío = todos
  familia         string   — vacío = todas  (ej. "lácteos", "empaque")
  dias_ventana    number   — solo modo 'vencimiento' (por defecto 30)
  umbral_valor    number   — dispara solo si el valor en riesgo lo supera
  moneda          'VES' | 'USD'
```

- `reorden` — existencia ≤ punto de reorden. **El punto de reorden se calcula,
  no se teclea**: `consumo_promedio_diario × lead_time_proveedor × factor_seguridad`.
  Un mínimo fijo es el error clásico del diseño textil.
- `vencimiento` — lotes que expiran dentro de `dias_ventana`, agrupados en
  ≤7 / ≤15 / ≤30 días.
- `inmovilizado` — sin movimiento en N días y con valor en libros.

```
devuelve:
  modo, total_articulos, valor_en_riesgo, moneda,
  criticos_7d, criticos_15d, criticos_30d,
  detalle[]  → { sku, descripcion, lote, vence, dias_restantes,
                 existencia, unidad, valor, almacen }
  resumen    → texto plano para el cuerpo de un correo
```

⚠️ **Sin fecha de vencimiento y lote capturados en Profit, el modo
`vencimiento` es imposible.** No difícil: imposible. Verificar antes de
prometerlo (§6).

---

#### `processor:rendimiento` — **Rendimiento de Producción**

El nodo central del encargo. Compara lo que salió contra lo que debió salir.

```
config_json:
  orden_produccion   string  — admite {{previous.orden}}
  formula_id         string  — receta / BOM de referencia
  tolerancia_pct     number  — desviación aceptable (por defecto 3)
  incluir_merma      boolean — desglosar por causa
```

```
devuelve:
  orden, producto, formula,
  mp_consumida, mp_estandar, unidad,
  produccion_real, produccion_teorica,
  rendimiento_pct, rendimiento_estandar_pct,
  desviacion_pct, dentro_tolerancia (boolean),
  merma_total, merma_pct,
  merma_tecnica, merma_vencimiento, merma_calidad, merma_desconocida,
  costo_desviacion            — desviación × costo unitario de reposición
  resumen
```

`dentro_tolerancia` está pensado para encadenar directo a un
`processor:decision` sin escribir una condición a mano — precisamente porque un
`decision` mal configurado va siempre por la rama `true` (§9.4).

---

#### `processor:calidad` — **Liberación de Lote**

```
config_json:
  lote               string — admite {{previous.lote}}
  parametros[]       → { nombre, valor_min, valor_max, unidad, critico }
  accion_si_falla    'retener' | 'reprocesar' | 'rechazar'   (por defecto 'retener')
  requiere_aprobacion boolean
```

```
devuelve:
  lote, producto, evaluados, conformes, no_conformes,
  liberado (boolean), criticos_fallidos[], detalle[], resumen
```

⚠️ **Fail-closed, sin excepción.** Sin parámetros configurados, o si falta el
dato de un parámetro `critico`, **el nodo revienta**; no libera. Es la doctrina
que ya rige la matriz de aprobación (§6.5): *sin regla que case, el nodo
revienta*. Un valor por defecto permisivo aquí libera producto fuera de
especificación.

---

#### `processor:compras` — **Solicitud de Compra de MP**

Genera la **solicitud**, no la orden. La OC la registra una persona en Profit.

```
config_json:
  proveedor_preferente  string
  incluir_alternativos  boolean
  moneda                'VES' | 'USD'
  usar_tasa_bcv         boolean  — compone con processor:bcv
```

```
devuelve:
  solicitud_id, articulos[], cantidad_total, monto_estimado, moneda,
  tasa_aplicada, proveedor_sugerido, lead_time_dias, resumen
```

Encadena a `processor:aprobacion`. El monto estimado alimenta el `umbral_monto`
de la matriz de aprobación (§6.5), que es justo para lo que se construyó.

---

#### `processor:trazabilidad` — **Trazabilidad de Lote**

```
config_json:
  lote        string
  direccion   'adelante' | 'atras' | 'ambas'
```

```
devuelve:
  lote, direccion,
  materias_primas[]      → lotes de MP que entraron (dirección 'atras')
  productos_terminados[] → lotes de PT producidos (dirección 'adelante')
  clientes[], cantidad_afectada, resumen
```

---

### 4.3 ⚠️ Lista de sitios que hay que tocar por cada nodo nuevo

Este proyecto se rompe por listas copiadas que no se mueven juntas. Un nodo
nuevo toca **cinco** sitios:

1. `supabase/functions/execute-workflow/index.ts` — el `case` del `switch`.
2. `src/components/NodePalette.tsx` — el catálogo.
3. `src/components/NodeConfigPanel.tsx` — `FORM_MAP` **y** `ICON_MAP`.
4. `transicionar_flujo()` — si el nodo puede quedar «sin configurar», añadir su
   validación de publicación (§6.7), como ya se hace con `processor:decision`.
5. La huella de §9.5 no hay que tocarla: cubre `config_json` entero.

Y **si un nodo puede fallar de forma que su resultado sea inutilizable, tiene
que lanzar, no devolver `skipped`.** El `default` actual es lo que produjo §1.1.

---

## 5. Los seis procesos, por orden de retorno

**① Vencimiento y rotación (FEFO)** — diario.
`cron` → `inventario` (modo `vencimiento`) → `semaforo` → `decision` → si el
valor en riesgo supera umbral: `aprobacion` para descargo o promoción →
`email` a producción y ventas.
El que más dinero devuelve y el más fácil de justificar: la merma por
vencimiento es evitable al 100%. **Montable con nodos que ya ejecutan** si los
datos entran por `trigger:webhook`.

**② Desviación de rendimiento por orden** — al cierre de cada orden.
`webhook` → `rendimiento` → `decision` (`dentro_tolerancia`) → si no:
`agente` (Claude analiza causa probable) → `aprobacion` (jefe de planta) →
`email`.
Aquí aparecen la merma oculta, el error de fórmula y el descuadre de control
interno. **Es el corazón del encargo.**

**③ Reposición de materia prima crítica** — el sucesor honesto de «Orden de
Compra Automática».
`inventario` (modo `reorden`) → `bcv` → `compras` → `aprobacion` (por matriz,
según monto) → `email` al proveedor y a compras.

**④ Liberación de lote** — al cierre de producción.
`webhook` → `calidad` → `decision` → liberado: `log`; retenido: `aprobacion`
(Calidad) + `whatsapp` al jefe de planta.

**⑤ Cierre financiero mensual con Profit** — mensual.
`cron` → `eeff` (**con modelo industrial**) → `semaforo` (margen, rotación) →
`agente` (redacta el análisis) → `aprobacion` (contador) → `reporte` → `email`.
**Todos los nodos ya ejecutan.** Lo único que falta es §3.3.

**⑥ Retiro de producto (recall)** — manual, ojalá nunca.
`manual` → `trazabilidad` (ambas direcciones) → `agente` (redacta la
comunicación) → `aprobacion` (Gerencia + Calidad) → `email` + `whatsapp`.

---

## 6. Prerrequisitos de negocio — antes de escribir código

**No se automatiza lo que no se mide.** Estos tres puntos no son técnicos y
bloquean los procesos ①②④:

1. **Catálogo de causas de merma** formalizado, con las cuatro categorías de la
   tabla de §2 (punto 3). Sin él, ② no tiene contra qué clasificar.
2. **Estándar de rendimiento por fórmula** (receta/BOM con merma técnica
   presupuestada). Sin él, ② no tiene contra qué comparar y el nodo
   `rendimiento` no puede existir.
3. **Lote y fecha de vencimiento capturados en Profit** en las entradas de MP y
   en producción. Sin ellos, ① y ⑥ son imposibles.

Y dos advertencias técnicas:

⚠️ **`processor:decision` sin configurar va siempre por la rama `true`** (§9.4,
`'' === ''`). En ④ eso significa **liberar todo lote**. Es el peor sitio del
sistema para ese defecto. Lo cubre la validación de publicación de §6.7, pero
solo si el flujo pasa por el ciclo de vida — que ahora es obligatorio.

⚠️ **HermesAI Flow es un orquestador, no un ERP ni un WMS.** No debe convertirse
en el maestro de inventario. Lo que aporta es vigilancia, control, aprobación,
escalamiento, informe y trazabilidad de decisiones — que es exactamente lo que
se construyó entre el 11 y el 14/08/2026.

---

## 7. Plan por fases

| Fase | Alcance | Depende de | Esfuerzo |
|---|---|---|---|
| **A** | **Modelo industrial en `processor:eeff`** — gemelo `_shared/modelosFinancieros.ts` + `industry` en el `select` + selector en el formulario + fallo cerrado si no hay modelo | nada | Bajo |
| **B** | **Proceso ⑤ completo** con nodos existentes | A | Bajo |
| **C** | **Proceso ① por webhook**, con exportación manual de Profit (opción A de §3.4) | nada | Bajo |
| **D** | **Nodos `inventario` y `rendimiento`** + agente local (opción B de §3.4) | los 3 prerrequisitos de §6 | Alto |
| **E** | Procesos ② y ③ | D | Medio |
| **F** | Nodos `calidad` y `trazabilidad`, procesos ④ y ⑥ | D | Medio |
| **G** | Retirar de la paleta lo que no ejecuta (`erp`, `notificacion`, `compras` viejo, `delay`) y actualizar la plantilla `t6` | — | Bajo |

**Recomendación de arranque: A + B.** Es la única parte con todo lo necesario
ya en su sitio, cierra un fallo real de corrección (§3.2), y prueba de extremo a
extremo la cadena completa —incluidos matriz de aprobación, delegaciones y ciclo
de vida, recién puestos en producción— **antes** de invertir en el puente a
Profit y en los cinco nodos nuevos.

⚠️ **G no es cosmético.** Mientras esos nodos sigan en la paleta, cualquiera
puede montar un flujo que termina en verde sin hacer nada. Si no se retiran,
deben al menos **lanzar** en vez de devolver `skipped`.

---

*HermesAI Engineering — 15/08/2026*
