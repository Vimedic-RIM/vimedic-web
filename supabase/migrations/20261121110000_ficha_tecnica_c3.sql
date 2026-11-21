-- =====================================================================
-- Ficha técnica por producto (diseño C3 «Columna lateral», A4).
--   · producto_especificaciones: las especificaciones en FILAS (grupo, etiqueta, valor, unidad, orden, destacado).
--     Las marcadas «destacado» (máx. 3) son los indicadores grandes de la columna lateral.
--   · producto_fichas: lo propio de la ficha (modelo, descripción corta, características cortas, «Incluye»).
--     Los textos de la web (productos.descripcion, caracteristicas…) no se tocan: la ficha tiene su versión resumida.
--   · ficha_tecnica(p_producto): todo lo que la ficha muestra, y SOLO eso (nunca costo, stock, proveedor ni importación).
--     La ven y descargan quienes ven productos (Inventario, Marketing, Catálogos, CRM/asesores, FEMEDICS).
--   · ficha_guardar(p_producto, p_ficha, p_especs): guarda todo junto; solo quien edita Marketing.
--   La marca y el contacto son siempre los de VIMEDIC (FEMEDICS no crea fichas).
-- =====================================================================

create table if not exists public.producto_especificaciones (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  grupo       text not null default 'Generales',
  etiqueta    text not null,
  valor       text not null,
  unidad      text,
  orden       integer not null default 0,
  destacado   boolean not null default false
);
select app.estandarizar('public.producto_especificaciones');
select app.aplicar_rls('public.producto_especificaciones', array['inventario', 'marketing', 'catalogos', 'crm', 'femedics'], array['marketing']);
create index if not exists producto_especificaciones_producto_idx on public.producto_especificaciones (producto_id, orden) where deleted_at is null;
-- Quitar una especificación es parte de EDITAR la ficha (no un «eliminar» de registro): ficha_guardar da de baja las filas
-- anteriores y guarda las nuevas, y ya exige editar Marketing. Por eso esta tabla no lleva el control de «eliminar».
drop trigger if exists tg_borrado_logico on public.producto_especificaciones;

create table if not exists public.producto_fichas (
  id              uuid primary key default gen_random_uuid(),
  producto_id     uuid not null unique references public.productos(id) on delete cascade,
  modelo          text,
  descripcion     text,
  caracteristicas jsonb not null default '[]'::jsonb,
  accesorios      jsonb not null default '[]'::jsonb,
  ia_generada_en  timestamptz,
  ia_notas        text
);
select app.estandarizar('public.producto_fichas');
select app.aplicar_rls('public.producto_fichas', array['inventario', 'marketing', 'catalogos', 'crm', 'femedics'], array['marketing']);

