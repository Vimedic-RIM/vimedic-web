-- =====================================================================
-- Gemini (IA): el modelo ya no queda fijo en el código.
--   · La Edge Function pide a Google la lista de modelos (v1beta/models), la filtra y la guarda 24 h aquí.
--   · Modo «Automático» (config.modelo = 'auto'): usa el Flash más reciente de esa lista.
--   · Si Google retira un modelo, la función cambia sola al reemplazo, reintenta una vez y lo anota.
-- cache = {"modelos":[{"id","nombre"}], "retirados":[…], "cambios":[{"de","a","fecha"}]}; cache_en = cuándo se pidió la lista.
-- Solo las lee y escribe la Edge Function (service_role): la tabla sigue sin acceso desde el navegador
-- (RLS sin políticas y revoke a anon/authenticated) e integraciones_estado no las devuelve.
-- =====================================================================

alter table public.integraciones add column if not exists cache jsonb;
alter table public.integraciones add column if not exists cache_en timestamptz;

comment on column public.integraciones.cache is 'Datos que la Edge Function guarda del proveedor (Gemini: lista de modelos, modelos retirados y cambios de modelo). Solo service_role.';
comment on column public.integraciones.cache_en is 'Cuándo se actualizó cache (Gemini: la lista de modelos dura 24 h).';
