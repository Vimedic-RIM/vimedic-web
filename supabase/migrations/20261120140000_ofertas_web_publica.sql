-- =====================================================================
-- Ofertas en la web pública (vimedic.com.ec): «Black Sales» y cualquier campaña vigente.
--   web_ofertas_publicas() arma SOLO lo publicable: campaña, fechas, producto visible en el catálogo
--   (en_catalogo y no oculto), su imagen y el % de descuento. Sin precios (política de la empresa: la web no
--   muestra precios), sin costos ni márgenes.
--   · Ofertas vigentes con las mismas reglas que inv_ofertas_vigentes (no canceladas/pausadas/finalizadas,
--     dentro de fechas, con precio de oferta) y para clientes del público: aplica_a 'PVP' o 'AMBOS' (no las de distribuidor).
--   · Un producto con varias ofertas: la de mayor descuento.
--   No es una vista para anon: la ejecuta solo la Edge Function pública «ofertas-web» con service_role
--   (CLAUDE.md: nada de políticas anon fuera de v_catalogo_publico, categorías y aliados).
-- =====================================================================

create or replace function public.web_ofertas_publicas()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with hoy as (select (now() at time zone 'America/Guayaquil')::date as d),
  cand as (
    select distinct on (o.producto_id)
           o.producto_id, o.descuento_pct, o.fin, o.inicio, o.texto_cliente, o.regalo, o.tipo, c.id as campana_id, c.nombre as campana, c.inicio as c_inicio, c.fin as c_fin
      from public.ofertas o
      join public.productos p on p.id = o.producto_id
      left join public.promo_campanas c on c.id = o.campana_id and c.deleted_at is null
      cross join hoy
     where o.deleted_at is null and o.producto_id is not null
       and coalesce(o.estado, '') not in ('Cancelada', 'Pausada', 'Finalizada')
       and coalesce(o.precio_oferta, 0) > 0 and coalesce(o.descuento_pct, 0) > 0
       and (o.fin is null or o.fin >= hoy.d) and (o.inicio is null or o.inicio <= hoy.d)
       and o.aplica_a in ('PVP', 'AMBOS')
       and p.deleted_at is null and p.en_catalogo and not p.oculto and coalesce(p.codigo, '') <> ''
     order by o.producto_id, o.descuento_pct desc, o.created_at desc
  ),
  prods as (
    select c.*, p.codigo, p.nombre, coalesce(p.marca, '') as marca, coalesce(p.imagen_url, '') as imagen,
           coalesce(cat.nombre, 'Otros') as categoria, coalesce(cat.orden, 999) as cat_orden
      from cand c join public.productos p on p.id = c.producto_id left join public.categorias cat on cat.id = p.categoria_id
  )
  select jsonb_build_object(
    'hoy', (select d from hoy),
    'campanas', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', x.campana, 'inicio', x.inicio, 'fin', x.fin, 'productos', x.n, 'maxDescuento', x.maxd) order by x.n desc)
        from (select coalesce(campana, 'Ofertas') as campana, min(coalesce(c_inicio, inicio)) as inicio, max(coalesce(c_fin, fin)) as fin, count(*) as n, max(descuento_pct) as maxd
                from prods group by coalesce(campana, 'Ofertas')) x), '[]'::jsonb),
    'productos', coalesce((
      select jsonb_agg(jsonb_build_object(
          'codigo', codigo, 'nombre', nombre, 'marca', marca, 'categoria', categoria, 'imagen', imagen,
          'descuento', round(descuento_pct)::int, 'campana', coalesce(campana, 'Ofertas'), 'fin', fin,
          'texto', coalesce(texto_cliente, ''), 'regalo', coalesce(regalo, ''))
        order by cat_orden, categoria, descuento_pct desc, nombre)
        from prods), '[]'::jsonb)
  )
$$;
revoke all on function public.web_ofertas_publicas() from public, anon, authenticated;
-- sin grant: solo service_role (la Edge Function ofertas-web)
