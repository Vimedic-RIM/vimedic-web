-- =====================================================================
-- VIMEDIC · Servicio Técnico: lo que faltaba frente al original (Issue #18)
--   · Página pública del servicio para el cliente (vmServicioPublico):
--     avance, línea de tiempo, garantía y descarga del informe técnico y
--     del comprobante de recepción, por el código de la orden.
--   · Cada orden nace con su código público (stToken_).
--   · Aviso al técnico cuando se le asigna una orden (stAvisarTecnico_;
--     el original enviaba un correo, aquí llega a la campana).
-- =====================================================================

-- 1) Código público de la orden
create or replace function app.tg_st_orden_token()
returns trigger language plpgsql as $$
begin
  if coalesce(new.token, '') = '' then new.token := replace(gen_random_uuid()::text, '-', ''); end if;
  return new;
end;
$$;
drop trigger if exists tg_st_orden_token on public.st_ordenes;
create trigger tg_st_orden_token before insert on public.st_ordenes for each row execute function app.tg_st_orden_token();
update public.st_ordenes set token = replace(gen_random_uuid()::text, '-', '') where coalesce(token, '') = '';
create unique index if not exists st_ordenes_token_uq on public.st_ordenes (token) where token is not null;

-- 2) Aviso al técnico asignado (interno o externo con usuario)
create or replace function app.tg_st_orden_tecnico()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_para uuid;
begin
  if (new.tecnico_id is null and coalesce(btrim(new.tecnico_texto), '') = '') or new.deleted_at is not null or new.estado in ('Finalizada', 'Cancelada') then return new; end if;
  if tg_op = 'UPDATE' and new.tecnico_id is not distinct from old.tecnico_id and new.tecnico_texto is not distinct from old.tecnico_texto then return new; end if;
  -- Externo: su usuario (empleado) o su correo; interno: el empleado con ese nombre
  if new.tecnico_id is not null then
    select coalesce(t.empleado_id, (select e.id from public.empleados e where lower(e.email) = lower(t.email) and e.estado = 'activo' and e.deleted_at is null limit 1))
      into v_para from public.st_tecnicos t where t.id = new.tecnico_id;
  else
    select e.id into v_para from public.empleados e where lower(btrim(e.nombre)) = lower(btrim(new.tecnico_texto)) and e.estado = 'activo' and e.deleted_at is null limit 1;
  end if;
  if v_para is null or v_para is not distinct from app.empleado_id() then return new; end if;
  insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
  values (v_para, 'serviciotecnico', 'asignada', 'aviso',
    'Se te asignó una orden de servicio: ' || coalesce(new.tipo, '') || ' — ' || coalesce(new.cliente_texto, '') ||
    coalesce(' · ' || nullif(new.producto_texto, ''), '') ||
    case when new.fecha_programada is not null then ' · ' || to_char(new.fecha_programada at time zone 'America/Guayaquil', 'DD/MM/YYYY HH24:MI') else '' end,
    'st_ordenes', new.id);
  return new;
exception when others then
  raise warning 'Aviso al técnico no creado: %', sqlerrm;  -- nunca bloquea la orden
  return new;
end;
$$;
drop trigger if exists tg_st_orden_tecnico on public.st_ordenes;
create trigger tg_st_orden_tecnico after insert or update of tecnico_id, tecnico_texto on public.st_ordenes
  for each row execute function app.tg_st_orden_tecnico();

