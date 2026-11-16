-- =====================================================================
-- Inventario · Ofertas vigentes (Issue #39) — corrección del desempate
-- Entre dos ofertas vigentes del mismo producto gana la más reciente (antes ganaba la que empezó primero);
-- entre dos próximas, la que empieza antes.
-- Quien ve Inventario ve las ofertas aprobadas que están vigentes (y, si lo pide, las próximas),
-- para la etiqueta OFERTA y el PDF para clientes. Sin costo ni margen: no se abre la tabla
-- ofertas (su RLS es de Ofertas/Marketing/CRM); esta función devuelve solo lo que va al cliente.
-- Vigente = no cancelada ni pausada, ya empezó y no ha terminado (hora de Ecuador), igual que estadoDe() de Ofertas.
-- Una oferta por producto: la vigente antes que la próxima; si hay dos, la más reciente.
-- =====================================================================
create or replace function public.inv_ofertas_vigentes(p_proximas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hoy date := (now() at time zone 'America/Guayaquil')::date;
  r jsonb;
begin
  if not (app.es_superadmin() or app.puede_alguno(array['inventario', 'ofertas', 'crm', 'femedics'], 'ver')) then
    raise exception 'Sin permiso para ver las ofertas.';
  end if;

  with una as (
    select distinct on (o.producto_id) o.*
    from public.ofertas o
    where o.deleted_at is null and o.producto_id is not null
      and coalesce(o.estado, '') not in ('Cancelada', 'Pausada', 'Finalizada')
      and coalesce(o.precio_oferta, 0) > 0
      and (o.fin is null or o.fin >= hoy)
      and (o.inicio is null or o.inicio <= hoy or p_proximas)
    order by o.producto_id, (o.inicio is null or o.inicio <= hoy) desc,
             case when o.inicio > hoy then o.inicio end nulls first, o.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ofertaId', u.id, 'codigoOferta', u.codigo, 'productoId', p.id, 'codigo', p.codigo, 'nombre', p.nombre,
      'marca', coalesce(p.marca, ''), 'categoriaId', p.categoria_id, 'categoria', coalesce(c.nombre, 'Sin categoría'), 'catOrden', c.orden,
      'img', coalesce(p.imagen_url, ''), 'publico', p.en_vista_publica, 'stock', coalesce(p.stock, 0),
      'pvp', coalesce(nullif(u.pvp_base, 0), p.pvp, 0), 'precio', u.precio_oferta, 'descuento', coalesce(u.descuento_pct, 0),
      'iva', p.aplica_iva is not false, 'tipo', coalesce(u.tipo, ''),
      'inicio', to_char(u.inicio, 'YYYY-MM-DD'), 'fin', to_char(u.fin, 'YYYY-MM-DD'),
      'proxima', u.inicio is not null and u.inicio > hoy,
      'texto', coalesce(u.texto_cliente, ''), 'regalo', coalesce(u.regalo, ''), 'combo', coalesce(u.combo_con, ''),
      'campana', coalesce(pc.nombre, ''))
    order by p.en_vista_publica desc, c.orden nulls last, c.nombre, p.orden nulls last, p.nombre), '[]'::jsonb)
  into r
  from una u
  join public.productos p on p.id = u.producto_id and p.deleted_at is null
    and lower(coalesce(p.estado, '')) <> 'inactivo'
  left join public.categorias c on c.id = p.categoria_id
  left join public.promo_campanas pc on pc.id = u.campana_id;

  return r;
end $$;

revoke all on function public.inv_ofertas_vigentes(boolean) from public, anon;
grant execute on function public.inv_ofertas_vigentes(boolean) to authenticated;
notify pgrst, 'reload schema';
