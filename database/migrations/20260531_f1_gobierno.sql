-- ═══════════════════════════════════════════════════════════════════════════
-- HermesAI Flow — F1 GOBIERNO
-- Roles BPM ampliados + Audit Log inmutable + Matriz de Aprobación
-- Ejecutar en Supabase SQL Editor (proyecto kbscaxcokxwdbnrltkup)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Ampliar roles permitidos en profiles ───────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN (
        'admin', 'dueno_proceso', 'supervisor', 'operador', 'autorizador', 'auditor',
        'editor', 'operator', 'viewer'  -- legacy
    ));

-- ── 2. Audit Log — INMUTABLE (solo INSERT, nunca UPDATE/DELETE) ────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    usuario_id      uuid REFERENCES public.profiles(id),
    usuario_email   text,                 -- snapshot por si el perfil se borra
    accion          text NOT NULL,        -- 'crear' | 'modificar' | 'eliminar' | 'ejecutar' | 'aprobar' | 'rechazar' | 'login' | 'cambio_rol'
    entidad         text NOT NULL,        -- 'workflow' | 'usuario' | 'integracion' | 'aprobacion'
    entidad_id      uuid,
    descripcion     text,
    datos_antes     jsonb,
    datos_despues   jsonb,
    ip_address      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_date ON public.audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entidad  ON public.audit_log(entidad, entidad_id);

-- ── 3. Matriz de Aprobación ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.matriz_aprobacion (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    nombre          text NOT NULL,            -- ej: "Siniestros mayores"
    categoria       text,                     -- categoría de proceso a la que aplica
    umbral_monto    numeric DEFAULT 0,        -- monto a partir del cual aplica
    moneda          text DEFAULT 'USD',
    rol_aprobador   text NOT NULL,            -- rol que debe aprobar
    nivel           integer NOT NULL DEFAULT 1, -- orden de escalamiento
    activa          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_matriz_org ON public.matriz_aprobacion(organization_id, nivel);

-- ── 4. Delegaciones (suplencia de aprobadores) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.delegaciones (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    usuario_id      uuid NOT NULL REFERENCES public.profiles(id),  -- titular
    suplente_id     uuid NOT NULL REFERENCES public.profiles(id),  -- quien lo cubre
    desde           timestamptz NOT NULL,
    hasta           timestamptz NOT NULL,
    motivo          text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — Aislamiento por organización
-- ═══════════════════════════════════════════════════════════════════════════

-- Helper: organización del usuario autenticado (SECURITY DEFINER evita recursión)
CREATE OR REPLACE FUNCTION public.my_org_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Helper: ¿el usuario es admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- ── Audit Log: lectura por org, INSERT abierto, NUNCA update/delete ─────────
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_read_org" ON public.audit_log
    FOR SELECT TO authenticated
    USING (organization_id = public.my_org_id());

CREATE POLICY "audit_insert" ON public.audit_log
    FOR INSERT TO authenticated
    WITH CHECK (organization_id = public.my_org_id());

-- NO se crean políticas UPDATE ni DELETE → el log es inmutable por diseño.

-- ── Matriz de aprobación: lectura por org, escritura solo admin ─────────────
ALTER TABLE public.matriz_aprobacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matriz_read_org" ON public.matriz_aprobacion
    FOR SELECT TO authenticated
    USING (organization_id = public.my_org_id());

CREATE POLICY "matriz_admin_write" ON public.matriz_aprobacion
    FOR ALL TO authenticated
    USING (organization_id = public.my_org_id() AND public.is_admin())
    WITH CHECK (organization_id = public.my_org_id() AND public.is_admin());

-- ── Delegaciones: lectura por org, escritura admin o el propio titular ──────
ALTER TABLE public.delegaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deleg_read_org" ON public.delegaciones
    FOR SELECT TO authenticated
    USING (organization_id = public.my_org_id());

CREATE POLICY "deleg_write" ON public.delegaciones
    FOR ALL TO authenticated
    USING (organization_id = public.my_org_id() AND (public.is_admin() OR usuario_id = auth.uid()))
    WITH CHECK (organization_id = public.my_org_id() AND (public.is_admin() OR usuario_id = auth.uid()));

-- ── profiles: permitir a admin gestionar usuarios de su org ────────────────
DROP POLICY IF EXISTS "profiles_admin_manage" ON public.profiles;
CREATE POLICY "profiles_admin_manage" ON public.profiles
    FOR ALL TO authenticated
    USING (organization_id = public.my_org_id() AND public.is_admin())
    WITH CHECK (organization_id = public.my_org_id() AND public.is_admin());

-- rollback:
-- DROP TABLE IF EXISTS public.delegaciones;
-- DROP TABLE IF EXISTS public.matriz_aprobacion;
-- DROP TABLE IF EXISTS public.audit_log;
-- DROP FUNCTION IF EXISTS public.my_org_id();
-- DROP FUNCTION IF EXISTS public.is_admin();
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','editor','operator','viewer'));
