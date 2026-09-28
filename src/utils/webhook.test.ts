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
