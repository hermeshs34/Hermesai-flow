-- ═══════════════════════════════════════════════════════════════════════════
-- 03/08/2026 — Restringir por rol la lectura de audit_log
--
-- PROBLEMA
-- La política audit_read_org solo comprobaba organization_id, así que
-- cualquier usuario autenticado de la organización —incluido un 'viewer'—
-- podía leer el registro de auditoría completo vía API.
--
-- schema.sql afirmaba desde F1 que la lectura estaba restringida a
-- admin/auditor/cumplimiento. Esa política nunca existió: es otro caso del
-- desfase que documenta 20260801_alinear_esquema_real.sql, y salió a la luz al
-- regenerar schema.sql desde el catálogo real el 02/08.
--
-- La lista de roles es la que la propia aplicación ya declara en el permiso
-- 'view_audit' (src/core/user.types.ts): admin, dueno_proceso, cumplimiento,
-- auditor. Se elige esa y no otra para que RLS y frontend tengan UNA sola
-- fuente de verdad y no vuelvan a divergir.
--
-- NO se toca audit_insert. Cualquier usuario debe poder escribir su propia
-- traza —GovernanceService.log registra hasta un cambio de contraseña— y el
-- INSERT no necesita permiso de SELECT porque no encadena .select().
--
-- OJO: esta migración sola no basta. El frontend hace lo contrario de lo que
-- debería (Governance.tsx bloquea al auditor y muestra la pestaña de auditoría
-- solo al admin), y se corrige en el mismo commit.
-- ═══════════════════════════════════════════════════════════════════════════

-- Paso 1 — comprobar el estado de partida.
-- Debe devolver UNA fila, con qual = (organization_id = my_org_id()).
SELECT policyname, cmd, qual
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'audit_log'
  AND  cmd        = 'SELECT';

-- Paso 2 — reemplazar la política.
DROP POLICY IF EXISTS audit_read_org ON public.audit_log;

CREATE POLICY audit_read_org ON public.audit_log
    FOR SELECT TO authenticated
    USING (
        organization_id = public.my_org_id()
        AND public.my_role() IN ('admin', 'dueno_proceso', 'cumplimiento', 'auditor')
    );

-- Paso 3 — verificar.
-- Debe devolver la política con el filtro de rol ya incluido en qual.
SELECT policyname, cmd, roles, qual
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename  = 'audit_log'
ORDER  BY policyname;

-- Paso 4 — cuántos usuarios pierden acceso, para saber a quién avisar.
SELECT role,
       count(*) AS usuarios,
       CASE WHEN role IN ('admin', 'dueno_proceso', 'cumplimiento', 'auditor')
            THEN 'conserva lectura'
            ELSE 'pierde lectura'
       END AS efecto
FROM   public.profiles
WHERE  is_active
GROUP  BY role
ORDER  BY efecto, role;
