-- ============================================================================
-- 20260814_delegaciones_operativas.sql
--
-- `delegaciones` existía desde F1 con tabla, RLS y claves foráneas, y **cero
-- referencias en todo el código**: ni una pantalla que la escribiera, ni una
-- línea que la leyera. CLAUDE.md la describía como «tabla con CRUD y cero
-- lectores»; el CRUD tampoco existía.
--
-- Lo que arregla conectarla: hoy hay UN solo `cumplimiento` (Nohemy Romero) y
-- las aprobaciones de AML no las resuelve nadie más —ni un admin (§6.2)— ni
-- escalan al vencer, que desde el 11/08 cancelan el flujo. Es decir: que esa
-- persona esté de baja una semana no es un contratiempo, es una parada de todas
-- las aprobaciones regulatorias. Una delegación acotada en el tiempo convierte
-- eso en un incidente manejable.
--
-- ── La decisión que gobierna el diseño ──────────────────────────────────────
-- Una delegación SÍ alcanza a las tareas regulatorias. Si no las alcanzara no
-- resolvería nada, porque el único punto único de fallo real es justo ese.
--
-- Pero entonces la delegación se convierte en la puerta de al lado de §6.2, y
-- el proyecto ya conoce ese patrón: la regla del Oficial de Cumplimiento se
-- saltaba sola con esperar 48 h porque el escalamiento la rodeaba. Así que la
-- puerta se cierra aquí, en la base, y no en la pantalla:
--
--   **Una delegación de alguien con rol regulatorio solo la puede crear esa
--   misma persona.** Un admin no puede nombrarse suplente del Oficial de
--   Cumplimiento; si pudiera, §6.2 sería decorativa — bastaría un clic.
--
-- La RLS actual (`deleg_write`: `is_admin() OR usuario_id = auth.uid()`) sola
-- NO basta para eso: deja al admin escribir cualquier fila. Por eso hay trigger.
-- ============================================================================

-- ── 1. Dejar constancia de que una resolución fue por delegación ────────────
-- Sin esto, «quién aprobó en nombre de quién» solo se podría reconstruir
-- mirando `delegaciones` en el momento de la consulta — y las delegaciones se
-- borran. Un control cuya evidencia se puede borrar no es un control.
-- Adrede SIN clave foránea: un ON DELETE SET NULL borraría el hecho al limpiar
-- la delegación, que es exactamente lo que se quiere evitar. El registro
-- legible para una persona vive además en `audit_log`.
ALTER TABLE public.tareas_aprobacion
    ADD COLUMN IF NOT EXISTS delegacion_id uuid;

COMMENT ON COLUMN public.tareas_aprobacion.delegacion_id IS
    'Si la tarea se resolvió por delegación, el id de la delegación usada. Sin FK a propósito: borrar la delegación no debe borrar el hecho de que se usó.';

-- ── 2. Salvaguardas de la propia delegación ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.delegaciones_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER            -- necesita leer profiles de otros; no acepta parámetros
SET search_path = public
AS $fn$
DECLARE
    v_rol_titular  text;
    v_org_titular  uuid;
    v_org_suplente uuid;
    v_act_suplente boolean;
BEGIN
    IF NEW.usuario_id = NEW.suplente_id THEN
        RAISE EXCEPTION 'No se puede delegar en uno mismo.';
    END IF;

    IF NEW.hasta <= NEW.desde THEN
        RAISE EXCEPTION 'La delegación tiene que terminar después de empezar.';
    END IF;

    SELECT p.role, p.organization_id INTO v_rol_titular, v_org_titular
      FROM profiles p WHERE p.id = NEW.usuario_id;

    SELECT p.organization_id, p.is_active INTO v_org_suplente, v_act_suplente
      FROM profiles p WHERE p.id = NEW.suplente_id;

    -- Un NULL aquí es «no se puede comprobar», y eso se rechaza. Misma familia
    -- que la huella NULL de §9.5.
    IF v_rol_titular IS NULL OR v_org_suplente IS NULL THEN
        RAISE EXCEPTION 'No se pudo comprobar la delegación: alguna de las dos personas no existe.';
    END IF;

    IF v_org_titular <> NEW.organization_id OR v_org_suplente <> NEW.organization_id THEN
        RAISE EXCEPTION 'Las dos personas de una delegación tienen que ser de la misma organización.';
    END IF;

    IF v_act_suplente IS NOT TRUE THEN
        RAISE EXCEPTION 'El suplente elegido está desactivado: no puede recibir una delegación.';
    END IF;

    -- ⚠️ La puerta de al lado de §6.2. Ver cabecera.
    -- `auth.uid()` es NULL fuera de una sesión (service_role, migraciones): ahí
    -- también se rechaza, porque tampoco se puede comprobar quién lo pide.
    IF v_rol_titular = 'cumplimiento' AND NEW.usuario_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Una delegación del Oficial de Cumplimiento solo puede crearla esa misma persona. Ni un administrador puede nombrarse su suplente.';
    END IF;

    -- Sin solapes con otra delegación viva de la misma persona: dos suplentes a
    -- la vez es una ambigüedad, y ya se ha visto en este proyecto que un empate
    -- con efectos distintos se resuelve mal solo (§6.5).
    IF EXISTS (
        SELECT 1 FROM delegaciones d
         WHERE d.usuario_id = NEW.usuario_id
           AND d.id IS DISTINCT FROM NEW.id
           AND d.desde < NEW.hasta
           AND d.hasta > NEW.desde
    ) THEN
        RAISE EXCEPTION 'Ya hay otra delegación de esa persona que se solapa con estas fechas. Anula la anterior antes de crear esta.';
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS delegaciones_validar_trg ON public.delegaciones;
CREATE TRIGGER delegaciones_validar_trg
    BEFORE INSERT OR UPDATE ON public.delegaciones
    FOR EACH ROW EXECUTE FUNCTION public.delegaciones_validar();

REVOKE ALL ON FUNCTION public.delegaciones_validar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delegaciones_validar() FROM anon;

-- ── 3. Índice para la consulta que se hace en cada aprobación ───────────────
CREATE INDEX IF NOT EXISTS delegaciones_suplente_vigencia_idx
    ON public.delegaciones (suplente_id, desde, hasta);

CREATE INDEX IF NOT EXISTS delegaciones_usuario_vigencia_idx
    ON public.delegaciones (usuario_id, desde, hasta);

-- ── 4. Tocar delegaciones es un hecho auditable ─────────────────────────────
-- En cuanto una tabla gobierna quién puede autorizar, editarla es parte del
-- control interno — mismo criterio que `matriz_aprobacion` el 13/08 (§6.5).
DO $do$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO v_def
      FROM pg_constraint
     WHERE conrelid = 'public.audit_log'::regclass
       AND conname  = 'audit_log_entidad_check';

    IF v_def IS NULL THEN
        RAISE NOTICE 'audit_log no tiene CHECK de entidad; no hay nada que ampliar.';
    ELSIF v_def LIKE '%delegacion%' THEN
        RAISE NOTICE 'El CHECK de audit_log.entidad ya admite delegacion.';
    ELSE
        ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_entidad_check;
        EXECUTE replace(
            'ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entidad_check ' || v_def,
            ']))', ', ''delegacion''::text]))');
    END IF;
END
$do$;
