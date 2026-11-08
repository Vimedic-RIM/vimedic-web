-- =====================================================================
-- VIMEDIC · Módulo Logística
-- Evidencias en Storage, choferes, cierre de entrega (equipos de Servicio
-- Técnico e instalaciones) y postventa automática para el asesor.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('entregas', 'entregas', false, 15728640)
on conflict (id) do nothing;

drop policy if exists entregas_storage_ver on storage.objects;
create policy entregas_storage_ver on storage.objects for select to authenticated
  using (bucket_id = 'entregas' and app.puede_alguno(array['logistica', 'bodega', 'crm'], 'ver'));
drop policy if exists entregas_storage_subir on storage.objects;
create policy entregas_storage_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'entregas' and app.puede('logistica', 'editar'));
drop policy if exists entregas_storage_borrar on storage.objects;
create policy entregas_storage_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'entregas' and app.puede('logistica', 'editar'));

-- Choferes / responsables: empleados con acceso a Logística
create or replace function public.lg_equipo()
returns table (id uuid, nombre text, email text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.email
  from public.empleados e left join public.roles r on r.id = e.rol_id
  where app.puede('logistica', 'ver') and e.estado = 'activo' and e.deleted_at is null
    and (coalesce(r.permisos, '{}'::jsonb) ? 'logistica' or coalesce(e.permisos_extra, '{}'::jsonb) ? 'logistica' or coalesce(e.es_superadmin, false))
  order by e.nombre
$$;
revoke all on function public.lg_equipo() from public, anon;
grant execute on function public.lg_equipo() to authenticated;

-- Entrega realizada (chofer propio / retiro) o recibida (transportista)
create or replace function public.lg_entregar(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.entregas; f public.facturas; yo uuid := app.empleado_id(); quien text; externo boolean; v_nombre text;
  v_prueba jsonb; pr jsonb; s text; eq uuid; eqs uuid[] := '{}'; tipos text[] := '{}'; t text; conf jsonb; pide text; e public.st_equipos; ent jsonb;
begin
  if not app.puede('logistica', 'editar') then raise exception 'Sin permiso en Logística'; end if;
  select * into o from public.entregas where id = p_id and deleted_at is null for update;
  if not found then raise exception 'No se encontró la entrega.'; end if;
  if o.estado = 'Entregada' then raise exception 'Esta entrega ya está cerrada.'; end if;
  select coalesce(emp.nombre, emp.email) into quien from public.empleados emp where emp.id = yo; quien := coalesce(quien, 'Logística');
  externo := o.modalidad = 'Transportista';
  v_nombre := left(btrim(coalesce(p->>'nombre', '')), 120);
  if not externo then
    if v_nombre = '' then raise exception 'Escribe el nombre de quien recibe.'; end if;
    if coalesce(p->>'firma', '') not like 'data:image/png;base64,%' or length(p->>'firma') > 40000 then raise exception 'Falta la firma de quien recibe.'; end if;
    if jsonb_array_length(coalesce(p->'fotos', '[]'::jsonb)) = 0 then raise exception 'Toma al menos una foto de la entrega.'; end if;
  end if;
  v_prueba := jsonb_build_object('nombre', v_nombre, 'cedula', left(coalesce(p->>'cedula', ''), 20), 'firma', case when externo then '' else coalesce(p->>'firma', '') end,
    'fotos', coalesce(p->'fotos', '[]'::jsonb), 'lat', p->'lat', 'lng', p->'lng', 'precision', p->'precision', 'nota', left(coalesce(p->>'nota', ''), 600),
    'fecha', now(), 'por', quien, 'confirmacion', case when externo then coalesce(nullif(p->>'confirmacion', ''), 'Confirmado con el cliente') else '' end);
  update public.entregas set estado = 'Entregada', prueba = v_prueba, fecha_entrega = now(),
    postventa_fecha = case when postventa_codigo is null then (case when externo then now() else now() + interval '1 day' end) else postventa_fecha end,
    eventos = eventos || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', quien, 'publico', true, 'clave', 'entregado',
      'nota', (case when modalidad = 'Retiro' then 'Pedido retirado' else 'Pedido entregado' end) || (case when v_nombre <> '' then ' a ' || v_nombre else '' end) || '.'))
  where id = p_id;

  -- Servicio Técnico: equipos con serie y, si se pidió, órdenes de instalación / capacitación
  select * into f from public.facturas where id = o.factura_id;
  if found then
    for pr in select * from jsonb_array_elements(o.productos) loop
      for s in select jsonb_array_elements_text(coalesce(pr->'series', '[]'::jsonb)) loop
        if btrim(s) = '' then continue; end if;
        eq := app.st_crear_equipo(f, pr->>'id', pr->>'nombre', pr->>'key', s, current_date, 'Entrega ' || o.codigo);
        if eq is not null then
          update public.st_equipos set fecha_entrega = coalesce(fecha_entrega, current_date) where id = eq;
          eqs := eqs || eq;
        end if;
      end loop;
    end loop;
  end if;
  conf := coalesce(o.confirmacion, '{}'::jsonb); pide := coalesce(conf->>'instalacion', ''); ent := coalesce(o.entrega, '{}'::jsonb);
  if array_length(eqs, 1) > 0 and pide ~* 'Instalaci|Capacitaci|Ambas' then
    tipos := case when pide = 'Ambas' then array['Instalación', 'Capacitación'] when pide ~* 'Instalaci' then array['Instalación'] else array['Capacitación'] end;
    foreach t in array tipos loop
      for eq in select unnest(case when t = 'Instalación' then eqs else eqs[1:1] end) loop
        select * into e from public.st_equipos where id = eq;
        insert into public.st_ordenes (id, codigo, empresa, tipo, origen, prioridad, estado, modalidad, cobertura, equipo_id, serie, producto_texto, cliente_id, cliente_texto, identificacion,
          contacto, telefono, email, direccion, ciudad, factura_id, operacion_codigo, factura_texto, asesor_id, falla_reportada, token, eventos, checklist, mediciones, repuestos, asistentes, fotos, recepcion)
        values (gen_random_uuid(), 'OS-' || to_char(now() at time zone 'America/Guayaquil', 'YYMMDD') || '-' || (1000 + floor(random() * 9000))::int,
          e.empresa, t, 'Logística ' || o.codigo, 'Alta', 'Recibida', 'En sitio', 'Incluido en la venta', e.id, e.serie, e.producto_texto, e.cliente_id, e.cliente_texto, e.identificacion,
          coalesce(conf->>'recibeNombre', ent->>'quienRecibe', ent->>'nombreDestinatario', ''), coalesce(conf->>'recibeTelefono', o.telefono, e.telefono), e.email, e.direccion, e.ciudad, e.factura_id, e.operacion_codigo, e.factura_texto, e.asesor_id,
          case when t = 'Instalación' then 'Instalación y puesta en marcha solicitada en la venta.' else 'Capacitación al personal solicitada en la venta.' end ||
            coalesce(' ' || nullif(concat_ws(' · ', nullif('Piso: ' || coalesce(conf->>'piso', ''), 'Piso: '), nullif('Horario: ' || coalesce(conf->>'horario', ''), 'Horario: '),
              nullif('Ingreso: ' || coalesce(conf->>'permisoIngreso', ''), 'Ingreso: ')), ''), ''),
          replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
          jsonb_build_array(jsonb_build_object('fecha', now(), 'por', quien, 'nota', 'Solicitud de ' || lower(t) || ' recibida.', 'publico', true)),
          '[]', '[]', '[]', '[]', '[]', '{}');
      end loop;
    end loop;
  end if;
