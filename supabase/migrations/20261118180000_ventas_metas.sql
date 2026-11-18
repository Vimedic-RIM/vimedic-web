-- =====================================================================
-- VIMEDIC · Módulo «Ventas y metas» (18-nov-2026)
--
-- Cada asesor ve sus ventas, se pone sus metas del mes y ve gráficos para mejorar su estrategia.
-- Coordinación y dirección (CRM «ver todos», Dashboard, o jefes con equipo) ven el panel general
-- del equipo, la meta de cada asesor y pueden fijarla.
--
-- Pipeline = proformas abiertas de los últimos 120 días.
-- Venta = factura (igual que el Dashboard): fecha en que se ganó, base sin IVA menos notas de crédito.
-- Proforma = cotización (sin las históricas). Gestión = interacción registrada por el asesor.
--
-- Metas: una por asesor y mes. Si la fija la coordinación queda como mínimo: el asesor puede subirla,
-- no bajarla. Todo pasa por funciones (la tabla solo la lee directo quien tiene Dashboard).
-- =====================================================================

create table if not exists public.metas_ventas (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.empleados(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  monto numeric(12,2) not null default 0 check (monto >= 0),
  ventas integer check (ventas >= 0),
  proformas integer check (proformas >= 0),
  gestiones integer check (gestiones >= 0),
  nota text,
  minimo numeric(12,2) check (minimo >= 0),
  fijada_por uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.metas_ventas');
select app.aplicar_rls('public.metas_ventas', array['dashboard'], array['dashboard']);
create unique index if not exists metas_ventas_empleado_mes on public.metas_ventas (empleado_id, mes) where deleted_at is null;

-- Quién ve a todos los asesores
create or replace function app.ven_todos()
returns boolean language sql stable as $$
  select app.es_superadmin() or app.puede('crm', 'ver_todos') or app.puede('femedics', 'ver_todos') or app.puede('dashboard', 'ver')
$$;

-- Asesores del panel general: los que venden o cotizan (o tienen meta), que el usuario puede ver
create or replace function app.ven_equipo()
returns table (id uuid, nombre text, empresa text, foto_url text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.empresa, e.foto_url
    from public.empleados e
   where e.deleted_at is null and e.estado = 'activo'
     and (exists (select 1 from public.facturas f where f.asesor_id = e.id and f.deleted_at is null and f.created_at > now() - interval '12 months')
       or exists (select 1 from public.cotizaciones c where c.asesor_id = e.id and c.deleted_at is null and c.tipo_registro <> 'Histórico' and c.fecha > now() - interval '6 months')
       or exists (select 1 from public.metas_ventas m where m.empleado_id = e.id and m.deleted_at is null))
     and (app.ven_todos() or app.es_yo_o_subordinado(e.id))
$$;

-- ---------------------------------------------------------------------
-- Panel: p_asesor nulo = vista general (coordinación) o el propio asesor
-- ---------------------------------------------------------------------
create or replace function public.ven_panel(p_asesor uuid default null, p_mes date default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_yo uuid := app.empleado_id();
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_gen boolean;
  v_mes date; v_fin date; v_ini12 date; v_ini6 date; v_ini90 date; v_prev date; v_prev_corte date;
  v_ids uuid[];
  v_general boolean := false;
  r jsonb := '{}'::jsonb;
begin
  if v_yo is null and not app.es_superadmin() then raise exception 'Tu usuario no está vinculado a un empleado.'; end if;
  if not (app.puede_alguno(array['crm', 'femedics', 'dashboard'], 'ver') or app.es_superadmin()) then raise exception 'No tienes acceso a Ventas.'; end if;
  v_gen := app.ven_todos() or exists (select 1 from app.ven_equipo() q where q.id is distinct from v_yo);
  v_mes := date_trunc('month', coalesce(p_mes, v_hoy))::date;
  v_fin := (v_mes + interval '1 month')::date;
  v_ini12 := (v_mes - interval '11 months')::date;
  v_ini6 := (v_mes - interval '5 months')::date;
  v_ini90 := least(v_hoy, v_fin - 1) - 90;
  v_prev := (v_mes - interval '1 month')::date;
  v_prev_corte := least(v_prev + (least(v_hoy, v_fin - 1) - v_mes), v_mes - 1);

  if p_asesor is null and v_gen then
    select coalesce(array_agg(q.id), '{}') into v_ids from app.ven_equipo() q;
    v_general := true;
  else
    p_asesor := coalesce(p_asesor, v_yo);
    if p_asesor is distinct from v_yo and not (app.ven_todos() or app.es_yo_o_subordinado(p_asesor)) then
      raise exception 'Solo puedes ver tus propias ventas.';
    end if;
    v_ids := array[p_asesor];
  end if;

  create temp table if not exists ven_fac (id uuid, asesor_id uuid, d date, base numeric, estado text, medio text, items jsonb, cotizacion_id uuid) on commit drop;
  create temp table if not exists ven_prof (id uuid, asesor_id uuid, d date, total numeric, estado_crm text, tipo_registro text) on commit drop;
  create temp table if not exists ven_ges (empleado_id uuid, ts timestamp) on commit drop;
  truncate ven_fac, ven_prof, ven_ges;

  insert into ven_fac
    select f.id, f.asesor_id, coalesce(f.fecha_ganado, (f.created_at at time zone 'America/Guayaquil')::date),
           greatest(coalesce(f.subtotal, f.total / 1.15, 0) - coalesce(f.total_notas_credito, 0) / 1.15, 0),
           f.estado, coalesce(nullif(trim(f.medio_captacion_venta), ''), 'Sin medio'), coalesce(f.items, '[]'::jsonb), f.cotizacion_id
      from public.facturas f
     where f.deleted_at is null and f.asesor_id = any(v_ids)
       and coalesce(f.fecha_ganado, (f.created_at at time zone 'America/Guayaquil')::date) >= v_ini12
       and coalesce(f.fecha_ganado, (f.created_at at time zone 'America/Guayaquil')::date) < v_fin;
  insert into ven_prof
    select c.id, c.asesor_id, (c.fecha at time zone 'America/Guayaquil')::date, coalesce(c.total, 0), c.estado_crm, c.tipo_registro
      from public.cotizaciones c
     where c.deleted_at is null and c.asesor_id = any(v_ids) and c.tipo_registro <> 'Histórico'
       and (c.fecha at time zone 'America/Guayaquil')::date >= v_ini12 and (c.fecha at time zone 'America/Guayaquil')::date < v_fin;
  insert into ven_ges
    select i.empleado_id, (i.fecha at time zone 'America/Guayaquil')
      from public.interacciones i
     where i.deleted_at is null and i.empleado_id = any(v_ids) and coalesce(i.tipo, '') not in ('Sistema', 'Eliminado', 'Multimedia', 'Facturación', 'Reasignación')
       and (i.fecha at time zone 'America/Guayaquil')::date >= least(v_ini12, v_ini90) and (i.fecha at time zone 'America/Guayaquil')::date < v_fin;

  r := jsonb_build_object(
    'yo', jsonb_build_object('id', v_yo, 'general', v_gen, 'todos', app.ven_todos()),
    'general', v_general,
    'asesor', case when v_general then null else (select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'foto_url', e.foto_url) from public.empleados e where e.id = p_asesor) end,
    'equipo_lista', case when v_gen then coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'nombre', q.nombre, 'empresa', q.empresa) order by q.nombre) from app.ven_equipo() q), '[]'::jsonb) else '[]'::jsonb end,
    'mes', v_mes, 'hoy', v_hoy,
    'meta', (select jsonb_build_object('monto', coalesce(sum(m.monto), 0), 'ventas', sum(m.ventas), 'proformas', sum(m.proformas), 'gestiones', sum(m.gestiones),
                                       'minimo', max(m.minimo), 'nota', max(m.nota), 'con_meta', count(*),
                                       'fijada_por', (select e.nombre from public.empleados e where e.id = max(m.fijada_por::text)::uuid))
               from public.metas_ventas m where m.deleted_at is null and m.mes = v_mes and m.empleado_id = any(v_ids)),
    'kpi', (select jsonb_build_object(
        'monto', coalesce((select sum(base) from ven_fac where d >= v_mes), 0),
        'n', (select count(*) from ven_fac where d >= v_mes),
        'facturado', coalesce((select sum(base) from ven_fac where d >= v_mes and estado = 'Facturado'), 0),
        'por_facturar', coalesce((select sum(base) from ven_fac where d >= v_mes and estado is distinct from 'Facturado'), 0),
        'proformas', (select count(*) from ven_prof where d >= v_mes),
        'proformas_monto', coalesce((select sum(total) from ven_prof where d >= v_mes), 0),
        'gestiones', (select count(*) from ven_ges where ts::date >= v_mes),
        'leads', (select count(*) from public.leads l where l.deleted_at is null and l.asesor_id = any(v_ids) and (l.fecha at time zone 'America/Guayaquil')::date >= v_mes and (l.fecha at time zone 'America/Guayaquil')::date < v_fin),
        'prev_monto', coalesce((select sum(base) from ven_fac where d >= v_prev and d < v_mes), 0),
        'prev_n', (select count(*) from ven_fac where d >= v_prev and d < v_mes),
        'prev_al_dia', coalesce((select sum(base) from ven_fac where d >= v_prev and d <= v_prev_corte), 0))),
    'diario', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'monto', m, 'n', n) order by d) from (select d, sum(base) m, count(*) n from ven_fac where d >= v_mes group by d) x), '[]'::jsonb),
    'meses', (select jsonb_agg(jsonb_build_object('m', to_char(g.m, 'YYYY-MM'),
                 'monto', coalesce((select sum(base) from ven_fac f where date_trunc('month', f.d) = g.m), 0),
                 'n', (select count(*) from ven_fac f where date_trunc('month', f.d) = g.m),
                 'proformas', (select count(*) from ven_prof p where date_trunc('month', p.d) = g.m),
                 'meta', (select sum(mm.monto) from public.metas_ventas mm where mm.deleted_at is null and mm.mes = g.m::date and mm.empleado_id = any(v_ids))) order by g.m)
               from generate_series(v_ini12, v_mes, interval '1 month') g(m)),
    'canales', coalesce((select jsonb_agg(jsonb_build_object('medio', medio, 'monto', m, 'n', n) order by m desc) from (select medio, sum(base) m, count(*) n from ven_fac where d >= v_ini6 group by medio) x), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('categoria', c, 'monto', m) order by m desc) from (
        select coalesce(cat.nombre, nullif(trim(regexp_replace(it->>'categoria', '^[^[:alnum:]]+', '')), ''), 'Sin categoría') c,
               sum(coalesce((it->>'precio')::numeric, 0) * coalesce((it->>'cantidad')::numeric, 0) * (1 - coalesce((it->>'descuento')::numeric, 0) / 100)) m
          from ven_fac f cross join lateral jsonb_array_elements(case when jsonb_typeof(f.items) = 'array' then f.items else '[]'::jsonb end) it
          left join public.productos pr on pr.codigo = coalesce(it->>'codigo', it->>'id') and pr.deleted_at is null left join public.categorias cat on cat.id = pr.categoria_id
         where f.d >= v_ini6 group by 1 order by 2 desc limit 8) x), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(jsonb_build_object('nombre', nm, 'codigo', cod, 'unidades', u, 'monto', m) order by m desc) from (
        select max(it->>'nombre') nm, coalesce(it->>'codigo', it->>'id', it->>'nombre') cod, sum(coalesce((it->>'cantidad')::numeric, 0)) u,
               sum(coalesce((it->>'precio')::numeric, 0) * coalesce((it->>'cantidad')::numeric, 0) * (1 - coalesce((it->>'descuento')::numeric, 0) / 100)) m
          from ven_fac f, jsonb_array_elements(case when jsonb_typeof(f.items) = 'array' then f.items else '[]'::jsonb end) it where f.d >= v_ini6 group by 2 order by 4 desc limit 10) x), '[]'::jsonb),
    'calor', coalesce((select jsonb_agg(jsonb_build_object('dw', dw, 'h', h, 'n', n)) from (
        select extract(dow from ts)::int dw, extract(hour from ts)::int h, count(*) n from ven_ges where ts::date >= v_ini90 group by 1, 2) x), '[]'::jsonb),
    'dias_venta', coalesce((select jsonb_agg(jsonb_build_object('dw', dw, 'monto', m, 'n', n)) from (
        select extract(dow from d)::int dw, sum(base) m, count(*) n from ven_fac where d >= v_ini6 group by 1) x), '[]'::jsonb),
    'embudo', jsonb_build_object(
        'leads', (select count(*) from public.leads l where l.deleted_at is null and l.asesor_id = any(v_ids) and (l.fecha at time zone 'America/Guayaquil')::date >= v_ini90),
        'gestiones', (select count(*) from ven_ges where ts::date >= v_ini90),
        'proformas', (select count(*) from ven_prof where d >= v_ini90),
        'ventas', (select count(*) from ven_fac where d >= v_ini90)),
    'equipo_cierre', (select round(100.0 * count(*) filter (where t = 'v') / nullif(count(*) filter (where t = 'p'), 0), 1) from (
        select 'v' t from public.facturas f where f.deleted_at is null and coalesce(f.fecha_ganado, (f.created_at at time zone 'America/Guayaquil')::date) >= v_ini90 and coalesce(f.fecha_ganado, (f.created_at at time zone 'America/Guayaquil')::date) < v_fin
        union all select 'p' from public.cotizaciones c where c.deleted_at is null and c.tipo_registro <> 'Histórico' and (c.fecha at time zone 'America/Guayaquil')::date >= v_ini90 and (c.fecha at time zone 'America/Guayaquil')::date < v_fin) z),
    'ciclo', (select round(avg(f.d - (c.fecha at time zone 'America/Guayaquil')::date)) from ven_fac f join public.cotizaciones c on c.id = f.cotizacion_id
               where f.d >= v_ini6 and (c.fecha at time zone 'America/Guayaquil')::date <= f.d),
    'pipeline', jsonb_build_object(
        'monto', coalesce((select sum(c.total) from public.cotizaciones c where c.deleted_at is null and c.asesor_id = any(v_ids) and c.tipo_registro = 'Cotización' and coalesce(c.estado_crm, '') not in ('Ganado', 'Perdido') and c.fecha > now() - interval '120 days'), 0),
        'n', (select count(*) from public.cotizaciones c where c.deleted_at is null and c.asesor_id = any(v_ids) and c.tipo_registro = 'Cotización' and coalesce(c.estado_crm, '') not in ('Ganado', 'Perdido') and c.fecha > now() - interval '120 days'),
        'frias', (select count(*) from public.cotizaciones c where c.deleted_at is null and c.asesor_id = any(v_ids) and c.tipo_registro = 'Cotización' and coalesce(c.estado_crm, '') not in ('Ganado', 'Perdido')
                   and c.fecha > now() - interval '120 days' and coalesce(c.ultima_actividad, c.fecha) < now() - interval '7 days'),
        'top', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
            select jsonb_build_object('id', c.id, 'codigo', c.codigo, 'cliente', coalesce(cl.nombre, c.nombre), 'total', coalesce(c.total, 0), 'estado', c.estado_crm,
                     'dias', (v_hoy - (coalesce(c.ultima_actividad, c.fecha) at time zone 'America/Guayaquil')::date), 'seguimiento', c.proximo_seguimiento, 'asesor', e.nombre) x
              from public.cotizaciones c left join public.clientes cl on cl.id = c.cliente_id left join public.empleados e on e.id = c.asesor_id
             where c.deleted_at is null and c.asesor_id = any(v_ids) and c.tipo_registro = 'Cotización' and coalesce(c.estado_crm, '') not in ('Ganado', 'Perdido')
               and c.fecha > now() - interval '120 days'
             order by c.total desc nulls last limit 8) t), '[]'::jsonb))
  );

  -- Equipo: tabla por asesor (vista general) o solo el puesto (vista del asesor)
  if v_general then
    r := r || jsonb_build_object('equipo', coalesce((select jsonb_agg(x order by (x->>'monto')::numeric desc) from (
      select jsonb_build_object('id', q.id, 'nombre', q.nombre, 'foto_url', q.foto_url, 'empresa', q.empresa,
        'meta', (select m.monto from public.metas_ventas m where m.deleted_at is null and m.mes = v_mes and m.empleado_id = q.id),
        'minimo', (select m.minimo from public.metas_ventas m where m.deleted_at is null and m.mes = v_mes and m.empleado_id = q.id),
        'monto', coalesce((select sum(base) from ven_fac f where f.asesor_id = q.id and f.d >= v_mes), 0),
        'n', (select count(*) from ven_fac f where f.asesor_id = q.id and f.d >= v_mes),
        'prev', coalesce((select sum(base) from ven_fac f where f.asesor_id = q.id and f.d >= v_prev and f.d < v_mes), 0),
        'proformas', (select count(*) from ven_prof p where p.asesor_id = q.id and p.d >= v_mes),
        'gestiones', (select count(*) from ven_ges g where g.empleado_id = q.id and g.ts::date >= v_mes),
        'cierre', (select round(100.0 * (select count(*) from ven_fac f where f.asesor_id = q.id and f.d >= v_ini90) / nullif((select count(*) from ven_prof p where p.asesor_id = q.id and p.d >= v_ini90), 0), 1)),
        'pipeline', coalesce((select sum(c.total) from public.cotizaciones c where c.deleted_at is null and c.asesor_id = q.id and c.tipo_registro = 'Cotización' and coalesce(c.estado_crm, '') not in ('Ganado', 'Perdido') and c.fecha > now() - interval '120 days'), 0)) x
      from app.ven_equipo() q) t), '[]'::jsonb));
  else
    r := r || jsonb_build_object('puesto', (
      with tot as (
        select f.asesor_id, sum(greatest(coalesce(f.subtotal, f.total / 1.15, 0) - coalesce(f.total_notas_credito, 0) / 1.15, 0)) m
          from public.facturas f
         where f.deleted_at is null and f.asesor_id is not null
           and coalesce(f.fecha_ganado, (f.created_at at time zone 'America/Guayaquil')::date) >= v_mes
           and coalesce(f.fecha_ganado, (f.created_at at time zone 'America/Guayaquil')::date) < v_fin
         group by 1)
      select jsonb_build_object('puesto', (select count(*) + 1 from tot where m > coalesce((select m from tot where asesor_id = p_asesor), 0)), 'de', (select count(*) from tot))));
  end if;
  return r;
