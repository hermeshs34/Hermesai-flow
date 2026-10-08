#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// verificar.mjs — lo que este proyecto copia a mano, comparado contra sí mismo
// y contra la base. Lo usa la skill desplegar-flujos (SKILL.md).
//
//   node .claude/skills/desplegar-flujos/verificar.mjs            # todo
//   node .claude/skills/desplegar-flujos/verificar.mjs --sin-red  # solo ficheros
//
// Cada comprobación termina en OK, FALLO o NO COMPROBADO. Solo hay veredicto
// VERDE si TODAS dan OK: un fichero que no aparece, una lista que no se pudo
// leer o una base a la que no se llegó NO cuentan como «sin diferencias»
// (CLAUDE.md §9.5: lo que no se puede comprobar no puede acabar diciendo que sí).
//
// La base manda sobre las migraciones (§5.1): las listas del lado SQL se leen
// de pg_get_functiondef / pg_policy en producción, no de database/migrations/.
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ    = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SIN_RED = process.argv.includes('--sin-red');
const res     = [];   // { grupo, nombre, estado, detalle }

const anota = (grupo, nombre, estado, detalle = '') => res.push({ grupo, nombre, estado, detalle });
const ruta  = (p) => resolve(RAIZ, p);
const leer  = (p) => { const f = ruta(p); return existsSync(f) ? readFileSync(f, 'utf8').replace(/\r\n/g, '\n') : null; };
const conj  = (xs) => [...new Set(xs)].sort();
const igual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const fmt   = (xs) => xs.length ? xs.join(', ') : '(vacía)';

function compararConjuntos(grupo, nombre, a, etqA, b, etqB) {
    if (a == null || b == null) {
        return anota(grupo, nombre, 'FALLO', `no se pudo leer ${a == null ? etqA : etqB}`);
    }
    const A = conj(a), B = conj(b);
    if (igual(A, B)) return anota(grupo, nombre, 'OK', fmt(A));
    const soloA = A.filter(x => !B.includes(x)), soloB = B.filter(x => !A.includes(x));
    // Con nombres sueltos basta la diferencia; las listas enteras solo si es un duplicado.
    const partes = [];
    if (soloA.length) partes.push(`solo en ${etqA}: ${fmt(soloA)}`);
    if (soloB.length) partes.push(`solo en ${etqB}: ${fmt(soloB)}`);
    anota(grupo, nombre, 'FALLO', partes.length ? partes.join(' | ') : `${etqA}: ${fmt(a)} | ${etqB}: ${fmt(b)}`);
}

const citas = (s) => s == null ? null : [...s.matchAll(/'([^']*)'/g)].map(m => m[1]);

// ── 1. Ficheros gemelos ─────────────────────────────────────────────────────
function gemeloDesdeLinea(nombre, a, b, desde) {
    const ta = leer(a), tb = leer(b);
    if (ta == null || tb == null) return anota('gemelos', nombre, 'FALLO', `no existe ${ta == null ? a : b}`);
    const la = ta.split('\n').slice(desde - 1), lb = tb.split('\n').slice(desde - 1);
    const n  = Math.max(la.length, lb.length);
    for (let i = 0; i < n; i++) {
        if (la[i] !== lb[i]) {
            return anota('gemelos', nombre, 'FALLO',
                `difieren desde la línea ${i + desde}: «${(la[i] ?? '<fin>').trim().slice(0, 70)}» vs «${(lb[i] ?? '<fin>').trim().slice(0, 70)}»`);
        }
    }
    anota('gemelos', nombre, 'OK', desde > 1 ? `idénticos desde la línea ${desde}` : 'idénticos');
}