-- Lectura para la ficha (vista previa, PDF): solo datos publicables.
create or replace function public.ficha_tecnica(p_producto uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  p record;
  v_aj jsonb;
begin
  if not app.puede_alguno(array['inventario', 'marketing', 'catalogos', 'crm', 'femedics'], 'ver') then
    raise exception 'No tienes acceso a las fichas técnicas.';
  end if;
  select pr.id, pr.codigo, pr.nombre, pr.imagen_url, pr.descripcion, pr.caracteristicas, pr.especificaciones, pr.accesorios,
         pr.certificaciones, pr.destacados, pr.en_catalogo, pr.oculto, c.nombre as categoria
    into p
    from public.productos pr left join public.categorias c on c.id = pr.categoria_id
   where pr.id = p_producto and pr.deleted_at is null;
  if p.id is null then raise exception 'No se encontró el producto.'; end if;
  select valor into v_aj from public.marketing_ajustes where clave = 'ficha' and deleted_at is null;

  return jsonb_build_object(
    'producto', jsonb_build_object('id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'categoria', coalesce(p.categoria, ''),
                                   'imagen', coalesce(p.imagen_url, ''), 'publico', coalesce(p.en_catalogo, false) and not coalesce(p.oculto, false)),
    'fotos', coalesce((select jsonb_agg(g.archivo_url order by g.orden, g.created_at) from public.producto_galeria g
                        where g.producto_id = p.id and g.deleted_at is null and coalesce(g.tipo, '') <> 'video'
                          and coalesce(g.archivo_url, '') <> '' and g.archivo_url is distinct from p.imagen_url), '[]'::jsonb),
    'video', (select g.archivo_url from public.producto_galeria g where g.producto_id = p.id and g.deleted_at is null and g.tipo = 'video'
               and coalesce(g.archivo_url, '') <> '' order by g.orden, g.created_at limit 1),
    'ficha', (select jsonb_build_object('modelo', coalesce(f.modelo, ''), 'descripcion', coalesce(f.descripcion, ''), 'caracteristicas', f.caracteristicas,
                                        'accesorios', f.accesorios, 'ia_generada_en', f.ia_generada_en, 'ia_notas', coalesce(f.ia_notas, ''))
                from public.producto_fichas f where f.producto_id = p.id and f.deleted_at is null),
    'especificaciones', coalesce((select jsonb_agg(jsonb_build_object('grupo', e.grupo, 'etiqueta', e.etiqueta, 'valor', e.valor, 'unidad', coalesce(e.unidad, ''),
                                                                      'destacado', e.destacado) order by e.orden, e.created_at)
                                   from public.producto_especificaciones e where e.producto_id = p.id and e.deleted_at is null), '[]'::jsonb),
    -- Respaldo: los textos actuales del producto, para cuando la ficha todavía no tiene sus datos propios.
    'respaldo', jsonb_build_object('descripcion', coalesce(p.descripcion, ''), 'caracteristicas', coalesce(p.caracteristicas, ''),
                                   'especificaciones', coalesce(p.especificaciones, ''), 'accesorios', coalesce(p.accesorios, ''),
                                   'destacados', coalesce(p.destacados, '')),
    'certificaciones', coalesce(nullif(btrim(coalesce(p.certificaciones, '')), ''), coalesce(v_aj ->> 'certificaciones', '')),
    'contacto', jsonb_build_object('web', coalesce(nullif(v_aj ->> 'web', ''), 'vimedic.com.ec'), 'telefono', coalesce(v_aj ->> 'telefono', ''),
                                   'correo', coalesce(v_aj ->> 'correo', ''))
  );
end;
$$;
revoke all on function public.ficha_tecnica(uuid) from public, anon;
grant execute on function public.ficha_tecnica(uuid) to authenticated;

-- Guardar la ficha (datos + especificaciones) en una sola operación.
create or replace function public.ficha_guardar(p_producto uuid, p_ficha jsonb, p_especs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_n int := 0;
  v_dest int;
  e jsonb;
  i int := 0;
begin
  if not app.puede('marketing', 'editar') then raise exception 'Solo quien edita Marketing puede guardar la ficha técnica.'; end if;
  if not exists (select 1 from public.productos where id = p_producto and deleted_at is null) then raise exception 'No se encontró el producto.'; end if;
  if jsonb_typeof(coalesce(p_especs, '[]'::jsonb)) <> 'array' then raise exception 'Especificaciones no válidas.'; end if;
  if jsonb_array_length(coalesce(p_especs, '[]'::jsonb)) > 150 then raise exception 'Máximo 150 especificaciones.'; end if;
  select count(*) into v_dest from jsonb_array_elements(coalesce(p_especs, '[]'::jsonb)) x where (x ->> 'destacado')::boolean is true;
  if v_dest > 3 then raise exception 'Elige máximo 3 datos destacados.'; end if;

  insert into public.producto_fichas (producto_id, modelo, descripcion, caracteristicas, accesorios, ia_generada_en, ia_notas)
  values (p_producto, nullif(left(btrim(coalesce(p_ficha ->> 'modelo', '')), 80), ''), nullif(left(btrim(coalesce(p_ficha ->> 'descripcion', '')), 900), ''),
          coalesce((select jsonb_agg(left(btrim(x), 140)) from jsonb_array_elements_text(coalesce(p_ficha -> 'caracteristicas', '[]'::jsonb)) x where btrim(x) <> ''), '[]'::jsonb),
          coalesce((select jsonb_agg(left(btrim(x), 140)) from jsonb_array_elements_text(coalesce(p_ficha -> 'accesorios', '[]'::jsonb)) x where btrim(x) <> ''), '[]'::jsonb),
          case when (p_ficha ->> 'ia')::boolean is true then now() end, nullif(left(coalesce(p_ficha ->> 'ia_notas', ''), 600), ''))
  on conflict (producto_id) do update set
    modelo = excluded.modelo, descripcion = excluded.descripcion, caracteristicas = excluded.caracteristicas, accesorios = excluded.accesorios,
    ia_generada_en = coalesce(excluded.ia_generada_en, producto_fichas.ia_generada_en),
    ia_notas = case when excluded.ia_generada_en is not null then excluded.ia_notas else producto_fichas.ia_notas end,
    deleted_at = null;

  -- Las filas anteriores se dan de baja (borrado lógico) y se guardan las nuevas en su orden.
  update public.producto_especificaciones set deleted_at = now() where producto_id = p_producto and deleted_at is null;
  for e in select * from jsonb_array_elements(coalesce(p_especs, '[]'::jsonb)) loop
    i := i + 1;
    if btrim(coalesce(e ->> 'etiqueta', '')) = '' or btrim(coalesce(e ->> 'valor', '')) = '' then continue; end if;
    insert into public.producto_especificaciones (producto_id, grupo, etiqueta, valor, unidad, orden, destacado)
    values (p_producto, coalesce(nullif(left(btrim(coalesce(e ->> 'grupo', '')), 40), ''), 'Generales'), left(btrim(e ->> 'etiqueta'), 80),
            left(btrim(e ->> 'valor'), 200), nullif(left(btrim(coalesce(e ->> 'unidad', '')), 20), ''), i, coalesce((e ->> 'destacado')::boolean, false));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('especificaciones', v_n, 'destacados', v_dest);
end;
$$;
revoke all on function public.ficha_guardar(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.ficha_guardar(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