end;
$$;
revoke all on function public.lg_entregar(uuid, jsonb) from public, anon;
grant execute on function public.lg_entregar(uuid, jsonb) to authenticated;

-- Postventa: nueva gestión en el CRM a nombre del asesor cuando llega su fecha
create or replace function public.lg_activar_postventas()
returns integer language plpgsql security definer set search_path = public as $$
declare o public.entregas; n int := 0; v_cod text; v_interes text;
begin
  if not app.puede('logistica', 'editar') then return 0; end if;
  for o in select * from public.entregas where deleted_at is null and postventa_codigo is null and postventa_fecha is not null and postventa_fecha <= now() and estado in ('Entregada', 'Con transportista') loop
    v_cod := 'CON-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    v_interes := 'Postventa — Factura ' || coalesce(o.factura_texto, '—') || ': ' ||
      coalesce((select string_agg((x->>'cantidad') || '× ' || (x->>'nombre'), ', ') from jsonb_array_elements(o.productos) x), '') ||
      case when o.modalidad = 'Transportista' then ' · Enviado por ' || coalesce(o.transportista, '') || ' (guía ' || coalesce(o.guia_numero, '') || ')'
           else ' · Entregado ' || coalesce(to_char(o.fecha_entrega at time zone 'America/Guayaquil', 'DD/MM/YYYY'), '') end ||
      '. Confirmar recepción, funcionamiento, capacitación y satisfacción.';
    insert into public.leads (id, codigo, empresa, origen_tipo, nombre, telefono, email, interes, canal, medio_captacion, asesor_id, estado_crm, ultima_actividad, proximo_seguimiento)
    values (gen_random_uuid(), v_cod, o.empresa, 'contacto', o.cliente_texto, o.telefono, o.email, v_interes, 'Postventa', 'Postventa', o.asesor_id, 'Contactado', now(), now());
    update public.entregas set postventa_codigo = v_cod,
      eventos = eventos || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', 'Sistema', 'publico', false, 'nota', 'Se activó la gestión de postventa para el asesor (' || v_cod || ').'))
    where id = o.id;
    if o.asesor_id is not null then
      insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
      values (o.asesor_id, 'logistica', 'postventa', 'aviso', 'Postventa pendiente — ' || coalesce(o.cliente_texto, '') || ' (' || v_cod || ')', 'entregas', o.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.lg_activar_postventas() from public, anon;
grant execute on function public.lg_activar_postventas() to authenticated;
