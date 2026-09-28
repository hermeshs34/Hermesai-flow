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
