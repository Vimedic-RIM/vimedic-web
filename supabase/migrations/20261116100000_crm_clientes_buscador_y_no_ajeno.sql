-- =====================================================================
-- CRM: buscador de clientes y restricción "cliente de otro asesor", como el original
-- (Clientes.gs: getClientsList → esPropio; verificarClienteNoAjeno_; CRMDashboard.html: filaResultadoCliente_).
--   · El buscador cruza TODOS los clientes de la empresa. Los de otro asesor salen igual (para no duplicarlos), pero solo con
--     el nombre y a quién están asignados, sin cédula, ciudad, correo ni teléfono, y no se pueden usar.
--   · "Propio" = quien ve todo, el cliente sin asesor, el suyo o el de su equipo, y para el Asistente Comercial Gerencia los
--     de la Alta Dirección. Antes un asesor no veía los clientes sin asesor ni encontraba los de otros (y podía duplicarlos).
--   · Bloqueo real en la base: no se crea una cotización/venta para la cédula/RUC de un cliente de otro asesor; si quien la
--     crea es el asistente y el cliente es de un jefe, queda a nombre de ese jefe. Un cliente con una cédula ya registrada
--     da un mensaje claro (antes: error técnico del índice único).
-- =====================================================================

create or replace function app.cliente_propio(p_asesor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_asesor is null
      or app.es_superadmin()
      or app.puede_alguno(array['crm', 'femedics'], 'ver_todos')
      or app.es_yo_o_subordinado(p_asesor)
      or p_asesor = any (app.gerencia_asistida());
$$;
revoke all on function app.cliente_propio(uuid) from public, anon;
grant execute on function app.cliente_propio(uuid) to authenticated;

-- Los clientes SIN asesor son de todos (esPropio = !c.asesor): se ven y se editan con permiso del CRM.
drop policy if exists clientes_ver_sin_asesor on public.clientes;
create policy clientes_ver_sin_asesor on public.clientes for select to authenticated
  using ((select app.puede_alguno(array['crm', 'femedics'], 'ver'))
         and (empresa = (select app.empresa_actual()) or (select app.puede('femedics', 'ver')))
         and deleted_at is null and asesor_id is null);
drop policy if exists clientes_editar_sin_asesor on public.clientes;
create policy clientes_editar_sin_asesor on public.clientes for update to authenticated
  using (app.puede_alguno(array['crm', 'femedics'], 'editar') and app.acceso_empresa(empresa) and asesor_id is null)
  with check (app.acceso_empresa(empresa));

-- Buscador: todos los clientes de la empresa; los propios primero y con sus datos, los ajenos solo con nombre y asesor.
create or replace function public.crm_buscar_clientes(p_q text, p_empresa text default null, p_limite integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp text := coalesce(nullif(btrim(p_empresa), ''), app.empresa_actual());
  w text[];
  v_dig text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
  r jsonb;
begin
  if not (app.es_superadmin() or app.puede_alguno(array['crm', 'femedics', 'clientes', 'facturacion'], 'ver')) then
    raise exception 'Sin permiso para buscar clientes.';
  end if;
  if not app.acceso_empresa(v_emp) then raise exception 'Sin acceso a los clientes de %.', v_emp; end if;
  w := array(select x from regexp_split_to_table(public.sin_tildes(coalesce(p_q, '')), '\s+') x where x <> '');
  if coalesce(array_length(w, 1), 0) = 0 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(t.j order by t.propio desc, t.nombre), '[]'::jsonb) into r
  from (
    select c.nombre, app.cliente_propio(c.asesor_id) as propio,
      case when app.cliente_propio(c.asesor_id) then jsonb_build_object(
          'id', c.id, 'nombre', c.nombre, 'identificacion', c.identificacion, 'email', c.email, 'telefono', c.telefono,
          'direccion', c.direccion, 'ciudad', c.ciudad, 'institucion', c.institucion, 'asesor_id', c.asesor_id,
          'tipo_cliente', c.tipo_cliente, 'descuento_fijo', c.descuento_fijo, 'datos_venta', c.datos_venta, 'propio', true)
        else jsonb_build_object('id', c.id, 'nombre', c.nombre, 'asesor_id', c.asesor_id, 'propio', false) end as j
    from public.clientes c
    where c.deleted_at is null and c.empresa = v_emp
      and (not exists (select 1 from unnest(w) x where strpos(c.busqueda || ' ' || public.sin_tildes(coalesce(c.direccion, '')), x) = 0)
           -- cédula/RUC y teléfonos también por dígitos ("+593 99 123 4567" encuentra "0991234567"), como el original
           or (length(v_dig) >= 6 and strpos(regexp_replace(coalesce(c.identificacion, '') || ' ' || coalesce(c.telefono, '') || ' ' || coalesce(c.telefono2, ''), '[^0-9 ]', '', 'g'), right(v_dig, 9)) > 0))
    order by app.cliente_propio(c.asesor_id) desc, c.nombre
    limit least(greatest(coalesce(p_limite, 50), 1), 100)
  ) t;
  return r;
end $$;
revoke all on function public.crm_buscar_clientes(text, text, integer) from public, anon;
grant execute on function public.crm_buscar_clientes(text, text, integer) to authenticated;

-- Bloqueo real (verificarClienteNoAjeno_): cotización/venta nueva para el cliente o la cédula/RUC de un cliente de otro asesor.
create or replace function app.tg_cotizacion_cliente_no_ajeno() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; v_ident text := app.normalizar_identificacion(new.identificacion);
begin
  if auth.uid() is null then return new; end if;   -- cargas e importaciones
  select cl.id, cl.nombre, cl.asesor_id, e.nombre as asesor into c
  from public.clientes cl left join public.empleados e on e.id = cl.asesor_id
  where cl.deleted_at is null and cl.asesor_id is not null and cl.empresa = coalesce(new.empresa, 'VIMEDIC')
    and ((new.cliente_id is not null and cl.id = new.cliente_id) or (v_ident is not null and cl.identificacion = v_ident))
  order by (cl.id = new.cliente_id) desc nulls last
  limit 1;
  if c.id is null then return new; end if;
  -- El Asistente Comercial Gerencia trabaja los clientes de los jefes: queda a nombre del jefe dueño del cliente.
  if c.asesor_id = any (app.gerencia_asistida()) then new.asesor_id := c.asesor_id; return new; end if;
  if app.cliente_propio(c.asesor_id) then return new; end if;
  raise exception '"%" ya está asignado al asesor %. No puedes crear cotización, venta ni cliente para esta cédula/RUC — se duplicaría la información del cliente.', c.nombre, coalesce(c.asesor, 'otro asesor');
end $$;
drop trigger if exists tg_cotizacion_cliente_no_ajeno on public.cotizaciones;
create trigger tg_cotizacion_cliente_no_ajeno before insert on public.cotizaciones
  for each row execute function app.tg_cotizacion_cliente_no_ajeno();

-- Cliente con una cédula/RUC que ya existe: mensaje claro en vez del error del índice único.
create or replace function app.tg_cliente_no_duplicado() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; v_ident text := app.normalizar_identificacion(new.identificacion);
begin
  if v_ident is null or new.deleted_at is not null then return new; end if;
  select cl.nombre, e.nombre as asesor into c
  from public.clientes cl left join public.empleados e on e.id = cl.asesor_id
  where cl.deleted_at is null and cl.empresa = new.empresa and cl.identificacion = v_ident and cl.id <> new.id
  limit 1;
  if found then
    raise exception 'Ya existe un cliente con la cédula/RUC % ("%"%). No se crea un cliente duplicado.', v_ident, c.nombre,
      case when c.asesor is not null then ', asignado a ' || c.asesor else ', sin asesor' end;
  end if;
  return new;
end $$;
drop trigger if exists tg_cliente_no_duplicado on public.clientes;
create trigger tg_cliente_no_duplicado before insert on public.clientes
  for each row execute function app.tg_cliente_no_duplicado();

notify pgrst, 'reload schema';
