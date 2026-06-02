-- Agregar rol 'cumplimiento' al constraint de la tabla profiles
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','dueno_proceso','supervisor','operador','autorizador','cumplimiento','auditor','editor','operator','viewer'));

-- rollback:
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
--   CHECK (role IN ('admin','dueno_proceso','supervisor','operador','autorizador','auditor','editor','operator','viewer'));
