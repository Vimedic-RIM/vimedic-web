-- =====================================================================
-- Ofertas vigentes · regla de apagado y desempate del original (Issue #41)
-- El CRM (formularios de proforma y venta) aplica la oferta sola al elegir el producto, como la app original.
-- Esta función suma dos datos a cada oferta, tomados de ofActivasMapa_ / prQuedan_ de la app original:
--   quedan  = unidades que quedan para la oferta: el stock (sin negativos) y, si la oferta tiene límite de unidades,
--             el límite menos lo vendido (vendidas = stock inicial − stock actual).
--   apagada = la oferta de campaña (o con límite de unidades) a la que ya no le quedan unidades: no se debe aplicar.
-- Todas las ofertas siguen saliendo (Inventario y el PDF filtran por su cuenta); quien aplica precios descarta las apagadas.
-- Desempate: si un producto tiene varias ofertas vigentes, gana la de MAYOR descuento (en el original, la más alta);
-- a igual descuento, la más reciente. La vigente va antes que la próxima.
-- Sigue sin devolver costo ni margen.
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
    order by o.producto_id,
             (o.inicio is null or o.inicio <= hoy) desc,
             case when o.inicio > hoy then o.inicio end nulls first,
             coalesce(o.descuento_pct, 0) desc,
             o.created_at desc
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
      'campana', coalesce(pc.nombre, ''),
      'limite', coalesce(u.unidades_limite, 0), 'quedan', q.quedan, 'deCampana', u.campana_id is not null,
      'apagada', coalesce(q.quedan = 0 and (coalesce(u.unidades_limite, 0) > 0 or u.campana_id is not null), false))
    order by p.en_vista_publica desc, c.orden nulls last, c.nombre, p.orden nulls last, p.nombre), '[]'::jsonb)
  into r
  from una u
  join public.productos p on p.id = u.producto_id and p.deleted_at is null
    and lower(coalesce(p.estado, '')) <> 'inactivo'
  left join public.categorias c on c.id = p.categoria_id
  left join public.promo_campanas pc on pc.id = u.campana_id
  cross join lateral (
    select case
      when p.stock is null then null
      when not (coalesce(u.unidades_limite, 0) > 0) then greatest(0, p.stock)
      else greatest(0, least(greatest(0, p.stock),
             u.unidades_limite - case when coalesce(u.stock_inicial, 0) > 0 then greatest(0, u.stock_inicial - greatest(0, p.stock)) else 0 end))
    end as quedan
  ) q;

  return r;
end $$;

revoke all on function public.inv_ofertas_vigentes(boolean) from public, anon;
grant execute on function public.inv_ofertas_vigentes(boolean) to authenticated;
notify pgrst, 'reload schema';
