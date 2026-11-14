-- Promociones: lo que faltaba del original (Promociones.gs) — Issue #34
--   cancelar_campana_promocion (prCancelar): al cancelar una campaña aprobada, sus ofertas se cancelan.
--   promo_tablero (prTablero): ventas de la campaña por producto, día y asesor.
--   promo_interesados (prInteresados): clientes que cotizaron sus equipos y no compraron, por asesor.

/** Códigos de los productos de una campaña: con descuento (o todos si no está aprobada) y los de sus combos. */
create or replace function app.promo_codigos(c public.promo_campanas, p_todos boolean) returns text[]
language sql stable as $$
  select coalesce(array_agg(distinct k), '{}') from (
    select i ->> 'id' as k from jsonb_array_elements(coalesce(c.items, '[]'::jsonb)) i
     where p_todos or coalesce((i ->> 'desc')::numeric, 0) > 0
    union
    select p #>> '{}' from jsonb_array_elements(coalesce(c.combos, '[]'::jsonb)) cb, jsonb_array_elements(coalesce(cb -> 'productos', '[]'::jsonb)) p
  ) x where coalesce(k, '') <> '';
$$;

create or replace function public.cancelar_campana_promocion(p_campana_id uuid, p_comentario text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.promo_campanas; yo uuid := app.empleado_id(); v_nombre text; n int := 0;
begin
  select * into c from public.promo_campanas where id = p_campana_id and deleted_at is null for update;
  if c.id is null then raise exception 'No se encontró la campaña.'; end if;
  if c.estado = 'Cancelada' then return jsonb_build_object('ok', true, 'canceladas', 0); end if;
  if c.estado = 'Aprobada' then
    if not app.puede_alguno(array['marketing', 'promociones'], 'aprobar') then raise exception 'Una campaña aprobada solo la puede cancelar quien aprueba.'; end if;
  elsif not (app.puede_alguno(array['marketing', 'promociones'], 'aprobar') or app.puede_alguno(array['marketing', 'promociones'], 'editar') or c.creado_por = yo) then
    raise exception 'No puedes cancelar esta campaña.';
  end if;
  select nombre into v_nombre from public.empleados where id = yo;
  if c.estado = 'Aprobada' then
    update public.ofertas
       set estado = 'Cancelada', actualizado_por = yo,
           historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('f', now(), 'por', coalesce(v_nombre, ''), 'n', 'Cancelada con la campaña ' || c.nombre))
     where campana_id = c.id and deleted_at is null and estado not in ('Finalizada', 'Cancelada');
    get diagnostics n = row_count;
  end if;
  update public.promo_campanas
     set estado = 'Cancelada', comentario = nullif(btrim(coalesce(p_comentario, '')), ''), actualizado_por = yo,
         historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', coalesce(v_nombre, ''),
           'accion', 'Cancelada' || case when n > 0 then ' (' || n || ' oferta(s))' else '' end) || case when nullif(btrim(coalesce(p_comentario, '')), '') is null then '{}'::jsonb else jsonb_build_object('comentario', btrim(p_comentario)) end)
   where id = c.id;
  perform app.auditar('marketing', 'Cancelar campaña', coalesce(c.codigo, c.nombre), 'OK', n || ' oferta(s) cancelada(s)');
  return jsonb_build_object('ok', true, 'canceladas', n);
end $$;

