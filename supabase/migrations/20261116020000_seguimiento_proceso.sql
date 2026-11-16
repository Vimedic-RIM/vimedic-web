-- =====================================================================
-- Seguimiento de pedidos · Fase 4: mapa de proceso del Dashboard Ejecutivo — Issue #38
-- Un solo llamado devuelve, por etapa: pedidos que están ahí ahora, cuántos van atrasados, tiempo
-- promedio y mediana que tomó la etapa (en días hábiles) frente al objetivo, % a tiempo y errores.
-- Además: tiempo total venta → entrega, % entregado a tiempo, tendencia semanal y las listas para
-- el detalle (pedidos actuales y errores del período). Todo se calcula en la base, no en el navegador.
--
-- Criterios:
--  · "Ahora" (en etapa / atrasados) es la foto actual: no depende del período.
--  · El tiempo de una etapa cuenta cuando el pedido SALE de ella dentro del período.
--  · Venta → entrega cuenta los pedidos entregados dentro del período.
--  · Errores: los registrados dentro del período.
-- =====================================================================

create or replace function public.trk_proceso(p_desde date, p_hasta date, p_empresa text default '', p_asesor uuid default null, p_zona text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb := app.trk_config();
  d1 date := coalesce(p_desde, app.trk_hoy() - 30);
  d2 date := coalesce(p_hasta, app.trk_hoy());
  v_desde timestamptz; v_hasta timestamptz;
  r jsonb;
begin
  if not (app.es_superadmin() or app.puede('dashboard', 'ver') or app.puede('tracking', 'ver') or app.puede_alguno(array['crm', 'femedics'], 'ver_todos')) then
    raise exception 'Sin permiso para ver el proceso de pedidos.';
  end if;
  if d2 < d1 then d2 := d1; end if;
  v_desde := d1::timestamp at time zone 'America/Guayaquil';
  v_hasta := (d2 + 1)::timestamp at time zone 'America/Guayaquil';

  with base as (
    select p.id, p.codigo, p.empresa, p.cliente_texto, p.asesor_id, p.zona, p.etapa, p.etapa_desde, p.estado, p.created_at, p.completado_en
      from public.pedidos_seguimiento p
     where p.deleted_at is null
       and (coalesce(p_empresa, '') = '' or p.empresa = p_empresa)
       and (p_asesor is null or p.asesor_id = p_asesor)
       and (coalesce(p_zona, '') = '' or p.zona = p_zona)
  ),
  -- Cada avance abre una etapa; la cierra el avance siguiente (desempate por el orden de las etapas).
  av as (
    select e.pedido_id, e.etapa, e.fecha, b.zona,
           lead(e.fecha) over (partition by e.pedido_id order by e.fecha, app.trk_orden(e.etapa), e.created_at) as fin
      from public.pedidos_eventos e join base b on b.id = e.pedido_id
     where e.tipo = 'avance' and e.deleted_at is null
  ),
  pasos as (
    select etapa, app.trk_dias(fecha, fin, c) as dur, app.trk_objetivo(etapa, zona, c) as obj
      from av
     where fin is not null and fin >= v_desde and fin < v_hasta and etapa not in ('venta', 'entregada')
  ),
  pasos_et as (
    select etapa, count(*) as n, round(avg(dur), 2) as prom, round((percentile_cont(0.5) within group (order by dur))::numeric, 2) as med,
           round(max(dur), 2) as maximo, count(*) filter (where dur <= obj) as a_tiempo
      from pasos group by etapa
  ),
  actuales as (
    select b.*, app.trk_dias(b.etapa_desde, now(), c) as dias, app.trk_objetivo(b.etapa, b.zona, c) as obj
      from base b where b.estado = 'En curso'
  ),
  act_et as (
    select etapa, count(*) as n, count(*) filter (where obj > 0 and dias > obj) as atrasados, round(avg(dias), 2) as prom
      from actuales group by etapa
  ),
  errores as (
    select e.id, e.pedido_id, e.etapa, e.titulo, e.detalle, e.fecha, e.area
      from public.pedidos_eventos e join base b on b.id = e.pedido_id
     where e.tipo = 'error' and e.deleted_at is null and e.fecha >= v_desde and e.fecha < v_hasta
  ),
  err_et as (select etapa, count(*) as n from errores group by etapa),
  -- Venta → entrega de los pedidos entregados en el período, contra la suma de los objetivos de su zona.
  entregas as (
    select b.id, b.zona, ent.fecha as entregada, app.trk_dias(b.created_at, ent.fecha, c) as lead,
           (select sum(app.trk_objetivo(x, b.zona, c)) from unnest(array['venta', 'facturar', 'facturada', 'preparacion', 'lista', 'despachada', 'en_ruta']) x) as obj
      from base b
      join lateral (select min(e.fecha) as fecha from public.pedidos_eventos e
                     where e.pedido_id = b.id and e.tipo = 'avance' and e.etapa = 'entregada' and e.deleted_at is null) ent on ent.fecha is not null
     where ent.fecha >= v_desde and ent.fecha < v_hasta
  ),
  semanas as (
    select s::date as semana
      from generate_series(date_trunc('week', least(d1, d2 - 49)::timestamp), date_trunc('week', d2::timestamp), interval '1 week') s
  )
  select jsonb_build_object(
    'desde', d1, 'hasta', d2, 'config', c,
    'etapas', (
      select jsonb_agg(jsonb_build_object(
          'clave', x.etapa, 'nombre', app.trk_nombre(x.etapa), 'area', app.trk_area(x.etapa),
          'objetivo', app.trk_objetivo(x.etapa, 'local', c),
          'objetivoProvincia', case when x.etapa = 'en_ruta' then app.trk_objetivo(x.etapa, 'provincia', c) end,
          'ahora', coalesce(a.n, 0), 'atrasados', coalesce(a.atrasados, 0), 'diasAhora', coalesce(a.prom, 0),
          'pasaron', coalesce(s.n, 0), 'promedio', s.prom, 'mediana', s.med, 'maximo', s.maximo,
          'aTiempo', case when s.n > 0 then round(100.0 * s.a_tiempo / s.n) end,
          'errores', coalesce(er.n, 0)) order by x.ord)
        from unnest(array['facturar', 'facturada', 'preparacion', 'lista', 'despachada', 'en_ruta', 'instalacion']) with ordinality x(etapa, ord)
        left join act_et a on a.etapa = x.etapa
        left join pasos_et s on s.etapa = x.etapa
        left join err_et er on er.etapa = x.etapa),
    'totales', jsonb_build_object(
      'creados', (select count(*) from base where created_at >= v_desde and created_at < v_hasta),
      'entregados', (select count(*) from entregas),
      'completados', (select count(*) from base where completado_en >= v_desde and completado_en < v_hasta),
      'cancelados', (select count(*) from base where estado = 'Cancelado' and created_at >= v_desde and created_at < v_hasta),
      'enCurso', (select count(*) from actuales),
      'atrasados', (select count(*) from actuales where obj > 0 and dias > obj),
      'errores', (select count(*) from errores),
      'conErrores', (select count(distinct pedido_id) from errores),
      'leadPromedio', (select round(avg(lead), 2) from entregas),
      'leadMediana', (select round((percentile_cont(0.5) within group (order by lead))::numeric, 2) from entregas),
      'leadObjetivoLocal', (select sum(app.trk_objetivo(x, 'local', c)) from unnest(array['venta', 'facturar', 'facturada', 'preparacion', 'lista', 'despachada', 'en_ruta']) x),
      'leadObjetivoProvincia', (select sum(app.trk_objetivo(x, 'provincia', c)) from unnest(array['venta', 'facturar', 'facturada', 'preparacion', 'lista', 'despachada', 'en_ruta']) x),
      'entregaATiempo', (select case when count(*) > 0 then round(100.0 * count(*) filter (where lead <= obj) / count(*)) end from entregas)),
    'semanal', (
      select jsonb_agg(jsonb_build_object('semana', w.semana,
          'creados', (select count(*) from base b where b.created_at >= w.semana::timestamp at time zone 'America/Guayaquil' and b.created_at < (w.semana + 7)::timestamp at time zone 'America/Guayaquil'),
          'entregados', (select count(*) from entregas en where en.entregada >= w.semana::timestamp at time zone 'America/Guayaquil' and en.entregada < (w.semana + 7)::timestamp at time zone 'America/Guayaquil'),
          'lead', (select round(avg(en.lead), 2) from entregas en where en.entregada >= w.semana::timestamp at time zone 'America/Guayaquil' and en.entregada < (w.semana + 7)::timestamp at time zone 'America/Guayaquil'),
          'errores', (select count(*) from public.pedidos_eventos e join base b on b.id = e.pedido_id where e.tipo = 'error' and e.deleted_at is null
                        and e.fecha >= w.semana::timestamp at time zone 'America/Guayaquil' and e.fecha < (w.semana + 7)::timestamp at time zone 'America/Guayaquil'))
        order by w.semana) from semanas w),
    'actuales', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'codigo', a.codigo, 'cliente', a.cliente_texto, 'empresa', a.empresa, 'etapa', a.etapa, 'zona', a.zona,
          'asesor', coalesce(split_part(em.nombre, ' (', 1), ''), 'dias', a.dias, 'objetivo', a.obj, 'atrasado', a.obj > 0 and a.dias > a.obj,
          'errores', (select count(*) from public.pedidos_eventos e where e.pedido_id = a.id and e.tipo = 'error' and e.deleted_at is null))
        order by (a.dias - a.obj) desc)
        from (select * from actuales order by (dias - obj) desc limit 500) a left join public.empleados em on em.id = a.asesor_id), '[]'::jsonb),
    'errores', coalesce((
      select jsonb_agg(jsonb_build_object('id', er.id, 'pedidoId', er.pedido_id, 'codigo', b.codigo, 'cliente', b.cliente_texto, 'etapa', er.etapa,
          'titulo', er.titulo, 'detalle', er.detalle, 'fecha', er.fecha, 'area', er.area) order by er.fecha desc)
        from (select * from errores order by fecha desc limit 200) er join base b on b.id = er.pedido_id), '[]'::jsonb),
    'asesores', coalesce((
      select jsonb_agg(jsonb_build_object('id', em.id, 'nombre', split_part(em.nombre, ' (', 1)) order by em.nombre)
        from public.empleados em where em.id in (select distinct asesor_id from public.pedidos_seguimiento where deleted_at is null and asesor_id is not null)), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke all on function public.trk_proceso(date, date, text, uuid, text) from public, anon;
grant execute on function public.trk_proceso(date, date, text, uuid, text) to authenticated;
notify pgrst, 'reload schema';