// fecha.ts: las cabeceras difieren a propósito y el de src/ tiene horaVE de más.
// Se compara el CÓDIGO de lo que exportan los dos (constantes y cuerpos).
function exportados(texto) {
    const out = new Map();
    const sinComentarios = texto.split('\n').filter(l => !/^\s*(\/\/|\/\*\*.*\*\/\s*$)/.test(l)).join('\n');
    for (const m of sinComentarios.matchAll(/export const (\w+)\s*=\s*([^;\n]+)/g)) out.set(m[1], m[2].trim());
    for (const m of sinComentarios.matchAll(/export function (\w+)/g)) {
        let i = sinComentarios.indexOf('{', m.index), prof = 0, j = i;
        for (; j < sinComentarios.length; j++) {
            if (sinComentarios[j] === '{') prof++;
            else if (sinComentarios[j] === '}' && --prof === 0) break;
        }
        out.set(m[1], sinComentarios.slice(m.index, j + 1).replace(/\s+/g, ' '));
    }
    return out;
}
function gemeloFecha() {
    const a = leer('src/utils/fecha.ts'), b = leer('supabase/functions/_shared/fecha.ts');
    if (a == null || b == null) return anota('gemelos', 'fecha.ts', 'FALLO', 'falta uno de los dos ficheros');
    const ea = exportados(a), eb = exportados(b);
    const comunes = [...eb.keys()].filter(k => ea.has(k));
    const soloDeno = [...eb.keys()].filter(k => !ea.has(k));
    const distintos = comunes.filter(k => ea.get(k) !== eb.get(k));
    if (!comunes.length) return anota('gemelos', 'fecha.ts', 'FALLO', 'no se encontró ningún export común');
    if (distintos.length || soloDeno.length) {
        return anota('gemelos', 'fecha.ts', 'FALLO',
            (distintos.length ? `código distinto en: ${distintos.join(', ')}` : '') +
            (soloDeno.length ? ` export solo en Deno: ${soloDeno.join(', ')}` : ''));
    }
    anota('gemelos', 'fecha.ts', 'OK', `mismo código en ${comunes.join(', ')}`);
}

gemeloDesdeLinea('matriz (src/utils ↔ _shared)', 'src/utils/matrizAprobacion.ts', 'supabase/functions/_shared/matriz.ts', 16);
gemeloDesdeLinea('modelosFinancieros', 'src/utils/modelosFinancieros.ts', 'supabase/functions/_shared/modelosFinancieros.ts', 16);
gemeloDesdeLinea('screeningNucleo ↔ RiskGuard', 'supabase/functions/_shared/screeningNucleo.ts',
    '../../../RiskGuard_Insurance/supabase/functions/_shared/screeningNucleo.ts', 1);
gemeloFecha();

// ── 2. Listas copiadas en el código ─────────────────────────────────────────
const userTypes = leer('src/core/user.types.ts');
const motor     = leer('supabase/functions/execute-workflow/index.ts');
const resolver  = leer('supabase/functions/resolve-approval/index.ts');
const panel     = leer('src/components/NodeConfigPanel.tsx');

