-- 20261027c — Administrador de la plataforma (decisión de Hermes, 27/10/2026)
--
-- Marca `app_metadata.admin_plataforma = true` en UNA cuenta:
-- hersan_romero@yahoo.com (perfil «Daniel Sanchez», admin).
-- Es lo que mira `es_admin_plataforma()` (20261027b), junto con aal2, para
-- dejar cambiar `politicas_seguridad.exigir_mfa`. Sin segundo factor la marca
-- no concede nada.
--
-- `app_metadata` no lo puede escribir el usuario (a diferencia de
-- `user_metadata`): solo la clave de servicio o SQL como aquí.
--
-- VUELTA ATRÁS:
--   update auth.users
--      set raw_app_meta_data = raw_app_meta_data - 'admin_plataforma'
--    where id = 'fc5decbb-58b6-4305-8448-c4b5d8dfe21a';

do $$
declare
    n int;
begin
    update auth.users
       set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"admin_plataforma": true}'::jsonb
     where id = 'fc5decbb-58b6-4305-8448-c4b5d8dfe21a'
       and lower(email) = 'hersan_romero@yahoo.com';
    get diagnostics n = row_count;
    if n <> 1 then
        raise exception 'Se esperaba 1 fila y se tocaron %', n;
    end if;
end $$;
