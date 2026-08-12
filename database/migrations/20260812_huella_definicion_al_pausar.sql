-- 20260812 — Huella de la definición al pausar por aprobación.
--
-- El problema (verificado en execute-workflow/index.ts): los nodos y conexiones
-- se cargan en la línea 1246, ANTES de bifurcar a `resume` en la 1263. O sea que
-- un run pausado esperando aprobación —hasta 48 h por defecto— al reanudarse
-- relee la definición ACTUAL del flujo, no la que tenía cuando se pausó.
--
-- Consecuencia: se aprueba la versión A y continúa la versión B. Puede haber
-- cambiado el destinatario de un correo, la rama de una decisión o el
-- `rol_aprobador` de un nodo posterior. Y no queda registrado en ningún sitio:
-- lo aprobado y lo ejecutado dejan de ser lo mismo, en silencio.
--
-- Arreglo: al pausar se guarda una huella SHA-256 de la definición; al reanudar
-- se recalcula y, si no coincide, NO se reanuda. Falla cerrado.
--
-- La huella cubre lo que cambia el COMPORTAMIENTO (id, tipo, categoría, título
-- y config_json de cada nodo; origen y destino de cada conexión) y deja fuera
-- la posición en el lienzo: mover un nodo no cambia lo que hace, y un control
-- que salta por arrastrar una caja es un control que la gente aprende a
-- ignorar.
--
-- Se prefiere la huella a guardar la definición entera porque falla cerrado y
-- cuesta una columna. La instantánea completa —que además permitiría reanudar
-- la versión aprobada en vez de rechazarla— es el versionado de
-- CICLO_VIDA_FLUJOS.md §3, y se deja para cuando haga falta.

ALTER TABLE public.execution_runs
    ADD COLUMN IF NOT EXISTS definicion_huella TEXT;

COMMENT ON COLUMN public.execution_runs.definicion_huella IS
    'SHA-256 de la definición (nodos+conexiones, sin posiciones) en el momento de pausar por aprobación. Al reanudar se recalcula: si no coincide, el flujo cambió después de aprobarse y no se reanuda.';

-- Los runs anteriores a esta migración quedan con NULL. Un NULL significa «no
-- se puede comprobar», y eso NO se trata como «adelante»: la función lo rechaza
-- igual. Al aplicar esto no había ni un solo run en `esperando_aprobacion`
-- (comprobado), así que no rompe nada vivo.