function rolesConPermiso(permiso) {
    if (userTypes == null) return null;
    const bloque = userTypes.match(/ROLE_PERMISSIONS[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (!bloque) return null;
    const out = [];
    for (const m of bloque[1].matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
        if (citas(m[2]).includes(permiso)) out.push(m[1]);
    }
    return out.length ? out : null;
}
const setDe   = (txt, nombre) => { const m = txt?.match(new RegExp(`const ${nombre}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]`)); return m ? citas(m[1]) : null; };
const arrayDe = (txt, nombre) => { const m = txt?.match(new RegExp(`const ${nombre}[^=]*=\\s*\\[([^\\]]*)\\]`)); return m ? citas(m[1]) : null; };

const PERM = {
    manage:    rolesConPermiso('manage_workflows'),
    execute:   rolesConPermiso('execute_workflows'),
    approve:   rolesConPermiso('approve_tasks'),
    authorize: rolesConPermiso('authorize_workflows'),
    audit:     rolesConPermiso('view_audit'),
};

compararConjuntos('listas', 'execute_workflows ↔ ROLES_QUE_EJECUTAN', PERM.execute, 'user.types', setDe(motor, 'ROLES_QUE_EJECUTAN'), 'execute-workflow');
compararConjuntos('listas', 'manage_workflows ↔ ROLES_QUE_DISENAN', PERM.manage, 'user.types', setDe(motor, 'ROLES_QUE_DISENAN'), 'execute-workflow');
compararConjuntos('listas', 'approve_tasks ↔ ROLES_APROBADORES', PERM.approve, 'user.types', setDe(motor, 'ROLES_APROBADORES'), 'execute-workflow');
{
    const m = panel?.match(/const ROLES = \[([\s\S]*?)\];/);
    const valores = m ? [...m[1].matchAll(/value:\s*'([^']*)'/g)].map(x => x[1]).filter(Boolean) : null;
    compararConjuntos('listas', 'ROLES_APROBADORES ↔ desplegable del Constructor', setDe(motor, 'ROLES_APROBADORES'), 'execute-workflow', valores, 'NodeConfigPanel');
}
compararConjuntos('listas', 'ROLES_REGULATORIOS (pantalla ↔ resolve-approval)', arrayDe(userTypes, 'ROLES_REGULATORIOS'), 'user.types', arrayDe(resolver, 'ROLES_REGULATORIOS'), 'resolve-approval');

const CASOS = motor ? conj([...motor.matchAll(/case '((?:trigger|processor|output):[a-z_]+)'/g)].map(m => m[1])) : null;
{
    const cors = motor?.match(/'Access-Control-Allow-Headers':\s*'([^']*)'/)?.[1];
    if (cors == null) anota('listas', 'CORS de execute-workflow admite x-cron-secret', 'FALLO', 'no se encontró Allow-Headers');
    else anota('listas', 'CORS de execute-workflow admite x-cron-secret', cors.includes('x-cron-secret') ? 'OK' : 'FALLO', cors);
}

// ── 3. Listas del lado SQL — leídas de la BASE ──────────────────────────────
function supabaseJson(args) {
    const salida = execSync(`npx supabase ${args}`, { cwd: RAIZ, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const i = salida.search(/[\[{]/);
    if (i < 0) throw new Error('la CLI no devolvió JSON');
    return JSON.parse(salida.slice(i));
}

const SQL = `select jsonb_build_object(
  'transicionar', pg_get_functiondef('public.transicionar_flujo(uuid,text,text)'::regprocedure),
  'secreto',      pg_get_functiondef('public.generar_secreto_webhook(uuid)'::regprocedure),
  'url_webhook',  pg_get_functiondef('public.configurar_webhook_url(uuid,boolean)'::regprocedure),
  'politicas',    (select jsonb_object_agg(polname, coalesce(pg_get_expr(polqual,polrelid),'') || ' ' || coalesce(pg_get_expr(polwithcheck,polrelid),''))
                     from pg_policy where polname in ('nodes_editor_write','connections_editor_write','workflows_editor_update','workflows_editor_write','audit_read_org'))
) as d`;

// Expresión de política → roles de su ARRAY[...]; null si no hay o si hay dos distintos.
function rolesDePolitica(expr) {
    if (!expr) return null;
    const arrays = [...expr.matchAll(/ARRAY\[([^\]]*)\]/g)].map(m => conj(citas(m[1])).join(','));
    const unicos = [...new Set(arrays)];
    return unicos.length === 1 ? unicos[0].split(',') : null;
}
// Cuerpo de función → cada lista de «v_rol NOT IN (...)».
const listasNotIn = (def) => [...(def ?? '').matchAll(/v_rol\s+NOT\s+IN\s*\(([^)]*)\)/gi)].map(m => conj(citas(m[1])));

if (SIN_RED) {
    anota('base', 'listas SQL contra la base', 'NO COMPROBADO', 'ejecutado con --sin-red');
    anota('funciones', 'verify_jwt desplegado', 'NO COMPROBADO', 'ejecutado con --sin-red');
} else {
    let d = null;
    try { d = supabaseJson(`db query --linked -o json "${SQL.replace(/\s+/g, ' ')}"`).rows?.[0]?.d; }
    catch (e) { anota('base', 'lectura de la base', 'FALLO', `supabase db query: ${String(e.message).split('\n')[0]} (¿sesión de la CLI caducada? supabase orgs list)`); }

    if (d) {
        const enviar = listasNotIn(d.transicionar);
        compararConjuntos('base', 'transicionar_flujo: quién envía a revisión ↔ manage_workflows', enviar[0] ?? null, 'base', PERM.manage, 'user.types');
        compararConjuntos('base', 'transicionar_flujo: quién autoriza ↔ authorize_workflows', enviar[1] ?? null, 'base', PERM.authorize, 'user.types');
        if (enviar.length !== 2) anota('base', 'transicionar_flujo: nº de listas de rol', 'FALLO', `se esperaban 2 «v_rol NOT IN», hay ${enviar.length}: revisar el parser o la función`);
        compararConjuntos('base', 'generar_secreto_webhook ↔ manage_workflows', listasNotIn(d.secreto)[0] ?? null, 'base', PERM.manage, 'user.types');
        compararConjuntos('base', 'configurar_webhook_url ↔ manage_workflows', listasNotIn(d.url_webhook)[0] ?? null, 'base', PERM.manage, 'user.types');

        const nodosBase = d.transicionar ? [...d.transicionar.matchAll(/'((?:trigger|processor|output):[a-z_]+)'/g)].map(m => m[1]) : null;
        compararConjuntos('base', 'nodos publicables (transicionar_flujo) ↔ case del motor', nodosBase, 'base', CASOS, 'execute-workflow');

        const pol = d.politicas ?? {};
        for (const p of ['nodes_editor_write', 'connections_editor_write', 'workflows_editor_update', 'workflows_editor_write']) {
            compararConjuntos('base', `RLS ${p} ↔ manage_workflows`, rolesDePolitica(pol[p]), 'base', PERM.manage, 'user.types');
        }
        compararConjuntos('base', 'RLS audit_read_org ↔ view_audit', rolesDePolitica(pol.audit_read_org), 'base', PERM.audit, 'user.types');
    }

    // ── 4. Edge Functions desplegadas ───────────────────────────────────────
    // verify_jwt=false significa que la autorización es el código (§6.1). Si el
    // código no autentica, la función está abierta a internet.
    const DEBE_SER_FALSE = ['execute-workflow', 'cron-runner', 'resolve-approval', 'request-password-reset', 'vigilante-reloj', 'webhook-in', 'design-assistant'];
    const PUBLICAS       = ['request-password-reset'];   // públicas por diseño (§6.4)
    let lista = null;
    try { lista = supabaseJson('functions list -o json'); }
    catch (e) { anota('funciones', 'lectura de las funciones desplegadas', 'FALLO', String(e.message).split('\n')[0]); }

    if (lista) {
        const desplegadas = new Map(lista.map(f => [f.slug, f]));
        for (const slug of DEBE_SER_FALSE) {
            const f = desplegadas.get(slug);
            if (!f) anota('funciones', `${slug}: desplegada`, 'FALLO', 'no aparece en functions list');
            else anota('funciones', `${slug}: verify_jwt=false`, f.verify_jwt === false ? 'OK' : 'FALLO',
                f.verify_jwt === false ? `v${f.version}` : `v${f.version} con verify_jwt=true: la puerta rechaza antes que el código. Redesplegar con --no-verify-jwt`);
        }
        for (const f of lista) {
            if (f.verify_jwt !== false || PUBLICAS.includes(f.slug)) continue;
            const codigo = leer(`supabase/functions/${f.slug}/index.ts`);
            const autentica = codigo != null && /auth\.getUser|CRON_SECRET|x-webhook-secret/.test(codigo);
            if (!DEBE_SER_FALSE.includes(f.slug) || !autentica) {
                anota('funciones', `${f.slug}: verify_jwt=false y el código autentica`, autentica ? 'OK' : 'FALLO',
                    autentica ? '' : 'el código no comprueba sesión ni secreto: cualquiera en internet puede llamarla');
            }
        }
        const enRepo = readdirSync(ruta('supabase/functions'), { withFileTypes: true })
            .filter(e => e.isDirectory() && e.name !== '_shared' && existsSync(join(ruta('supabase/functions'), e.name, 'index.ts')))
            .map(e => e.name);
        const sinDesplegar = enRepo.filter(s => !desplegadas.has(s));
        anota('funciones', 'toda función del repo está desplegada', sinDesplegar.length ? 'FALLO' : 'OK',
            sinDesplegar.length ? `sin desplegar: ${sinDesplegar.join(', ')}` : `${enRepo.length} funciones`);
    }
}

// ── Informe ─────────────────────────────────────────────────────────────────
const MARCA = { OK: '  ok  ', FALLO: 'FALLO ', 'NO COMPROBADO': ' ???  ' };
let grupo = '';
for (const r of res) {
    if (r.grupo !== grupo) { grupo = r.grupo; console.log(`\n[${grupo}]`); }
    console.log(`  ${MARCA[r.estado]} ${r.nombre}${r.detalle ? `\n          ${r.detalle}` : ''}`);
}
console.log('\n[a mano] delegaciones.ts (src ↔ _shared): manejo de errores distinto A PROPÓSITO (§6.6) — no se compara con diff; revisar que las reglas sigan iguales si se tocó.');

const fallos = res.filter(r => r.estado === 'FALLO').length;
const sinMirar = res.filter(r => r.estado === 'NO COMPROBADO').length;
const veredicto = fallos ? `ROJO — ${fallos} fallo(s)` : sinMirar ? `INCOMPLETO — ${sinMirar} sin comprobar (no es verde)` : 'VERDE';
console.log(`\nVeredicto: ${veredicto}  (${res.length} comprobaciones)`);
process.exit(fallos || sinMirar ? 1 : 0);
