-- ═══════════════════════════════════════════════════════════════════════════
-- HermesAI Flow — Recuperación de contraseña
-- 13/08/2026
--
-- Encargo de Hermes: «no hay una opción para que el Administrador pueda asignar
-- una clave temporal al usuario por olvido, y si el usuario se olvida la clave
-- no hay manera de que él pueda entrar».
--
-- Con 7 personas dentro y un solo `cumplimiento`, un olvido de clave dejaba a
-- esa persona fuera sin vía de vuelta. Si la que se queda fuera es Nohemy, se
-- para toda aprobación de AML: nadie más puede hacerlo (CLAUDE.md 6.2).
--
-- Esta migración añade lo mínimo que necesita la base; el resto vive en dos
-- Edge Functions (admin-reset-password, request-password-reset).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Marca de «esta clave se la puso otro» ─────────────────────────────────
--
-- Una clave temporal la conoce quien la generó. Mientras siga puesta, la cuenta
-- tiene dos dueños. La marca obliga a cambiarla en el primer acceso.
--
-- El DEFAULT es false y la columna es NOT NULL a propósito: un NULL aquí
-- significaría «no se sabe» y la pantalla lo leería como «no hace falta
-- cambiarla», que es justo el fallo abierto que este proyecto ya ha pagado tres
-- veces (token = '', '' === '', huella NULL). No se puede no saberlo.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS debe_cambiar_clave BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.debe_cambiar_clave IS
    'true cuando la clave vigente la asignó un administrador (olvido). La pantalla obliga a cambiarla antes de dejar entrar. Lo pone admin-reset-password; lo quita marcar_clave_cambiada().';


-- 2. Quitar la marca: solo sobre la propia fila y solo esa columna ─────────
--
-- `profiles` tiene dos políticas: profiles_read_own_org (SELECT de la
-- organización) y profiles_admin_manage (todo, solo admin). O sea, un usuario
-- normal NO puede escribir su propio perfil — y está bien que sea así, porque
-- una política de «edita tu fila» le dejaría cambiarse el `role`.
--
-- De ahí esta función SECURITY DEFINER: es la excepción mínima. No recibe
-- parámetros, así que no hay nada que falsear; toca una sola columna de una
-- sola fila, la de auth.uid(). No puede tocar el rol, ni la organización, ni la
-- fila de otra persona.
CREATE OR REPLACE FUNCTION public.marcar_clave_cambiada()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
    UPDATE public.profiles
       SET debe_cambiar_clave = false
     WHERE id = auth.uid();
$fn$;

COMMENT ON FUNCTION public.marcar_clave_cambiada() IS
    'Limpia debe_cambiar_clave del usuario autenticado tras cambiar su contraseña. SECURITY DEFINER porque profiles solo lo escribe un admin.';

-- Dejarlo solo en manos de sesiones autenticadas.
--
-- ⚠️ `REVOKE FROM PUBLIC` NO basta, y el ensayo de esta migración lo demostró:
-- Supabase tiene ALTER DEFAULT PRIVILEGES que conceden EXECUTE a `anon`,
-- `authenticated` y `service_role` sobre cada función nueva del esquema public.
-- Eso es un permiso concedido POR NOMBRE, y revocar el de PUBLIC no lo toca:
-- tras el REVOKE, `anon` seguía con EXECUTE. Hay que nombrarlo.
--
-- Con `anon` la función no haría nada —auth.uid() es NULL y el UPDATE no casa
-- ninguna fila—, pero un endpoint que no hace nada sigue siendo un endpoint
-- abierto, y el que revise los permisos mañana no debería tener que razonar
-- sobre auth.uid() para saber que está cerrado.
REVOKE ALL ON FUNCTION public.marcar_clave_cambiada() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marcar_clave_cambiada() FROM anon;
GRANT EXECUTE ON FUNCTION public.marcar_clave_cambiada() TO authenticated;
