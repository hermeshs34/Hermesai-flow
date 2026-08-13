// ═══════════════════════════════════════════════════════════════════════════
// HermesAI Flow — Generación de claves temporales
//
// Único sitio donde se inventa una contraseña. Lo usan `admin-create-user`
// (alta) y `admin-reset-password` (olvido).
//
// ⚠️ NO usar Math.random(). Hasta el 13/08/2026 el alta de usuarios generaba la
// clave con `Math.random().toString(36)`: en V8 eso es xorshift128+, un PRNG no
// criptográfico cuyo estado interno se puede reconstruir observando unas pocas
// salidas. Como la clave temporal viaja por correo y da acceso a la cuenta hasta
// que la persona la cambie, adivinarla es entrar. `crypto.getRandomValues` sí es
// el generador del sistema operativo.
// ═══════════════════════════════════════════════════════════════════════════

// Alfabetos sin caracteres que se confunden al dictar o copiar una clave por
// teléfono: fuera 0/O, 1/l/I. Alguien va a leerla en voz alta.
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS    = '23456789';
const TODOS      = MAYUSCULAS + MINUSCULAS + DIGITOS;

const LARGO = 14;

/**
 * Un entero aleatorio en [0, tope) sin sesgo de módulo.
 *
 * `random % tope` favorece a los valores bajos cuando `tope` no divide al rango
 * del byte. Se descartan los bytes de la franja sobrante y se vuelve a pedir.
 */
function enteroAleatorio(tope: number): number {
    const limite = Math.floor(256 / tope) * tope;
    const buf = new Uint8Array(1);
    for (;;) {
        crypto.getRandomValues(buf);
        if (buf[0] < limite) return buf[0] % tope;
    }
}

function unoDe(alfabeto: string): string {
    return alfabeto[enteroAleatorio(alfabeto.length)];
}

/**
 * Clave temporal de 14 caracteres con al menos una mayúscula, una minúscula y
 * un dígito.
 *
 * Se garantizan las tres clases y luego se baraja, porque si no la mayúscula
 * caería siempre en la primera posición y la entropía real bajaría.
 */
export function generarClaveTemporal(): string {
    const caracteres = [
        unoDe(MAYUSCULAS),
        unoDe(MINUSCULAS),
        unoDe(DIGITOS),
    ];
    while (caracteres.length < LARGO) caracteres.push(unoDe(TODOS));

    // Fisher–Yates con la misma fuente aleatoria
    for (let i = caracteres.length - 1; i > 0; i--) {
        const j = enteroAleatorio(i + 1);
        [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
    }
    return caracteres.join('');
}
