// ═══════════════════════════════════════════════════════════════════════════
// Modelos financieros por industria — qué grupo de cuentas es qué
//
// ⚠️ GEMELO COPIADO de supabase/functions/_shared/modelosFinancieros.ts. Si
// cambias uno, cambia el otro. Duplicado por lo mismo que `fecha.ts`,
// `matrizAprobacion.ts` y `delegaciones.ts` (CLAUDE.md §6.5, §6.6, §9.3): una
// Edge Function corre en Deno y no alcanza este árbol.
//
// MANDA EL DE DENO — es el que clasifica los saldos que salen del nodo. Este
// solo alimenta el formulario del Constructor y la vista previa; el peor caso
// de que este se equivoque es una etiqueta mal puesta en pantalla, nunca una
// cifra mal calculada en un correo.
//
// Se verifican con `diff` a partir de la línea 16: todo salvo esta cabecera.
// ═══════════════════════════════════════════════════════════════════════════

export type IdModelo = 'seguros' | 'industrial';

export interface SaldosBalance {
    activos:    number;
    pasivos:    number;
    patrimonio: number;
    /** Detalle que solo produce el modelo industrial. En seguros queda en 0. */
    efectivo:           number;
    cuentas_por_cobrar: number;
    inventario:         number;
    activo_fijo:        number;
    cuentas_por_pagar:  number;
}

export interface SaldosResultado {
    ingresos:           number;
    costo_ventas:       number;
    gastos_operativos:  number;
    gastos_financieros: number;
}

export interface KpiGerencial {
    id:         string;
    etiqueta:   string;
    valor:      number;
    unidad:     'porcentaje' | 'ratio';
    estado:     'bien' | 'atencion' | 'critico';
    comentario: string;
}

export interface ModeloFinanciero {
    id:     IdModelo;
    nombre: string;
    /**
     * Etiqueta de la línea de inventario. En seguros no hay inventario; en
     * alimentos hay tres cosas distintas dentro de la misma cifra y el lector
     * necesita saberlo.
     */
    etiquetaInventario: string;
    /**
     * Cuando el balance no trae activos, ¿se rellenan con pasivo+patrimonio?
     *
     * En seguros SÍ: el sistema de EE.FF. importa el activo (SUDEASEG) y el
     * pasivo (Profit) de dos fuentes distintas, y si falta la primera el total
     * se deduce de la segunda. En industrial NO: ahí las tres cifras vienen del
     * mismo balance de comprobación, así que un activo en cero es un dato que
     * falta, y taparlo con la suma del pasivo fabrica un número que nadie midió.
     */
    rellenarActivosDesdePasivos: boolean;
    clasificarBalance(codigo: string, nombre: string, saldo: number, s: SaldosBalance): void;
    clasificarResultado(codigo: string, nombre: string, valor: number, s: SaldosResultado): void;
    kpis(b: SaldosBalance, r: SaldosResultado): KpiGerencial[];
}

export function saldosBalanceVacios(): SaldosBalance {
    return {
        activos: 0, pasivos: 0, patrimonio: 0,
        efectivo: 0, cuentas_por_cobrar: 0, inventario: 0,
        activo_fijo: 0, cuentas_por_pagar: 0,
    };
}

export function saldosResultadoVacios(): SaldosResultado {
    return { ingresos: 0, costo_ventas: 0, gastos_operativos: 0, gastos_financieros: 0 };
}

/**
 * Quita acentos además de bajar a minúsculas. Ver la nota del modelo industrial.
 *
 * Va con una tabla de vocales y no con `normalize('NFD')` + el rango de marcas
 * combinantes, que es la forma corta: ese rango son caracteres INVISIBLES, y
 * este fichero se compara con su gemelo mediante `diff` y se copia a mano entre
 * dos árboles. Un carácter que no se ve es justo lo que sobrevive mal a ese
 * viaje, y el fallo resultante —una comparación que deja de casar— no daría
 * error, daría una cuenta clasificada en el sitio equivocado.
 *
 * La `ñ` se deja como está a propósito: ninguna palabra clave la lleva, y
 * convertirla haría de «año» un «ano».
 */
