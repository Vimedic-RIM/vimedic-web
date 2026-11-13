-- Marketing › Biblioteca: subir imagen principal y fotos/videos de la galería desde la computadora
-- (mkCambiarImagen, mkSubirImagenProducto, galSubir del original) y las vistas "Por completar" y
-- "Videos pendientes" (mkfPendientes).

-- 1) Espacio público para las imágenes del catálogo (WebP). Cuando el catálogo pase a R2
--    (media.vimedic.com.ec) se mueven allá; mientras tanto se sirven desde la app.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalogo', 'catalogo', true, 52428800, array['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists catalogo_subir on storage.objects;
create policy catalogo_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogo' and (app.puede('marketing', 'crear') or app.puede('marketing', 'editar') or app.puede('inventario', 'editar')));
drop policy if exists catalogo_editar on storage.objects;
create policy catalogo_editar on storage.objects for update to authenticated
  using (bucket_id = 'catalogo' and (app.puede('marketing', 'editar') or app.puede('inventario', 'editar')));

-- 2) Productos por completar y videos pendientes, ordenados por prioridad (mkfPendientes).
--    Falta: imagen principal, 3 fotos, descripción, características, especificaciones y video.
--    Prioridad: cotizaciones del último año, nuevos con stock, nuevos.
create or replace function public.mkt_pendientes()
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.puede('marketing', 'ver') then raise exception 'Sin acceso a Marketing.'; end if;
  return jsonb_build_object(
    'tiposVideo', jsonb_build_array('Comercial', 'Informativo', 'Reel para redes', 'Técnico', 'Demostración en uso', 'Testimonio'),
    'videosCompleto', jsonb_build_array('Comercial', 'Informativo', 'Reel para redes'),
    'productos', coalesce((
      with cot as (
        select it ->> 'id' as cod, count(distinct c.id) as n
          from public.cotizaciones c,
               lateral jsonb_array_elements(case when jsonb_typeof(c.items) = 'array' then c.items else '[]'::jsonb end) it
         where c.deleted_at is null and c.fecha >= now() - interval '365 days' and coalesce(c.estado_crm, '') <> 'Eliminado'
         group by 1
      ), gal as (
        select producto_id, count(*) filter (where tipo <> 'video') as fotos, count(*) filter (where tipo = 'video') as videos
          from public.producto_galeria where deleted_at is null group by 1
      ), tipos as (
        select producto_id, jsonb_object_agg(t, n) as tipos
          from (select producto_id, coalesce(nullif(tipo_video, ''), 'Sin tipo') as t, count(*) as n
                  from public.producto_galeria where deleted_at is null and tipo = 'video' group by 1, 2) x
         group by 1
      ), abiertos as (
        select producto_id, count(distinct campo) as n
          from public.marketing_cambios where deleted_at is null and estado in ('Pendiente', 'Con cambios') and producto_id is not null group by 1
      ), base as (
        select p.id, p.codigo, p.nombre, cat.nombre as categoria, p.marca, p.imagen_url, p.en_catalogo, coalesce(p.stock, 0) as stock,
               coalesce(cot.n, 0) as cot, coalesce(p.fecha_creacion::timestamptz, p.created_at) >= now() - interval '60 days' as nuevo,
               coalesce(g.fotos, 0) as fotos, coalesce(g.videos, 0) as videos, coalesce(t.tipos, '{}'::jsonb) as tipos, coalesce(a.n, 0) as en_revision,
               p.ficha_tecnica_url,
               array_remove(array[
                 case when coalesce(btrim(p.imagen_url), '') = '' then 'imagen' end,
                 case when coalesce(g.fotos, 0) < 3 then 'fotos' end,
                 case when coalesce(btrim(p.descripcion), '') = '' then 'descripcion' end,
                 case when coalesce(btrim(p.caracteristicas), '') = '' then 'caracteristicas' end,
                 case when coalesce(btrim(p.especificaciones), '') = '' then 'especificaciones' end,
                 case when coalesce(g.videos, 0) = 0 then 'video' end], null) as falta,
               coalesce(cat.nombre, '') !~* 'flete|servicio|insumo|repuesto' as web
          from public.productos p
          left join public.categorias cat on cat.id = p.categoria_id
          left join cot on cot.cod = p.codigo
          left join gal g on g.producto_id = p.id
          left join tipos t on t.producto_id = p.id
          left join abiertos a on a.producto_id = p.id
         where p.deleted_at is null and not coalesce(p.oculto, false) and coalesce(p.estado, '') !~* '^inactivo'
      )
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'codigo', b.codigo, 'nombre', b.nombre, 'categoria', b.categoria, 'marca', b.marca, 'imagen', b.imagen_url,
               'publico', b.en_catalogo, 'web', b.web, 'cot', b.cot, 'nuevo', b.nuevo, 'stock', b.stock, 'falta', to_jsonb(b.falta),
               'pct', round((6 - cardinality(b.falta)) * 100.0 / 6), 'fotos', b.fotos, 'videos', b.videos, 'tiposVideo', b.tipos,
               'faltanTipos', (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(array['Comercial', 'Informativo', 'Reel para redes']) x where not b.tipos ? x),
               'enRevision', b.en_revision, 'ficha', b.ficha_tecnica_url is not null and b.ficha_tecnica_url <> '',
               'estado', case when b.en_revision > 0 then 'revision' when cardinality(b.falta) = 0 then 'completo' when cardinality(b.falta) >= 5 then 'sin_empezar' else 'progreso' end)
             order by b.web desc, (b.cot * 10 + case when b.nuevo and b.stock > 0 then 50 else 0 end + case when b.nuevo then 20 else 0 end) desc, b.cot desc, b.nombre)
        from base b
    ), '[]'::jsonb));
end;
$$;
revoke all on function public.mkt_pendientes() from public, anon;
grant execute on function public.mkt_pendientes() to authenticated;
