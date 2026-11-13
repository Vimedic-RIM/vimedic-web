-- =====================================================================
-- CRM: lo que la primera migración dejó fuera (Leads.gs / CRMDashboard.html)
--
-- 1) crm_cambiar_estado: mismo control que updateLeadStatus() del original.
--    · Ganado solo con el formulario de venta; desde Ganado no se mueve.
--    · Perdido exige motivo y no se permite desde "Nuevo" (primero una gestión).
--    · Guarda el detalle del formulario de la etapa (Contactado, Sin respuesta,
--      Seguimiento, Negociación, Visita, Perdido) en el historial con la misma
--      etiqueta del original y el próximo seguimiento elegido.
-- 2) crm_registrar_seguimiento: "Nuevo intento" / seguimiento de una proforma
--    sin cambiar la etapa (vmRegistrarSeguimiento).
-- 3) crm_guardar_etapas: administrar etapas del pipeline (savePipelineStages):
--    agregar, quitar y ordenar. Nuevo, Ganado y Perdido no se quitan; tampoco
--    una etapa que todavía tiene gestiones (no se pierden tarjetas).
-- 4) inv_estado_stock: CRM y FEMEDICS (cotización / venta) también ven
--    "en revisión · en reparación · por llegar" (versión 4 del original).
-- 5) Anuncios activos visibles también para FEMEDICS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cambio de etapa validado
-- ---------------------------------------------------------------------
create or replace function public.crm_cambiar_estado(
  p_tabla text, p_id uuid, p_estado text, p_detalle text default null, p_proximo timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actual text;
  v_codigo text;
  v_ref_tipo text;
  v_nota text;
  v_tipo text;
  v_det text := nullif(btrim(coalesce(p_detalle, '')), '');
  v_filas int;
begin
  if p_tabla not in ('leads', 'cotizaciones') then raise exception 'Tabla no válida.'; end if;
  p_estado := btrim(coalesce(p_estado, ''));
  if p_estado = '' then raise exception 'Elige la etapa.'; end if;
  if not exists (select 1 from public.etapas_pipeline where nombre = p_estado and deleted_at is null) then
    raise exception '%', 'La etapa "' || p_estado || '" no existe en el pipeline.';
  end if;

  if p_tabla = 'leads' then
    select coalesce(nullif(btrim(estado_crm), ''), 'Nuevo'), codigo,
           case origen_tipo when 'whatsapp' then 'Chat WhatsApp' when 'cita' then 'Cita' else 'Contacto' end
      into v_actual, v_codigo, v_ref_tipo
      from public.leads where id = p_id and deleted_at is null;
  else
    select coalesce(nullif(btrim(estado_crm), ''), 'Nuevo'), codigo,
           case when tipo_registro = 'Venta' then 'Venta' else 'Cotización' end
      into v_actual, v_codigo, v_ref_tipo
      from public.cotizaciones where id = p_id and deleted_at is null;
  end if;
  if v_actual is null then raise exception 'No se encontró la gestión (o no tienes acceso a ella).'; end if;
  if v_actual = p_estado then return jsonb_build_object('success', true, 'sin_cambio', true); end if;

  if lower(v_actual) = 'ganado' then
    raise exception 'Esta gestión ya está en Ganado y pasó a facturación: no se puede cambiar de etapa.';
  end if;
  if p_estado = 'Ganado' then
    raise exception 'Para marcar Ganado hay que completar el formulario de venta.';
  end if;
  if p_estado = 'Perdido' and lower(v_actual) = 'nuevo' then
    raise exception 'No se puede pasar a Perdido sin haber realizado al menos una gestión. Primero regístrala (Contactado, Sin respuesta, etc.).';
  end if;
  if p_estado = 'Perdido' and v_det is null then
    raise exception 'Debes indicar el motivo de la pérdida.';
  end if;

  if p_tabla = 'leads' then
    update public.leads
       set estado_crm = p_estado, ultima_actividad = now(), proximo_seguimiento = coalesce(p_proximo, proximo_seguimiento)
     where id = p_id;
  else
    update public.cotizaciones
       set estado_crm = p_estado, ultima_actividad = now(), proximo_seguimiento = coalesce(p_proximo, proximo_seguimiento)
     where id = p_id;
  end if;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then raise exception 'No tienes permiso para cambiar esta gestión.'; end if;

  v_nota := 'Estado actualizado a "' || p_estado || '".';
  if p_estado = 'Perdido' then v_nota := v_nota || ' Motivo: ' || v_det;
  elsif p_estado = 'Contactado' and v_det is not null then v_nota := v_det;
  elsif v_det is not null then v_nota := v_nota || ' ' || v_det;
  end if;
  v_tipo := case p_estado when 'Perdido' then 'Lead Perdido' when 'Visita' then 'Visita Programada'
                          when 'Contactado' then 'Contacto Registrado' else 'Cambio de Estado' end;

  insert into public.interacciones (id, codigo, ref_tipo, ref_codigo, lead_id, cotizacion_id, tipo, nota, empleado_id, usuario_texto)
  values (gen_random_uuid(), 'INT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), v_ref_tipo, v_codigo,
          case when p_tabla = 'leads' then p_id end, case when p_tabla = 'cotizaciones' then p_id end,
          v_tipo, left(v_nota, 3000), app.empleado_id(),
          (select nombre from public.empleados where id = app.empleado_id()));

  return jsonb_build_object('success', true, 'estado', p_estado, 'anterior', v_actual);
end;
$$;
revoke all on function public.crm_cambiar_estado(text, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.crm_cambiar_estado(text, uuid, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Seguimiento / nuevo intento sin cambiar de etapa
-- ---------------------------------------------------------------------
create or replace function public.crm_registrar_seguimiento(
  p_tabla text, p_id uuid, p_detalle text, p_proximo timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_codigo text;
  v_ref_tipo text;
  v_texto text := left(btrim(coalesce(p_detalle, '')), 3000);
  v_filas int;
begin
  if p_tabla not in ('leads', 'cotizaciones') then raise exception 'Tabla no válida.'; end if;
  if v_texto = '' then raise exception 'Escribe una observación.'; end if;

  if p_tabla = 'leads' then
    select codigo, case origen_tipo when 'whatsapp' then 'Chat WhatsApp' when 'cita' then 'Cita' else 'Contacto' end
      into v_codigo, v_ref_tipo from public.leads where id = p_id and deleted_at is null;
    update public.leads set ultima_actividad = now(), proximo_seguimiento = coalesce(p_proximo, proximo_seguimiento)
     where id = p_id and deleted_at is null;
  else
    select codigo, case when tipo_registro = 'Venta' then 'Venta' else 'Cotización' end
      into v_codigo, v_ref_tipo from public.cotizaciones where id = p_id and deleted_at is null;
    update public.cotizaciones set ultima_actividad = now(), proximo_seguimiento = coalesce(p_proximo, proximo_seguimiento)
     where id = p_id and deleted_at is null;
  end if;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then raise exception 'No se encontró la gestión o no tienes permiso para registrar el seguimiento.'; end if;

  insert into public.interacciones (id, codigo, ref_tipo, ref_codigo, lead_id, cotizacion_id, tipo, nota, empleado_id, usuario_texto)
  values (gen_random_uuid(), 'INT-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), coalesce(v_ref_tipo, 'Contacto'), v_codigo,
          case when p_tabla = 'leads' then p_id end, case when p_tabla = 'cotizaciones' then p_id end,
          'Seguimiento', v_texto, app.empleado_id(),
          (select nombre from public.empleados where id = app.empleado_id()));

  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.crm_registrar_seguimiento(text, uuid, text, timestamptz) from public, anon;
grant execute on function public.crm_registrar_seguimiento(text, uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Administrar las etapas del pipeline
-- ---------------------------------------------------------------------
create or replace function public.crm_guardar_etapas(p_etapas text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lista text[];
  v_ocupadas text;
  v_obligatoria text;
  i int;
begin
  if not (app.es_superadmin() or app.puede('crm', 'administrar') or app.puede('marketing', 'administrar')) then
    raise exception 'Solo un administrador del CRM puede editar las etapas del pipeline.';
  end if;

  select array_agg(btrim(x) order by o) into v_lista
    from unnest(coalesce(p_etapas, '{}'::text[])) with ordinality t(x, o)
   where btrim(coalesce(x, '')) <> '';
  if coalesce(array_length(v_lista, 1), 0) = 0 then raise exception 'Debe existir al menos una etapa.'; end if;
  if (select count(distinct lower(x)) from unnest(v_lista) x) <> array_length(v_lista, 1) then
    raise exception 'Hay etapas repetidas.';
  end if;
  if exists (select 1 from unnest(v_lista) x where length(x) > 40) then
    raise exception 'El nombre de una etapa es demasiado largo (máximo 40 caracteres).';
  end if;
  foreach v_obligatoria in array array['Nuevo', 'Ganado', 'Perdido'] loop
    if not (v_obligatoria = any (v_lista)) then
      raise exception '%', 'La etapa "' || v_obligatoria || '" es obligatoria y no se puede quitar.';
    end if;
  end loop;

  -- No se quita una etapa con gestiones activas: sus tarjetas desaparecerían del tablero.
  select string_agg(e.nombre || ' (' || e.n || ')', ', ') into v_ocupadas
    from (
      select ep.nombre,
             (select count(*) from public.leads l where l.estado_crm = ep.nombre and l.deleted_at is null)
           + (select count(*) from public.cotizaciones c where c.estado_crm = ep.nombre and c.deleted_at is null) as n
        from public.etapas_pipeline ep
       where ep.deleted_at is null and not (ep.nombre = any (v_lista))
    ) e
   where e.n > 0;
  if v_ocupadas is not null then
    raise exception '%', 'No se puede quitar una etapa que todavía tiene gestiones: ' || v_ocupadas || '. Muévelas primero a otra etapa.';
  end if;

  update public.etapas_pipeline set deleted_at = now()
   where deleted_at is null and not (nombre = any (v_lista));

  for i in 1 .. array_length(v_lista, 1) loop
    insert into public.etapas_pipeline (orden, nombre, es_final)
    values (i, v_lista[i], v_lista[i] in ('Ganado', 'Perdido'))
    on conflict (nombre) do update set orden = excluded.orden, es_final = excluded.es_final, deleted_at = null;
  end loop;

  perform app.auditar('crm', 'Etapas del pipeline', null, 'OK', array_to_string(v_lista, ' → '));
  return jsonb_build_object('success', true, 'etapas', to_jsonb(v_lista));
end;
$$;
revoke all on function public.crm_guardar_etapas(text[]) from public, anon;
grant execute on function public.crm_guardar_etapas(text[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Estado del stock también para CRM / FEMEDICS / Ofertas / Marketing
--    (mismo cálculo que 20261108004200; solo cambia quién puede pedirlo)
-- ---------------------------------------------------------------------
create or replace function public.inv_estado_stock()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  res jsonb;
begin
  if not app.puede_alguno(array['inventario', 'crm', 'femedics', 'ofertas', 'promociones', 'marketing'], 'ver') then
    raise exception 'No tienes acceso al estado del stock.';
  end if;

  with exp as (
    select e.id, e.codigo,
           coalesce(nullif(e.flujo->>'nombre', ''), nullif(e.referencia, ''), e.codigo) as nombre,
           nullif(left(coalesce(e.flujo->>'eta', e.embarque->>'eta', ''), 10), '') as eta,
           case
             when coalesce(e.recepcion->>'confirmada', '') = 'true' then 'Ingresado'
             when e.flujo->>'origen' = 'interno' and coalesce(e.flujo->'enviado', 'null'::jsonb) = 'null'::jsonb then 'Borrador'
             when exists (select 1 from public.imp_recepciones o where o.pedido_codigo = e.codigo and o.tipo = 'REVISION' and o.deleted_at is null) then 'En bodega'
             when e.flujo->>'etapa' in ('Registrado', 'En tránsito', 'En aduana', 'En bodega') then e.flujo->>'etapa'
             else 'Registrado'
           end as etapa,
           coalesce(
             (select left(min(x->>'fecha'), 10) from jsonb_array_elements(case when jsonb_typeof(e.flujo->'etapas') = 'array' then e.flujo->'etapas' else '[]'::jsonb end) x where x->>'etapa' = 'En bodega'),
             (select left(min(o.fecha::text), 10) from public.imp_recepciones o where o.pedido_codigo = e.codigo and o.tipo = 'REVISION' and o.deleted_at is null)
           ) as llegada
      from public.imp_expedientes e
     where e.deleted_at is null
  ), lin as (
    select x.codigo, x.nombre, x.eta, x.llegada, x.etapa, i.cantidad,
           coalesce(i.producto_id, p.id) as prod_id,
           greatest(0, i.cantidad - s.rec - s.falt) as por_recibir,
           s.pend, s.st + s.dev as en_st
      from exp x
      join public.imp_items i on i.pedido_codigo = x.codigo and i.deleted_at is null and i.cantidad > 0
      left join public.productos p on p.codigo = i.codigo_producto and p.deleted_at is null
      left join lateral (
        select coalesce(sum(nullif(o.cantidades->>'rec', '')::numeric), 0) as rec,
               coalesce(sum(nullif(o.cantidades->>'pend', '')::numeric), 0) as pend,
               coalesce(sum(nullif(o.cantidades->>'st', '')::numeric), 0) as st,
               coalesce(sum(nullif(o.cantidades->>'dev', '')::numeric), 0) as dev,
               coalesce(sum(nullif(o.cantidades->>'falt', '')::numeric), 0) as falt
          from public.imp_recepciones o
         where o.item_id = i.id and o.deleted_at is null
      ) s on true
     where x.etapa <> 'Borrador'
  ), vis as (
    select l.*,
           case when l.etapa = 'En bodega' then 0 else l.por_recibir end as en_camino,
           case when l.etapa = 'En bodega' then l.pend + l.por_recibir else l.pend end as en_revision
      from lin l
     where l.etapa <> 'Ingresado'
  ), por_prod as (
    select prod_id,
           sum(en_revision)::int as revision,
           sum(en_camino)::int as por_llegar,
           min(eta) filter (where en_camino > 0) as eta,
           jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', left(nombre, 80), 'etapa', etapa, 'eta', coalesce(eta, ''), 'llegada', coalesce(llegada, ''),
                                        'enCamino', en_camino, 'enRevision', en_revision, 'enST', en_st) order by coalesce(eta, '9')) as imps
      from vis
     where prod_id is not null and (en_camino > 0 or en_revision > 0)
     group by prod_id
  ), rep as (
    select id as prod_id, stock_por_reparar as reparacion from public.productos where deleted_at is null and stock_por_reparar > 0
  ), prods as (
    select coalesce(a.prod_id, r.prod_id) as prod_id,
           jsonb_build_object('revision', coalesce(a.revision, 0), 'reparacion', coalesce(r.reparacion, 0), 'porLlegar', coalesce(a.por_llegar, 0),
                              'eta', coalesce(a.eta, ''), 'imps', coalesce(a.imps, '[]'::jsonb)) as o
      from por_prod a full join rep r on r.prod_id = a.prod_id
  ), resumen as (
    select x.codigo, x.nombre, x.etapa, x.eta, x.llegada,
           (select coalesce(jsonb_object_agg(t.prod_id, t.u), '{}'::jsonb) from (select prod_id, sum(cantidad)::int u from lin l where l.codigo = x.codigo and l.prod_id is not null group by prod_id) t) as productos,
           (select count(*) from lin l where l.codigo = x.codigo and l.prod_id is null)::int as nuevos
      from exp x
     where x.etapa <> 'Borrador'
  ), lista as (
    select * from (
      select r.*, row_number() over (partition by (r.etapa = 'Ingresado') order by case when r.etapa = 'Ingresado' then 0 end, r.codigo desc) as n from resumen r
    ) z where z.etapa <> 'Ingresado' or z.n <= 20
  )
  select jsonb_build_object(
    'productos', coalesce((select jsonb_object_agg(prod_id::text, o) from prods), '{}'::jsonb),
    'importaciones', coalesce((select jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', left(nombre, 80), 'etapa', etapa, 'eta', coalesce(eta, ''),
                                'llegada', coalesce(llegada, ''), 'productos', productos, 'nuevos', nuevos)
                                order by (etapa = 'Ingresado'), coalesce(eta, '9'), codigo) from lista), '[]'::jsonb),
    'generado', now()
  ) into res;

  return res;
end;
$$;
revoke all on function public.inv_estado_stock() from public, anon;
grant execute on function public.inv_estado_stock() to authenticated;

-- ---------------------------------------------------------------------
-- 5) Anuncios activos: FEMEDICS también los elige al registrar una gestión
-- ---------------------------------------------------------------------
drop policy if exists anuncios_femedics_ver on public.anuncios_activos;
create policy anuncios_femedics_ver on public.anuncios_activos for select to authenticated
  using (deleted_at is null and app.puede('femedics', 'ver'));
