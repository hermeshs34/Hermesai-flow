-- ENSAYO de 20260928_webhook_payload_solo_servicio.sql — NO deja nada en la base.
-- Aplica los permisos dentro de una transacción, los prueba (también leyendo de
-- verdad como `authenticated`) y termina con RAISE EXCEPTION, que lo deshace.
-- Veredicto en el mensaje de error: «ENSAYO: 6 de 6 OK — sin fallos».

BEGIN;

REVOKE SELECT ON public.webhook_recepciones FROM authenticated;
GRANT SELECT (id, organization_id, workflow_id, recibido_at, evento_id,
              estado, motivo, bytes, execution_run_id)
    ON public.webhook_recepciones TO authenticated;

DO $ensayo$
DECLARE
    v_ok int := 0; v_total int := 0; v_fallos text := ''; v_n int;
BEGIN
    v_total := v_total + 1;
    IF NOT has_column_privilege('authenticated', 'public.webhook_recepciones', 'payload', 'SELECT')
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [1 authenticated aún lee payload]'; END IF;

    v_total := v_total + 1;
    IF has_column_privilege('authenticated', 'public.webhook_recepciones', 'estado', 'SELECT')
       AND has_column_privilege('authenticated', 'public.webhook_recepciones', 'execution_run_id', 'SELECT')
       AND has_column_privilege('authenticated', 'public.webhook_recepciones', 'recibido_at', 'SELECT')
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [2 el panel perdió columnas]'; END IF;

    v_total := v_total + 1;
    IF has_column_privilege('service_role', 'public.webhook_recepciones', 'payload', 'SELECT')
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [3 el motor ya no lee payload]'; END IF;

    v_total := v_total + 1;
    IF NOT has_table_privilege('anon', 'public.webhook_recepciones', 'SELECT')
       AND NOT has_column_privilege('anon', 'public.webhook_recepciones', 'payload', 'SELECT')
    THEN v_ok := v_ok + 1; ELSE v_fallos := v_fallos || ' [4 anon lee]'; END IF;

    -- 5. Lectura real como usuario: la consulta del panel funciona…
    v_total := v_total + 1;
    BEGIN
        SET LOCAL ROLE authenticated;
        SELECT count(*) INTO v_n FROM (
            SELECT id, recibido_at, estado, motivo, evento_id, execution_run_id
              FROM public.webhook_recepciones) s;
        RESET ROLE;
        v_ok := v_ok + 1;
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE; v_fallos := v_fallos || ' [5 la consulta del panel falla]';
    END;

    -- 6. …y pedir payload revienta.
    v_total := v_total + 1;
    BEGIN
        SET LOCAL ROLE authenticated;
        SELECT count(payload) INTO v_n FROM public.webhook_recepciones;
        RESET ROLE;
        v_fallos := v_fallos || ' [6 authenticated leyó payload]';
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE; v_ok := v_ok + 1;
    END;

    RAISE EXCEPTION 'ENSAYO: % de % OK —%', v_ok, v_total,
        CASE WHEN v_fallos = '' THEN ' sin fallos' ELSE v_fallos END;
END
$ensayo$;
