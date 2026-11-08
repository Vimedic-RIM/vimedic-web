-- =====================================================================
-- VIMEDIC · Módulo Bodega (despacho de ventas facturadas)
-- Reemplaza Bodega.gs: orden de despacho al facturar, traer facturas
-- anteriores, despacho (total/parcial) y evidencias en Storage.
-- =====================================================================

-- En la hoja original "Requiere Serie" vacío = SÍ. La carga inicial dejó todo en falso.
alter table public.productos alter column requiere_serie set default true;
update public.productos set requiere_serie = true where requiere_serie = false;

-- Series: objeto {clave: [series]} (en la tabla base venía como arreglo)
alter table public.despachos alter column series set default '{}'::jsonb;
update public.despachos set series = '{}'::jsonb where jsonb_typeof(series) <> 'object';

-- ---------------------------------------------------------------------
-- Crea la orden de despacho de una factura (idempotente)
-- ---------------------------------------------------------------------
create or replace function public.bodega_crear_despacho(p_factura uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.facturas;
  v_id uuid;
  v_lineas jsonb;
  v_cli record;
begin
  select * into f from public.facturas where id = p_factura and deleted_at is null;
  if not found or f.estado <> 'Facturado' then return null; end if;
  select id into v_id from public.despachos
    where (factura_id = f.id or operacion_codigo = f.codigo) and deleted_at is null limit 1;
  if found then return null; end if;

  select coalesce(jsonb_agg(l order by ord), '[]'::jsonb) into v_lineas from (
    select ord,
      jsonb_build_object(
        'key', cod || '|' || row_number() over (partition by cod order by ord),
        'id', cod, 'nombre', coalesce(it->>'nombre', ''),
        'cantidad', greatest(1, abs(coalesce(nullif(it->>'cantidad', '')::numeric, 1))::int),
        'requiereSerie', coalesce((select pr.requiere_serie from public.productos pr where pr.codigo = cod limit 1), true),
        'observacion', coalesce(it->>'observacion', ''), 'despachado', 0) as l
    from (select ord, it, coalesce(nullif(it->>'codigo', ''), it->>'itemId', it->>'id', '') as cod
          from jsonb_array_elements(f.items) with ordinality as t(it, ord)) q
  ) z;

  select nombre, telefono into v_cli from public.clientes where id = f.cliente_id;
  insert into public.despachos (id, codigo, empresa, factura_id, operacion_codigo, cliente_id, cliente_texto, identificacion, telefono,
    asesor_id, factura_texto, factura_url, estado, entrega, productos, series, token_seguimiento, historial, creado_por)
  values (gen_random_uuid(),
    'DSP-' || to_char(now() at time zone 'America/Guayaquil', 'YYMMDD') || '-' || (1000 + floor(random() * 9000))::int,
    f.empresa, f.id, f.codigo, f.cliente_id, v_cli.nombre, f.identificacion, coalesce(v_cli.telefono, f.pago_entrega->>'telefonoDestinatario'),
    f.asesor_id, f.numero_contifico, f.pdf_url, 'Por preparar', coalesce(f.pago_entrega, '{}'::jsonb), v_lineas, '{}'::jsonb,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')::text,
    jsonb_build_array(jsonb_build_object('fecha', now(), 'por', 'Sistema', 'nota', 'Orden creada al facturar (factura ' || coalesce(f.numero_contifico, '—') || ').')),
    app.empleado_id())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.bodega_crear_despacho(uuid) from public, anon;
grant execute on function public.bodega_crear_despacho(uuid) to authenticated;

-- Al pasar una factura a "Facturado" se crea sola la orden de Bodega
create or replace function app.tg_factura_a_bodega()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'Facturado' and (tg_op = 'INSERT' or old.estado is distinct from 'Facturado') then
    perform public.bodega_crear_despacho(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists tg_factura_a_bodega on public.facturas;
create trigger tg_factura_a_bodega after insert or update of estado on public.facturas
  for each row execute function app.tg_factura_a_bodega();

-- Trae a Bodega las facturas de los últimos N días que aún no tienen orden
create or replace function public.bodega_traer_facturas(p_dias int default 15)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare r record; n int := 0;
begin
  if not app.puede('bodega', 'editar') then raise exception 'Sin permiso en Bodega'; end if;
  for r in select id from public.facturas
           where estado = 'Facturado' and deleted_at is null
             and fecha_facturacion >= (current_date - greatest(1, least(120, coalesce(p_dias, 15))))
  loop
    if public.bodega_crear_despacho(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.bodega_traer_facturas(int) from public, anon;
grant execute on function public.bodega_traer_facturas(int) to authenticated;

-- ---------------------------------------------------------------------
-- Despachar (todo o una parte): valida y crea la entrega en Logística
-- p_cantidades = {clave: unidades a enviar ahora}
-- ---------------------------------------------------------------------
create or replace function public.bodega_despachar(p_id uuid, p_cantidades jsonb, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.despachos;
  yo uuid := app.empleado_id();
  quien text;
  p jsonb; k text; falta int; n int; tiene int; necesarias int; desde int;
  cant jsonb := '{}'::jsonb; total int := 0;
  prods jsonb := '[]'::jsonb; env_series jsonb := '{}'::jsonb;
  fotos jsonb; envio jsonb; completo boolean; num int;
  ent jsonb; modalidad text; trans text; tipo text; arr jsonb;
begin
  if not app.puede('bodega', 'editar') then raise exception 'Sin permiso en Bodega'; end if;
  select * into d from public.despachos where id = p_id and deleted_at is null for update;
  if not found then raise exception 'No se encontró el despacho'; end if;
  if d.estado = 'Despachada' then raise exception 'Este despacho ya salió completo.'; end if;
  select coalesce(nombre, email) into quien from public.empleados where id = yo;
  quien := coalesce(quien, 'Bodega');

  select count(*) into n from jsonb_array_elements(d.novedades) x where coalesce((x->>'resuelta')::boolean, false) = false;
  if n > 0 then raise exception 'Hay % novedad(es) sin resolver. Resuélvelas antes de despachar.', n; end if;

  for p in select * from jsonb_array_elements(d.productos) loop
    k := p->>'key';
    falta := (p->>'cantidad')::int - coalesce((p->>'despachado')::int, 0);
    n := case when p_cantidades ? k then floor(coalesce(nullif(p_cantidades->>k, '')::numeric, 0))::int else falta end;
    if n < 0 or n > falta then raise exception 'Cantidad no válida para "%" (pendientes: %).', p->>'nombre', falta; end if;
    cant := cant || jsonb_build_object(k, n); total := total + n;
  end loop;
  if total = 0 then raise exception 'Indica al menos una unidad a despachar.'; end if;

  -- Series completas para lo que se envía
  for p in select * from jsonb_array_elements(d.productos) loop
    if coalesce((p->>'requiereSerie')::boolean, true) then
      k := p->>'key';
      necesarias := coalesce((p->>'despachado')::int, 0) + (cant->>k)::int;
      select count(*) into tiene from jsonb_array_elements_text(coalesce(d.series->k, '[]'::jsonb)) s where btrim(s) <> '';
      if tiene < necesarias then raise exception 'Faltan series de "%": % de %.', p->>'nombre', tiene, necesarias; end if;
    end if;
  end loop;

  -- Al menos una foto nueva (que no sea evidencia de un envío anterior)
  select coalesce(jsonb_agg(e->'url'), '[]'::jsonb) into fotos from jsonb_array_elements(d.evidencias) e
    where not exists (select 1 from jsonb_array_elements(d.envios) en, jsonb_array_elements(coalesce(en->'fotos', '[]'::jsonb)) f where f = e->'url');
  if jsonb_array_length(fotos) = 0 then raise exception 'Toma al menos una foto de evidencia del despacho.'; end if;

  -- Series enviadas y nuevo acumulado de despachado
  for p in select * from jsonb_array_elements(d.productos) loop
    k := p->>'key'; desde := coalesce((p->>'despachado')::int, 0); n := (cant->>k)::int;
    if coalesce((p->>'requiereSerie')::boolean, true) and n > 0 then
      select coalesce(jsonb_agg(s order by i), '[]'::jsonb) into arr
        from jsonb_array_elements(coalesce(d.series->k, '[]'::jsonb)) with ordinality t(s, i) where i > desde and i <= desde + n;
      env_series := env_series || jsonb_build_object(k, arr);
    end if;
    prods := prods || jsonb_build_array(jsonb_set(p, '{despachado}', to_jsonb(desde + n)));
  end loop;

  select bool_and((x->>'despachado')::int >= (x->>'cantidad')::int) into completo from jsonb_array_elements(prods) x;
  num := jsonb_array_length(d.envios) + 1;
  envio := jsonb_build_object('n', num, 'fecha', now(), 'por', quien, 'cantidades', cant, 'series', env_series, 'fotos', fotos, 'nota', left(coalesce(p_nota, ''), 500));

  update public.despachos set
    productos = prods, envios = d.envios || jsonb_build_array(envio),
    estado = case when completo then 'Despachada' else 'Parcial' end,
    despachado_por = yo, fecha_despacho = now(), preparado_por = coalesce(preparado_por, yo),
    historial = (d.historial || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', quien,
      'nota', case when completo then 'Despachó el pedido completo' else 'Despacho parcial Nº ' || num end || ' (' || total || ' unidad(es)).' ||
              case when coalesce(p_nota, '') <> '' then ' Nota: ' || p_nota else '' end)))
  where id = p_id;

  -- Pasa a Logística
  ent := coalesce(d.entrega, '{}'::jsonb);
  tipo := coalesce(ent->>'entrega', ''); trans := coalesce(ent->>'transporte', '');
  modalidad := case when tipo ~* 'retiro' then 'Retiro' when tipo = 'Envío' and trans <> '' and trans <> 'Empresa' then 'Transportista' else 'Chofer propio' end;
  insert into public.entregas (id, codigo, empresa, despacho_id, factura_id, operacion_codigo, envio_numero, cliente_id, cliente_texto, identificacion, telefono, email,
    asesor_id, factura_texto, tipo_entrega, modalidad, transportista, estado, fecha_programada, token_seguimiento, entrega, productos, eventos, creado_por)
  values (gen_random_uuid(),
    'ENT-' || to_char(now() at time zone 'America/Guayaquil', 'YYMMDD') || '-' || (1000 + floor(random() * 9000))::int,
    d.empresa, d.id, d.factura_id, d.operacion_codigo, num, d.cliente_id, d.cliente_texto, d.identificacion,
    coalesce(d.telefono, ent->>'telefonoDestinatario', ent->>'telefonoEntregaLocal'), ent->>'emailDestinatario',
    d.asesor_id, d.factura_texto, tipo, modalidad, case when modalidad = 'Transportista' then trans else null end, 'Por confirmar',
    nullif(ent->>'fechaEntrega', '')::date,
    case when num = 1 then d.token_seguimiento else replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') end,
    ent,
    (select coalesce(jsonb_agg(jsonb_build_object('key', pp->>'key', 'id', pp->>'id', 'nombre', pp->>'nombre', 'cantidad', (cant->>(pp->>'key'))::int,
        'series', coalesce(env_series->(pp->>'key'), '[]'::jsonb))), '[]'::jsonb)
       from jsonb_array_elements(d.productos) pp where (cant->>(pp->>'key'))::int > 0),
    jsonb_build_array(jsonb_build_object('fecha', now(), 'por', quien, 'publico', true, 'clave', 'despachado',
      'nota', 'Salió de bodega' || case when completo then '' else ' (envío parcial Nº ' || num || ')' end || ' y pasó a Logística.')),
    yo);

  return jsonb_build_object('estado', case when completo then 'Despachada' else 'Parcial' end, 'total', total);
end;
$$;
revoke all on function public.bodega_despachar(uuid, jsonb, text) from public, anon;
grant execute on function public.bodega_despachar(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- Evidencias (fotos y videos) en Supabase Storage, bucket privado
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('despachos', 'despachos', false, 52428800)
on conflict (id) do nothing;

drop policy if exists despachos_storage_ver on storage.objects;
create policy despachos_storage_ver on storage.objects for select to authenticated
  using (bucket_id = 'despachos' and app.puede_alguno(array['bodega', 'logistica', 'facturacion'], 'ver'));
drop policy if exists despachos_storage_subir on storage.objects;
create policy despachos_storage_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'despachos' and app.puede('bodega', 'editar'));
drop policy if exists despachos_storage_borrar on storage.objects;
create policy despachos_storage_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'despachos' and app.puede('bodega', 'editar'));
