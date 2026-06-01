-- ═══════════════════════════════════════════════════════════════════════════
-- F2.2 — Preferencias de notificación por organización
-- Ejecutar en Supabase SQL Editor (proyecto kbscaxcokxwdbnrltkup)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS notif_email   text,
  ADD COLUMN IF NOT EXISTS notif_errors  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notif_success boolean NOT NULL DEFAULT false;

-- rollback:
-- ALTER TABLE public.organizations DROP COLUMN notif_email, DROP COLUMN notif_errors, DROP COLUMN notif_success;