end;
$$;
revoke all on function public.ven_panel(uuid, date) from public, anon;
grant execute on function public.ven_panel(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- Guardar meta: el asesor la suya (desde el mes actual); coordinación la de su equipo (queda como mínimo)
-- ---------------------------------------------------------------------
create or replace function public.ven_meta_guardar(p_empleado uuid, p_mes date, p_monto numeric, p_ventas integer default null,
  p_proformas integer default null, p_gestiones integer default null, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yo uuid := app.empleado_id();
  v_mes date := date_trunc('month', p_mes)::date;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_coord boolean;
  m public.metas_ventas;
begin
  if p_empleado is null or v_mes is null then raise exception 'Faltan datos de la meta.'; end if;
  if p_monto is null or p_monto < 0 or p_monto > 99999999 then raise exception 'Escribe la meta en dólares.'; end if;
  if coalesce(p_ventas, 0) < 0 or coalesce(p_proformas, 0) < 0 or coalesce(p_gestiones, 0) < 0 then raise exception 'Las metas no pueden ser negativas.'; end if;
  v_coord := p_empleado is distinct from v_yo and (app.ven_todos() or app.es_yo_o_subordinado(p_empleado));
  if p_empleado is distinct from v_yo and not v_coord then raise exception 'Solo puedes poner tus propias metas.'; end if;
  if not v_coord and v_mes < date_trunc('month', v_hoy)::date then raise exception 'Las metas de meses pasados solo las cambia la coordinación.'; end if;

  select * into m from public.metas_ventas where empleado_id = p_empleado and mes = v_mes and deleted_at is null for update;
  if found and not v_coord and m.minimo is not null and p_monto < m.minimo then
    raise exception 'Tu coordinación fijó una meta mínima de $%: puedes subirla, no bajarla.', to_char(m.minimo, 'FM999G999G990D00');
  end if;
  if found then
    update public.metas_ventas set monto = round(p_monto, 2), ventas = p_ventas, proformas = p_proformas, gestiones = p_gestiones, nota = nullif(trim(coalesce(p_nota, '')), ''),
           minimo = case when v_coord then round(p_monto, 2) else minimo end, fijada_por = case when v_coord then v_yo else fijada_por end
     where id = m.id returning * into m;
  else
    insert into public.metas_ventas (id, empleado_id, mes, monto, ventas, proformas, gestiones, nota, minimo, fijada_por, creado_por)
    values (gen_random_uuid(), p_empleado, v_mes, round(p_monto, 2), p_ventas, p_proformas, p_gestiones, nullif(trim(coalesce(p_nota, '')), ''),
            case when v_coord then round(p_monto, 2) end, case when v_coord then v_yo end, v_yo)
    returning * into m;
  end if;
  return to_jsonb(m);
end;
$$;
revoke all on function public.ven_meta_guardar(uuid, date, numeric, integer, integer, integer, text) from public, anon;
grant execute on function public.ven_meta_guardar(uuid, date, numeric, integer, integer, integer, text) to authenticated;
