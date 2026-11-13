-- Marketing › Anuncios e indicadores (Data Marketing.gs: mkPuedeIndicadores_, mkAnuncios, mkEstadisticas_).
--
-- 1) "Ver indicadores de Marketing" (Empleados › permisos especiales: marketingindicadores): sin él,
--    la persona solo ve Planificador, Audiovisual, Biblioteca, Revisión… (no Resumen ni Anuncios).
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
    'requiere', not (v_coord or v_directa),
    'indicadores', app.es_superadmin() or app.puede('marketing', 'administrar')
                   or lower(coalesce(e.preferencias -> 'permisosFlags' ->> 'marketingindicadores', '')) in ('true', 'si', 'sí', '1')
  );
end;
$$;

-- 2) Atribución de leads y ventas por anuncio o campaña (mkEstadisticas_): leads por fecha de creación;
--    ventas por fecha de venta; importes comerciales antes de IVA.
create or replace function public.mkt_atribucion(p_desde date, p_hasta date, p_empresa text default 'VIMEDIC')
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare
  t0 timestamptz := (p_desde::text || ' 00:00:00-05')::timestamptz;
  t1 timestamptz := (p_hasta::text || ' 23:59:59-05')::timestamptz;
begin
  if not coalesce((public.marketing_mi_rol() ->> 'indicadores')::boolean, false) then raise exception 'No tienes acceso a los indicadores de Marketing.'; end if;
  return (
    with reg as (
      select l.codigo, l.fecha, false as venta, null::timestamptz as fecha_venta, null::jsonb as items,
             coalesce(l.atribucion, '{}'::jsonb) as a, l.anuncio, coalesce(l.medio_captacion, '') as medio
        from public.leads l where l.deleted_at is null and l.empresa = p_empresa and l.fecha between t0 and t1
      union all
      select c.codigo, c.fecha, (c.tipo_registro = 'Venta' or c.estado_crm = 'Ganado'), c.fecha_venta, c.items,
             coalesce(c.atribucion, '{}'::jsonb), null, coalesce(nullif(c.medio_captacion_lead, ''), c.medio_captacion_venta, '')
        from public.cotizaciones c where c.deleted_at is null and c.empresa = p_empresa
         and (c.fecha between t0 and t1 or ((c.tipo_registro = 'Venta' or c.estado_crm = 'Ganado') and c.fecha_venta between t0 and t1))
    ), base as (
      select r.*,
             nullif(r.a ->> 'anuncio_id', '') as ad,
             coalesce(nullif(r.a ->> 'campana_id', ''), nullif(r.a ->> 'utm_campaign', '')) as campana,
             (nullif(r.a ->> 'anuncio_id', '') is not null or coalesce(r.anuncio, '') <> '' or coalesce(r.a ->> 'fbclid', '') <> '' or coalesce(r.a ->> 'gclid', '') <> ''
              or coalesce(r.a ->> 'ttclid', '') <> '' or coalesce(r.a ->> 'utm_medium', '') ~* 'cpc|paid|ppc|cpm' or r.medio ~* 'anuncio') as pagado,
             coalesce((select sum(app.num_seguro(it ->> 'cantidad') * app.num_seguro(it ->> 'precio') * (1 - app.num_seguro(it ->> 'descuento') / 100))
                         from jsonb_array_elements(case when jsonb_typeof(r.items) = 'array' then r.items else '[]'::jsonb end) it), 0) as base_venta
        from reg r
    ), g as (
      select case when ad is not null then 'ad:' || ad when campana is not null then 'campaign:' || campana when coalesce(anuncio, '') <> '' then 'manual:' || anuncio else 'sin-id' end as clave,
             max(ad) as ad, coalesce(max(campana), max(anuncio), 'Sin campaña identificada') as campana, max(medio) as medio,
             count(*) filter (where fecha between t0 and t1 and coalesce(codigo, '') !~ '^VTA-') as leads,
             count(*) filter (where venta and fecha_venta between t0 and t1) as ventas,
             round(coalesce(sum(base_venta) filter (where venta and fecha_venta between t0 and t1), 0), 2) as base,
             count(*) filter (where venta and fecha_venta is null) as sin_fecha
        from base where pagado group by 1
    )
    select jsonb_build_object(
      'grupos', coalesce((select jsonb_agg(jsonb_build_object('clave', clave, 'adId', ad, 'campana', campana, 'medio', medio, 'leads', leads, 'ventas', ventas, 'baseVentas', base)
                          order by base desc, leads desc) from g where leads > 0 or ventas > 0), '[]'::jsonb),
      'leads', (select coalesce(sum(leads), 0) from g), 'ventas', (select coalesce(sum(ventas), 0) from g), 'baseVentas', (select coalesce(sum(base), 0) from g),
      'ventasSinFecha', (select coalesce(sum(sin_fecha), 0) from g),
      'criterio', 'Leads por fecha de creación; ventas por fecha de venta. Atribución por anuncio o campaña del registro, no por la ficha del cliente. Importes comerciales antes de IVA, no cobros ni utilidad.')
  );
end;
$$;
revoke all on function public.mkt_atribucion(date, date, text) from public, anon;
grant execute on function public.mkt_atribucion(date, date, text) to authenticated;
