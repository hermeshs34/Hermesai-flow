# Webhook de entrada por flujo — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un sistema externo arranque un flujo con un `POST` a `webhook-in/<workflow_id>` autenticado con un secreto por flujo, y que los nodos usen lo recibido como `{{webhook.campo}}`.

**Architecture:** Una Edge Function pública (`webhook-in`) valida, autentica contra la huella SHA-256 guardada en `workflow_webhooks`, registra la llamada en `webhook_recepciones` y lanza `execute-workflow` por la vía interna (`x-cron-secret`) pasándole **solo el id de la recepción**. El motor ancla la recepción (`aceptada → lanzada`) y lee el payload de la base en un solo paso atómico, y lo guarda en el contexto como propiedad **no enumerable** `__webhook`, que solo se lee con `{{webhook.…}}`. El secreto lo genera una RPC `SECURITY DEFINER`; el valor sale una vez y no se guarda.

**Tech Stack:** Supabase (PostgreSQL 15, RLS, pg_cron), Edge Functions Deno, React 18 + TypeScript strict, Vitest 2 (nuevo, solo para las piezas puras).

**Spec:** `docs/superpowers/specs/2026-09-28-webhook-entrada-design.md` (con la §12 «Desviaciones» que añade este plan).

## Global Constraints

- Tope de cuerpo: **256 KB** (`MAX_BYTES = 256 * 1024`). Límite: **60** llamadas aceptadas por flujo y minuto. `Idempotency-Key`: máx. **200** caracteres.
- Cabecera del secreto: **`x-webhook-secret`**. Parámetro en URL: **`?secreto=`**, solo con `permite_secreto_url = true`. Prefijo del secreto: **`hfw_`** + 64 hex.
- Respuestas: 405 / 415 / 413 / 400 (entrada), **401 `{"error":"No autorizado"}`** idéntico para flujo inexistente, sin webhook o secreto erróneo, 409 (flujo no apto), 429 (límite), 200 `{duplicada:true, execution_run_id}`, **202 `{recibido:true, recepcion_id}`**.
- Retención de `webhook_recepciones`: **90 días**, job `purgar-webhook-recepciones` (`17 4 * * *`). ⚠️ Ni el nombre ni el comando contienen `cron-runner` (CLAUDE.md §6.1.1). Nunca `$$` en comentarios SQL.
- Roles que generan el secreto = `manage_workflows`: **`admin`, `dueno_proceso`, `editor`** (copiado de `ROLE_PERMISSIONS`).
- RPCs: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE` a `PUBLIC` **y a `anon` por su nombre**, `GRANT EXECUTE` solo a `authenticated` (§6.4).
- Tablas nuevas: `CREATE TABLE` a secas; RLS con **solo** política de `SELECT`; sin GRANT de escritura a `authenticated`; `secreto_hash` sin GRANT de lectura.
- **Todo `{ error }` de supabase-js se lee** (§5.1 regla 2). Los textos de 4xx se escriben para una persona (§12.2).
- El correo sale solo por `_shared/email.ts` (§9.1). Las fechas, solo por `fecha.ts` (§9.3).
- `git add` y `git commit` en **llamadas separadas**; informar del resultado del hook. El push lo hace Hermes.
- Claude **no despliega** Edge Functions ni escribe en producción: el despliegue (`--no-verify-jwt`) y la migración los hace Hermes, en el orden de la Tarea 6.
- Comprobación de tipos: `npm run typecheck` (no `npx tsc --noEmit`, §15).

## Review Focus

1. **Cuerpo con `\u0000` dentro de una cadena** (`{"x":"a\u0000b"}`): `JSON.parse` lo acepta pero `jsonb` lo rechaza (22P05) → hoy sería un 500 opaco. Se espera **400** con motivo. Test en Tarea 1 (`contieneNulo`).
2. **`{{webhook.__proto__}}`, `{{webhook.constructor}}`, `{{webhook.toString}}`** deben resolver a vacío, no a código de `Object.prototype`. Test en Tarea 1 (`leerRuta`).
3. **Ejecutar a mano o «Reintentar» (Monitoring/WorkQueue) un flujo cuyo disparador es Webhook** mandaría el correo con todos los `{{webhook.…}}` en blanco. Se espera que el nodo disparador **reviente** con un motivo legible. Implementado en Tarea 3 (paso del `case 'trigger:webhook'`) y prueba E2E 9 de la Tarea 6.
4. **Una llamada de usuario con `triggeredBy:'webhook'` y un `recepcionId` ajeno** no debe anclar la recepción de nadie ni crear un run marcado como webhook. Se espera 400. Tarea 3 + E2E 8.
5. **`Content-Type: Application/JSON; charset=UTF-8`**, id en mayúsculas y barra final en la ruta deben aceptarse; `Idempotency-Key` de solo espacios cuenta como ausente. Tests en Tarea 1.

---

## Mapa de ficheros

| Fichero | Responsabilidad |
|---|---|
| `supabase/functions/_shared/webhook.ts` (nuevo) | Piezas puras: validar entrada, elegir secreto, huella, comparación en tiempo constante, lectura segura de rutas, motivo de un cuerpo de error. Sin Deno ni red. |
| `supabase/functions/_shared/webhook.test.ts` (nuevo) | Tests Vitest de lo anterior. |
| `database/migrations/20260928_webhook_entrada.sql` (nuevo) | Tablas, índices, RLS, GRANTs, CHECK de `audit_log`, dos RPCs, job de purga. |
| `database/ensayos/20260928_webhook_entrada.ensayo.sql` (nuevo) | Copia literal del cuerpo + pruebas; termina en `RAISE EXCEPTION` ⇒ no deja nada. |
| `supabase/functions/execute-workflow/index.ts` | `recepcionId` por vía interna, anclaje atómico, `__webhook` no enumerable, recarga al reanudar, `{{webhook.…}}`, escape en cuerpos de correo, `case 'trigger:webhook'` propio. |
| `supabase/functions/webhook-in/index.ts` (nuevo) | La puerta. |
| `src/types/webhook.ts` (nuevo) | Tipos del frontend. |
| `src/utils/webhook.ts` + `src/utils/webhook.test.ts` (nuevos) | Etiqueta de estado y ejemplo curl (puros, con tests). |
| `src/services/webhook.service.ts` (nuevo) | Lecturas y RPCs. |
| `src/components/WebhookSection.tsx` (nuevo) | Sección «Entrada por webhook». |
| `src/components/NodeConfigPanel.tsx` | Props nuevas, formulario del nodo Webhook, aviso de destinatario `{{webhook.`. |
| `src/components/WorkflowCanvas.tsx:1287` | Pasa `workflowId`, `organizationId`, `puedeEditar`. |
| `package.json` | `vitest` + script `test`. |
| `CLAUDE.md`, `database/schema.sql`, spec | Documentación tras desplegar. |

---

### Task 1: Piezas puras del webhook + Vitest

**Files:**
- Modify: `package.json` (devDependency `vitest`, script `test`)
- Create: `supabase/functions/_shared/webhook.ts`
- Test: `supabase/functions/_shared/webhook.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usados por las Tareas 3 y 4):
  - `MAX_BYTES: number`, `LIMITE_POR_MINUTO: number`, `MAX_EVENTO_ID: number`, `PREFIJO_SECRETO: string`
  - `type Veredicto<T> = { ok: true; valor: T } | { ok: false; status: number; error: string }`
  - `extraerIdFlujo(pathname: string): string | null`
  - `validarEntrada(metodo: string, contentType: string | null, cuerpo: Uint8Array): Veredicto<Record<string, unknown>>`
  - `validarIdempotencyKey(v: string | null): Veredicto<string | null>`
  - `elegirSecreto(cabecera: string | null, deUrl: string | null, permiteUrl: boolean): string | null`
  - `sha256Hex(texto: string): Promise<string>`
  - `igualesTiempoConstante(a: string, b: string): boolean`
  - `leerRuta(obj: unknown, ruta: string): unknown`
  - `textoDeValor(v: unknown): string`
  - `motivoDeCuerpo(status: number, texto: string): string`

- [ ] **Step 1: Instalar Vitest y añadir el script**

Run: `npm install --save-dev vitest@^2.1.9`

Luego, en `package.json`, dentro de `"scripts"`, añadir tras `"typecheck"`:

```json
    "typecheck": "tsc --noEmit -p tsconfig.app.json",
    "test": "vitest run"
```

- [ ] **Step 2: Escribir los tests (fallan: el módulo no existe)**

Crear `supabase/functions/_shared/webhook.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
    MAX_BYTES, extraerIdFlujo, validarEntrada, validarIdempotencyKey, elegirSecreto,
    sha256Hex, igualesTiempoConstante, leerRuta, textoDeValor, motivoDeCuerpo,
} from './webhook.ts';

const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';
const bytes = (s: string) => new TextEncoder().encode(s);

describe('extraerIdFlujo', () => {
    it('saca el id tras webhook-in', () => {
        expect(extraerIdFlujo(`/webhook-in/${ID}`)).toBe(ID);
        expect(extraerIdFlujo(`/functions/v1/webhook-in/${ID}`)).toBe(ID);
    });
    it('admite barra final y mayúsculas (devuelve minúsculas)', () => {
        expect(extraerIdFlujo(`/webhook-in/${ID.toUpperCase()}/`)).toBe(ID);
    });
    it('rechaza lo que no es un uuid o trae segmentos de más', () => {
        expect(extraerIdFlujo('/webhook-in/abc')).toBeNull();
        expect(extraerIdFlujo('/webhook-in/')).toBeNull();
        expect(extraerIdFlujo(`/webhook-in/${ID}/otra`)).toBeNull();
        expect(extraerIdFlujo(`/otra/${ID}`)).toBeNull();
    });
});

describe('validarEntrada', () => {
    const ok = (ct: string, s: string) => validarEntrada('POST', ct, bytes(s));
    it('acepta un objeto JSON', () => {
        expect(ok('application/json', '{"a":1}')).toEqual({ ok: true, valor: { a: 1 } });
    });
    it('acepta Content-Type con mayúsculas y charset', () => {
        expect(ok('Application/JSON; charset=UTF-8', '{"a":1}').ok).toBe(true);
    });
    it('405 si no es POST', () => {
        expect(validarEntrada('GET', 'application/json', bytes('{}'))).toMatchObject({ ok: false, status: 405 });
    });
    it('415 si no es JSON', () => {
        expect(ok('text/plain', '{}')).toMatchObject({ ok: false, status: 415 });
        expect(validarEntrada('POST', null, bytes('{}'))).toMatchObject({ ok: false, status: 415 });
    });
    it('413 por encima del tope', () => {
        const grande = new Uint8Array(MAX_BYTES + 1);
        expect(validarEntrada('POST', 'application/json', grande)).toMatchObject({ ok: false, status: 413 });
    });
    it('400 si no es UTF-8 válido', () => {
        expect(validarEntrada('POST', 'application/json', new Uint8Array([0x7b, 0xff, 0x7d]))).toMatchObject({ ok: false, status: 400 });
    });
    it('400 si no es JSON, está vacío o no es un objeto', () => {
        for (const s of ['{a:1}', '', '[]', 'null', '"x"', '3']) {
            expect(ok('application/json', s)).toMatchObject({ ok: false, status: 400 });
        }
    });
    it('400 si trae el carácter nulo en una clave o un valor (jsonb no lo admite)', () => {
        expect(ok('application/json', '{"x":"a\\u0000b"}')).toMatchObject({ ok: false, status: 400 });
        expect(ok('application/json', '{"a\\u0000":1}')).toMatchObject({ ok: false, status: 400 });
        expect(ok('application/json', '{"x":[{"y":"\\u0000"}]}')).toMatchObject({ ok: false, status: 400 });
        // Una barra invertida escapada seguida de "u0000" NO es un nulo
        expect(ok('application/json', '{"x":"\\\\u0000"}').ok).toBe(true);
    });
});

describe('validarIdempotencyKey', () => {
    it('ausente o solo espacios = null', () => {
        expect(validarIdempotencyKey(null)).toEqual({ ok: true, valor: null });
        expect(validarIdempotencyKey('   ')).toEqual({ ok: true, valor: null });
    });
    it('recorta espacios', () => {
        expect(validarIdempotencyKey('  pedido-1 ')).toEqual({ ok: true, valor: 'pedido-1' });
    });
    it('200 caracteres pasan, 201 no', () => {
        expect(validarIdempotencyKey('a'.repeat(200)).ok).toBe(true);
        expect(validarIdempotencyKey('a'.repeat(201))).toMatchObject({ ok: false, status: 400 });
    });
    it('rechaza caracteres de control', () => {
        expect(validarIdempotencyKey('a\u0001b')).toMatchObject({ ok: false, status: 400 });
    });
});

describe('elegirSecreto', () => {
    it('la cabecera gana y se recorta', () => {
        expect(elegirSecreto(' hfw_a ', 'hfw_b', true)).toBe('hfw_a');
    });
    it('la URL solo vale si el flujo la permite', () => {
        expect(elegirSecreto(null, 'hfw_b', false)).toBeNull();
        expect(elegirSecreto('  ', ' hfw_b ', true)).toBe('hfw_b');
    });
    it('nada = null', () => {
        expect(elegirSecreto(null, null, true)).toBeNull();
        expect(elegirSecreto('', '', true)).toBeNull();
    });
});

describe('sha256Hex', () => {
    it('vector conocido', async () => {
        expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
});

describe('igualesTiempoConstante', () => {
    it('compara bien', () => {
        expect(igualesTiempoConstante('abc', 'abc')).toBe(true);
        expect(igualesTiempoConstante('abc', 'abd')).toBe(false);
        expect(igualesTiempoConstante('abc', 'abcd')).toBe(false);
        expect(igualesTiempoConstante('', '')).toBe(true);
    });
});

describe('leerRuta', () => {
    const datos = { cliente: { nombre: 'Ana', tags: ['vip', 'nuevo'] }, n: 0 };
    it('lee rutas propias, incluidos índices de lista', () => {
        expect(leerRuta(datos, 'cliente.nombre')).toBe('Ana');
        expect(leerRuta(datos, 'cliente.tags.1')).toBe('nuevo');
        expect(leerRuta(datos, 'n')).toBe(0);
        expect(leerRuta(datos, '')).toBe(datos);
    });
    it('no alcanza el prototipo', () => {
        expect(leerRuta(datos, '__proto__')).toBeUndefined();
        expect(leerRuta(datos, 'constructor')).toBeUndefined();
        expect(leerRuta(datos, 'toString')).toBeUndefined();
        expect(leerRuta(datos, 'cliente.constructor.name')).toBeUndefined();
    });
    it('ruta inexistente o sobre algo que no es objeto', () => {
        expect(leerRuta(datos, 'nada.mas')).toBeUndefined();
        expect(leerRuta(datos, 'cliente.nombre.x')).toBeUndefined();
        expect(leerRuta(undefined, 'a')).toBeUndefined();
    });
});

describe('textoDeValor', () => {
    it('convierte a texto', () => {
        expect(textoDeValor(null)).toBe('');
        expect(textoDeValor(undefined)).toBe('');
        expect(textoDeValor(0)).toBe('0');
        expect(textoDeValor(false)).toBe('false');
        expect(textoDeValor({ a: 1 })).toBe('{"a":1}');
        expect(textoDeValor('{{summary}}')).toBe('{{summary}}');
    });
});

describe('motivoDeCuerpo', () => {
    it('saca el campo error del JSON', () => {
        expect(motivoDeCuerpo(409, '{"error":"El flujo no está publicado"}')).toBe('El flujo no está publicado');
    });
    it('si no hay campo error, devuelve el sobre recortado', () => {
        expect(motivoDeCuerpo(500, 'boom')).toBe('HTTP 500 — boom');
        expect(motivoDeCuerpo(500, '{"x":1}')).toBe('HTTP 500 — {"x":1}');
        expect(motivoDeCuerpo(502, 'x'.repeat(400))).toBe(`HTTP 502 — ${'x'.repeat(300)}`);
    });
});
```

- [ ] **Step 3: Ejecutar y ver que falla**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./webhook.ts"`.

- [ ] **Step 4: Implementar el módulo**

Crear `supabase/functions/_shared/webhook.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════════════
// Webhook de entrada — piezas puras (las usan webhook-in y execute-workflow)
// Diseño: docs/superpowers/specs/2026-09-28-webhook-entrada-design.md
//
// ⚠️ Este módulo se prueba con Vitest desde la raíz (`npm test`). Por eso no
// puede tocar `Deno.*` al cargarse, ni importar nada que lo haga — en concreto
// NO importa `email.ts`, que lee RESEND_API_KEY en el cuerpo del módulo. El
// escape HTML lo aplica el motor, que sí tiene `escaparHtml` a mano.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_BYTES         = 256 * 1024;
export const LIMITE_POR_MINUTO = 60;
export const MAX_EVENTO_ID     = 200;
export const PREFIJO_SECRETO   = 'hfw_';

export type Veredicto<T> =
    | { ok: true; valor: T }
    | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/…/webhook-in/<uuid>[/]` → uuid en minúsculas. Cualquier otra forma → null. */
export function extraerIdFlujo(pathname: string): string | null {
    const partes = pathname.split('/').filter(Boolean);
    const i = partes.lastIndexOf('webhook-in');
    if (i === -1 || partes.length !== i + 2) return null;
    const id = partes[i + 1];
    return UUID.test(id) ? id.toLowerCase() : null;
}

/** jsonb no admite U+0000 en cadenas ni en claves: se rechaza antes de llegar a la base. */
function contieneNulo(v: unknown): boolean {
    if (typeof v === 'string') return v.includes('\u0000');
    if (Array.isArray(v)) return v.some(contieneNulo);
    if (v !== null && typeof v === 'object') {
        return Object.entries(v).some(([k, x]) => k.includes('\u0000') || contieneNulo(x));
    }
    return false;
}

export function validarEntrada(
    metodo: string,
    contentType: string | null,
    cuerpo: Uint8Array,
): Veredicto<Record<string, unknown>> {
    if (metodo !== 'POST') {
        return { ok: false, status: 405, error: 'Solo se admite POST.' };
    }
    const tipo = (contentType ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== 'application/json') {
        return { ok: false, status: 415, error: 'El cuerpo tiene que ser JSON (Content-Type: application/json).' };
    }
    if (cuerpo.byteLength > MAX_BYTES) {
        return { ok: false, status: 413, error: `El cuerpo supera el máximo de ${MAX_BYTES / 1024} KB.` };
    }
    let texto: string;
    try {
        texto = new TextDecoder('utf-8', { fatal: true }).decode(cuerpo);
    } catch {
        return { ok: false, status: 400, error: 'El cuerpo no es texto UTF-8 válido.' };
    }
    let dato: unknown;
    try {
        dato = JSON.parse(texto);
    } catch {
        return { ok: false, status: 400, error: 'El cuerpo no es JSON válido.' };
    }
    if (dato === null || typeof dato !== 'object' || Array.isArray(dato)) {
        return { ok: false, status: 400, error: 'El cuerpo tiene que ser un objeto JSON ({ … }), no una lista ni un valor suelto.' };
    }
    if (contieneNulo(dato)) {
        return { ok: false, status: 400, error: 'El cuerpo contiene el carácter nulo (\\u0000), que no se puede guardar.' };
    }
    return { ok: true, valor: dato as Record<string, unknown> };
}

export function validarIdempotencyKey(v: string | null): Veredicto<string | null> {
    const t = (v ?? '').trim();
    if (t === '') return { ok: true, valor: null };
    if (t.length > MAX_EVENTO_ID) {
        return { ok: false, status: 400, error: `Idempotency-Key no puede pasar de ${MAX_EVENTO_ID} caracteres.` };
    }
    // deno-lint-ignore no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(t)) {
        return { ok: false, status: 400, error: 'Idempotency-Key contiene caracteres de control.' };
    }
    return { ok: true, valor: t };
}

