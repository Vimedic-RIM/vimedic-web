-- Marketing › Planificador: rol del equipo, publicaciones que esperan al coordinador y
-- registro de cada publicación creada desde la app (sin duplicados si la respuesta se pierde).
--
-- Original (Apps Script): MarketingFlujo.gs (mkfYo_, mkfRequiere_, mkfDiferir_) y
-- Data Marketing.gs (mkPublicar con requestId, mkGuardarPostMeta_).

-- 1) Rol en Marketing de quien usa la app.
--    Coordinación (o quien tiene marketing › aprobar, o superadmin) aprueba; Asistente y Audiovisual
--    envían a aprobación las publicaciones en redes, salvo que tengan "Publicación directa".
--    El rol se guarda en empleados.preferencias.marketing (pantalla Empleados).
create or replace function public.marketing_mi_rol()
returns jsonb
language plpgsql stable security definer set search_path = public, app
as $$
declare
  e record;
  v_rol text;
  v_directa boolean;
  v_coord boolean;
begin
  select id, nombre, preferencias into e from public.empleados where id = app.empleado_id() and deleted_at is null;
  v_rol := nullif(trim(coalesce(e.preferencias -> 'marketing' ->> 'rol', '')), '');
  if v_rol is null or v_rol not in ('Coordinación', 'Asistente', 'Audiovisual') then v_rol := 'Asistente'; end if;
  v_directa := lower(coalesce(e.preferencias -> 'marketing' ->> 'directa', '')) in ('true', 'si', 'sí', '1');
  v_coord := v_rol = 'Coordinación' or app.es_superadmin() or app.puede('marketing', 'aprobar');
  return jsonb_build_object(
    'empleado_id', e.id,
    'nombre', e.nombre,
    'rol', case when v_coord and v_rol <> 'Coordinación' then 'Coordinación' else v_rol end,
    'coord', v_coord,
    'directa', v_directa,
    'requiere', not (v_coord or v_directa)
  );
end;
$$;
revoke all on function public.marketing_mi_rol() from public, anon;
grant execute on function public.marketing_mi_rol() to authenticated;

-- 2) Cada publicación creada desde la app queda registrada antes de enviarla a Zernio con el
--    identificador de la solicitud: si la respuesta se pierde y se vuelve a intentar, no se duplica.
alter table public.marketing_publicaciones alter column post_id drop not null;
alter table public.marketing_publicaciones add column if not exists solicitud_id text;
alter table public.marketing_publicaciones add column if not exists producto_texto text;
alter table public.marketing_publicaciones add column if not exists formato text;
create unique index if not exists marketing_publicaciones_solicitud_uidx
  on public.marketing_publicaciones (solicitud_id) where solicitud_id is not null and deleted_at is null;