-- 3) Página pública del servicio: /servicio/?c=<código>
create or replace function public.servicio_publico(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare o public.st_ordenes; e public.st_equipos; v_asesor text; v_tel text; v_tec_emp text; v_cod_prod text; v_gar text; v_cot jsonb; v_doc jsonb; v_eq jsonb;
begin
  if p_token is null or p_token !~* '^[a-f0-9]{24,64}$' then raise exception 'Enlace no válido.'; end if;
  select * into o from public.st_ordenes where token = p_token and deleted_at is null limit 1;
  if not found then raise exception 'No encontramos este servicio. Revisa el enlace.'; end if;
  if o.equipo_id is not null then select * into e from public.st_equipos where id = o.equipo_id; end if;
  select x.nombre, x.telefono into v_asesor, v_tel from public.empleados x where x.id = o.asesor_id;
  select t.empresa into v_tec_emp from public.st_tecnicos t where t.id = o.tecnico_id;
  if e.producto_id is not null then select p.codigo into v_cod_prod from public.productos p where p.id = e.producto_id; end if;
  v_gar := case when e.id is null then '' when e.garantia_hasta is not null then case when e.garantia_hasta >= (now() at time zone 'America/Guayaquil')::date then 'Vigente' else 'Vencida' end
                when e.garantia_meses = 0 then 'Sin garantía' else 'Por confirmar' end;
  v_cot := case when jsonb_typeof(o.cotizacion) = 'object' and o.cotizacion ? 'estado' then jsonb_build_object('estado', o.cotizacion->>'estado') end;

  -- Datos del informe / comprobante (sin fotos: están en un espacio privado)
  if o.estado = 'Finalizada' or coalesce(o.recepcion_numero, '') <> '' then
    v_doc := jsonb_build_object('codigo', o.codigo, 'tipo', o.tipo, 'empresa', o.empresa, 'cobertura', coalesce(o.cobertura, ''), 'modalidad', coalesce(o.modalidad, ''),
      'cliente', coalesce(o.cliente_texto, ''), 'identificacion', coalesce(o.identificacion, ''), 'direccion', coalesce(o.direccion, ''), 'ciudad', coalesce(o.ciudad, ''),
      'contacto', coalesce(o.contacto, ''), 'telefono', coalesce(o.telefono, ''), 'factura', coalesce(o.factura_texto, ''), 'producto', coalesce(o.producto_texto, ''), 'serie', coalesce(o.serie, ''),
      'tecnico', coalesce(o.tecnico_texto, ''), 'tecnicoEmpresa', coalesce(v_tec_emp, ''), 'inicio', coalesce(to_jsonb(o.inicio), '""'::jsonb), 'cierre', coalesce(to_jsonb(o.cierre), '""'::jsonb), 'horas', coalesce(o.horas, 0),
      'falla', coalesce(o.falla_reportada, ''), 'diagnostico', coalesce(o.diagnostico, ''), 'trabajo', coalesce(o.trabajo_realizado, ''), 'recomendaciones', coalesce(o.recomendaciones, ''),
      'estadoFinal', coalesce(o.estado_final, ''), 'proximoMantenimiento', coalesce(o.proximo_mantenimiento::text, ''), 'informeN', coalesce(o.informe_numero, ''), 'recepcionN', coalesce(o.recepcion_numero, ''),
      'checklist', case when jsonb_typeof(o.checklist) = 'array' then o.checklist else '[]'::jsonb end,
      'mediciones', case when jsonb_typeof(o.mediciones) = 'array' then o.mediciones else '[]'::jsonb end,
      'repuestos', case when jsonb_typeof(o.repuestos) = 'array' then o.repuestos else '[]'::jsonb end,
      'asistentes', case when jsonb_typeof(o.asistentes) = 'array' then o.asistentes else '[]'::jsonb end,
      'fotos', '[]'::jsonb,
      'recepcion', case when jsonb_typeof(o.recepcion) = 'object' then o.recepcion else '{}'::jsonb end,
      'firma', case when jsonb_typeof(o.firma) = 'object' then o.firma else '{}'::jsonb end);
    v_eq := case when e.id is null then null else jsonb_build_object('marca', coalesce(e.marca, ''), 'modelo', coalesce(e.modelo, ''), 'codigo', coalesce(v_cod_prod, ''), 'lote', coalesce(e.lote, ''),
      'fechaEntrega', coalesce(e.fecha_entrega::text, ''), 'garantia', v_gar, 'garantiaHasta', coalesce(e.garantia_hasta::text, ''), 'ubicacion', coalesce(e.ubicacion, '')) end;
  end if;

  return jsonb_build_object(
    'marca', case when o.empresa = 'FEMEDICS' then 'FEMEDICS' else 'VIMEDIC' end, 'codigo', o.codigo, 'tipo', o.tipo, 'modalidad', coalesce(o.modalidad, ''), 'estado', o.estado,
    'cliente', coalesce(o.cliente_texto, ''), 'producto', coalesce(o.producto_texto, ''), 'serie', coalesce(o.serie, ''), 'cobertura', coalesce(o.cobertura, ''),
    'garantia', v_gar, 'garantiaHasta', coalesce(e.garantia_hasta::text, ''),
    'tecnico', split_part(coalesce(o.tecnico_texto, ''), ' ', 1), 'fecha', o.fecha, 'fechaProgramada', o.fecha_programada, 'inicio', o.inicio, 'cierre', o.cierre,
    'conDiagnostico', coalesce(btrim(o.diagnostico), '') <> '',
    'huboRepuesto', exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o.eventos) = 'array' then o.eventos else '[]'::jsonb end) ev where ev->>'nota' ~* 'repuesto'),
    'cotizacion', v_cot, 'estadoFinal', coalesce(o.estado_final, ''), 'proximoMantenimiento', o.proximo_mantenimiento,
    'eventos', (select coalesce(jsonb_agg(jsonb_build_object('fecha', ev->>'fecha', 'nota', ev->>'nota') order by ev->>'fecha'), '[]'::jsonb)
                from jsonb_array_elements(case when jsonb_typeof(o.eventos) = 'array' then o.eventos else '[]'::jsonb end) ev where coalesce((ev->>'publico')::boolean, false)),
    'asesor', split_part(coalesce(v_asesor, ''), ' ', 1), 'contactoTelefono', coalesce(v_tel, ''),
    'informe', case when o.estado = 'Finalizada' then v_doc end, 'recepcion', case when coalesce(o.recepcion_numero, '') <> '' then v_doc end, 'equipo', v_eq);
end;
$$;
revoke all on function public.servicio_publico(text) from public;
grant execute on function public.servicio_publico(text) to anon, authenticated;

notify pgrst, 'reload schema';