/** Tablero en vivo de una campaña aprobada (prTablero / prVentas_). */
create or replace function public.promo_tablero(p_campana_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.promo_campanas; cods text[]; v_ini timestamptz; v_hasta timestamptz; hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_prod jsonb; v_dias jsonb; v_ases jsonb; v_tot jsonb; v_capital numeric;
begin
  if not app.puede_alguno(array['marketing', 'promociones', 'ofertas'], 'ver') then raise exception 'Sin acceso a Promociones.'; end if;
  select * into c from public.promo_campanas where id = p_campana_id and deleted_at is null;
  if c.id is null then raise exception 'No se encontró la campaña.'; end if;
  if c.estado <> 'Aprobada' then raise exception 'El tablero se activa cuando la campaña está aprobada.'; end if;
  if c.inicio is null or c.fin is null then raise exception 'La campaña no tiene fechas.'; end if;
  cods := app.promo_codigos(c, false);
  v_ini := (c.inicio - case when c.preventa then coalesce(c.preventa_dias, 0) else 0 end)::timestamp at time zone 'America/Guayaquil';
  v_hasta := least(now(), (c.fin + 1)::timestamp at time zone 'America/Guayaquil');

  create temp table if not exists _pt_ventas (codigo text, dia date, asesor text, operacion text, u numeric, m numeric) on commit drop;
  truncate _pt_ventas;
  insert into _pt_ventas
  select p.codigo, (mv.fecha at time zone 'America/Guayaquil')::date, coalesce(nullif(split_part(coalesce(e.nombre, mv.responsable_texto, ''), ' (', 1), ''), 'Sin asesor'),
         nullif(mv.operacion_codigo, ''), abs(mv.cantidad), abs(mv.cantidad) * coalesce(mv.precio, 0) * (1 - coalesce(mv.descuento, 0) / 100.0)
    from public.movimientos_inventario mv
    join public.productos p on p.id = mv.producto_id
    left join public.empleados e on e.id = mv.responsable_id
   where mv.deleted_at is null and p.codigo = any (cods)
     and mv.tipo not in ('INGRESO', 'DEVOLUCION') and mv.tipo not like 'TRASLADO%' and coalesce(mv.bodega, '') <> 'Por reparar'
     and mv.fecha >= v_ini and mv.fecha <= v_hasta;

  select coalesce(jsonb_agg(x order by (x ->> 'monto')::numeric desc, (x ->> 'web')::boolean desc), '[]'::jsonb), coalesce(sum((x ->> 'stockInicial')::numeric * (x ->> 'pvp')::numeric), 0)
    into v_prod, v_capital
    from (select jsonb_build_object('id', p.codigo, 'nombre', p.nombre, 'img', coalesce(p.imagen_url, ''), 'web', coalesce(p.en_vista_publica, false),
            'desc', (i ->> 'desc')::numeric, 'pvp', coalesce(p.pvp, 0), 'precio', round(coalesce(p.pvp, 0) * (1 - (i ->> 'desc')::numeric / 100), 2),
            'stockInicial', o.stock_inicial, 'stock', p.stock, 'vendidas', coalesce(v.u, 0), 'monto', round(coalesce(v.m, 0), 2),
            'quedan', case when o.stock_inicial is null then null else greatest(0, o.stock_inicial - coalesce(v.u, 0)) end) x
            from jsonb_array_elements(coalesce(c.items, '[]'::jsonb)) i
            join public.productos p on p.codigo = i ->> 'id' and p.deleted_at is null
            left join lateral (select stock_inicial from public.ofertas where campana_id = c.id and producto_id = p.id and deleted_at is null order by created_at desc limit 1) o on true
            left join lateral (select sum(u) u, sum(m) m from _pt_ventas where codigo = p.codigo) v on true
           where coalesce((i ->> 'desc')::numeric, 0) > 0) t;
  select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'u', u, 'm', round(m, 2)) order by dia), '[]'::jsonb) into v_dias
    from (select dia, sum(u) u, sum(m) m from _pt_ventas group by dia) d;
  select coalesce(jsonb_agg(jsonb_build_object('asesor', asesor, 'u', u, 'm', round(m, 2), 'ventas', nullif(ops, 0)) order by m desc), '[]'::jsonb) into v_ases
    from (select asesor, sum(u) u, sum(m) m, count(distinct operacion) ops from _pt_ventas group by asesor) a;
  select jsonb_build_object('unidades', coalesce(sum(u), 0), 'monto', round(coalesce(sum(m), 0), 2),
           'hoyU', coalesce(sum(u) filter (where dia = hoy), 0), 'hoyM', round(coalesce(sum(m) filter (where dia = hoy), 0), 2),
           'ventas', nullif(count(distinct operacion), 0))
    into v_tot from _pt_ventas;
  v_tot := v_tot || jsonb_build_object('capitalInicial', round(v_capital, 2), 'equipos', jsonb_array_length(v_prod),
    'movidos', (select count(*) from jsonb_array_elements(v_prod) x where (x ->> 'vendidas')::numeric > 0),
    'descPromedio', (select round(avg((x ->> 'desc')::numeric), 1) from jsonb_array_elements(v_prod) x));
  return jsonb_build_object('id', c.id, 'codigo', c.codigo, 'nombre', c.nombre, 'inicio', c.inicio, 'fin', c.fin, 'preventa', c.preventa,
    'estado', case when c.fin < hoy then 'Finalizada' when c.inicio > hoy then 'Programada' else 'En curso' end,
    'totales', v_tot, 'productos', v_prod, 'dias', v_dias, 'asesores', v_ases,
    'combos', (select coalesce(jsonb_agg(cb), '[]'::jsonb) from jsonb_array_elements(coalesce(c.combos, '[]'::jsonb)) cb where coalesce((cb ->> 'precio')::numeric, 0) > 0),
    'generado', now());