const VOCALES_ACENTUADAS: Record<string, string> = {
    'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u',
};
const sinAcentos = (s: string) =>
    (s ?? '').toLowerCase().replace(/[áéíóúü]/g, c => VOCALES_ACENTUADAS[c] ?? c);

// ═══════════════════════════════════════════════════════════════════════════
// SEGUROS (SUDEASEG) — grupos 2 Activos · 3 Gastos · 4 Pasivo/Patrimonio · 5 Ingresos
//
// ⚠️ Esta clase reproduce, línea por línea, lo que el motor venía haciendo en
// `execute-workflow` desde el 10/06/2026, cuando se contrastó contra SQL y
// cuadró al céntimo. **No se le ha tocado ni un carácter al portarla**, y en
// particular NO usa `sinAcentos`: compara con `.toLowerCase()` a secas, igual
// que antes.
//
// Eso tiene una consecuencia conocida y deliberada: los nombres acentuados
// —«Superávit», «Pérdida del Ejercicio»— NO casan, así que esas cuentas caen en
// `pasivos` en vez de `patrimonio`. Es un fallo real, pero arreglarlo aquí
// movería en silencio una cifra que hoy alguien da por buena. Se anota para que
// se decida aparte, no se cuela dentro de otro cambio.
// ═══════════════════════════════════════════════════════════════════════════
export class ModeloSeguros implements ModeloFinanciero {
    id: IdModelo = 'seguros';
    nombre = 'Seguros y Reaseguros (SUDEASEG)';
    etiquetaInventario = 'No aplica';
    rellenarActivosDesdePasivos = true;

    clasificarBalance(codigo: string, nombre: string, saldo: number, s: SaldosBalance) {
        const v     = Math.abs(saldo);
        const clean = codigo.replace(/[^a-zA-Z0-9]/g, '');
        const name  = (nombre ?? '').toLowerCase();

        if (codigo.match(/^2[\.\-]/i) || codigo.match(/^2\d/)) {
            // 2.xxx → ACTIVOS. El neteo de contra-activos ya ocurrió al
            // consolidar con signo, así que aquí se suma el valor absoluto.
            s.activos += v;
        } else if (codigo.match(/^4[\.\-]/i) || codigo.match(/^4\d/)) {
            const esPatrimonio =
                clean.startsWith('409')  || clean.startsWith('410')  || clean.startsWith('411')  ||
                clean.startsWith('4409') || clean.startsWith('4410') || clean.startsWith('4411') ||
                name.includes('capital social') || name.includes('patrimonio') ||
                name.includes('reserva legal') || name.includes('superavit') ||
                name.includes('utilidad del ejercicio') || name.includes('utilidades no distribuidas') ||
                name.includes('resultado del ejercicio') || name.includes('perdida del ejercicio');
            if (esPatrimonio) s.patrimonio += v; else s.pasivos += v;
        }
        // Los grupos 3 y 5 son resultado y los clasifica el otro pipeline.
    }

    clasificarResultado(codigo: string, nombre: string, valor: number, s: SaldosResultado) {
        const grupo  = codigo.charAt(0);
        const digits = codigo.replace(/[^0-9]/g, '');
        const name   = (nombre ?? '').toLowerCase();

        if (grupo === '5') {
            // Los ingresos vienen en negativo (naturaleza acreedora). Un saldo
            // positivo en el grupo 5 es una reversión y cuenta como costo.
            if (valor < 0) s.ingresos += Math.abs(valor);
            else           s.costo_ventas += valor;
        } else if (grupo === '3') {
            const esTecnico =
                digits.startsWith('30')  || digits.startsWith('311') ||
                digits.startsWith('312') || digits.startsWith('32')  ||
                digits.startsWith('33')  || digits.startsWith('34')  ||
                (digits.startsWith('317') && (name.includes('tecnico') || name.includes('técnico')));
            if (esTecnico) s.costo_ventas += Math.abs(valor);
            else           s.gastos_operativos += Math.abs(valor);
        }
    }