/** La cabecera manda. La URL solo cuenta si el flujo lo permite (`permite_secreto_url`). */
export function elegirSecreto(cabecera: string | null, deUrl: string | null, permiteUrl: boolean): string | null {
    const c = (cabecera ?? '').trim();
    if (c !== '') return c;
    const u = (deUrl ?? '').trim();
    return permiteUrl && u !== '' ? u : null;
}

/** Misma huella que `encode(sha256(convert_to(x,'UTF8')),'hex')` en la base. */
export async function sha256Hex(texto: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

/** Se usa con dos huellas hex de 64: la longitud no es secreta, el contenido sí. */
export function igualesTiempoConstante(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let dif = 0;
    for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return dif === 0;
}

/**
 * Lee `a.b.0.c` recorriendo SOLO propiedades propias. `{{webhook.constructor}}`
 * o `{{webhook.__proto__}}` no pueden devolver nada del prototipo: el dato
 * viene de fuera y la ruta la escribe el diseñador, pero el objeto no.
 */
export function leerRuta(obj: unknown, ruta: string): unknown {
    if (ruta === '') return obj;
    let val: unknown = obj;
    for (const seg of ruta.split('.')) {
        if (val === null || typeof val !== 'object') return undefined;
        if (!Object.prototype.hasOwnProperty.call(val, seg)) return undefined;
        val = (val as Record<string, unknown>)[seg];
    }
    return val;
}

export function textoDeValor(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

/** Motivo legible de una respuesta no-2xx: el campo `error` del JSON, o el sobre recortado. */
export function motivoDeCuerpo(status: number, texto: string): string {
    try {
        const j = JSON.parse(texto);
        if (j && typeof j.error === 'string' && j.error.trim() !== '') return j.error;
    } catch { /* no era JSON */ }
    return `HTTP ${status} — ${texto.slice(0, 300)}`;
}
```

- [ ] **Step 5: Ejecutar y ver que pasa**

Run: `npm test`
Expected: PASS, todos los `describe` en verde.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json supabase/functions/_shared/webhook.ts supabase/functions/_shared/webhook.test.ts
```
```bash
git commit -m "feat(webhook): piezas puras de la puerta + Vitest"
```
(dos llamadas separadas; informar del hook)

---

### Task 2: Migración y ensayo

**Files:**
- Create: `database/migrations/20260928_webhook_entrada.sql`
- Create: `database/ensayos/20260928_webhook_entrada.ensayo.sql`

**Interfaces:**
- Consumes: `public.my_organization_id()`, `public.profiles(role, organization_id, email, is_active)`, `public.workflows(id, organization_id, name, estado_definicion)`, `public.audit_log`.
- Produces:
  - Tabla `workflow_webhooks(workflow_id PK, organization_id, secreto_hash, permite_secreto_url, generado_por, generado_email, generado_at, ultimo_aviso_fallo_at)`
  - Tabla `webhook_recepciones(id, organization_id, workflow_id, recibido_at, evento_id, estado, motivo, payload, bytes, execution_run_id)`; estados `aceptada | lanzada | fallo_al_lanzar | rechazada_inactivo | frenada_limite | duplicada`
  - RPC `generar_secreto_webhook(p_workflow_id uuid) → text`
  - RPC `configurar_webhook_url(p_workflow_id uuid, p_permitir boolean) → void`

- [ ] **Step 1: Escribir la migración**

Crear `database/migrations/20260928_webhook_entrada.sql`:

```sql
-- 20260928 — Webhook de entrada por flujo (entrega 1 del punto 1)
-- Diseño: docs/superpowers/specs/2026-09-28-webhook-entrada-design.md
-- Plan:   docs/superpowers/plans/2026-09-28-webhook-entrada.md
--
-- ⚠️ ENSAYAR ANTES: database/ensayos/20260928_webhook_entrada.ensayo.sql lleva
-- este mismo cuerpo, copiado LITERAL entre sus marcas, y termina en un error
-- que lo deshace todo. Si tocas el cuerpo aquí, cópialo allí; el plan trae el
-- diff que comprueba que no divergen.
--
-- Orden de despliegue: ESTA migración primero, luego execute-workflow, luego
-- webhook-in (las dos con --no-verify-jwt), luego el frontend.

BEGIN;

-- ── 1. Una fila por flujo: huella del secreto y configuración ───────────────
-- El valor del secreto NO se guarda nunca: solo su sha256 en hex.
CREATE TABLE public.workflow_webhooks (
    workflow_id           uuid PRIMARY KEY REFERENCES public.workflows(id) ON DELETE CASCADE,
    organization_id       uuid NOT NULL REFERENCES public.organizations(id),
    secreto_hash          text NOT NULL CHECK (secreto_hash ~ '^[0-9a-f]{64}$'),
    permite_secreto_url   boolean NOT NULL DEFAULT false,
    generado_por          uuid,          -- sin FK a propósito: borrar al usuario no borra el hecho (§6.6)
    generado_email        text,
    generado_at           timestamptz NOT NULL DEFAULT now(),
    ultimo_aviso_fallo_at timestamptz    -- un correo de «fallo al lanzar» por flujo y hora
);

-- ── 2. Registro de cada llamada AUTENTICADA ─────────────────────────────────
-- Los intentos con secreto erróneo no llegan aquí: si llegaran, cualquiera
-- podría llenar la base mandando basura (lección del 01/08, 743 MB).
CREATE TABLE public.webhook_recepciones (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES public.organizations(id),
    workflow_id      uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    recibido_at      timestamptz NOT NULL DEFAULT now(),
    evento_id        text CHECK (evento_id IS NULL OR char_length(evento_id) BETWEEN 1 AND 200),
    estado           text NOT NULL CHECK (estado IN (
                         'aceptada', 'lanzada', 'fallo_al_lanzar',
                         'rechazada_inactivo', 'frenada_limite', 'duplicada')),
    motivo           text,
    payload          jsonb,
    bytes            integer,
    execution_run_id uuid                -- sin FK: el run lo borra la cascada del flujo, no esto
);

-- La base decide la carrera entre dos llamadas iguales simultáneas.
CREATE UNIQUE INDEX webhook_recepciones_evento_unico
    ON public.webhook_recepciones (workflow_id, evento_id)
    WHERE evento_id IS NOT NULL AND estado IN ('aceptada', 'lanzada', 'fallo_al_lanzar');

-- Límite por minuto y lista del panel.
CREATE INDEX webhook_recepciones_flujo_fecha
    ON public.webhook_recepciones (workflow_id, recibido_at DESC);

-- El motor recarga los datos al reanudar un run pausado.
CREATE INDEX webhook_recepciones_run
    ON public.webhook_recepciones (execution_run_id)
    WHERE execution_run_id IS NOT NULL;

-- ── 3. RLS: la organización LEE; escriben solo las RPCs y la clave de servicio
-- Sin política de escritura Y sin GRANT, como tareas_aprobacion desde el
-- 25/09: una política permisiva añadida mañana no reabre la puerta.
ALTER TABLE public.workflow_webhooks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_recepciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhooks_tenant_read ON public.workflow_webhooks
    FOR SELECT TO authenticated
    USING (organization_id = my_organization_id());

CREATE POLICY recepciones_tenant_read ON public.webhook_recepciones
    FOR SELECT TO authenticated
    USING (organization_id = my_organization_id());

-- Supabase da ALL a anon y authenticated sobre toda tabla nueva de public
-- (ALTER DEFAULT PRIVILEGES): se retira por su nombre (§6.4).
REVOKE ALL ON public.workflow_webhooks, public.webhook_recepciones FROM PUBLIC, anon, authenticated;

-- secreto_hash no se enseña: no es reversible, pero no hay motivo para verlo.
GRANT SELECT (workflow_id, organization_id, permite_secreto_url, generado_por,
              generado_email, generado_at, ultimo_aviso_fallo_at)
    ON public.workflow_webhooks TO authenticated;
GRANT SELECT ON public.webhook_recepciones TO authenticated;
GRANT ALL ON public.workflow_webhooks, public.webhook_recepciones TO service_role;

-- ── 4. Tocar el secreto es un hecho auditable ───────────────────────────────
-- Lista medida en producción el 28/09/2026 + 'webhook'.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entidad_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entidad_check
    CHECK (entidad = ANY (ARRAY['workflow', 'usuario', 'integracion', 'aprobacion',
                                'sesion', 'matriz_aprobacion', 'delegacion', 'webhook']));

-- ── 5. Generar / rotar el secreto ───────────────────────────────────────────
CREATE FUNCTION public.generar_secreto_webhook(p_workflow_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_uid     uuid := auth.uid();
    v_rol     text;
    v_org     uuid;
    v_email   text;
    v_activo  boolean;
    v_wf_org  uuid;
    v_nombre  text;
    v_habia   boolean;
    v_secreto text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No hay sesión. Vuelve a entrar en la aplicación.';
    END IF;

    SELECT p.role, p.organization_id, p.email, p.is_active
      INTO v_rol, v_org, v_email, v_activo
      FROM profiles p WHERE p.id = v_uid;

    IF v_rol IS NULL OR v_activo IS NOT TRUE THEN
        RAISE EXCEPTION 'Tu usuario no está activo.';
    END IF;

    SELECT w.organization_id, w.name INTO v_wf_org, v_nombre
      FROM workflows w WHERE w.id = p_workflow_id;

    -- DEFINER se salta la RLS: la organización se comprueba a mano.
    IF v_wf_org IS NULL OR v_wf_org <> v_org THEN
        RAISE EXCEPTION 'Ese flujo no existe o no pertenece a tu organización.';
    END IF;

    -- ⚠️ Copia de `manage_workflows` en ROLE_PERMISSIONS (src/core/user.types.ts).
    -- Si cambia una, cambia la otra (como transicionar_flujo, CLAUDE.md §6.7).
    IF v_rol NOT IN ('admin', 'dueno_proceso', 'editor') THEN
        RAISE EXCEPTION 'Solo el Administrador o el Dueño de Proceso pueden generar el secreto del webhook de un flujo.';
    END IF;

    v_habia := EXISTS (SELECT 1 FROM workflow_webhooks WHERE workflow_id = p_workflow_id);

    -- Dos uuid v4 = 244 bits aleatorios, sin depender de pgcrypto. Una variable
    -- de plpgsql se evalúa UNA vez: cumple el papel del CTE AS MATERIALIZED de
    -- ROTAR_CRON_SECRET.sql (que la huella y el valor devuelto salgan del
    -- mismo secreto).
    v_secreto := 'hfw_' || replace(gen_random_uuid()::text, '-', '')
                        || replace(gen_random_uuid()::text, '-', '');

    -- Rotar invalida el anterior en el acto. No toca permite_secreto_url ni
    -- ultimo_aviso_fallo_at, ni la definición del flujo: no lo despublica (§6.7).
    INSERT INTO workflow_webhooks (workflow_id, organization_id, secreto_hash,
                                   generado_por, generado_email, generado_at)
    VALUES (p_workflow_id, v_org, encode(sha256(convert_to(v_secreto, 'UTF8')), 'hex'),
            v_uid, v_email, now())
    ON CONFLICT (workflow_id) DO UPDATE
       SET secreto_hash   = EXCLUDED.secreto_hash,
           generado_por   = EXCLUDED.generado_por,
           generado_email = EXCLUDED.generado_email,
           generado_at    = EXCLUDED.generado_at;

    -- Se registra el hecho, NUNCA el secreto.
    INSERT INTO audit_log (organization_id, usuario_id, usuario_email, accion,
                           entidad, entidad_id, descripcion)
    VALUES (v_org, v_uid, v_email,
            CASE WHEN v_habia THEN 'modificar' ELSE 'crear' END,
            'webhook', p_workflow_id,
            CASE WHEN v_habia
                 THEN format('Rotó el secreto del webhook del flujo «%s». El anterior deja de valer.', v_nombre)
                 ELSE format('Generó el secreto del webhook del flujo «%s».', v_nombre)
            END);

    RETURN v_secreto;
END;
$fn$;

REVOKE ALL ON FUNCTION public.generar_secreto_webhook(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generar_secreto_webhook(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.generar_secreto_webhook(uuid) TO authenticated;

-- ── 6. Permitir / retirar el secreto en la URL ──────────────────────────────
CREATE FUNCTION public.configurar_webhook_url(p_workflow_id uuid, p_permitir boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_uid    uuid := auth.uid();
    v_rol    text;
    v_org    uuid;
    v_email  text;
    v_activo boolean;
    v_wf_org uuid;
    v_nombre text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'No hay sesión. Vuelve a entrar en la aplicación.';
    END IF;

    SELECT p.role, p.organization_id, p.email, p.is_active
      INTO v_rol, v_org, v_email, v_activo
      FROM profiles p WHERE p.id = v_uid;

    IF v_rol IS NULL OR v_activo IS NOT TRUE THEN
        RAISE EXCEPTION 'Tu usuario no está activo.';
    END IF;

    SELECT w.organization_id, w.name INTO v_wf_org, v_nombre
      FROM workflows w WHERE w.id = p_workflow_id;

    IF v_wf_org IS NULL OR v_wf_org <> v_org THEN
        RAISE EXCEPTION 'Ese flujo no existe o no pertenece a tu organización.';
    END IF;

    -- ⚠️ Copia de `manage_workflows` (ver generar_secreto_webhook).
    IF v_rol NOT IN ('admin', 'dueno_proceso', 'editor') THEN
        RAISE EXCEPTION 'Solo el Administrador o el Dueño de Proceso pueden cambiar cómo se autentica el webhook de un flujo.';
    END IF;

    IF p_permitir IS NULL THEN
        RAISE EXCEPTION 'Falta indicar si se permite o no el secreto en la URL.';
    END IF;

    UPDATE workflow_webhooks SET permite_secreto_url = p_permitir
     WHERE workflow_id = p_workflow_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ese flujo todavía no tiene secreto. Genera uno primero.';
    END IF;

    INSERT INTO audit_log (organization_id, usuario_id, usuario_email, accion,
                           entidad, entidad_id, descripcion)
    VALUES (v_org, v_uid, v_email, 'modificar', 'webhook', p_workflow_id,
            CASE WHEN p_permitir
                 THEN format('Permitió el secreto en la URL del webhook del flujo «%s».', v_nombre)
                 ELSE format('Retiró el secreto en la URL del webhook del flujo «%s».', v_nombre)
            END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.configurar_webhook_url(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.configurar_webhook_url(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.configurar_webhook_url(uuid, boolean) TO authenticated;

-- ── 7. Retención: 90 días ───────────────────────────────────────────────────
-- Job puramente SQL, sin HTTP: no cae en net._http_response y no altera el
-- conteo de salud_cron(). El nombre y el comando NO contienen la cadena del
-- runner del reloj, o el barrido de 20260807 se lo llevaría (§6.1.1).
SELECT cron.schedule(
    'purgar-webhook-recepciones',
    '17 4 * * *',
    $cmd$DELETE FROM public.webhook_recepciones WHERE recibido_at < now() - interval '90 days'$cmd$
);

COMMIT;
```

- [ ] **Step 2: Escribir el ensayo**

Crear `database/ensayos/20260928_webhook_entrada.ensayo.sql`. Estructura exacta: cabecera → `BEGIN;` → marca `-- >>> CUERPO` → **el cuerpo de la migración copiado literal, desde la línea siguiente a `BEGIN;` hasta la anterior a `COMMIT;`** → marca `-- <<< CUERPO` → bloque de pruebas. Sin `COMMIT`.

```sql
-- ENSAYO de 20260928_webhook_entrada.sql — NO deja nada en la base.
--
-- Corre la migración entera dentro de una transacción, la prueba, y termina con
-- RAISE EXCEPTION: el error deshace todo, también el job de pg_cron. El
-- veredicto va en el propio mensaje de error:
--     ENSAYO: 17 de 17 OK — sin fallos
--
-- Entre las marcas CUERPO va la migración copiada LITERAL. Comprobación
-- (tiene que salir vacía):
--   diff <(sed -n '/^BEGIN;$/,/^COMMIT;$/p' database/migrations/20260928_webhook_entrada.sql | sed '1d;$d') \
--        <(sed -n '/^-- >>> CUERPO$/,/^-- <<< CUERPO$/p' database/ensayos/20260928_webhook_entrada.ensayo.sql | sed '1d;$d')

BEGIN;
-- >>> CUERPO
(… aquí, literal, todo lo que hay entre «BEGIN;» y «COMMIT;» en la migración …)
-- <<< CUERPO

DO $ensayo$
DECLARE
    v_ok     int  := 0;
    v_total  int  := 0;
    v_fallos text := '';
    v_notas  text := '';
    v_admin    uuid;
    v_operador uuid;
    v_otro     uuid;
    v_org      uuid;
    v_wf       uuid;   -- flujo publicado de la organización
    v_wf_sin   uuid;   -- otro flujo, que se queda sin secreto
    v_s1 text; v_s2 text; v_s3 text; v_h text;
    v_n0 int; v_n int; v_b boolean; v_estado text; v_sql text;
BEGIN
    SELECT id, organization_id INTO v_admin, v_org
      FROM profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1;
    SELECT id INTO v_operador
      FROM profiles WHERE role = 'operador' AND is_active AND organization_id = v_org LIMIT 1;
    SELECT id INTO v_otro
      FROM profiles WHERE role = 'admin' AND is_active AND organization_id <> v_org LIMIT 1;
    SELECT id INTO v_wf
      FROM workflows WHERE organization_id = v_org AND estado_definicion = 'publicado' LIMIT 1;
    SELECT id INTO v_wf_sin
      FROM workflows WHERE organization_id = v_org AND id <> v_wf ORDER BY created_at LIMIT 1;

    IF v_admin IS NULL OR v_wf IS NULL OR v_wf_sin IS NULL THEN
        RAISE EXCEPTION 'ENSAYO: faltan datos de partida (admin %, flujo publicado %, segundo flujo %)',
            v_admin, v_wf, v_wf_sin;
    END IF;

    -- 1. Permisos de las RPC
    v_total := v_total + 1;
    IF NOT has_function_privilege('anon', 'public.generar_secreto_webhook(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.configurar_webhook_url(uuid,boolean)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.generar_secreto_webhook(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.configurar_webhook_url(uuid,boolean)', 'EXECUTE')
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [1 permisos RPC]'; END IF;

    -- 2. Un operador no genera
    IF v_operador IS NULL THEN
        v_notas := v_notas || ' (sin operador: prueba 2 omitida)';
    ELSE
        v_total := v_total + 1;
        BEGIN
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_operador, 'role', 'authenticated')::text, true);
            SET LOCAL ROLE authenticated;
            PERFORM public.generar_secreto_webhook(v_wf);
            RESET ROLE;
            v_fallos := v_fallos || ' [2 el operador generó]';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE 'Solo el Administrador%' THEN v_ok := v_ok + 1;
            ELSE v_fallos := v_fallos || ' [2 ' || SQLERRM || ']'; END IF;
        END;
    END IF;

    -- 3. Un admin de otra organización no genera
    IF v_otro IS NULL THEN
        v_notas := v_notas || ' (sin otra organización: prueba 3 omitida)';
    ELSE
        v_total := v_total + 1;
        BEGIN
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
            SET LOCAL ROLE authenticated;
            PERFORM public.generar_secreto_webhook(v_wf);
            RESET ROLE;
            v_fallos := v_fallos || ' [3 otra organización generó]';
        EXCEPTION WHEN OTHERS THEN
            IF SQLERRM LIKE 'Ese flujo no existe%' THEN v_ok := v_ok + 1;
            ELSE v_fallos := v_fallos || ' [3 ' || SQLERRM || ']'; END IF;
        END;
    END IF;

    -- 4. Generar dos veces: formato, huella nueva, dos filas de auditoría sin el secreto
    v_total := v_total + 1;
    SELECT count(*) INTO v_n0 FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_s1 := public.generar_secreto_webhook(v_wf);
    v_s2 := public.generar_secreto_webhook(v_wf);
    RESET ROLE;
    SELECT secreto_hash INTO v_h FROM workflow_webhooks WHERE workflow_id = v_wf;
    SELECT count(*) INTO v_n FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf;
    IF v_s1 ~ '^hfw_[0-9a-f]{64}$' AND v_s2 ~ '^hfw_[0-9a-f]{64}$' AND v_s1 <> v_s2
       AND v_h = encode(sha256(convert_to(v_s2, 'UTF8')), 'hex')
       AND v_n - v_n0 = 2
       AND NOT EXISTS (SELECT 1 FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf
                         AND (coalesce(descripcion, '') || coalesce(datos_antes::text, '') || coalesce(datos_despues::text, ''))
                             ~ ('(' || v_s1 || '|' || v_s2 || ')'))
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [4 generar/rotar/auditoría]'; END IF;

    -- 5-11. authenticated no escribe en las tablas ni lee secreto_hash
    FOREACH v_sql IN ARRAY ARRAY[
        format('INSERT INTO workflow_webhooks (workflow_id, organization_id, secreto_hash) VALUES (%L, %L, repeat(''a'', 64))', v_wf_sin, v_org),
        'UPDATE workflow_webhooks SET permite_secreto_url = true',
        'DELETE FROM workflow_webhooks',
        format('INSERT INTO webhook_recepciones (organization_id, workflow_id, estado) VALUES (%L, %L, ''aceptada'')', v_org, v_wf),
        'UPDATE webhook_recepciones SET motivo = ''x''',
        'DELETE FROM webhook_recepciones',
        'SELECT secreto_hash FROM workflow_webhooks'
    ] LOOP
        v_total := v_total + 1;
        BEGIN
            PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
            SET LOCAL ROLE authenticated;
            EXECUTE v_sql;
            RESET ROLE;
            v_fallos := v_fallos || ' [permitido: ' || left(v_sql, 45) || ']';
        EXCEPTION
            WHEN insufficient_privilege THEN v_ok := v_ok + 1;
            WHEN OTHERS THEN v_fallos := v_fallos || ' [' || left(v_sql, 45) || ': ' || SQLERRM || ']';
        END;
    END LOOP;

    -- 12. authenticated SÍ lee su fila (sin secreto_hash)
    v_total := v_total + 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM workflow_webhooks WHERE workflow_id = v_wf AND permite_secreto_url = false;
    RESET ROLE;
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [12 la organización no ve su fila]'; END IF;

    -- 13. Generar no despublica
    v_total := v_total + 1;
    SELECT estado_definicion INTO v_estado FROM workflows WHERE id = v_wf;
    IF v_estado = 'publicado' THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [13 quedó en ' || v_estado || ']'; END IF;

    -- 14. Índice único: dos aceptadas con el mismo evento chocan; una duplicada no
    v_total := v_total + 1;
    BEGIN
        INSERT INTO webhook_recepciones (organization_id, workflow_id, evento_id, estado) VALUES (v_org, v_wf, 'ensayo-1', 'aceptada');
        INSERT INTO webhook_recepciones (organization_id, workflow_id, evento_id, estado) VALUES (v_org, v_wf, 'ensayo-1', 'duplicada');
        INSERT INTO webhook_recepciones (organization_id, workflow_id, evento_id, estado) VALUES (v_org, v_wf, 'ensayo-1', 'lanzada');
        v_fallos := v_fallos || ' [14 el índice único dejó pasar el repetido]';
    EXCEPTION
        WHEN unique_violation THEN v_ok := v_ok + 1;
        WHEN OTHERS THEN v_fallos := v_fallos || ' [14 ' || SQLERRM || ']';
    END;

    -- 15. configurar_webhook_url sin secreto falla
    v_total := v_total + 1;
    BEGIN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
        SET LOCAL ROLE authenticated;
        PERFORM public.configurar_webhook_url(v_wf_sin, true);
        RESET ROLE;
        v_fallos := v_fallos || ' [15 configuró sin secreto]';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'Ese flujo todavía no tiene secreto%' THEN v_ok := v_ok + 1;
        ELSE v_fallos := v_fallos || ' [15 ' || SQLERRM || ']'; END IF;
    END;

    -- 16. Con secreto: enciende, audita, y rotar después no lo apaga
    v_total := v_total + 1;
    SELECT count(*) INTO v_n0 FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.configurar_webhook_url(v_wf, true);
    v_s3 := public.generar_secreto_webhook(v_wf);
    RESET ROLE;
    SELECT permite_secreto_url INTO v_b FROM workflow_webhooks WHERE workflow_id = v_wf;
    SELECT count(*) INTO v_n FROM audit_log WHERE entidad = 'webhook' AND entidad_id = v_wf;
    IF v_b AND v_n - v_n0 = 2 THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || format(' [16 permite=%s auditorías=%s]', v_b, v_n - v_n0); END IF;

    -- 17. El job de purga existe y no contiene la cadena del runner
    v_total := v_total + 1;
    SELECT count(*) INTO v_n FROM cron.job
     WHERE jobname = 'purgar-webhook-recepciones' AND schedule = '17 4 * * *'
       AND command NOT LIKE '%cron-runner%';
    IF v_n = 1 THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [17 job de purga]'; END IF;

    -- Tres «%» y tres argumentos (un «%%» sería un % literal y no consumiría ninguno).
    RAISE EXCEPTION 'ENSAYO: % de % OK —%', v_ok, v_total,
        (CASE WHEN v_fallos = '' THEN ' sin fallos' ELSE v_fallos END) || v_notas;
END
$ensayo$;
```

- [ ] **Step 3: Pegar el cuerpo y comprobar que no diverge**

Sustituir la línea `(… aquí, literal, …)` por el cuerpo de la migración, y ejecutar:

```bash
diff <(sed -n '/^BEGIN;$/,/^COMMIT;$/p' database/migrations/20260928_webhook_entrada.sql | sed '1d;$d') \
     <(sed -n '/^-- >>> CUERPO$/,/^-- <<< CUERPO$/p' database/ensayos/20260928_webhook_entrada.ensayo.sql | sed '1d;$d') \
  && echo "IDENTICOS"
```
Expected: `IDENTICOS`, sin ninguna línea de diff.

- [ ] **Step 4: Correr el ensayo**

Primero intentarlo por la CLI (no deja nada: acaba en error):

```bash
supabase db query --linked -f database/ensayos/20260928_webhook_entrada.ensayo.sql
```

Si ese permiso se deniega, pedírselo a Hermes con **un** paso: «abre el SQL Editor, pega el fichero `database/ensayos/20260928_webhook_entrada.ensayo.sql` entero y pulsa Run; el resultado es un error rojo que empieza por `ENSAYO:` — cópiame esa línea».

Expected: `ERROR: ENSAYO: 17 de 17 OK — sin fallos` (o 15–16 de 15–16 con la nota de la prueba omitida si falta un operador u otra organización). Cualquier `[…]` en el mensaje es un fallo: corregir la migración, recopiar el cuerpo (Step 3) y repetir.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/20260928_webhook_entrada.sql database/ensayos/20260928_webhook_entrada.ensayo.sql
```
```bash
git commit -m "feat(webhook): migración (tablas, RLS, RPCs del secreto, purga) + ensayo con rollback"
```

---

### Task 3: El motor acepta llamadas de webhook

**Files:**
- Modify: `supabase/functions/execute-workflow/index.ts` (imports ~l.8; `resolveValue` 150–189; triggers 677–680; email 689; reporte 1765; handler ~2003, ~2036, 2163–2229, 2274)

**Interfaces:**
- Consumes (Tarea 1): `leerRuta`, `textoDeValor` de `../_shared/webhook.ts`. (Tarea 2): tabla `webhook_recepciones`.
- Produces (la usa la Tarea 4): el cuerpo que acepta la vía interna
  `{ workflowId: string, organizationId: string, triggeredBy: 'webhook', recepcionId: string }`.
  Respuestas: 400 si llega `triggeredBy:'webhook'` sin `recepcionId` válido por la vía interna; **500 `{ error }`** si no se puede anclar la recepción (la puerta lo convierte en `fallo_al_lanzar`).

- [ ] **Step 1: Importar las piezas puras**

Tras la línea 11 (`import { destinatariosDelRol } …`):

```ts
import { leerRuta, textoDeValor } from '../_shared/webhook.ts';
```

- [ ] **Step 2: `resolveValue` con `{{webhook.…}}`**

Sustituir la cabecera y el principio de `resolveValue` (líneas 149–159):

```ts
// ── Resolución de valores de contexto ───────────────────────────────────────
// `escaparWebhook`: los valores de {{webhook.…}} vienen de un sistema externo;
// en el CUERPO HTML de un correo se escapan (se escapa el dato, nunca la
// plantilla — ver escaparHtml en _shared/email.ts). En asunto y destinatario
// van como texto.
function resolveValue(
    expr: string,
    context: Record<string, any>,
    opciones: { escaparWebhook?: boolean } = {},
): any {
    if (!expr) return expr;

    // Reemplazar todas las expresiones {{...}} dentro de una cadena.
    // String.replace con función NO vuelve a analizar lo que inserta: un
    // "{{summary}}" que llegue dentro del payload se escribe literal.
    if (expr.includes('{{')) {
        return expr.replace(/\{\{([^}]+)\}\}/g, (_, rawPath) => {
            const path = rawPath.trim();

            // {{webhook}} o {{webhook.campo.0.sub}} → lo recibido por webhook-in.
            // Vive en una propiedad NO enumerable (ver el anclaje en el handler),
            // así que solo se alcanza por aquí: ni {{previous.…}} ni {{summary}}
            // ni el agente IA la ven.
            if (path === 'webhook' || path.startsWith('webhook.')) {
                const texto = textoDeValor(leerRuta(context.__webhook, path === 'webhook' ? '' : path.slice(8)));
                return opciones.escaparWebhook ? escaparHtml(texto) : texto;
            }

            // {{summary}} → tabla HTML con todos los datos del contexto
            if (path === 'summary') return buildContextSummary(context);
```

(El resto de la función —rama `previous.` y ruta genérica— no cambia.)

- [ ] **Step 3: El disparador Webhook, en su propio `case` y fallando cerrado**

Sustituir las líneas 677–680:

```ts
        case 'trigger:manual':
        case 'trigger:cron':
            return { triggered: true, timestamp: new Date().toISOString() };

        // Un flujo que arranca por webhook sin la llamada que lo origina (Ejecutar
        // a mano, «Reintentar» en Monitoreo o en la bandeja) correría con todos
        // los {{webhook.…}} en blanco y mandaría el correo igual. Se detiene.
        case 'trigger:webhook': {
            const recibido = context.__webhook as Record<string, unknown> | undefined;
            if (!recibido) {
                throw new Error(
                    'Este flujo arranca con una llamada a su webhook y esta ejecución no trae ninguna, ' +
                    'así que no hay datos que usar. Se lanza llamando a su dirección (ver el panel del nodo Webhook), ' +
                    'no con Ejecutar ni con Reintentar.',
                );
            }
            return { triggered: true, timestamp: new Date().toISOString(), recibido: true, evento_id: recibido._evento_id ?? null };
        }
```

- [ ] **Step 4: Escapar lo recibido en los cuerpos de correo**

Línea 689 (`output:email`):

```ts
            let   body    = resolveValue(cfg.body ?? '', context, { escaparWebhook: true });
```

Línea 1765 (`processor:reporte` / `output:reporte`), mismo cambio:

```ts
            let   body    = resolveValue(cfg.body ?? '', context, { escaparWebhook: true });
```

- [ ] **Step 5: Aceptar `recepcionId` solo por la vía interna**

Justo después del bloque que define `esLlamadaInterna` (tras la línea `(token !== '' && token === SERVICE_ROLE_KEY);`, ~l.2036), insertar:

```ts
        // ── Llamada recibida por webhook (webhook-in) ────────────────────────
        // Solo la vía interna puede decir «esta ejecución viene de un webhook».
        // En una llamada de usuario se ignora: si no, cualquier sesión podría
        // hacerse pasar por un sistema externo o anclar la recepción de otro.
        // Los datos NO viajan en el cuerpo: se leen de la base por este id al
        // anclar la recepción (paso 5, más abajo).
        const recepcionId: string | null =
            esLlamadaInterna && triggeredBy === 'webhook' && action !== 'resume' && typeof body.recepcionId === 'string'
                ? body.recepcionId
                : null;
        if (triggeredBy === 'webhook' && action !== 'resume' && !recepcionId) {
            return new Response(
                JSON.stringify({ error: 'Una ejecución por webhook solo la lanza la puerta webhook-in, con la llamada que recibió.' }),
                { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
            );
        }
```

- [ ] **Step 6: Recordar el origen del run al reanudar**

En el bloque «3. Crear o reutilizar registro de ejecución», tras `let completedNodeIds: Set<string> = new Set();`:

```ts
        let runTriggeredBy: string | null = null;
```

En el `select` del run pausado (l.~2169):

```ts
                .select('id, context_json, completed_node_ids, definicion_huella, triggered_by')
```

Y junto a `runId = existingRun.id;`:

```ts
            runTriggeredBy   = (existingRun.triggered_by as string | null) ?? null;
```

- [ ] **Step 7: Anclar la recepción y cargar los datos**

Sustituir la línea `const context: Record<string, any> = { ...restoredContext };` (l.~2274) por:

```ts
        const context: Record<string, any> = { ...restoredContext };

        // ── Datos recibidos por webhook ─────────────────────────────────────
        // Anclar y leer es UN paso: el UPDATE solo casa si la recepción sigue
        // en 'aceptada' y es de este flujo y organización, y devuelve los datos.
        // Si no casa, la llamada ya se lanzó (o no es nuestra): no se ejecuta
        // otra vez. Cualquier fallo lanza ⇒ el catch pone el run en error y
        // devuelve 500 ⇒ webhook-in marca 'fallo_al_lanzar' y avisa.
        let recepcion: { payload: unknown; evento_id: string | null; recibido_at: string } | null = null;
        if (recepcionId) {
            const { data, error: recErr } = await supabase
                .from('webhook_recepciones')
                .update({ estado: 'lanzada', execution_run_id: runId })
                .eq('id', recepcionId)
                .eq('workflow_id', workflowId)
                .eq('organization_id', organizationId)
                .eq('estado', 'aceptada')
                .select('payload, evento_id, recibido_at')
                .maybeSingle();
            if (recErr) throw new Error(`No se pudo enlazar la llamada recibida con esta ejecución: ${recErr.message}`);
            if (!data) throw new Error('La llamada recibida ya no está pendiente de lanzar (¿se lanzó dos veces?). No se ejecuta de nuevo.');
            recepcion = data;
        } else if (action === 'resume' && runTriggeredBy === 'webhook') {
            // Los datos no están en context_json (propiedad no enumerable): se
            // recargan de la recepción que lanzó este run.
            const { data, error: recErr } = await supabase
                .from('webhook_recepciones')
                .select('payload, evento_id, recibido_at')
                .eq('execution_run_id', runId)
                .eq('estado', 'lanzada')
                .maybeSingle();
            if (recErr) throw new Error(`No se pudieron recuperar los datos recibidos por webhook: ${recErr.message}`);
            if (!data) throw new Error('Esta ejecución arrancó por webhook y ya no se encuentra la llamada que la originó. No se reanuda sin sus datos.');
            recepcion = data;
        }

        // NO enumerable a propósito: todo lo que recorre el contexto —la búsqueda
        // de {{previous.…}}, {{summary}}, el prompt del agente IA
        // (Object.values), el consolidado del reporte y el context_json que se
        // guarda al pausar (JSON.stringify)— se la salta. El dato externo solo
        // entra donde el diseñador escribe {{webhook.…}}, y no se guarda dos veces.
        if (recepcion) {
            Object.defineProperty(context, '__webhook', {
                value: {
                    ...((recepcion.payload as Record<string, unknown> | null) ?? {}),
                    _evento_id: recepcion.evento_id ?? null,
                    _recibido:  recepcion.recibido_at,
                },
                enumerable: false,
                writable:   false,
            });
        }
```

- [ ] **Step 8: Comprobar que no hay otra vía por la que el contexto se copie con spread antes de usarse**

Run: `grep -n "\.\.\.context\b\|Object.assign(.*context" supabase/functions/execute-workflow/index.ts`
Expected: ninguna copia de `context` que luego se pase a `resolveValue`. Si aparece alguna, la copia pierde `__webhook` (el spread no copia no enumerables): anotarlo y pasar el `context` original en ese punto.

- [ ] **Step 9: Comprobar tipos de Deno (si está disponible)**

Run: `npx --yes deno@2 check supabase/functions/execute-workflow/index.ts`
Expected: sin errores nuevos respecto a `git stash; npx --yes deno@2 check …; git stash pop`. Si `npx deno` no está disponible en este equipo, anotarlo: la comprobación queda en el sondeo tras desplegar (Tarea 6).

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/execute-workflow/index.ts
```
```bash
git commit -m "feat(motor): llamadas de webhook — anclaje atómico, {{webhook.…}} no enumerable y escapado, disparador que falla cerrado"
```

---

### Task 4: La puerta `webhook-in`

**Files:**
- Create: `supabase/functions/webhook-in/index.ts`

**Interfaces:**
- Consumes: Tarea 1 (todo `_shared/webhook.ts`), Tarea 2 (tablas), Tarea 3 (cuerpo interno de `execute-workflow`), `enviarEmail(to: string | string[], subject, html)` y `escaparHtml(valor: unknown)` de `_shared/email.ts`, `fechaHoraVE(valor)` de `_shared/fecha.ts`, `destinatariosDelRol(db, org, rol): Promise<{ name; email; porDelegacionDe? }[]>` de `_shared/delegaciones.ts`.
- Produces: `POST /functions/v1/webhook-in/<workflow_id>` con las respuestas de Global Constraints.

- [ ] **Step 1: Escribir la función**

Crear `supabase/functions/webhook-in/index.ts`:

```ts
// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Puerta del webhook de entrada
// Edge Function: webhook-in   (PÚBLICA — se despliega con --no-verify-jwt)
// POST /functions/v1/webhook-in/<workflow_id>
//   cabecera x-webhook-secret: hfw_…   (o ?secreto= si el flujo lo permite)
//   cabecera Idempotency-Key: …        (opcional, recomendada)
// Diseño: docs/superpowers/specs/2026-09-28-webhook-entrada-design.md
//
// No ejecuta nodos. Valida, autentica, registra la llamada y le pasa el
// testigo a execute-workflow por la vía interna (x-cron-secret) con SOLO el id
// de la recepción: el motor lee los datos de la base al anclarla.
//
// Sin CORS a propósito: es una llamada entre servidores. Un navegador que la
// hiciera estaría enseñando el secreto a quien abra la página.
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enviarEmail, escaparHtml } from '../_shared/email.ts';
import { fechaHoraVE } from '../_shared/fecha.ts';
import { destinatariosDelRol } from '../_shared/delegaciones.ts';
import {
    MAX_BYTES, LIMITE_POR_MINUTO,
    extraerIdFlujo, validarEntrada, validarIdempotencyKey, elegirSecreto,
    sha256Hex, igualesTiempoConstante, motivoDeCuerpo,
} from '../_shared/webhook.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Se lee al arrancar el isolate (§6.1.1): un secreto recién rotado entra al reciclarse.
const CRON_SECRET      = Deno.env.get('CRON_SECRET') ?? '';

const ESTADOS_ACEPTADOS = ['aceptada', 'lanzada', 'fallo_al_lanzar'];

// Se compara contra esto cuando el flujo no tiene webhook, para que el tiempo
// de respuesta no delate qué flujos lo tienen.
const HUELLA_NULA = '0'.repeat(64);

function json(status: number, cuerpo: unknown, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(cuerpo), {
        status,
        headers: { 'Content-Type': 'application/json', ...extra },
    });
}

// Idéntico para «no existe», «sin webhook» y «secreto erróneo».
const noAutorizado = () => json(401, { error: 'No autorizado' });

const haceMs = (ms: number) => new Date(Date.now() - ms).toISOString();

// ── Filas de rechazo: como mucho UNA por flujo, estado y minuto ─────────────
// Quien tiene el secreto no puede llenar la tabla a base de llamadas
// rechazadas: el usuario ve que hubo rechazos, no cada uno. Un fallo aquí no
// cambia la respuesta: se registra en el log de la función.
async function registrarLimitado(
    db: SupabaseClient, org: string, workflowId: string, estado: string,
    motivo: string, eventoId: string | null, runId: string | null,
): Promise<void> {
    try {
        const { count, error } = await db.from('webhook_recepciones')
            .select('id', { count: 'exact', head: true })
            .eq('workflow_id', workflowId).eq('estado', estado).gte('recibido_at', haceMs(60_000));
        if (error) throw error;
        if ((count ?? 0) > 0) return;
        const { error: insErr } = await db.from('webhook_recepciones').insert({
            organization_id: org, workflow_id: workflowId, estado, motivo,
            evento_id: eventoId, execution_run_id: runId,
        });
        if (insErr) throw insErr;
    } catch (e) {
        console.error(`webhook-in: no se pudo registrar «${estado}» del flujo ${workflowId}: ${(e as { message?: string }).message}`);
    }
}

async function buscarPrevia(db: SupabaseClient, workflowId: string, eventoId: string): Promise<{ execution_run_id: string | null } | null> {
    const { data, error } = await db.from('webhook_recepciones')
        .select('execution_run_id')
        .eq('workflow_id', workflowId).eq('evento_id', eventoId).in('estado', ESTADOS_ACEPTADOS)
        .maybeSingle();
    if (error) throw new Error(`No se pudo comprobar si la llamada estaba repetida: ${error.message}`);
    return data;
}

async function responderDuplicada(
    db: SupabaseClient, org: string, workflowId: string, eventoId: string, runId: string | null,
): Promise<Response> {
    await registrarLimitado(db, org, workflowId, 'duplicada',
        `Llamada repetida con Idempotency-Key «${eventoId}»: no se vuelve a ejecutar.`, eventoId, runId);
    return json(200, { duplicada: true, execution_run_id: runId });
}

// ── Aviso a los administradores: uno por flujo y hora ───────────────────────
// El turno se toma con un UPDATE condicional: si dos fallos llegan a la vez,
// solo uno devuelve fila y solo ese manda el correo.
async function avisarFallo(
    db: SupabaseClient, p: { workflowId: string; organizationId: string; nombreFlujo: string }, motivo: string,
): Promise<void> {
    try {
        const { data: turno, error } = await db.from('workflow_webhooks')
            .update({ ultimo_aviso_fallo_at: new Date().toISOString() })
            .eq('workflow_id', p.workflowId)
            .or(`ultimo_aviso_fallo_at.is.null,ultimo_aviso_fallo_at.lt."${haceMs(3_600_000)}"`)
            .select('workflow_id');
        if (error) throw error;
        if (!turno || turno.length === 0) return;   // ya se avisó en la última hora

        const admins = await destinatariosDelRol(db, p.organizationId, 'admin');
        const emails = admins.map(a => a.email).filter(Boolean);
        if (emails.length === 0) {
            console.error(`webhook-in: fallo al lanzar «${p.nombreFlujo}» y no hay administradores activos a quien avisar`);
            return;
        }
        await enviarEmail(
            emails,
            `⚠️ Webhook recibido pero el flujo no arrancó — ${p.nombreFlujo}`,
            `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#b45309;font-size:18px">Una llamada al webhook no pudo lanzar el flujo</h2>
  <p style="color:#374151;font-size:14px">
    <strong>Flujo:</strong> ${escaparHtml(p.nombreFlujo)}<br>
    <strong>Hora:</strong> ${escaparHtml(fechaHoraVE(new Date()))} (hora de Venezuela)
  </p>
  <p style="color:#374151;font-size:14px"><strong>Motivo:</strong> ${escaparHtml(motivo)}</p>
  <p style="color:#6b7280;font-size:13px">La llamada quedó guardada con sus datos, en estado «Falló al lanzar»,
  en el panel del nodo Webhook del Constructor. Se envía como máximo un aviso por flujo y hora.</p>
</div>`,
        );
    } catch (e) {
        console.error(`webhook-in: no se pudo avisar del fallo de «${p.nombreFlujo}»: ${(e as { message?: string }).message}`);
    }
}

// ── Lanzar el motor (en segundo plano, tras responder 202) ──────────────────
async function lanzar(
    db: SupabaseClient,
    p: { recepcionId: string; workflowId: string; organizationId: string; nombreFlujo: string },
): Promise<void> {
    let motivo: string | null = null;

    if (CRON_SECRET === '') {
        motivo = 'CRON_SECRET no está configurado en webhook-in: la llamada se recibió pero no se pudo lanzar el flujo.';
    } else {
        try {
            const { error } = await db.functions.invoke('execute-workflow', {
                headers: { 'x-cron-secret': CRON_SECRET },
                body: {
                    workflowId:     p.workflowId,
                    organizationId: p.organizationId,   // de la fila del flujo, nunca del cuerpo recibido
                    triggeredBy:    'webhook',
                    recepcionId:    p.recepcionId,
                },
            });
            if (error) {
                // `error.message` es siempre «non-2xx status code»: el motivo va en el cuerpo (§12.2).
                motivo = error.message;
                const ctx = (error as unknown as { context?: Response }).context;
                if (ctx && typeof ctx.text === 'function') {
                    try { motivo = motivoDeCuerpo(ctx.status, await ctx.text()); } catch { /* cuerpo ya consumido */ }
                }
            }
        } catch (e) {
            motivo = `No se pudo llamar al motor: ${(e as { message?: string }).message}`;
        }
    }

    if (motivo === null) return;   // el motor respondió 2xx: lo que pase después está en el run
    console.error(`webhook-in: fallo al lanzar la recepción ${p.recepcionId} — ${motivo}`);

    // Solo si sigue en 'aceptada'. Si el motor ya la ancló ('lanzada'), el fallo
    // pertenece al run y se ve en Monitoreo: no se pisa ni se avisa dos veces.
    const { data: cambiadas, error } = await db.from('webhook_recepciones')
        .update({ estado: 'fallo_al_lanzar', motivo })
        .eq('id', p.recepcionId).eq('estado', 'aceptada')
        .select('id');
    if (error) {
        console.error(`webhook-in: no se pudo marcar la recepción ${p.recepcionId} como fallida: ${error.message}`);
    } else if (!cambiadas || cambiadas.length === 0) {
        return;
    }
    await avisarFallo(db, p, motivo);
}

serve(async (req: Request) => {
    try {
        const url        = new URL(req.url);
        const workflowId = extraerIdFlujo(url.pathname);
        if (!workflowId) return noAutorizado();

        // Tope antes de leer: una cabecera honesta nos ahorra cargar el cuerpo.
        const declarado = Number(req.headers.get('content-length') ?? '0');
        if (req.method === 'POST' && Number.isFinite(declarado) && declarado > MAX_BYTES) {
            return json(413, { error: `El cuerpo supera el máximo de ${MAX_BYTES / 1024} KB.` });
        }

        // ── 1. Forma de la llamada (no se registra) ─────────────────────────
        const cuerpo  = new Uint8Array(await req.arrayBuffer());
        const entrada = validarEntrada(req.method, req.headers.get('content-type'), cuerpo);
        if (!entrada.ok) return json(entrada.status, { error: entrada.error });

        const clave = validarIdempotencyKey(req.headers.get('idempotency-key'));
        if (!clave.ok) return json(clave.status, { error: clave.error });

        const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

        // ── 2. Autenticación (no se registra: solo console.warn, sin el secreto)
        const { data: hook, error: hookErr } = await db.from('workflow_webhooks')
            .select('workflow_id, organization_id, secreto_hash, permite_secreto_url')
            .eq('workflow_id', workflowId)
            .maybeSingle();
        if (hookErr) {
            console.error(`webhook-in: no se pudo leer workflow_webhooks: ${hookErr.message}`);
            return json(500, { error: 'No se pudo comprobar la llamada. Inténtalo más tarde.' });
        }

        const secreto = elegirSecreto(
            req.headers.get('x-webhook-secret'),
            url.searchParams.get('secreto'),
            hook?.permite_secreto_url === true,
        );
        // Siempre se calcula y se compara, exista o no el flujo.
        const huella = await sha256Hex(secreto ?? '');
        const casa   = igualesTiempoConstante(huella, (hook?.secreto_hash as string | undefined) ?? HUELLA_NULA);
        if (!hook || secreto === null || !casa) {
            console.warn(`webhook-in: llamada no autorizada al flujo ${workflowId} (${hook ? 'secreto ausente o erróneo' : 'sin webhook'})`);
            return noAutorizado();
        }
        const org = hook.organization_id as string;

        // ── 3. ¿El flujo puede recibir? ─────────────────────────────────────
        const { data: wf, error: wfErr } = await db.from('workflows')
            .select('name, organization_id, estado_definicion, is_active')
            .eq('id', workflowId)
            .maybeSingle();
        if (wfErr) throw new Error(`No se pudo leer el flujo: ${wfErr.message}`);

        const { count: disparadores, error: trigErr } = await db.from('workflow_nodes')
            .select('id', { count: 'exact', head: true })
            .eq('workflow_id', workflowId).eq('type', 'trigger').eq('category', 'webhook');
        if (trigErr) throw new Error(`No se pudieron leer los nodos del flujo: ${trigErr.message}`);

        const nombreFlujo = (wf?.name as string | undefined) ?? workflowId;
        let noApto: string | null = null;
        if (!wf || wf.organization_id !== org) {
            noApto = 'El flujo ya no existe.';
        } else if (wf.estado_definicion !== 'publicado') {
            noApto = `El flujo «${nombreFlujo}» no está publicado (está en ${wf.estado_definicion}): tiene que pasar por revisión antes de aceptar llamadas.`;
        } else if (!wf.is_active) {
            noApto = `El flujo «${nombreFlujo}» está desactivado.`;
        } else if (!disparadores) {
            noApto = `El flujo «${nombreFlujo}» no tiene un nodo «Webhook Entrante»: no sabría por dónde empezar.`;
        }
        if (noApto) {
            await registrarLimitado(db, org, workflowId, 'rechazada_inactivo', noApto, clave.valor, null);
            return json(409, { error: noApto });
        }

        // ── 4. Límite por minuto ────────────────────────────────────────────
        const { count: recientes, error: limErr } = await db.from('webhook_recepciones')
            .select('id', { count: 'exact', head: true })
            .eq('workflow_id', workflowId).in('estado', ESTADOS_ACEPTADOS).gte('recibido_at', haceMs(60_000));
        if (limErr) throw new Error(`No se pudo contar las llamadas recientes: ${limErr.message}`);
        if ((recientes ?? 0) >= LIMITE_POR_MINUTO) {
            const m = `Más de ${LIMITE_POR_MINUTO} llamadas a este flujo en el último minuto. Espera un momento.`;
            await registrarLimitado(db, org, workflowId, 'frenada_limite', m, clave.valor, null);
            return json(429, { error: m }, { 'Retry-After': '60' });
        }

        // ── 5. ¿Repetida? ───────────────────────────────────────────────────
        if (clave.valor) {
            const previa = await buscarPrevia(db, workflowId, clave.valor);
            if (previa) return await responderDuplicada(db, org, workflowId, clave.valor, previa.execution_run_id);
        }

        // ── 6. Aceptar ──────────────────────────────────────────────────────
        const { data: nueva, error: insErr } = await db.from('webhook_recepciones')
            .insert({
                organization_id: org,
                workflow_id:     workflowId,
                evento_id:       clave.valor,
                estado:          'aceptada',
                payload:         entrada.valor,
                bytes:           cuerpo.byteLength,
            })
            .select('id')
            .single();
        if (insErr) {
            // Dos llamadas iguales a la vez: la base decidió; la segunda es duplicada.
            if (insErr.code === '23505' && clave.valor) {
                const previa = await buscarPrevia(db, workflowId, clave.valor);
                return await responderDuplicada(db, org, workflowId, clave.valor, previa?.execution_run_id ?? null);
            }
            throw new Error(`No se pudo registrar la llamada: ${insErr.message}`);
        }

        EdgeRuntime.waitUntil(lanzar(db, {
            recepcionId: nueva.id as string, workflowId, organizationId: org, nombreFlujo,
        }));
        return json(202, { recibido: true, recepcion_id: nueva.id });
    } catch (e) {
        console.error(`webhook-in: ${(e as { message?: string }).message}`);
        return json(500, { error: 'No se pudo procesar la llamada. Inténtalo más tarde.' });
    }
});
```

- [ ] **Step 2: Comprobar tipos de Deno (si está disponible)**

Run: `npx --yes deno@2 check supabase/functions/webhook-in/index.ts`
Expected: sin errores. Si `npx deno` no está disponible, anotarlo (queda el sondeo de la Tarea 6).

- [ ] **Step 3: Revisar a mano los tres invariantes de la puerta**

Run: `grep -n "secreto" supabase/functions/webhook-in/index.ts | grep -n "console"`
Expected: ninguna línea de `console.*` imprime la variable `secreto` ni `huella` (solo el texto «secreto ausente o erróneo»).

Run: `grep -n "Access-Control" supabase/functions/webhook-in/index.ts`
Expected: vacío (sin CORS, a propósito).

Run: `grep -n "cron-runner" supabase/functions/webhook-in/index.ts`
Expected: vacío.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/webhook-in/index.ts
```
```bash
git commit -m "feat(webhook): la puerta webhook-in — autenticación, límites, duplicados, lanzamiento y aviso de fallo"
```

---

### Task 5: Constructor — sección «Entrada por webhook»

**Files:**
- Create: `src/types/webhook.ts`
- Create: `src/utils/webhook.ts`
- Test: `src/utils/webhook.test.ts`
- Create: `src/services/webhook.service.ts`
- Create: `src/components/WebhookSection.tsx`
- Modify: `src/components/NodeConfigPanel.tsx` (Props l.11–17; EmailForm l.385–387; ReporteGerencialForm l.752–754; FORM_MAP l.1213; componente l.1300 y l.1360)
- Modify: `src/components/WorkflowCanvas.tsx:1287-1293`

**Interfaces:**
- Consumes: Tarea 2 (`workflow_webhooks` sin `secreto_hash`, `webhook_recepciones`, las dos RPCs). `rolesQuePueden(permiso)`, `mensajeDeRpc(err, que)` de `utils/errores`; `fechaHoraVE(valor)` de `utils/fecha`; `showSuccess`, `showError` de `utils/toast`.
- Produces:
  - `type EstadoRecepcion = 'aceptada' | 'lanzada' | 'fallo_al_lanzar' | 'rechazada_inactivo' | 'frenada_limite' | 'duplicada'`
  - `interface WebhookConfig { permiteSecretoUrl: boolean; generadoEmail: string | null; generadoAt: string }`
  - `interface RecepcionWebhook { id: string; recibidoAt: string; estado: EstadoRecepcion; motivo: string | null; eventoId: string | null; executionRunId: string | null }`
  - `etiquetaRecepcion(estado, recibidoAt, ahora?): { texto: string; tono: 'verde' | 'ambar' | 'rojo' | 'gris' }`
  - `ejemploCurl(url: string): string`
  - `WebhookService.urlDelFlujo / getConfig / generarSecreto / configurarUrl / ultimasRecepciones`
  - `<WebhookSection workflowId organizationId puedeEditar />`

- [ ] **Step 1: Tipos**

Crear `src/types/webhook.ts`:

```ts
// Webhook de entrada — ver docs/superpowers/specs/2026-09-28-webhook-entrada-design.md

export type EstadoRecepcion =
    | 'aceptada'
    | 'lanzada'
    | 'fallo_al_lanzar'
    | 'rechazada_inactivo'
    | 'frenada_limite'
    | 'duplicada';

/** Lo que la organización puede leer de `workflow_webhooks` (nunca la huella). */
export interface WebhookConfig {
    permiteSecretoUrl: boolean;
    generadoEmail:     string | null;
    generadoAt:        string;
}

export interface RecepcionWebhook {
    id:             string;
    recibidoAt:     string;
    estado:         EstadoRecepcion;
    motivo:         string | null;
    eventoId:       string | null;
    executionRunId: string | null;
}
```

- [ ] **Step 2: Tests de las piezas puras del frontend (fallan)**

Crear `src/utils/webhook.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { etiquetaRecepcion, ejemploCurl, MINUTOS_SIN_CONFIRMAR } from './webhook';

const AHORA = new Date('2026-09-28T15:00:00Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

describe('etiquetaRecepcion', () => {
    it('una aceptada reciente está «Recibida»', () => {
        expect(etiquetaRecepcion('aceptada', hace(1), AHORA)).toEqual({ texto: 'Recibida', tono: 'gris' });
    });
    it(`una aceptada de más de ${MINUTOS_SIN_CONFIRMAR} min está «Sin confirmar»`, () => {
        expect(etiquetaRecepcion('aceptada', hace(MINUTOS_SIN_CONFIRMAR + 1), AHORA)).toEqual({ texto: 'Sin confirmar', tono: 'ambar' });
    });
    it('el resto de estados', () => {
        expect(etiquetaRecepcion('lanzada', hace(60), AHORA).tono).toBe('verde');
        expect(etiquetaRecepcion('fallo_al_lanzar', hace(1), AHORA).tono).toBe('rojo');
        expect(etiquetaRecepcion('rechazada_inactivo', hace(1), AHORA).tono).toBe('ambar');
        expect(etiquetaRecepcion('frenada_limite', hace(1), AHORA).tono).toBe('ambar');
        expect(etiquetaRecepcion('duplicada', hace(1), AHORA).tono).toBe('gris');
    });
});

describe('ejemploCurl', () => {
    it('lleva la dirección, las dos cabeceras y un cuerpo JSON', () => {
        const c = ejemploCurl('https://x.supabase.co/functions/v1/webhook-in/abc');
        expect(c).toContain("'https://x.supabase.co/functions/v1/webhook-in/abc'");
        expect(c).toContain('x-webhook-secret: hfw_');
        expect(c).toContain('Idempotency-Key:');
        expect(c).toContain('Content-Type: application/json');
    });
});
```

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./webhook"`.

- [ ] **Step 3: Implementar las piezas puras**

Crear `src/utils/webhook.ts`:

```ts
import type { EstadoRecepcion } from '../types/webhook';

/** Una recepción 'aceptada' que el motor no ha anclado en este tiempo se enseña, no se calla. */
export const MINUTOS_SIN_CONFIRMAR = 5;

export type TonoRecepcion = 'verde' | 'ambar' | 'rojo' | 'gris';

export function etiquetaRecepcion(
    estado: EstadoRecepcion,
    recibidoAt: string,
    ahora: Date = new Date(),
): { texto: string; tono: TonoRecepcion } {
    switch (estado) {
        case 'lanzada':            return { texto: 'Lanzada', tono: 'verde' };
        case 'aceptada':
            return ahora.getTime() - new Date(recibidoAt).getTime() > MINUTOS_SIN_CONFIRMAR * 60_000
                ? { texto: 'Sin confirmar', tono: 'ambar' }
                : { texto: 'Recibida', tono: 'gris' };
        case 'fallo_al_lanzar':    return { texto: 'Falló al lanzar', tono: 'rojo' };
        case 'rechazada_inactivo': return { texto: 'Rechazada: flujo no apto', tono: 'ambar' };
        case 'frenada_limite':     return { texto: 'Frenada por límite', tono: 'ambar' };
        case 'duplicada':          return { texto: 'Duplicada', tono: 'gris' };
    }
}

export function ejemploCurl(url: string): string {
    return [
        `curl -X POST '${url}' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -H 'x-webhook-secret: hfw_TU_SECRETO' \\`,
        `  -H 'Idempotency-Key: pedido-12345' \\`,
        `  -d '{"nombre":"Ana Pérez","email":"ana@ejemplo.com"}'`,
    ].join('\n');
}
```

Run: `npm test`
Expected: PASS (los de la Tarea 1 y estos).

- [ ] **Step 4: Servicio**

Crear `src/services/webhook.service.ts`:

```ts
import { supabase } from '../core/supabase.ts';
import { mensajeDeRpc } from '../utils/errores.ts';
import type { WebhookConfig, RecepcionWebhook, EstadoRecepcion } from '../types/webhook.ts';

export class WebhookService {
    static urlDelFlujo(workflowId: string): string {
        return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhook-in/${workflowId}`;
    }

    static async getConfig(workflowId: string, organizationId: string): Promise<WebhookConfig | null> {
        // Columnas explícitas, NUNCA '*': secreto_hash no tiene GRANT de lectura
        // y un select('*') reventaría con «permission denied».
        const { data, error } = await supabase
            .from('workflow_webhooks')
            .select('permite_secreto_url, generado_email, generado_at')
            .eq('workflow_id', workflowId)
            .eq('organization_id', organizationId)
            .maybeSingle();
        if (error) throw new Error(`No se pudo leer la configuración del webhook: ${error.message}`);
        if (!data) return null;
        return {
            permiteSecretoUrl: data.permite_secreto_url as boolean,
            generadoEmail:     (data.generado_email as string | null) ?? null,
            generadoAt:        data.generado_at as string,
        };
    }

    /** Devuelve el secreto EN CLARO. Es la única vez que existe fuera de quien lo recibe. */
    static async generarSecreto(workflowId: string): Promise<string> {
        const { data, error } = await supabase.rpc('generar_secreto_webhook', { p_workflow_id: workflowId });
        if (error) throw new Error(mensajeDeRpc(error, 'los datos del webhook'));
        if (typeof data !== 'string' || !data.startsWith('hfw_')) {
            throw new Error('Se generó un secreto nuevo pero no llegó bien a la pantalla. El anterior ya no vale: vuelve a pulsar «Rotar secreto».');
        }
        return data;
    }

    static async configurarUrl(workflowId: string, permitir: boolean): Promise<void> {
        const { error } = await supabase.rpc('configurar_webhook_url', { p_workflow_id: workflowId, p_permitir: permitir });
        if (error) throw new Error(mensajeDeRpc(error, 'los datos del webhook'));
    }

    static async ultimasRecepciones(workflowId: string, organizationId: string, limite = 10): Promise<RecepcionWebhook[]> {
        const { data, error } = await supabase
            .from('webhook_recepciones')
            .select('id, recibido_at, estado, motivo, evento_id, execution_run_id')
            .eq('workflow_id', workflowId)
            .eq('organization_id', organizationId)
            .order('recibido_at', { ascending: false })
            .limit(limite);
        if (error) throw new Error(`No se pudieron leer las últimas llamadas: ${error.message}`);
        return (data ?? []).map(r => ({
            id:             r.id as string,
            recibidoAt:     r.recibido_at as string,
            estado:         r.estado as EstadoRecepcion,
            motivo:         (r.motivo as string | null) ?? null,
            eventoId:       (r.evento_id as string | null) ?? null,
            executionRunId: (r.execution_run_id as string | null) ?? null,
        }));
    }
}
```

- [ ] **Step 5: Componente**

Crear `src/components/WebhookSection.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, RefreshCw, AlertTriangle, Lock } from 'lucide-react';
import { WebhookService } from '../services/webhook.service';
import type { WebhookConfig, RecepcionWebhook } from '../types/webhook';
import { etiquetaRecepcion, ejemploCurl, type TonoRecepcion } from '../utils/webhook';
import { fechaHoraVE } from '../utils/fecha';
import { rolesQuePueden } from '../utils/errores';
import { showError, showSuccess } from '../utils/toast';

interface Props {
    workflowId:     string | null;
    organizationId: string;
    puedeEditar:    boolean;
}

const TONO: Record<TonoRecepcion, string> = {
    verde: 'bg-green-100 text-green-700',
    ambar: 'bg-amber-100 text-amber-800',
    rojo:  'bg-red-100 text-red-700',
    gris:  'bg-gray-100 text-gray-600',
};

async function copiar(texto: string, que: string) {
    try {
        await navigator.clipboard.writeText(texto);
        showSuccess(`${que} copiado`);
    } catch {
        showError(`No se pudo copiar: selecciona el texto y cópialo a mano.`);
    }
}

export default function WebhookSection({ workflowId, organizationId, puedeEditar }: Props) {
    const [config, setConfig]           = useState<WebhookConfig | null>(null);
    const [recepciones, setRecepciones] = useState<RecepcionWebhook[]>([]);
    const [cargando, setCargando]       = useState(true);
    const [errorCarga, setErrorCarga]   = useState<string | null>(null);
    const [ocupado, setOcupado]         = useState(false);
    const [secretoNuevo, setSecretoNuevo] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        if (!workflowId) return;
        setCargando(true);
        setErrorCarga(null);
        try {
            const [c, r] = await Promise.all([
                WebhookService.getConfig(workflowId, organizationId),
                WebhookService.ultimasRecepciones(workflowId, organizationId),
            ]);
            setConfig(c);
            setRecepciones(r);
        } catch (e) {
            setErrorCarga((e as Error).message);
        } finally {
            setCargando(false);
        }
    }, [workflowId, organizationId]);

    useEffect(() => { void cargar(); }, [cargar]);

    if (!workflowId) {
        return (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600">
                Primero hay que guardar el flujo: el secreto del webhook se genera para un flujo que ya existe.
            </div>
        );
    }

    const url = WebhookService.urlDelFlujo(workflowId);

    const generar = async () => {
        if (config && !window.confirm(
            'Rotar el secreto invalida el actual EN EL ACTO: el sistema que llama dejará de funcionar ' +
            'hasta que le pongas el nuevo. ¿Seguir?')) return;
        setOcupado(true);
        try {
            setSecretoNuevo(await WebhookService.generarSecreto(workflowId));
            await cargar();
        } catch (e) {
            showError((e as Error).message);
        } finally {
            setOcupado(false);
        }
    };

    const cambiarUrl = async (permitir: boolean) => {
        if (permitir && !window.confirm(
            'Con esto el secreto podrá ir en la dirección (?secreto=…). Las direcciones quedan en historiales, ' +
            'registros de servidores y proxys del sistema que llama. Úsalo solo si ese sistema no permite ' +
            'poner cabeceras. ¿Permitirlo?')) return;
        setOcupado(true);
        try {
            await WebhookService.configurarUrl(workflowId, permitir);
            await cargar();
            showSuccess(permitir ? 'Secreto en la URL permitido' : 'Secreto en la URL retirado');
        } catch (e) {
            showError((e as Error).message);
        } finally {
            setOcupado(false);
        }
    };

    const ambar = config?.permiteSecretoUrl === true;

    return (
        <div className={`mt-2 rounded-xl border p-4 space-y-4 ${ambar ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-800">Entrada por webhook</h3>
                {!puedeEditar && (
                    <span className="flex items-center gap-1 text-[10px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">
                        <Lock className="w-3 h-3" /> Solo lectura
                    </span>
                )}
            </div>

            {/* 1. Dirección */}
            <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Dirección del flujo</label>
                <div className="flex gap-2">
                    <code className="flex-1 text-[11px] bg-gray-100 rounded px-2 py-1.5 break-all">{url}</code>
                    <button onClick={() => copiar(url, 'Dirección')} className="px-2 text-gray-500 hover:text-gray-800" title="Copiar">
                        <Copy className="w-4 h-4" />
                    </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Solo acepta llamadas si el flujo está <strong>publicado y activo</strong>.</p>
            </div>

            {/* 2. Estado */}
            {cargando ? (
                <p className="text-xs text-gray-400">Cargando…</p>
            ) : errorCarga ? (
                <p className="text-xs text-red-600">{errorCarga}</p>
            ) : config ? (
                <p className="text-xs text-green-700">
                    Activo · generado por {config.generadoEmail ?? 'alguien'} el {fechaHoraVE(config.generadoAt)} (hora de Venezuela)
                </p>
            ) : (
                <p className="text-xs text-gray-600">Sin secreto — el flujo no acepta llamadas.</p>
            )}

            {/* 3. Generar / rotar */}
            {puedeEditar ? (
                <button
                    onClick={generar}
                    disabled={ocupado || cargando}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                    {config ? <RefreshCw className="w-3.5 h-3.5" /> : <KeyRound className="w-3.5 h-3.5" />}
                    {config ? 'Rotar secreto' : 'Generar secreto'}
                </button>
            ) : (
                <p className="text-[11px] text-gray-500">
                    Generar o rotar el secreto es de {rolesQuePueden('manage_workflows')}.
                </p>
            )}

            {/* 4. Secreto en la URL */}
            {config && (
                <label className={`flex items-start gap-2 text-xs ${puedeEditar ? 'cursor-pointer' : 'opacity-60'}`}>
                    <input
                        type="checkbox"
                        checked={config.permiteSecretoUrl}
                        disabled={!puedeEditar || ocupado}
                        onChange={e => cambiarUrl(e.target.checked)}
                        className="mt-0.5"
                    />
                    <span>
                        Permitir el secreto en la URL (<code>?secreto=…</code>)
                        {ambar && (
                            <span className="flex items-center gap-1 text-amber-800 mt-1">
                                <AlertTriangle className="w-3.5 h-3.5" /> Encendido: la dirección con el secreto puede quedar en registros ajenos.
                            </span>
                        )}
                    </span>
                </label>
            )}

            {/* 5. Ejemplo */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-600">Ejemplo de llamada</label>
                    <button onClick={() => copiar(ejemploCurl(url), 'Ejemplo')} className="text-gray-500 hover:text-gray-800" title="Copiar">
                        <Copy className="w-3.5 h-3.5" />
                    </button>
                </div>
                <pre className="text-[10px] bg-gray-900 text-gray-100 rounded p-2 overflow-x-auto whitespace-pre">{ejemploCurl(url)}</pre>
                <p className="text-[11px] text-gray-500 mt-1">
                    Manda siempre <code>Idempotency-Key</code> con un valor único por evento: si la llamada se repite, el flujo no se ejecuta dos veces.
                    En los nodos siguientes, lo enviado se usa como <code>{'{{webhook.nombre}}'}</code>.
                </p>
            </div>

            {/* 6. Últimas llamadas */}
            <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Últimas llamadas</label>
                {recepciones.length === 0 ? (
                    <p className="text-[11px] text-gray-400">Ninguna todavía.</p>
                ) : (
                    <ul className="space-y-1">
                        {recepciones.map(r => {
                            const et = etiquetaRecepcion(r.estado, r.recibidoAt);
                            return (
                                <li key={r.id} className="text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                    <span className="text-gray-500">{fechaHoraVE(r.recibidoAt)}</span>
                                    <span className={`px-1.5 py-0.5 rounded-full ${TONO[et.tono]}`}>{et.texto}</span>
                                    {r.executionRunId && (
                                        <span className="text-gray-500" title="Búscala en Monitoreo por este código">
                                            ejecución <code>{r.executionRunId.slice(0, 8)}</code>
                                        </span>
                                    )}
                                    {r.motivo && <span className="w-full text-gray-600">{r.motivo}</span>}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Ventana del secreto: se enseña UNA vez */}
            {secretoNuevo && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3">
                        <h4 className="font-bold text-gray-900 text-sm">Secreto del webhook</h4>
                        <p className="text-xs text-red-700 font-semibold">Guárdalo ahora; no se volverá a mostrar.</p>
                        <code className="block text-[11px] bg-gray-100 rounded px-2 py-2 break-all select-all">{secretoNuevo}</code>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => copiar(secretoNuevo, 'Secreto')} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50">
                                Copiar
                            </button>
                            <button onClick={() => setSecretoNuevo(null)} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                                Ya lo he guardado
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 6: `NodeConfigPanel` — props, formulario del nodo y avisos**

1. Import (tras la línea 9):

```tsx
import WebhookSection from './WebhookSection';
```

2. `Props` (l.11–17), añadir tres campos:

```tsx
interface Props {
    node:     WorkflowNodeData | null;
    prevNode: WorkflowNodeData | null;
    isOpen:   boolean;
    onClose:  () => void;
    onSave:   (nodeId: string, config: Record<string, any>) => void;
    workflowId:     string | null;
    organizationId: string;
    puedeEditar:    boolean;
}
```

3. Tras `ManualTriggerForm` (función que acaba hacia la l.325), añadir:

```tsx
function WebhookTriggerForm() {
    return (
        <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800 space-y-1.5">
            <p><Zap className="w-3.5 h-3.5 inline mr-1" />Este flujo arranca cuando otro sistema llama a su dirección con el secreto.</p>
            <p>Lo que envíe en el cuerpo JSON se usa en los nodos siguientes como <code>{'{{webhook.campo}}'}</code> — por ejemplo <code>{'{{webhook.cliente.nombre}}'}</code>.</p>
            <p>Son datos de fuera: en el cuerpo de un correo se escapan, y no entran en <code>{'{{previous.…}}'}</code> ni en <code>{'{{summary}}'}</code>.</p>
        </div>
    );
}

/** El destinatario lo decide quien tenga el secreto del webhook: se avisa. */
function AvisoDestinatarioWebhook({ to }: { to: unknown }) {
    if (!String(to ?? '').includes('{{webhook.')) return null;
    return (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
                El destinatario sale de los datos que manda el sistema externo: quien tenga el secreto del webhook decide
                a quién se envía este correo. Úsalo solo para responder a quien hizo la llamada (p. ej. confirmar un formulario).
            </span>
        </div>
    );
}
```

4. En `EmailForm`, tras el `</Field>` de «Para (destinatario)» (l.387):

```tsx
            <AvisoDestinatarioWebhook to={cfg.to} />
```

5. En `ReporteGerencialForm`, tras el `</Field>` de «Para (destinatario)» (l.754), la misma línea:

```tsx
            <AvisoDestinatarioWebhook to={cfg.to} />
```

6. En `FORM_MAP` (l.1213), tras `manual:`:

```tsx
    webhook: ()        => <WebhookTriggerForm />,
```

7. Firma del componente (l.1300):

```tsx
const NodeConfigPanel: React.FC<Props> = ({ node, prevNode, isOpen, onClose, onSave, workflowId, organizationId, puedeEditar }) => {
```

8. Tras `{formNode}` (l.1360):

```tsx
                    {node.type === 'trigger' && node.category === 'webhook' && (
                        <WebhookSection workflowId={workflowId} organizationId={organizationId} puedeEditar={puedeEditar} />
                    )}
```

- [ ] **Step 7: `WorkflowCanvas` — pasar las props**

En `src/components/WorkflowCanvas.tsx` l.1287–1293:

```tsx
            <NodeConfigPanel
                node={nodeToConfig}
                prevNode={prevNodeToConfig}
                isOpen={configPanelOpen}
                onClose={() => { setConfigPanelOpen(false); setNodeToConfig(null); setPrevNodeToConfig(null); }}
                onSave={handleSaveNodeConfig}
                workflowId={activeWorkflowId}
                organizationId={currentUser.organizationId}
                puedeEditar={puedeEditar}
            />
```

- [ ] **Step 8: Tipos, tests y build**

Run: `npm run typecheck`
Expected: sale con 0 y sin líneas de error.

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: build correcto.

- [ ] **Step 9: Commit**

```bash
git add src/types/webhook.ts src/utils/webhook.ts src/utils/webhook.test.ts src/services/webhook.service.ts src/components/WebhookSection.tsx src/components/NodeConfigPanel.tsx src/components/WorkflowCanvas.tsx
```
```bash
git commit -m "feat(constructor): sección «Entrada por webhook» — dirección, secreto de una vez, secreto en URL, últimas llamadas"
```

---

### Task 6: Despliegue, prueba de extremo a extremo y documentación

**Files:**
- Modify: `database/schema.sql` (regenerado, no a mano)
- Modify: `CLAUDE.md` (§4 árbol, nueva §8.3)
- Modify: `docs/superpowers/specs/2026-09-28-webhook-entrada-design.md` (estado → implementado)

**Interfaces:**
- Consumes: todo lo anterior, desplegado.
- Produces: el sistema en producción y documentado.

- [ ] **Step 1: Hermes aplica la migración** (SQL Editor, fichero entero `database/migrations/20260928_webhook_entrada.sql`). Comprobar después, por lectura:

```bash
supabase db query --linked "select (select count(*) from pg_tables where schemaname='public' and tablename in ('workflow_webhooks','webhook_recepciones')) as tablas, (select count(*) from cron.job where jobname='purgar-webhook-recepciones') as job, has_function_privilege('anon','public.generar_secreto_webhook(uuid)','EXECUTE') as anon_ejecuta"
```
Expected: `tablas: 2, job: 1, anon_ejecuta: false`.

- [ ] **Step 2: Hermes despliega el motor y se sondea**

```
supabase functions deploy execute-workflow --no-verify-jwt
curl -s -X POST "https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/execute-workflow" -H "Content-Type: application/json" -d "{}"
```
Expected: `{"error":"workflowId y organizationId son requeridos"}`. Si sale `UNAUTHORIZED_NO_AUTH_HEADER`, se olvidó `--no-verify-jwt`: redesplegar con la bandera **ya** (el cron está roto mientras tanto).

- [ ] **Step 3: Hermes despliega la puerta y se sondea**

```
supabase functions deploy webhook-in --no-verify-jwt
curl -s -X POST "https://kbscaxcokxwdbnrltkup.supabase.co/functions/v1/webhook-in/00000000-0000-4000-8000-000000000000" -H "Content-Type: application/json" -d "{}"
```
Expected: `{"error":"No autorizado"}` — **no** `UNAUTHORIZED_NO_AUTH_HEADER`.

- [ ] **Step 4: Hermes hace push del frontend** (`git push`; Netlify despliega desde `main`).

- [ ] **Step 5: Prueba de extremo a extremo** con un flujo de prueba `Webhook Entrante → Email` (Para: la cuenta de Hermes; Asunto: `Prueba {{webhook.nombre}}`; Cuerpo: `<p>Hola {{webhook.nombre}}</p>`), enviado a revisión, autorizado desde otra cuenta, publicado y activado; secreto generado desde el panel. En cada llamada, `SECRETO` es el valor copiado de la ventana (Hermes lo pone en su terminal; **no se pega en el chat**) y `URL` la dirección del panel.

| # | Llamada | Esperado |
|---|---|---|
| 1 | `curl -s -X POST "$URL" -H "Content-Type: application/json" -H "x-webhook-secret: $SECRETO" -H "Idempotency-Key: prueba-1" -d '{"nombre":"Ana"}'` | 202 `{"recibido":true,…}`; llega «Prueba Ana»; en el panel, «Lanzada» con código de ejecución |
| 2 | La misma otra vez | 200 `{"duplicada":true,"execution_run_id":"…"}` con el mismo código; **sin** segundo correo |
| 3 | Con `x-webhook-secret: hfw_malo` | 401 `{"error":"No autorizado"}`; **cero** filas nuevas en el panel |
| 4 | Sin cabecera y con `"$URL?secreto=$SECRETO"`, interruptor apagado → luego encendido | 401 → 202 |
| 5 | Desactivar el flujo y repetir la 1 con otra clave | 409 con motivo; «Rechazada: flujo no apto» en el panel |
| 6 | `-d '{"nombre":"<b>x</b> {{summary}}"}'` (clave nueva) | El correo muestra `<b>x</b> {{summary}}` **literal** |
| 7 | Cuerpo de 300 KB | 413 |
| 8 | Desde la consola del navegador, con sesión: `supabase.functions.invoke('execute-workflow',{body:{workflowId:…,organizationId:…,triggeredBy:'webhook',recepcionId:'<id de la 1>'}})` | 400 «Una ejecución por webhook solo la lanza la puerta…» |
| 9 | Pulsar **Ejecutar** en el Constructor sobre el flujo de prueba | El run acaba en error con «Este flujo arranca con una llamada a su webhook…»; **no** sale correo |
| 10 | `-d '{"x":"a\u0000b"}'` | 400 «…carácter nulo…» |

Comprobar además, por lectura, que el payload **no** está en `context_json`:

```bash
supabase db query --linked "select context_json::text like '%Ana%' as payload_en_contexto from execution_runs where triggered_by='webhook' order by started_at desc limit 1"
```
Expected: `false`.

- [ ] **Step 6: Regenerar `schema.sql`** (Docker en marcha, §5.1):

```
supabase link --project-ref kbscaxcokxwdbnrltkup
supabase db dump --linked --schema public --keep-comments -f database/schema.sql
```
Expected: el fichero contiene `workflow_webhooks`, `webhook_recepciones` y las dos funciones.

- [ ] **Step 7: CLAUDE.md**

1. En el árbol de §4, tras la línea de `vigilante-reloj/`:

```
│       ├── webhook-in/              ← PÚBLICA: puerta del webhook de entrada (§8.3)
```

2. Nueva sección tras §8.2:

```markdown
### 8.3 Webhook de entrada — `webhook-in` (desde el DD/MM/2026)

Cualquier sistema arranca un flujo con `POST /functions/v1/webhook-in/<workflow_id>`
y la cabecera `x-webhook-secret`. Diseño y motivos:
`docs/superpowers/specs/2026-09-28-webhook-entrada-design.md`.

- **El secreto no se guarda**: `workflow_webhooks.secreto_hash` es su SHA-256, y
  la organización no puede ni leer esa columna. Lo genera
  `generar_secreto_webhook()` (DEFINER, roles de `manage_workflows` **copiados**:
  si cambia `ROLE_PERMISSIONS`, cambia la RPC y `configurar_webhook_url`).
- **La puerta no ejecuta nada**: registra en `webhook_recepciones` y pasa al motor
  **solo el id** por `x-cron-secret`. El motor ancla la recepción
  (`aceptada → lanzada`) y lee el payload en el mismo UPDATE.
- **`context.__webhook` es NO enumerable**, a propósito: así no lo ven
  `{{previous.…}}`, `{{summary}}`, el prompt del agente IA ni el `context_json` de
  una pausa. Al reanudar se recarga de la recepción. **No lo conviertas en una
  propiedad normal** «para simplificar»: los datos externos acabarían en
  Anthropic y guardados dos veces.
- **Un flujo con disparador Webhook no se ejecuta a mano ni con Reintentar**: el
  nodo revienta sin datos. Relanzar una llamada es la entrega 2 (cola).
- ⚠️ `webhook-in` y `execute-workflow` se despliegan **con `--no-verify-jwt`**
  (§6.1). El sondeo correcto de `webhook-in` devuelve `{"error":"No autorizado"}`.
- Retención 90 días (`purgar-webhook-recepciones`). **El vigilante no lo mira.**
```

- [ ] **Step 8: Spec → implementado**

En la línea 4 de la spec: `**Estado:** implementado y desplegado el DD/MM/2026 (plan: docs/superpowers/plans/2026-09-28-webhook-entrada.md)`.

- [ ] **Step 9: Commit**

```bash
git add database/schema.sql CLAUDE.md docs/superpowers/specs/2026-09-28-webhook-entrada-design.md
```
```bash
git commit -m "docs(webhook): schema.sql regenerado, CLAUDE.md §8.3 y spec implementada"
```

- [ ] **Step 10: Memoria** — nota `webhook_entrada_<fecha>.md` con lo que haya salido de la prueba E2E y su línea en `MEMORY.md`.
