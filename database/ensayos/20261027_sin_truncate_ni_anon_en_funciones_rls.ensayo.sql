-- ENSAYO de 20261027_sin_truncate_ni_anon_en_funciones_rls.sql — NO deja nada en la base.
-- Termina en RAISE EXCEPTION: el error deshace la transacción.
--   ROJA : sin el bloque MIGRACIÓN ⇒ las pruebas 1–9 deben FALLAR (10 y 11 pasan).
--   VERDE: con el bloque ⇒ 11 de 11.
--   Tras aplicar: sin el bloque (ya está en la base) ⇒ 11 de 11.
-- Usa filas reales SOLO para intentar vaciarlas: cada intento se deshace.
--
--   supabase db query --linked -f database/ensayos/20261027_sin_truncate_ni_anon_en_funciones_rls.ensayo.sql

BEGIN;

-- >>> MIGRACIÓN
DO $mig$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT c.oid::regclass AS tabla
          FROM pg_class c
         WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
    LOOP
        EXECUTE format('REVOKE TRUNCATE ON TABLE %s FROM PUBLIC, anon, authenticated', t.tabla);
    END LOOP;
END
$mig$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_organization_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_role()            FROM PUBLIC, anon;
-- <<< MIGRACIÓN

DO $ensayo$
DECLARE
    v_ok int := 0; v_total int := 0; v_fallos text := '';
    v_admin uuid; v_org uuid; v_txt text; v_n int;
    v_trunc text[] := ARRAY['audit_log:authenticated', 'vigilante_reloj:authenticated',
                            'workflows:authenticated', 'profiles:anon'];
    v_par text; v_tabla text; v_rol text;
BEGIN
    IF current_user <> 'postgres' THEN
        RAISE EXCEPTION 'ENSAYO: corre como %, se esperaba postgres — no se prueba nada', current_user;
    END IF;
    SELECT id, organization_id INTO v_admin, v_org FROM public.profiles WHERE name = 'Hermes Sánchez' AND is_active;
    IF v_admin IS NULL THEN RAISE EXCEPTION 'ENSAYO: no encuentro a Hermes Sánchez activo'; END IF;

    -- 1–4. TRUNCATE prohibido, actuando como el rol real. Si llega a vaciar la
    --      tabla (pasada ROJA), el sub-bloque se deshace con 'deshacer_prueba'.
    FOREACH v_par IN ARRAY v_trunc LOOP
        v_tabla := split_part(v_par, ':', 1); v_rol := split_part(v_par, ':', 2);
        v_total := v_total + 1;
        BEGIN
            IF v_rol = 'authenticated' THEN
                PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
            ELSE
                PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
            END IF;
            EXECUTE format('SET LOCAL ROLE %I', v_rol);
            EXECUTE format('TRUNCATE public.%I', v_tabla);
            RAISE EXCEPTION 'deshacer_prueba';
        EXCEPTION
            WHEN insufficient_privilege THEN
                RESET ROLE; v_ok := v_ok + 1;
            WHEN raise_exception THEN
                RESET ROLE;
                IF SQLERRM <> 'deshacer_prueba' THEN RAISE; END IF;
                v_fallos := v_fallos || format(' [%s TRUNCATE %s como %s se permitió]', v_total, v_tabla, v_rol);
            WHEN feature_not_supported THEN
                RESET ROLE;
                v_fallos := v_fallos || format(' [%s TRUNCATE %s como %s pasó el permiso; lo frenó solo la FK]', v_total, v_tabla, v_rol);
        END;
    END LOOP;

    -- 5. Catálogo: ninguna tabla de public con TRUNCATE para anon ni authenticated.
    v_total := v_total + 1;
    SELECT string_agg(c.relname, ',') INTO v_txt
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
       AND (has_table_privilege('authenticated', c.oid, 'TRUNCATE')
            OR has_table_privilege('anon', c.oid, 'TRUNCATE'));
    IF v_txt IS NULL THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || format(' [5 con TRUNCATE: %s]', v_txt); END IF;

    -- 6. Una tabla NUEVA creada por postgres ya no nace con TRUNCATE.
    v_total := v_total + 1;
    CREATE TABLE public.zz_ensayo_truncate (id int);
    IF NOT has_table_privilege('authenticated', 'public.zz_ensayo_truncate', 'TRUNCATE')
       AND NOT has_table_privilege('anon', 'public.zz_ensayo_truncate', 'TRUNCATE')
       AND has_table_privilege('authenticated', 'public.zz_ensayo_truncate', 'SELECT')
    THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [6 una tabla nueva nace con TRUNCATE]'; END IF;
    DROP TABLE public.zz_ensayo_truncate;

    -- 7–9. anon ya no ejecuta las tres funciones de la RLS.
    FOREACH v_txt IN ARRAY ARRAY['is_admin', 'my_organization_id', 'my_role'] LOOP
        v_total := v_total + 1;
        BEGIN
            PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
            SET LOCAL ROLE anon;
            EXECUTE format('SELECT public.%I()::text', v_txt);
            RESET ROLE;
            v_fallos := v_fallos || format(' [%s anon ejecuta %s()]', v_total, v_txt);
        EXCEPTION WHEN insufficient_privilege THEN
            RESET ROLE; v_ok := v_ok + 1;
        END;
    END LOOP;

    -- 10. authenticated SÍ las sigue ejecutando, con el valor correcto.
    v_total := v_total + 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    IF public.my_organization_id() = v_org AND public.is_admin() AND public.my_role() = 'admin'
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [10 las funciones fallan para authenticated]'; END IF;

    -- 11. Y la RLS sigue dejando leer lo de siempre (efecto medido).
    v_total := v_total + 1;
    SELECT count(*) INTO v_n FROM public.workflows;
    RESET ROLE;
    IF v_n > 0 THEN v_ok := v_ok + 1;
    ELSE v_fallos := v_fallos || ' [11 un admin no ve sus flujos]'; END IF;

    RAISE EXCEPTION 'ENSAYO: % de % OK —%', v_ok, v_total,
        CASE WHEN v_fallos = '' THEN ' sin fallos' ELSE v_fallos END;
END
$ensayo$;