    kpis(_b: SaldosBalance, r: SaldosResultado): KpiGerencial[] {
        // Solo la siniestralidad. El «Margen de Solvencia» y el «Índice de
        // Reserva Bruta» del sistema de EE.FF. necesitan el PASIVO CORRIENTE
        // desglosado, y este nodo solo tiene el pasivo total: publicarlos con
        // esa aproximación sería un indicador que no mide lo que dice medir.
        const siniestralidad = r.ingresos > 0 ? (r.costo_ventas / r.ingresos) * 100 : 0;
        return [{
            id:       'siniestralidad',
            etiqueta: 'Siniestralidad Técnica',
            valor:    siniestralidad,
            unidad:   'porcentaje',
            estado:   siniestralidad < 65 ? 'bien' : siniestralidad < 80 ? 'atencion' : 'critico',
            comentario: siniestralidad < 65
                ? 'Eficiencia técnica óptima.'
                : siniestralidad < 80
                    ? 'Siniestralidad en rango de vigilancia.'
                    : 'CRÍTICO: la siniestralidad erosiona el capital.',
        }];
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// INDUSTRIAL / COMERCIAL — el plan que usa una empresa de alimentos en Profit
//   1 Activo · 2 Pasivo · 3 Patrimonio · 4 Ingresos · 5 Egresos
//
// Contrastado el 15/08/2026 contra el balance real de HierroFuerte, C.A., la
// única empresa `industry='industrial'` que hay cargada. Ojo con una idea que
// parece razonable y es falsa: **el grupo 5 no es «Costos» a secas**, es todo
// el lado del gasto, subdividido —5.1 costo de ventas, 5.3 y 5.4 gastos
// operativos, 5.7 y 5.8 financieros, 5.9 impuestos—. En ese plan no existen
// los grupos 6, 7 ni 8; se dejan mapeados porque otros perfiles de Profit sí
// los usan, pero no se han visto aquí.
//
// Es INCOMPATIBLE con el de seguros, no una variante: ahí el grupo 2 es el
// activo y aquí es el pasivo. Aplicar el modelo equivocado no da un número
// aproximado, da el pasivo donde va el activo.
//
// A diferencia del de seguros, este SÍ normaliza acentos. Puede hacerlo porque
// nace hoy y no hay ninguna cifra previa que mover: «Vehículos», «Retención» y
// «Pérdida del Ejercicio» casan como es debido desde el primer día.
// ═══════════════════════════════════════════════════════════════════════════
export class ModeloIndustrial implements ModeloFinanciero {
    id: IdModelo = 'industrial';
    nombre = 'Industrial / Comercial (plan de cuentas Profit)';
    etiquetaInventario = 'Inventarios (materia prima, en proceso y terminado)';
    rellenarActivosDesdePasivos = false;

    clasificarBalance(codigo: string, nombre: string, saldo: number, s: SaldosBalance) {
        const desc = sinAcentos(nombre);
        // Se conservan los puntos: los prefijos se comprueban en las dos formas
        // ('1.1' y '11') porque Profit exporta con y sin separador.
        const code = (codigo ?? '').replace(/[^0-9.]/g, '');

        // ⚠️ NO se usa `Math.abs`. `financial_entries` guarda el balance de
        // comprobación de Profit CON LOS SIGNOS NATURALES: el debe positivo y
        // el haber negativo. Tomar el valor absoluto haría que una
        // «Depreciación acumulada» —saldo acreedor dentro del activo— sumara
        // al activo en vez de restarlo, y que un pasivo con saldo deudor lo
        // inflara. En su lugar, el activo se suma tal cual y el pasivo y el
        // patrimonio se niegan, que es lo que los deja en positivo.
        // Comprobado el 15/08/2026 contra el balance real de HierroFuerte.
        const v = code.startsWith('1') ? saldo : -saldo;

        // ── 1. ACTIVO ────────────────────────────────────────────────────────
        if (code.startsWith('1')) {
            s.activos += v;

            const esCorriente = code.startsWith('1.1') || code.startsWith('11') ||
                desc.includes('corriente') || desc.includes('circulante') ||
                desc.includes('disponible');

            if (esCorriente) {
                if (code.startsWith('1.1.01') || code.startsWith('1.1.02') ||
                    desc.includes('caja') || desc.includes('banco') || desc.includes('efectivo') ||
                    desc.includes('disponible') || desc.includes('bolivares') || desc.includes('divisas')) {
                    s.efectivo += v;
                }
                // El inventario se mira ANTES que las cuentas por cobrar: una
                // cuenta llamada «Anticipo a proveedores de materia prima»
                // contiene las dos palabras, y en una empresa de alimentos lo
                // que importa es que no se pierda del inventario.
                else if (desc.includes('inventario') || desc.includes('mercancia') ||
                    desc.includes('materia prima') || desc.includes('producto') ||
                    desc.includes('proceso') || desc.includes('suministro') ||
                    desc.includes('insumo') || desc.includes('empaque') ||
                    desc.includes('envase') || desc.includes('materiales')) {
                    s.inventario += v;
                }
                else if (desc.includes('cliente') || desc.includes('cobrar') || desc.includes('anticipo') ||
                    desc.includes('efecto') || desc.includes('iva') || desc.includes('retencion')) {
                    s.cuentas_por_cobrar += v;
                }
                // En Profit, 1.1.04 sin más señas suele ser Clientes.
                else if (code.startsWith('1.1.04') || code.startsWith('1104')) {
                    s.cuentas_por_cobrar += v;
                }
            } else if (desc.includes('propiedad') || desc.includes('planta') || desc.includes('equipo') ||
                desc.includes('maquina') || desc.includes('vehiculo') || desc.includes('inmueble') ||
                desc.includes('mueble') || desc.includes('fijo') || desc.includes('depreciable')) {
                s.activo_fijo += v;
            }
        }
        // ── 2. PASIVO ────────────────────────────────────────────────────────
        else if (code.startsWith('2')) {
            s.pasivos += v;
            if (desc.includes('pagar') || desc.includes('proveedor') ||
                desc.includes('acreedor') || desc.includes('comercial')) {
                s.cuentas_por_pagar += v;
            }
        }
        // ── 3. PATRIMONIO ────────────────────────────────────────────────────
        else if (code.startsWith('3')) {
            // Aquí no hace falta un caso aparte para utilidades y pérdidas: con
            // el signo natural ya negado, una pérdida del ejercicio llega con
            // saldo deudor y RESTA del patrimonio ella sola.
            s.patrimonio += v;
        }
    }

    // ⚠️ Aquí TAMPOCO se usa `Math.abs`, y es lo que más cambia el resultado.
    // Con los signos naturales de Profit, un ingreso llega en negativo y un
    // gasto en positivo, así que las tres cuentas de resta del estado de
    // resultados —la contrapartida de ventas, el inventario final y los
    // ingresos financieros— se distinguen por el signo y por nada más.
    // Medido el 15/08/2026 sobre HierroFuerte: con `abs` los ingresos salían
    // 4.239.929,35 en vez de 3.770.354,65 y el costo de ventas 8.858.466,96 en
    // vez de 2.520.488,30, o sea un margen de −109 % en una empresa con +33 %.
    clasificarResultado(codigo: string, nombre: string, valor: number, s: SaldosResultado) {
        const code  = (codigo ?? '').replace(/[^0-9.]/g, '');
        const desc  = sinAcentos(nombre);
        const grupo = code.charAt(0);

        if (grupo === '4') {
            // Las ventas van al haber (negativas) y los descuentos y
            // devoluciones sobre ventas al debe: negar deja las primeras en
            // positivo y hace que las segundas resten, que es su función.
            s.ingresos += -valor;
        } else if (grupo === '5') {
            // En el plan real de Profit el grupo 5 no es solo el costo: lleva
            // dentro el costo (5.1), los gastos operativos (5.3, 5.4), los
            // financieros (5.7, 5.8) y los impuestos (5.9). Se reparte por
            // prefijo y por nombre; el signo se conserva en los tres destinos.
            if (code.startsWith('5.1') || code.startsWith('51') ||
                desc.includes('costo') || desc.includes('compra') ||
                desc.includes('inventario')) {
                // El inventario final entra aquí en negativo y resta del costo.
                s.costo_ventas += valor;
            } else if (code.startsWith('5.7') || code.startsWith('5.8') ||
                code.startsWith('57') || code.startsWith('58')) {
                s.gastos_financieros += valor;
            } else if (desc.includes('financiero') || desc.includes('cambiario')) {
                // Red de seguridad por nombre para los planes que no separan el
                // bloque financiero en 5.7/5.8. El diferencial cambiario es la
                // mayor partida financiera de una empresa venezolana y no lleva
                // la palabra «financiero», de ahí las dos.
                //
                // ⚠️ NO se busca «interes» ni «bancario»: «Intereses Prest.
                // sociales» (5.3.01.15) es gasto de personal y «Gastos
                // Bancarios» (5.3.03.16) cuelga de Gastos Generales. El plan de
                // cuentas ya dijo dónde va cada cosa; adivinarlo por el nombre
                // es contradecir al contador que lo montó.
                s.gastos_financieros += valor;
            } else {
                s.gastos_operativos += valor;
            }
        } else if (grupo === '6') {
            s.gastos_operativos += valor;
        } else if (grupo === '7' || grupo === '8') {
            s.gastos_financieros += valor;
        }
    }

    kpis(b: SaldosBalance, r: SaldosResultado): KpiGerencial[] {
        const densidad = b.activos > 0 ? (b.inventario / b.activos) * 100 : 0;
        const bruto    = r.ingresos - r.costo_ventas;
        const margen   = r.ingresos > 0 ? (bruto / r.ingresos) * 100 : 0;

        return [
            {
                id:       'densidad_inventario',
                etiqueta: 'Densidad de Inventario',
                valor:    densidad,
                unidad:   'porcentaje',
                estado:   densidad < 40 ? 'bien' : densidad < 70 ? 'atencion' : 'critico',
                comentario: densidad < 40
                    ? 'Nivel de stock balanceado.'
                    : densidad < 70
                        ? 'Alta concentración de capital en inventario.'
                        : 'CRÍTICO: exceso de inventario, riesgo de liquidez y de merma por vencimiento.',
            },
            {
                id:       'margen_bruto',
                etiqueta: 'Margen Industrial Bruto',
                valor:    margen,
                unidad:   'porcentaje',
                estado:   margen > 25 ? 'bien' : margen > 15 ? 'atencion' : 'critico',
                comentario: margen > 25
                    ? 'Margen industrial saludable.'
                    : 'Margen bajo: revisar costo de materia prima y rendimiento de producción.',
            },
        ];
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Selección del modelo
//
// ⚠️ Devuelve `null` cuando no reconoce la industria, y quien llama tiene que
// REVENTAR con ese `null`, no elegir uno por defecto.
//
// El sistema de Estados Financieros sí cae al modelo industrial cuando no sabe,
// y allí es defendible porque hay una persona mirando la pantalla que ve el
// resultado al instante. Aquí no la hay: el nodo corre de madrugada por cron y
// manda el número por correo. Un modelo por defecto convierte «no sé qué
// empresa es esta» en un balance con el pasivo puesto donde va el activo, con
// formato de miles y porcentaje de margen incluidos.
//
// Misma familia que `token !== ''` (§6.1), `'' === ''` (§9.4), la huella `NULL`
// (§9.5) y la matriz sin regla que case (§6.5): lo que no se puede comprobar no
// puede acabar diciendo que sí.
// ═══════════════════════════════════════════════════════════════════════════

const SEGUROS_PALABRAS    = ['seguro', 'sudeaseg', 'reaseguro', 'aseguradora'];
const INDUSTRIAL_PALABRAS = [
    'manufact', 'industri', 'comerc', 'aliment', 'consumo', 'fabrica', 'fábrica',
    'produccion', 'producción', 'textil', 'agro', 'planta', 'distribu', 'retail',
];

/** Modelo por su identificador exacto (lo que guarda `config_json.tipo_empresa`). */
export function modeloPorId(id: string | null | undefined): ModeloFinanciero | null {
    if (id === 'seguros')    return new ModeloSeguros();
    if (id === 'industrial') return new ModeloIndustrial();
    return null;
}

/**
 * Lo que ofrece el desplegable del Constructor, con los mismos ids que entiende
 * `modeloPorId`. Vive aquí y no en el formulario para que no puedan discrepar:
 * un desplegable que guarda un valor que el motor no reconoce crea un nodo que
 * nace muerto, que es exactamente lo que pasó con `approver: "Administrador"`
 * (CLAUDE.md §6.3).
 *
 * La primera opción va VACÍA a propósito, como la de la matriz de aprobación
 * (§6.5): en blanco no significa «sin configurar», significa «lo decide la
 * industria de la empresa en Estados Financieros».
 */
export const OPCIONES_MODELO: { value: '' | IdModelo; label: string }[] = [
    { value: '',           label: '— Según la industria de la empresa en EE.FF. —' },
    { value: 'industrial', label: 'Industrial / comercial (plan de cuentas Profit)' },
    { value: 'seguros',    label: 'Seguros / reaseguros (plan SUDEASEG)' },
];

/** Modelo deducido de `companies.industry` del sistema de Estados Financieros. */
export function modeloPorIndustria(industria: string | null | undefined): ModeloFinanciero | null {
    const t = sinAcentos(industria ?? '').trim();
    if (!t) return null;
    if (SEGUROS_PALABRAS.some(p => t.includes(p)))    return new ModeloSeguros();
    if (INDUSTRIAL_PALABRAS.some(p => t.includes(p))) return new ModeloIndustrial();
    return null;
}

/**
 * Resuelve el modelo con la misma precedencia que la matriz de aprobación
 * (§6.5): manda lo que diga el nodo; si va en blanco, decide el dato; y si no
 * hay dato que case, se devuelve el motivo para que el nodo reviente con él.
 */
export function resolverModelo(
    tipoEmpresaNodo: string | null | undefined,
    industriaEmpresa: string | null | undefined,
    nombreEmpresa: string,
): { ok: true; modelo: ModeloFinanciero; origen: 'nodo' | 'empresa' } | { ok: false; motivo: string } {
    const delNodo = modeloPorId((tipoEmpresaNodo ?? '').trim());
    if (delNodo) return { ok: true, modelo: delNodo, origen: 'nodo' };

    const deLaEmpresa = modeloPorIndustria(industriaEmpresa);
    if (deLaEmpresa) return { ok: true, modelo: deLaEmpresa, origen: 'empresa' };

    const dice = (industriaEmpresa ?? '').trim();
    return {
        ok: false,
        motivo:
            `No se sabe con qué plan de cuentas leer a "${nombreEmpresa}". ` +
            (dice
                ? `Su industria en Estados Financieros dice "${dice}", que no corresponde ni al plan de seguros (SUDEASEG) ni al industrial/comercial de Profit. `
                : 'No tiene industria definida en el sistema de Estados Financieros. ') +
            'Elige el tipo de empresa en la configuración de este nodo: los dos planes son incompatibles ' +
            '(en seguros el grupo 2 es el activo y en el industrial es el pasivo), así que adivinar daría ' +
            'un balance invertido sin avisar.',
    };
}
