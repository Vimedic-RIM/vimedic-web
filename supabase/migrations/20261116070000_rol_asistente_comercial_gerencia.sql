-- Rol "Asistente Comercial Gerencia".
-- Problema: las cotizaciones, ventas, clientes y leads de la Alta Dirección solo los veían ellos (ver_todos) y su equipo hacia abajo
-- (app.es_yo_o_subordinado). Quien asistía a los jefes no podía abrirlos, cotizarles ni venderles: el sistema decía "ya está asignado a otro asesor".
-- Solución: un rol propio. Quien lo tiene gestiona TODO lo comercial de la Alta Dirección (leads, clientes, cotizaciones, ventas y su
-- seguimiento) más lo suyo, sin ver el resto del CRM ni lo de los demás asesores.
--   · Los "jefes" se reconocen por el rol CRM "Alta Dirección"; el "asistente", por el rol CRM "Asistente Comercial Gerencia"
--     (campo rol_crm del rol, editable en Seguridad: un rol personalizado con ese valor también funciona).
--   · NO se toca app.es_yo_o_subordinado: Rutas, Viáticos y lo demás que la usan siguen igual (el asistente no ve los viáticos del jefe).
--   · Se agregan políticas ADICIONALES (se suman a las existentes) en leads, cotizaciones y clientes; nada se reemplaza.

-- 1) Rol (de sistema). Permisos = los de un Asesor (CRM, agenda, ofertas, catálogos, inventario); el alcance sobre los jefes sale de la regla de abajo.
insert into public.roles (nombre, descripcion, rol_crm, alcance, es_superadmin, es_sistema, permisos)
select 'Asistente Comercial Gerencia',
       'Gestiona lo comercial de la Alta Dirección (leads, clientes, cotizaciones, ventas y su seguimiento) a nombre de los jefes',
       'Asistente Comercial Gerencia', 'subordinados', false, true,
       '{"crm": ["ver","crear","editar"], "agenda": ["ver","crear","editar"], "ofertas": ["ver"], "catalogos": ["ver","crear"], "inventario": ["ver"]}'::jsonb
 where not exists (select 1 from public.roles where nombre = 'Asistente Comercial Gerencia');

-- 2) A quiénes asiste la persona que está conectada: la Alta Dirección activa, solo si ella tiene el rol de asistente. Vacío para los demás.
create or replace function app.gerencia_asistida() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(j.id), '{}'::uuid[])
    from public.empleados j
    join public.roles rj on rj.id = j.rol_id and rj.deleted_at is null and rj.rol_crm = 'Alta Dirección'
   where j.deleted_at is null and j.estado = 'activo'
     and exists (select 1 from public.empleados yo
                   join public.roles ry on ry.id = yo.rol_id and ry.deleted_at is null and ry.rol_crm = 'Asistente Comercial Gerencia'
                  where yo.id = app.empleado_id());
$$;
revoke all on function app.gerencia_asistida() from public, anon;
grant execute on function app.gerencia_asistida() to authenticated;

-- 3) Políticas adicionales (permissive: se suman a las que ya existen). (select …) hace que la lista se calcule una vez por consulta.
-- leads
drop policy if exists crm_ver_asistente on public.leads;
create policy crm_ver_asistente on public.leads for select to authenticated
  using ((select app.puede_alguno(array['crm', 'femedics'], 'ver'))
         and (empresa = (select app.empresa_actual()) or (select app.puede('femedics', 'ver')))
         and deleted_at is null
         and asesor_id = any ((select app.gerencia_asistida())::uuid[]));
drop policy if exists crm_editar_asistente on public.leads;
create policy crm_editar_asistente on public.leads for update to authenticated
  using (app.puede_alguno(array['crm', 'femedics'], 'editar') and app.acceso_empresa(empresa)
         and asesor_id = any ((select app.gerencia_asistida())::uuid[]))
  with check (app.puede_alguno(array['crm', 'femedics'], 'editar') and app.acceso_empresa(empresa));
-- cotizaciones (proformas y ventas)
drop policy if exists crm_ver_asistente on public.cotizaciones;
create policy crm_ver_asistente on public.cotizaciones for select to authenticated
  using ((select app.puede_alguno(array['crm', 'femedics'], 'ver'))
         and (empresa = (select app.empresa_actual()) or (select app.puede('femedics', 'ver')))
         and deleted_at is null
         and asesor_id = any ((select app.gerencia_asistida())::uuid[]));
drop policy if exists crm_editar_asistente on public.cotizaciones;
create policy crm_editar_asistente on public.cotizaciones for update to authenticated
  using (app.puede_alguno(array['crm', 'femedics'], 'editar') and app.acceso_empresa(empresa)
         and asesor_id = any ((select app.gerencia_asistida())::uuid[]))
  with check (app.puede_alguno(array['crm', 'femedics'], 'editar') and app.acceso_empresa(empresa));
-- clientes
drop policy if exists clientes_ver_asistente on public.clientes;
create policy clientes_ver_asistente on public.clientes for select to authenticated
  using ((select app.puede_alguno(array['crm', 'femedics'], 'ver'))
         and (empresa = (select app.empresa_actual()) or (select app.puede('femedics', 'ver')))
         and deleted_at is null
         and asesor_id = any ((select app.gerencia_asistida())::uuid[]));
drop policy if exists clientes_editar_asistente on public.clientes;
create policy clientes_editar_asistente on public.clientes for update to authenticated
  using (app.puede_alguno(array['crm', 'femedics'], 'editar') and app.acceso_empresa(empresa)
         and asesor_id = any ((select app.gerencia_asistida())::uuid[]))
  with check (app.acceso_empresa(empresa));

-- 4) Seguimiento de pedidos: ve y anota los pedidos de los jefes como un asesor los suyos (misma función de siempre + los asistidos).
create or replace function app.trk_ve(p_asesor uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.puede('tracking', 'ver') or app.puede('dashboard', 'ver') or app.puede_alguno(array['crm', 'femedics'], 'ver_todos')
      or (p_asesor is not null and app.es_yo_o_subordinado(p_asesor))
      or (p_asesor is not null and p_asesor = any (app.gerencia_asistida()));
$$;

-- 5) mi_perfil: agrega "asiste_a" (ids de los jefes que gestiona; [] si no es asistente). El resto queda igual que antes.
create or replace function public.mi_perfil()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', e.id,
    'nombre', e.nombre,
    'email', e.email,
    'empresa', e.empresa,
    'cargo', e.cargo,
    'departamento', e.departamento,
    'foto_url', e.foto_url,
    'jefe_id', e.jefe_id,
    'rol', r.nombre,
    'rol_crm', r.rol_crm,
    'es_superadmin', app.es_superadmin(),
    'permisos', app.permisos_actuales(),
    'es_jefe', exists (select 1 from public.empleados s where s.jefe_id = e.id and s.id <> e.id and s.deleted_at is null),
    'asiste_a', to_jsonb(app.gerencia_asistida())
  )
  from public.empleados e
  left join public.roles r on r.id = e.rol_id
  where e.auth_user_id = auth.uid() and e.estado = 'activo' and e.deleted_at is null;
$$;
revoke all on function public.mi_perfil() from public, anon;
grant execute on function public.mi_perfil() to authenticated;