end $$;

/** Clientes que cotizaron los equipos de la campaña y no compraron, por asesor (prInteresados). */
create or replace function public.promo_interesados(p_campana_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.promo_campanas; cods text[]; v_lista jsonb; v_total int;
begin
  if not app.puede_alguno(array['marketing', 'promociones', 'ofertas'], 'ver') then raise exception 'Sin acceso a Promociones.'; end if;
  select * into c from public.promo_campanas where id = p_campana_id and deleted_at is null;
  if c.id is null then raise exception 'No se encontró la campaña.'; end if;
  cods := (app.promo_codigos(c, c.estado <> 'Aprobada'))[1:80];
  with base as (
    select distinct on (k.codigo, coalesce(nullif(regexp_replace(coalesce(q.telefono, ''), '\D', '', 'g'), ''), nullif(lower(btrim(coalesce(q.email, ''))), ''), q.nombre))
           k.codigo, p.nombre as producto, q.nombre, regexp_replace(coalesce(q.telefono, ''), '\D', '', 'g') as telefono, lower(btrim(coalesce(q.email, ''))) as email,
           q.fecha, q.estado_crm, q.empresa, coalesce(nullif(split_part(coalesce(e.nombre, ''), ' (', 1), ''), 'Sin asesor') as asesor,
           (select (it ->> 'precio')::numeric from jsonb_array_elements(q.items) it where it ->> 'codigo' = k.codigo limit 1) as precio_cotizado,
           (select (i ->> 'desc')::numeric from jsonb_array_elements(coalesce(c.items, '[]'::jsonb)) i where i ->> 'id' = k.codigo and coalesce((i ->> 'desc')::numeric, 0) > 0 limit 1) as descu,
           p.pvp
      from unnest(cods) k(codigo)
      join public.productos p on p.codigo = k.codigo and p.deleted_at is null
      join public.cotizaciones q on q.deleted_at is null and q.tipo_registro <> 'Venta' and coalesce(q.estado_crm, '') not ilike '%ganado%'
           and q.items @> jsonb_build_array(jsonb_build_object('codigo', k.codigo)) and q.fecha > now() - interval '540 days'
      left join public.empleados e on e.id = q.asesor_id
     order by k.codigo, coalesce(nullif(regexp_replace(coalesce(q.telefono, ''), '\D', '', 'g'), ''), nullif(lower(btrim(coalesce(q.email, ''))), ''), q.nombre), q.fecha desc
  ), lim as (
    select * from (select b.*, row_number() over (partition by codigo order by fecha desc) rn from base b) z where rn <= 60
  )
  select coalesce(jsonb_agg(jsonb_build_object('asesor', asesor, 'contactos', contactos) order by n desc), '[]'::jsonb), coalesce(sum(n), 0)
    into v_lista, v_total
    from (select asesor, count(*) n, jsonb_agg(jsonb_build_object('nombre', coalesce(nombre, ''), 'telefono', telefono, 'email', email, 'fecha', fecha, 'estado', coalesce(estado_crm, ''),
            'empresa', empresa, 'productoId', codigo, 'producto', producto, 'precioCotizado', precio_cotizado,
            'oferta', case when descu is null then null else jsonb_build_object('desc', descu, 'precio', round(coalesce(pvp, 0) * (1 - descu / 100), 2), 'pvp', pvp) end) order by fecha desc) contactos
            from lim group by asesor) g;
  return jsonb_build_object('campana', c.nombre, 'fin', c.fin, 'preventa', c.preventa, 'total', v_total, 'asesores', v_lista);
end $$;

revoke all on function app.promo_codigos(public.promo_campanas, boolean) from public, anon, authenticated;
revoke all on function public.cancelar_campana_promocion(uuid, text) from public, anon;
revoke all on function public.promo_tablero(uuid) from public, anon;
revoke all on function public.promo_interesados(uuid) from public, anon;
grant execute on function public.cancelar_campana_promocion(uuid, text) to authenticated;
grant execute on function public.promo_tablero(uuid) to authenticated;
grant execute on function public.promo_interesados(uuid) to authenticated;
notify pgrst, 'reload schema';
