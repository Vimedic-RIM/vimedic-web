-- =====================================================================
-- VIMEDIC · Módulo «Documentos técnicos» (18-nov-2026)
--
-- Tabla de avance por producto: qué documentos tiene cada uno y cuáles le faltan.
-- Primero los prioritarios: visibles en el catálogo o importados (aparecen en Importaciones).
--
-- Un producto está completo con 4 requisitos:
--   1) Ficha técnica (la que genera la app o la hoja de datos del fabricante)
--   2) Manual (de usuario o de servicio)
--   3) Certificado
--   4) Registro sanitario
-- Los videos y otros archivos se muestran pero no cuentan para el avance.
--
-- Lo ve quien puede ver los documentos técnicos (misma regla que la tabla: Documentos técnicos,
-- Servicio Técnico y Marketing).
-- =====================================================================

create or replace function public.dt_avance(p_q text default '', p_filtro text default '', p_orden text default '', p_desde integer default 0, p_limite integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not app.puede_alguno(array['documentos_tecnicos', 'servicio_tecnico', 'marketing'], 'ver') then
    raise exception 'No tienes acceso a Documentos técnicos.';
  end if;

  with imp as (
    select distinct coalesce(i.producto_id, p.id) as id
      from public.imp_items i
      left join public.productos p on p.codigo = i.codigo_producto and p.deleted_at is null
     where i.deleted_at is null and coalesce(i.producto_id, p.id) is not null
  ), docs as (
    select d.producto_id,
           jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'nombre', d.nombre, 'url', d.url, 'notas', d.notas, 'vence', d.vence, 'version', d.version, 'fecha', d.created_at)
                     order by d.tipo, d.created_at desc) as lista,
           count(*) filter (where d.tipo = 'Hoja de datos del fabricante') as hoja,
           count(*) filter (where d.tipo in ('Manual de usuario', 'Manual de servicio')) as manual,
           count(*) filter (where d.tipo = 'Certificado') as cert,
           count(*) filter (where d.tipo = 'Registro sanitario') as reg,
           count(*) filter (where d.tipo = 'Otro') as otro,
           count(*) as n
      from public.documentos_tecnicos d
     where d.deleted_at is null
     group by d.producto_id
  ), base as (
    select p.id, p.codigo, p.codigo_unico, p.nombre, p.imagen_url, c.nombre as categoria,
           coalesce(p.en_catalogo, false) as catalogo, (imp.id is not null) as importado,
           (coalesce(p.en_catalogo, false) or imp.id is not null) as prioridad,
           nullif(trim(coalesce(p.ficha_tecnica_url, '')), '') as ficha,
           coalesce(d.hoja, 0) as hoja, coalesce(d.manual, 0) as manual, coalesce(d.cert, 0) as cert, coalesce(d.reg, 0) as reg,
           coalesce(d.otro, 0) as otro, coalesce(d.n, 0) as n, coalesce(d.lista, '[]'::jsonb) as lista,
           ((nullif(trim(coalesce(p.ficha_tecnica_url, '')), '') is not null or coalesce(d.hoja, 0) > 0)::int
             + (coalesce(d.manual, 0) > 0)::int + (coalesce(d.cert, 0) > 0)::int + (coalesce(d.reg, 0) > 0)::int) as cumple
      from public.productos p
      left join public.categorias c on c.id = p.categoria_id
      left join imp on imp.id = p.id
      left join docs d on d.producto_id = p.id
     where p.deleted_at is null
  ), filt as (
    select b.*
      from base b
     where (coalesce(trim(p_q), '') = '' or not exists (
             select 1 from unnest(string_to_array(lower(trim(p_q)), ' ')) w
              where w <> '' and lower(concat_ws(' ', b.codigo, b.codigo_unico, b.nombre, b.categoria)) not like '%' || w || '%'))
       and case coalesce(p_filtro, '')
             when 'prioritarios' then b.prioridad
             when 'catalogo' then b.catalogo
             when 'importados' then b.importado
             when 'incompletos' then b.cumple < 4
             when 'sin' then b.n = 0 and b.ficha is null
             when 'completos' then b.cumple = 4
             else true end
  ), orden as (
    select f.*, row_number() over (order by
             case when coalesce(p_orden, '') = 'nombre' then null else f.prioridad end desc nulls last,
             case when coalesce(p_orden, '') = 'nombre' then null else f.catalogo end desc nulls last,
             case when p_orden = 'avance' then -f.cumple when coalesce(p_orden, '') = 'nombre' then null else f.cumple end asc nulls last,
             f.nombre asc) as o
      from filt f
  )
  select jsonb_build_object(
    'total', (select count(*) from filt),
    'filas', coalesce((select jsonb_agg(to_jsonb(x) - 'o' order by x.o) from (select * from orden order by o offset greatest(p_desde, 0) limit least(greatest(p_limite, 1), 100)) x), '[]'::jsonb),
    'resumen', (select jsonb_build_object(
        'productos', count(*), 'completos', count(*) filter (where cumple = 4), 'con_docs', count(*) filter (where n > 0 or ficha is not null),
        'prioritarios', count(*) filter (where prioridad), 'prio_completos', count(*) filter (where prioridad and cumple = 4),
        'prio_sin', count(*) filter (where prioridad and n = 0 and ficha is null), 'prio_cumple', coalesce(sum(cumple) filter (where prioridad), 0),
        'catalogo', count(*) filter (where catalogo), 'importados', count(*) filter (where importado),
        'documentos', coalesce(sum(n), 0),
        'falta_ficha', count(*) filter (where prioridad and ficha is null and hoja = 0), 'falta_manual', count(*) filter (where prioridad and manual = 0),
        'falta_cert', count(*) filter (where prioridad and cert = 0), 'falta_reg', count(*) filter (where prioridad and reg = 0))
      from base)
  ) into v;
  return v;
end;
$$;
revoke all on function public.dt_avance(text, text, text, integer, integer) from public, anon;
grant execute on function public.dt_avance(text, text, text, integer, integer) to authenticated;
