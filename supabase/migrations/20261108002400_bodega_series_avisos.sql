-- Bodega: buscar un número de serie (a qué cliente/factura salió) y avisar novedades al asesor.
create or replace function public.bodega_buscar_serie(p_q text)
returns table (serie text, producto text, codigo text, despacho text, despacho_id uuid, cliente text, factura text, estado text, fecha timestamptz)
language sql stable security invoker set search_path = public as $$
  select s.v, p->>'nombre', p->>'id', d.codigo, d.id, d.cliente_texto, d.factura_texto,
         case when s.i <= coalesce((p->>'despachado')::int, 0) then 'Despachada' else 'En bodega' end,
         coalesce(d.fecha_despacho, d.fecha)
  from public.despachos d,
       jsonb_array_elements(d.productos) p,
       jsonb_array_elements_text(coalesce(d.series -> (p->>'key'), '[]'::jsonb)) with ordinality s(v, i)
  where d.deleted_at is null and btrim(s.v) <> '' and length(btrim(p_q)) >= 3
    and upper(s.v) like '%' || upper(btrim(p_q)) || '%'
  order by coalesce(d.fecha_despacho, d.fecha) desc
  limit 50
$$;
grant execute on function public.bodega_buscar_serie(text) to authenticated;
revoke execute on function public.bodega_buscar_serie(text) from anon, public;

create or replace function public.bodega_avisar_novedad(p_id uuid, p_tipo text, p_detalle text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.despachos;
begin
  if not app.puede('bodega', 'editar') then raise exception 'Sin permiso en Bodega'; end if;
  select * into d from public.despachos where id = p_id;
  if found and d.asesor_id is not null then
    insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (d.asesor_id, 'bodega', 'novedad', 'alerta',
            'Bodega · Novedad en despacho ' || d.codigo || ' (' || coalesce(d.cliente_texto, '') || '): ' || p_tipo || ' — ' || left(p_detalle, 300),
            'despachos', d.id);
  end if;
end;
$$;
revoke all on function public.bodega_avisar_novedad(uuid, text, text) from public, anon;
grant execute on function public.bodega_avisar_novedad(uuid, text, text) to authenticated;
