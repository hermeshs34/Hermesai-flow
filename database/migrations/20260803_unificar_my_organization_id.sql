-- HermesAI Flow - Unificar my_org_id() en my_organization_id()
-- Fecha: 02/08/2026
--
-- Habia dos funciones con el mismo cuerpo exacto:
--
--   my_org_id()          SELECT organization_id FROM public.profiles WHERE id = auth.uid();
--   my_organization_id() SELECT organization_id FROM public.profiles WHERE id = auth.uid()
--
-- Ambas SQL, STABLE, SECURITY DEFINER, retornando uuid. Verificado contra
-- pg_get_functiondef el 02/08: solo se diferencian en el punto y coma final.
-- Se conserva my_organization_id() por ser el nombre usado en el resto del
-- esquema y se retira my_org_id().
--
-- Dos funciones equivalentes no son un problema estetico: son dos sitios donde
-- corregir cualquier cambio futuro de la regla de tenancy, y uno de los dos se
-- va a olvidar. Es la misma forma de fallo que la lista de roles de view_audit
-- duplicada entre RLS y UI.
--
-- ALTER POLICY, NO DROP + CREATE. Un DROP POLICY deja la tabla sin esa politica
-- hasta que el CREATE se aplica; si el script falla en medio, la tabla queda
-- ABIERTA. ALTER POLICY reescribe la expresion en el sitio, sin ventana. La
-- transaccion explicita es la segunda red: o entran las ocho o no entra ninguna.

BEGIN;

-- audit_log ------------------------------------------------------------------
-- audit_insert sigue abierta a todo usuario autenticado de la organizacion a
-- proposito: cada uno escribe su propia traza. Solo cambia el nombre de la
-- funcion, no quien puede insertar.
ALTER POLICY audit_insert ON public.audit_log
  WITH CHECK (organization_id = my_organization_id());

ALTER POLICY audit_read_org ON public.audit_log
  USING (
    organization_id = my_organization_id()
    AND my_role() = ANY (ARRAY['admin', 'dueno_proceso', 'cumplimiento', 'auditor'])
  );

-- delegaciones ---------------------------------------------------------------
ALTER POLICY deleg_read_org ON public.delegaciones
  USING (organization_id = my_organization_id());

ALTER POLICY deleg_write ON public.delegaciones
  USING      (organization_id = my_organization_id() AND (is_admin() OR usuario_id = auth.uid()))
  WITH CHECK (organization_id = my_organization_id() AND (is_admin() OR usuario_id = auth.uid()));

-- matriz_aprobacion ----------------------------------------------------------
ALTER POLICY matriz_read_org ON public.matriz_aprobacion
  USING (organization_id = my_organization_id());

ALTER POLICY matriz_admin_write ON public.matriz_aprobacion
  USING      (organization_id = my_organization_id() AND is_admin())
  WITH CHECK (organization_id = my_organization_id() AND is_admin());

-- profiles -------------------------------------------------------------------
-- No hay recursion: my_organization_id() es SECURITY DEFINER, asi que su SELECT
-- sobre profiles no vuelve a evaluar esta politica. Igual que antes.
ALTER POLICY profiles_admin_manage ON public.profiles
  USING      (organization_id = my_organization_id() AND is_admin())
  WITH CHECK (organization_id = my_organization_id() AND is_admin());

-- tareas_aprobacion ----------------------------------------------------------
-- Sin WITH CHECK, igual que estaba: en una politica ALL sin WITH CHECK explicito
-- Postgres reutiliza el USING para la comprobacion de escritura. Anadirlo aqui
-- cambiaria el comportamiento, y esta migracion es una sustitucion neutra.
--
-- PENDIENTE APARTE: esta politica esta concedida a 'public' y no a
-- 'authenticated'. No se toca aqui para no mezclar un cambio de permisos con un
-- renombrado.
ALTER POLICY org_isolation ON public.tareas_aprobacion
  USING (organization_id = my_organization_id());

-- Retirada de la funcion duplicada -------------------------------------------
-- Sin CASCADE. Si quedara cualquier dependencia sin migrar, el DROP falla y la
-- transaccion entera se deshace. Con CASCADE se llevaria por delante justo las
-- politicas que acabamos de arreglar.
DROP FUNCTION public.my_org_id();

COMMIT;
