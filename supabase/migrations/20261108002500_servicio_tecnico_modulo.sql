-- =====================================================================
-- VIMEDIC · Módulo Servicio Técnico
-- Reemplaza ServicioTecnico.gs: equipos (hoja de vida), garantía, plan de
-- mantenimiento, órdenes, preventivos automáticos y cierre con repuestos.
-- =====================================================================

-- Evidencias (fotos, firmas, videos) de órdenes y seguimiento de inventario
insert into storage.buckets (id, name, public, file_size_limit)
values ('servicio-tecnico', 'servicio-tecnico', false, 26214400)
on conflict (id) do nothing;

drop policy if exists st_storage_ver on storage.objects;
create policy st_storage_ver on storage.objects for select to authenticated
  using (bucket_id = 'servicio-tecnico' and app.puede('servicio_tecnico', 'ver'));
drop policy if exists st_storage_subir on storage.objects;
create policy st_storage_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'servicio-tecnico' and app.puede('servicio_tecnico', 'editar'));
drop policy if exists st_storage_borrar on storage.objects;
create policy st_storage_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'servicio-tecnico' and app.puede('servicio_tecnico', 'editar'));

-- ---------------------------------------------------------------------
-- Técnicos internos: empleados con acceso a Servicio Técnico
-- ---------------------------------------------------------------------
create or replace function public.st_tecnicos_internos()
returns table (id uuid, nombre text, email text, telefono text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.email, e.telefono
  from public.empleados e left join public.roles r on r.id = e.rol_id
  where app.puede('servicio_tecnico', 'ver') and e.estado = 'activo' and e.deleted_at is null
    and (coalesce(e.es_superadmin, false) = false)
    and (coalesce(r.permisos, '{}'::jsonb) ? 'servicio_tecnico' or coalesce(e.permisos_extra, '{}'::jsonb) ? 'servicio_tecnico')
  order by e.nombre
$$;
revoke all on function public.st_tecnicos_internos() from public, anon;
grant execute on function public.st_tecnicos_internos() to authenticated;

-- ---------------------------------------------------------------------
-- Garantía en meses según el acta de la venta (null = aún sin acta)
-- ---------------------------------------------------------------------
create or replace function app.st_garantia_meses(f public.facturas, p_clave text)
returns integer language plpgsql stable as $$
declare a jsonb := coalesce(f.acta_datos, '{}'::jsonb); cant numeric; meses numeric;
begin
  if not (a ? 'garantiaCant' or a ? 'anios') then return null; end if;
  begin cant := coalesce(nullif(a->>'garantiaCant', ''), a->>'anios')::numeric; exception when others then return null; end;
  meses := case when a->>'garantiaUnidad' = 'meses' then cant else cant * 12 end;
  if p_clave is not null and (a->'sinGarantia'->>p_clave) in ('true', 't', '1') then meses := 0; end if;
  return meses::int;
end;
$$;

create or replace function app.st_fecha_acta(f public.facturas)
returns date language plpgsql stable as $$
begin return nullif(f.acta_datos->>'fecha', '')::date; exception when others then return null; end;
$$;

-- ---------------------------------------------------------------------
-- Crea el equipo (hoja de vida) si su serie aún no existe
-- ---------------------------------------------------------------------
create or replace function app.st_crear_equipo(
  f public.facturas, p_codigo text, p_nombre text, p_clave text, p_serie text, p_entrega date,
  p_origen text, p_ciudad text default null, p_direccion text default null, p_ubicacion text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_serie text := upper(btrim(coalesce(p_serie, '')));
  v_id uuid; v_meses integer; v_base date; v_plan text; v_frec integer;
  pr record; cl record; ent jsonb := coalesce(f.pago_entrega, '{}'::jsonb);
begin
  if v_serie = '' then return null; end if;
  select id into v_id from public.st_equipos where upper(serie) = v_serie and deleted_at is null limit 1;
  if found then return v_id; end if;
  v_meses := app.st_garantia_meses(f, p_clave);
  v_base := coalesce(p_entrega, app.st_fecha_acta(f), current_date);
  v_plan := case when coalesce(v_meses, 0) > 0 then 'Facturable' else 'Sin plan' end;
  v_frec := case when coalesce(v_meses, 0) > 0 then 6 else 0 end;
  select id, nombre, marca into pr from public.productos where codigo = p_codigo limit 1;
  select nombre, telefono, email into cl from public.clientes where id = f.cliente_id;
  insert into public.st_equipos (id, codigo, empresa, serie, producto_id, producto_texto, marca, factura_id, operacion_codigo, factura_texto, clave_venta,
    cliente_id, cliente_texto, identificacion, telefono, email, ciudad, direccion, ubicacion, asesor_id, fecha_venta, fecha_entrega,
    garantia_meses, garantia_hasta, plan_mantenimiento, frecuencia_meses, proximo_mantenimiento, estado, origen)
  values (gen_random_uuid(), 'EQ-' || to_char(now() at time zone 'America/Guayaquil', 'YYMMDD') || '-' || (1000 + floor(random() * 9000))::int,
    f.empresa, v_serie, pr.id, coalesce(p_nombre, pr.nombre), pr.marca, f.id, f.codigo, f.numero_contifico, p_clave,
    f.cliente_id, cl.nombre, f.identificacion, coalesce(cl.telefono, ent->>'telefonoDestinatario'), cl.email,
    coalesce(p_ciudad, ent->>'ciudad'), coalesce(p_direccion, ent->>'direccionEnvio', ent->>'direccionEntregaLocal'), p_ubicacion, f.asesor_id,
    f.fecha_facturacion, p_entrega, v_meses,
    case when coalesce(v_meses, 0) > 0 then (v_base + make_interval(months => v_meses))::date end,
    v_plan, v_frec, case when v_frec > 0 then (v_base + make_interval(months => v_frec))::date end, 'Operativo', p_origen)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.st_crear_equipo(public.facturas, text, text, text, text, date, text, text, text, text) from public, anon, authenticated;

-- Registro manual de un equipo vendido (solo equipos de ventas de la empresa)
create or replace function public.st_registrar_equipo(p_factura uuid, p_clave text, p_serie text, p_entrega date, p_ciudad text, p_direccion text, p_ubicacion text)
returns uuid language plpgsql security definer set search_path = public as $$
declare f public.facturas; l jsonb; v_id uuid; v_ex uuid;
begin
  if not app.puede('servicio_tecnico', 'editar') then raise exception 'Sin permiso en Servicio Técnico'; end if;
  if btrim(coalesce(p_serie, '')) = '' then raise exception 'Escribe el número de serie.'; end if;
  select * into f from public.facturas where id = p_factura and deleted_at is null;
  if not found then raise exception 'No se encontró la venta.'; end if;
  select id into v_ex from public.st_equipos where upper(serie) = upper(btrim(p_serie)) and deleted_at is null limit 1;
  if found then raise exception 'La serie % ya está registrada.', upper(btrim(p_serie)); end if;
  select it into l from (
    select it, coalesce(nullif(it->>'codigo', ''), it->>'itemId', it->>'id', '') || '|' ||
           row_number() over (partition by coalesce(nullif(it->>'codigo', ''), it->>'itemId', it->>'id', '') order by ord) as k
    from jsonb_array_elements(f.items) with ordinality t(it, ord)) q where k = p_clave;
  if l is null then raise exception 'Ese producto no pertenece a la venta elegida.'; end if;
  v_id := app.st_crear_equipo(f, coalesce(nullif(l->>'codigo', ''), l->>'itemId', l->>'id'), l->>'nombre', p_clave, p_serie, p_entrega,
                              'Registro manual', nullif(p_ciudad, ''), nullif(p_direccion, ''), nullif(p_ubicacion, ''));
  return v_id;
end;
$$;
revoke all on function public.st_registrar_equipo(uuid, text, text, date, text, text, text) from public, anon;
grant execute on function public.st_registrar_equipo(uuid, text, text, date, text, text, text) to authenticated;

-- Registra equipos de despachos ya hechos (series de Bodega) y completa garantías
create or replace function public.st_sincronizar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.despachos; f public.facturas; env jsonb; k text; s text; p jsonb; v_antes int; v_nuevos int := 0; v_gar int := 0; e record; m int; v_fecha date;
begin
  if not app.puede('servicio_tecnico', 'editar') then raise exception 'Sin permiso en Servicio Técnico'; end if;
  for d in select * from public.despachos where deleted_at is null and jsonb_array_length(envios) > 0 loop
    select * into f from public.facturas where id = d.factura_id;
    if not found then continue; end if;
    for env in select * from jsonb_array_elements(d.envios) loop
      for k in select jsonb_object_keys(coalesce(env->'series', '{}'::jsonb)) loop
        select pp into p from jsonb_array_elements(d.productos) pp where pp->>'key' = k limit 1;
        select fecha_entrega::date into v_fecha from public.entregas where despacho_id = d.id and envio_numero = (env->>'n')::int limit 1;
        for s in select jsonb_array_elements_text(env->'series'->k) loop
          if btrim(s) = '' then continue; end if;
          select count(*) into v_antes from public.st_equipos where upper(serie) = upper(btrim(s)) and deleted_at is null;
          perform app.st_crear_equipo(f, p->>'id', p->>'nombre', k, s, coalesce(v_fecha, (env->>'fecha')::date), 'Sincronización ' || d.codigo);
          if v_antes = 0 then v_nuevos := v_nuevos + 1; end if;
        end loop;
      end loop;
    end loop;
  end loop;
  -- Garantías aún desconocidas: se calculan si ya hay acta
  for e in select q.id, q.factura_id, q.clave_venta, q.fecha_entrega, q.plan_mantenimiento, q.frecuencia_meses from public.st_equipos q where q.garantia_meses is null and q.factura_id is not null and q.deleted_at is null loop
    select * into f from public.facturas where id = e.factura_id;
    m := app.st_garantia_meses(f, e.clave_venta);
    if m is null then continue; end if;
    v_fecha := coalesce(e.fecha_entrega, app.st_fecha_acta(f), current_date);
    update public.st_equipos set garantia_meses = m,
      garantia_hasta = case when m > 0 then (v_fecha + make_interval(months => m))::date end,
      plan_mantenimiento = case when m > 0 and plan_mantenimiento = 'Sin plan' and coalesce(frecuencia_meses, 0) = 0 then 'Facturable' else plan_mantenimiento end,
      frecuencia_meses = case when m > 0 and plan_mantenimiento = 'Sin plan' and coalesce(frecuencia_meses, 0) = 0 then 6 else frecuencia_meses end,
      proximo_mantenimiento = case when m > 0 and plan_mantenimiento = 'Sin plan' and coalesce(frecuencia_meses, 0) = 0 then (v_fecha + interval '6 months')::date else proximo_mantenimiento end
    where id = e.id;
    v_gar := v_gar + 1;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'garantias', v_gar);
end;
$$;
revoke all on function public.st_sincronizar() from public, anon;
grant execute on function public.st_sincronizar() to authenticated;

-- ---------------------------------------------------------------------
-- Preventivos automáticos: la orden se crea 15 días antes de la fecha
-- ---------------------------------------------------------------------
create or replace function public.st_programar_preventivos()
returns integer language plpgsql security definer set search_path = public as $$
declare e public.st_equipos; n int := 0; v_cob text; v_gar boolean;
begin
  if not app.puede('servicio_tecnico', 'editar') then return 0; end if;
  for e in select * from public.st_equipos
           where deleted_at is null and plan_mantenimiento is not null and plan_mantenimiento <> 'Sin plan' and proximo_mantenimiento is not null
             and coalesce(estado, '') <> 'Dado de baja' and proximo_mantenimiento <= current_date + 15
             and not exists (select 1 from public.st_ordenes o where o.equipo_id = st_equipos.id and o.deleted_at is null
                             and o.tipo = 'Mantenimiento preventivo' and o.estado not in ('Finalizada', 'Cancelada'))
  loop
    v_cob := case e.plan_mantenimiento when 'Incluido' then 'Incluido en la venta' when 'Contrato' then 'Contrato' else 'Facturable' end;
    v_gar := e.garantia_hasta is not null and e.garantia_hasta >= current_date;
    insert into public.st_ordenes (id, codigo, empresa, tipo, origen, prioridad, estado, modalidad, cobertura, equipo_id, serie, producto_texto, cliente_id, cliente_texto,
      identificacion, telefono, email, direccion, ciudad, factura_id, operacion_codigo, factura_texto, asesor_id, falla_reportada, token, eventos, checklist, mediciones, repuestos, asistentes, fotos, recepcion)
    values (gen_random_uuid(), 'OS-' || to_char(now() at time zone 'America/Guayaquil', 'YYMMDD') || '-' || (1000 + floor(random() * 9000))::int,
      e.empresa, 'Mantenimiento preventivo', 'Plan de mantenimiento', 'Normal', 'Recibida', 'En sitio', v_cob, e.id, e.serie, e.producto_texto, e.cliente_id, e.cliente_texto,
      e.identificacion, e.telefono, e.email, e.direccion, e.ciudad, e.factura_id, e.operacion_codigo, e.factura_texto, e.asesor_id,
      'Mantenimiento preventivo programado para el ' || to_char(e.proximo_mantenimiento, 'DD/MM/YYYY') || ' (plan: ' || e.plan_mantenimiento || ', cada ' || coalesce(e.frecuencia_meses, 0) || ' meses).' ||
        case when v_gar then ' Requerido para mantener la garantía.' else '' end,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      jsonb_build_array(jsonb_build_object('fecha', now(), 'por', 'Sistema', 'nota', 'Solicitud de mantenimiento preventivo recibida.', 'publico', true)),
      '[]', '[]', '[]', '[]', '[]', '{}');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.st_programar_preventivos() from public, anon;
grant execute on function public.st_programar_preventivos() to authenticated;

-- ---------------------------------------------------------------------
-- Cierre de la orden: valida, descuenta repuestos y actualiza la hoja de vida
-- p_fin = {estadoFinal, proximo, horas, recomendaciones, firma, firmaNombre, firmaCedula, firmaCargo}
-- ---------------------------------------------------------------------
create or replace function public.st_finalizar(p_id uuid, p_fin jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  o public.st_ordenes; eq public.st_equipos; yo uuid := app.empleado_id(); quien text;
  v_final text := p_fin->>'estadoFinal'; v_faltan text[] := '{}'; v_sin int; v_firma boolean; v_prox date; v_horas numeric; v_num text; v_n int;
  r jsonb; st integer; v_facturar boolean; v_cierre timestamptz := now(); v_cod text;
begin
  if not app.puede('servicio_tecnico', 'editar') then raise exception 'Sin permiso en Servicio Técnico'; end if;
  select * into o from public.st_ordenes where id = p_id and deleted_at is null for update;
  if not found then raise exception 'No se encontró la orden.'; end if;
  if o.estado in ('Finalizada', 'Cancelada') then raise exception 'La orden ya está cerrada.'; end if;
  if o.estado = 'Esperando aprobación' then raise exception 'La cotización aún no tiene respuesta del cliente.'; end if;
  if v_final is null or v_final not in ('Operativo', 'Operativo con observaciones', 'No operativo', 'Dado de baja') then raise exception 'Indica en qué estado queda el equipo.'; end if;
  select coalesce(nombre, email) into quien from public.empleados where id = yo; quien := coalesce(quien, 'Servicio Técnico');

  if o.tipo = 'Capacitación' then
    if jsonb_array_length(o.asistentes) = 0 then v_faltan := v_faltan || 'la lista de asistentes'; end if;
  elsif btrim(coalesce(o.trabajo_realizado, '')) = '' and btrim(coalesce(o.diagnostico, '')) = '' then v_faltan := v_faltan || 'el trabajo realizado o el diagnóstico';
  end if;
  select count(*) into v_sin from jsonb_array_elements(o.checklist) x where coalesce(x->>'resultado', '') = '';
  if v_sin > 0 then v_faltan := v_faltan || (v_sin || ' actividad(es) del checklist sin resultado'); end if;
  if o.modalidad is distinct from 'Remoto' and jsonb_array_length(o.fotos) = 0 then v_faltan := v_faltan || 'al menos una foto de evidencia'; end if;
  v_firma := coalesce(p_fin->>'firma', '') like 'data:image/png;base64,%' and length(p_fin->>'firma') < 40000;
  if o.modalidad is distinct from 'Remoto' and (not v_firma or btrim(coalesce(p_fin->>'firmaNombre', '')) = '') then v_faltan := v_faltan || 'la firma y el nombre de quien recibe el servicio'; end if;
  if array_length(v_faltan, 1) > 0 then raise exception 'Para cerrar falta: %.', array_to_string(v_faltan, ', '); end if;

  -- Repuestos → inventario (una sola vez)
  if jsonb_array_length(o.repuestos) > 0 and not o.repuestos_descontados then
    for r in select * from jsonb_array_elements(o.repuestos) loop
      select stock into st from public.productos where codigo = r->>'id' and deleted_at is null;
      if not found then raise exception 'El repuesto % no existe en Productos.', r->>'id'; end if;
      if st < (r->>'cantidad')::int then raise exception 'No hay stock suficiente de % (disponible: %).', r->>'nombre', st; end if;
    end loop;
    for r in select * from jsonb_array_elements(o.repuestos) loop
      insert into public.movimientos_inventario (id, tipo, operacion_codigo, producto_id, producto_codigo, nombre, cliente_texto, cantidad, responsable_id, responsable_texto, observacion)
      select gen_random_uuid(), 'SALIDA', o.codigo, p.id, p.codigo, p.nombre, o.cliente_texto, (r->>'cantidad')::numeric, yo, quien,
             'Servicio técnico ' || o.codigo || ' · ' || coalesce(o.producto_texto, '') || ' serie ' || coalesce(o.serie, '')
      from public.productos p where p.codigo = r->>'id';
      update public.productos set stock = stock - (r->>'cantidad')::int where codigo = r->>'id';
    end loop;
  end if;

  begin v_prox := nullif(p_fin->>'proximo', '')::date; exception when others then v_prox := null; end;
  v_horas := coalesce(nullif(p_fin->>'horas', '')::numeric, nullif(o.horas, 0), round((extract(epoch from (v_cierre - coalesce(o.inicio, v_cierre))) / 3600)::numeric, 1));
  v_facturar := o.cobertura = 'Facturable';
  select * into eq from public.st_equipos where id = o.equipo_id;

  perform pg_advisory_xact_lock(hashtext('st_informe_numero'));
  if o.informe_numero is null or o.informe_numero = '' then
    select count(*) + 1 into v_n from public.st_ordenes where informe_numero like 'IT-' || to_char(v_cierre at time zone 'America/Guayaquil', 'YYYY') || '-%';
    v_num := 'IT-' || to_char(v_cierre at time zone 'America/Guayaquil', 'YYYY') || '-' || lpad(v_n::text, 4, '0');
  else v_num := o.informe_numero; end if;

  update public.st_ordenes set
    estado = 'Finalizada', cierre = v_cierre, estado_final = v_final, inicio = coalesce(inicio, v_cierre),
    recomendaciones = case when p_fin ? 'recomendaciones' then left(p_fin->>'recomendaciones', 2000) else recomendaciones end,
    proximo_mantenimiento = v_prox, horas = greatest(0, v_horas),
    firma = case when v_firma then jsonb_build_object('png', p_fin->>'firma', 'nombre', left(p_fin->>'firmaNombre', 120), 'cedula', left(coalesce(p_fin->>'firmaCedula', ''), 20),
                                                       'cargo', left(coalesce(p_fin->>'firmaCargo', ''), 80), 'fecha', v_cierre) else '{}'::jsonb end,
    repuestos_descontados = jsonb_array_length(repuestos) > 0, facturacion = case when v_facturar then 'Pendiente' else 'No aplica' end, informe_numero = v_num,
    eventos = (eventos || jsonb_build_array(jsonb_build_object('fecha', v_cierre, 'por', quien, 'publico', true,
      'nota', 'Servicio finalizado. Tu equipo quedó ' || lower(v_final) || '. El informe técnico está disponible en este enlace.')))
  where id = p_id;

  if eq.id is not null then
    update public.st_equipos set
      estado = case v_final when 'Dado de baja' then 'Dado de baja' when 'No operativo' then 'No operativo' else 'Operativo' end,
      proximo_mantenimiento = case when o.tipo = 'Mantenimiento preventivo' then coalesce(v_prox, case when coalesce(eq.frecuencia_meses, 0) > 0 then (v_cierre::date + make_interval(months => eq.frecuencia_meses))::date end)
                                   when v_prox is not null then v_prox else proximo_mantenimiento end,
      fecha_entrega = case when o.tipo = 'Instalación' and fecha_entrega is null then v_cierre::date else fecha_entrega end
    where id = eq.id;
  end if;
  if v_facturar and o.asesor_id is not null then
    insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (o.asesor_id, 'servicio_tecnico', 'por_facturar', 'aviso', 'Servicio por facturar — ' || coalesce(o.cliente_texto, '') || ' (' || o.codigo || ')', 'st_ordenes', o.id);
  end if;
  return v_num;
end;
$$;
revoke all on function public.st_finalizar(uuid, jsonb) from public, anon;
grant execute on function public.st_finalizar(uuid, jsonb) to authenticated;
