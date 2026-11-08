-- =====================================================================
-- VIMEDIC · Migración 009 · Seguridad a nivel de fila (RLS)
--
-- Regla general por tabla:
--   ver      → el usuario tiene "ver" en ALGUNO de los módulos de lectura
--   crear    → tiene "crear" en algún módulo de escritura
--   editar   → tiene "editar" en algún módulo de escritura
--   borrado lógico (deleted_at) → requiere "eliminar"
--   borrado físico (DELETE)     → solo superadministrador
-- Los registros con deleted_at solo los ve quien tiene "eliminar" (para restaurarlos).
--
-- Las páginas públicas con token (seguimiento de despacho, material de proveedores,
-- firma de servicio técnico, aprobación por correo) NO usan estas políticas:
-- se atienden con Edge Functions que usan la service_role en el servidor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function app.puede_alguno(p_modulos text[], p_accion text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.es_superadmin()
      or exists (
        select 1
        from unnest(p_modulos) m
        where coalesce((app.permisos_actuales() -> m) ? p_accion, false)
      );
$$;

create or replace function app.empresa_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e.empresa from public.empleados e
  where e.auth_user_id = auth.uid() and e.estado = 'activo' and e.deleted_at is null
  limit 1;
$$;

-- VIMEDIC y FEMEDICS comparten tablas: cada quien ve su empresa, y quien tiene
-- el módulo "femedics" ve las dos.
create or replace function app.acceso_empresa(p_empresa text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_empresa = app.empresa_actual() or app.puede('femedics', 'ver');
$$;

-- Impide el borrado lógico a quien no tiene "eliminar" en el módulo (argumento del trigger).
create or replace function app.tg_controlar_borrado_logico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modulos text[] := string_to_array(tg_argv[0], ',');
begin
  if new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null
     and not app.puede_alguno(v_modulos, 'eliminar') then
    raise exception 'No tienes permiso para eliminar o restaurar este registro';
  end if;
  return new;
end;
$$;

-- Crea las 4 políticas estándar de una tabla.
create or replace function app.aplicar_rls(
  p_tabla           regclass,
  p_modulos_ver     text[],
  p_modulos_editar  text[]
)
returns void
language plpgsql
as $$
declare
  v_ver    text := quote_literal(p_modulos_ver::text);
  v_editar text := quote_literal(p_modulos_editar::text);
begin
  execute format('alter table %s enable row level security', p_tabla);

  execute format('drop policy if exists rls_ver on %s', p_tabla);
  execute format('drop policy if exists rls_crear on %s', p_tabla);
  execute format('drop policy if exists rls_editar on %s', p_tabla);
  execute format('drop policy if exists rls_borrar on %s', p_tabla);

  execute format($p$
    create policy rls_ver on %1$s for select to authenticated
    using (app.puede_alguno(%2$s::text[], 'ver')
           and (deleted_at is null or app.puede_alguno(%3$s::text[], 'eliminar')))
  $p$, p_tabla, v_ver, v_editar);

  execute format($p$
    create policy rls_crear on %1$s for insert to authenticated
    with check (app.puede_alguno(%2$s::text[], 'crear'))
  $p$, p_tabla, v_editar);

  execute format($p$
    create policy rls_editar on %1$s for update to authenticated
    using (app.puede_alguno(%2$s::text[], 'editar'))
    with check (app.puede_alguno(%2$s::text[], 'editar'))
  $p$, p_tabla, v_editar);

  execute format($p$
    create policy rls_borrar on %1$s for delete to authenticated
    using (app.es_superadmin())
  $p$, p_tabla);

  execute format('drop trigger if exists tg_borrado_logico on %s', p_tabla);
  execute format(
    'create trigger tg_borrado_logico before update of deleted_at on %s for each row execute function app.tg_controlar_borrado_logico(%L)',
    p_tabla, array_to_string(p_modulos_editar, ','));
end;
$$;

-- ---------------------------------------------------------------------
-- Políticas estándar por tabla
-- ---------------------------------------------------------------------
do $$
declare
  -- Módulos que necesitan consultar el catálogo de productos
  v_operativos text[] := array['inventario','crm','femedics','facturacion','movimientos','marketing','bodega',
                               'logistica','importaciones','servicio_tecnico','catalogos','ofertas',
                               'promociones','documentos_tecnicos','dashboard'];
begin
  -- Inventario y catálogo
  perform app.aplicar_rls('public.categorias',          array['inventario','marketing','catalogos','crm','femedics'], array['inventario','marketing']);
  perform app.aplicar_rls('public.proveedores',         array['inventario','facturacion','importaciones','marketing'], array['inventario','facturacion','importaciones']);
  perform app.aplicar_rls('public.productos',           v_operativos, array['inventario']);
  perform app.aplicar_rls('public.productos_costos',    array['importaciones','facturacion','dashboard'], array['importaciones','facturacion']);
  perform app.aplicar_rls('public.producto_galeria',    v_operativos, array['inventario','marketing']);
  perform app.aplicar_rls('public.fichas_tecnicas',     v_operativos, array['inventario','marketing']);
  perform app.aplicar_rls('public.documentos_tecnicos', v_operativos, array['documentos_tecnicos','servicio_tecnico','marketing']);
  perform app.aplicar_rls('public.notas_internas',      array['inventario','crm','clientes','femedics'], array['inventario','crm','clientes','femedics']);
  perform app.aplicar_rls('public.aliados',             array['marketing'], array['marketing']);

  -- CRM (leads, cotizaciones y clientes tienen políticas propias más abajo)
  perform app.aplicar_rls('public.sugerencias_clientes',      array['clientes','crm','femedics'], array['clientes','crm','femedics']);
  perform app.aplicar_rls('public.etapas_pipeline',           array['crm','femedics','dashboard'], array['seguridad']);
  perform app.aplicar_rls('public.interacciones',             array['crm','femedics','clientes'], array['crm','femedics','clientes']);
  perform app.aplicar_rls('public.solicitudes_cambio_asesor', array['crm','femedics'], array['crm','femedics']);
  perform app.aplicar_rls('public.rutas',                     array['crm'], array['crm']);
  perform app.aplicar_rls('public.viaticos',                  array['crm','financiero'], array['crm','financiero']);
  perform app.aplicar_rls('public.mensajes',                  array['crm','marketing'], array['crm','marketing']);
  perform app.aplicar_rls('public.asignacion_conversaciones', array['crm','marketing'], array['crm','marketing']);
  perform app.aplicar_rls('public.catalogos_generados',       array['catalogos','marketing','crm'], array['catalogos','crm']);
  perform app.aplicar_rls('public.catalogo_actividad',        array['catalogos','marketing','crm'], array['catalogos','crm']);

  -- Facturación
  perform app.aplicar_rls('public.facturas',               array['facturacion','bodega','logistica','servicio_tecnico','dashboard'], array['facturacion']);
  perform app.aplicar_rls('public.ingresos_proveedor',     array['facturacion','movimientos'], array['facturacion']);
  perform app.aplicar_rls('public.notas_credito',          array['facturacion'], array['facturacion']);
  perform app.aplicar_rls('public.nota_credito_detalle',   array['facturacion'], array['facturacion']);
  perform app.aplicar_rls('public.movimientos_inventario', array['movimientos','facturacion','inventario','bodega'], array['facturacion','bodega','movimientos']);

  -- Agenda
  perform app.aplicar_rls('public.proyectos',           array['agenda'], array['agenda']);
  perform app.aplicar_rls('public.actividades',         array['agenda'], array['agenda']);
  perform app.aplicar_rls('public.monedas_movimientos', array['agenda'], array['agenda']);
  perform app.aplicar_rls('public.premios_agenda',      array['agenda'], array['agenda']);

  -- Marketing
  perform app.aplicar_rls('public.audiovisual',             array['marketing'], array['marketing']);
  perform app.aplicar_rls('public.marketing_publicaciones', array['marketing'], array['marketing']);
  perform app.aplicar_rls('public.marketing_cambios',       array['marketing','inventario'], array['marketing','inventario']);
  perform app.aplicar_rls('public.marketing_enlaces',       array['marketing'], array['marketing']);
  perform app.aplicar_rls('public.promo_campanas',          array['marketing','promociones','ofertas','crm'], array['marketing','promociones']);
  perform app.aplicar_rls('public.ofertas',                 array['ofertas','marketing','crm','femedics'], array['ofertas']);
  perform app.aplicar_rls('public.material_solicitudes',    array['marketing','importaciones'], array['marketing','importaciones']);
  perform app.aplicar_rls('public.material_archivos',       array['marketing','importaciones'], array['marketing','importaciones']);
  perform app.aplicar_rls('public.anuncios_activos',        array['marketing','crm'], array['marketing']);

  -- Importaciones
  perform app.aplicar_rls('public.imp_expedientes',        array['importaciones'], array['importaciones']);
  perform app.aplicar_rls('public.imp_pedidos',            array['importaciones','bodega'], array['importaciones']);
  perform app.aplicar_rls('public.imp_items',              array['importaciones','bodega','servicio_tecnico'], array['importaciones','bodega']);
  perform app.aplicar_rls('public.imp_unidades',           array['importaciones','bodega','servicio_tecnico'], array['importaciones','bodega','servicio_tecnico']);
  perform app.aplicar_rls('public.imp_codigos_reservados', array['importaciones','inventario'], array['importaciones']);
  perform app.aplicar_rls('public.imp_listas_pedido',      array['importaciones'], array['importaciones']);
  perform app.aplicar_rls('public.imp_recepciones',        array['importaciones','bodega','servicio_tecnico'], array['importaciones','bodega']);
  perform app.aplicar_rls('public.imp_ordenes_st',         array['importaciones','bodega','servicio_tecnico'], array['bodega','servicio_tecnico']);

  -- Bodega, logística y servicio técnico
  perform app.aplicar_rls('public.despachos',                  array['bodega','logistica','facturacion'], array['bodega']);
  perform app.aplicar_rls('public.entregas',                   array['logistica','bodega','crm'], array['logistica']);
  perform app.aplicar_rls('public.encuestas',                  array['logistica','crm','dashboard'], array['logistica']);
  perform app.aplicar_rls('public.st_tecnicos',                array['servicio_tecnico'], array['servicio_tecnico']);
  perform app.aplicar_rls('public.st_equipos',                 array['servicio_tecnico','crm','logistica'], array['servicio_tecnico']);
  perform app.aplicar_rls('public.st_ordenes',                 array['servicio_tecnico'], array['servicio_tecnico']);
  perform app.aplicar_rls('public.st_protocolos',              array['servicio_tecnico'], array['servicio_tecnico']);
  perform app.aplicar_rls('public.st_incidencias_inventario',  array['servicio_tecnico','bodega','inventario'], array['servicio_tecnico','bodega']);

  -- Talento humano (configuración)
  perform app.aplicar_rls('public.th_tipos_permiso',  array['talento_humano'], array['talento_humano']);
end;
$$;

-- Costos: además de Importaciones/Facturación/Dashboard, quien tenga la acción
-- "ver_costos" en Ofertas o Promociones (para calcular márgenes). Ver productos ≠ ver costos.
create policy costos_ofertas on public.productos_costos for select to authenticated
  using (deleted_at is null and app.puede_alguno(array['ofertas','promociones'], 'ver_costos'));

-- Todos los empleados pueden ver los tipos de permiso activos (para pedir uno).
create policy th_tipos_permiso_empleados on public.th_tipos_permiso
  for select to authenticated
  using (app.empleado_id() is not null and activo and deleted_at is null);

-- ---------------------------------------------------------------------
-- CRM: clientes, leads y cotizaciones con alcance por asesor
--   · "ver_todos" en crm → ve todo
--   · si no, ve lo suyo y lo de su equipo (subordinados)
--   · FEMEDICS solo con acceso a esa empresa
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['public.leads', 'public.cotizaciones'] loop
    execute format('drop policy if exists crm_ver on %s', t);
    execute format('drop policy if exists crm_crear on %s', t);
    execute format('drop policy if exists crm_editar on %s', t);
    execute format('drop policy if exists crm_borrar on %s', t);

    execute format($p$
      create policy crm_ver on %s for select to authenticated using (
        app.puede_alguno(array['crm','femedics'], 'ver')
        and app.acceso_empresa(empresa)
        and (app.puede_alguno(array['crm','femedics'], 'ver_todos') or app.es_yo_o_subordinado(asesor_id))
        and (deleted_at is null or app.puede_alguno(array['crm','femedics'], 'eliminar'))
      )$p$, t);

    execute format($p$
      create policy crm_crear on %s for insert to authenticated with check (
        app.puede_alguno(array['crm','femedics'], 'crear') and app.acceso_empresa(empresa)
      )$p$, t);

    execute format($p$
      create policy crm_editar on %s for update to authenticated
      using (
        app.puede_alguno(array['crm','femedics'], 'editar')
        and app.acceso_empresa(empresa)
        and (app.puede_alguno(array['crm','femedics'], 'ver_todos') or app.es_yo_o_subordinado(asesor_id))
      )
      with check (app.puede_alguno(array['crm','femedics'], 'editar') and app.acceso_empresa(empresa))
      $p$, t);

    execute format('create policy crm_borrar on %s for delete to authenticated using (app.es_superadmin())', t);

    execute format('drop trigger if exists tg_borrado_logico on %s', t);
    execute format('create trigger tg_borrado_logico before update of deleted_at on %s for each row execute function app.tg_controlar_borrado_logico(%L)', t, 'crm,femedics');
  end loop;
end;
$$;

create policy clientes_ver on public.clientes for select to authenticated using (
  app.acceso_empresa(empresa)
  and (deleted_at is null or app.puede_alguno(array['clientes','crm'], 'eliminar'))
  and (
    app.puede('clientes', 'ver')
    or app.puede_alguno(array['facturacion','bodega','logistica','servicio_tecnico','dashboard'], 'ver')
    or (app.puede_alguno(array['crm','femedics'], 'ver')
        and (app.puede_alguno(array['crm','femedics'], 'ver_todos') or app.es_yo_o_subordinado(asesor_id)))
  )
);
create policy clientes_crear on public.clientes for insert to authenticated with check (
  app.acceso_empresa(empresa) and app.puede_alguno(array['clientes','crm','femedics','facturacion'], 'crear')
);
create policy clientes_editar on public.clientes for update to authenticated
  using (
    app.acceso_empresa(empresa)
    and (app.puede_alguno(array['clientes','facturacion'], 'editar')
         or (app.puede_alguno(array['crm','femedics'], 'editar') and app.es_yo_o_subordinado(asesor_id)))
  )
  with check (app.acceso_empresa(empresa));
create policy clientes_borrar on public.clientes for delete to authenticated using (app.es_superadmin());
create trigger tg_borrado_logico before update of deleted_at on public.clientes
  for each row execute function app.tg_controlar_borrado_logico('clientes,crm');

-- ---------------------------------------------------------------------
-- Empleados y roles
-- ---------------------------------------------------------------------
create policy empleados_ver on public.empleados for select to authenticated using (
  auth_user_id = auth.uid() or app.puede_alguno(array['empleados','talento_humano','seguridad'], 'ver')
);
create policy empleados_crear on public.empleados for insert to authenticated with check (
  app.puede_alguno(array['empleados','talento_humano'], 'crear')
);
create policy empleados_editar on public.empleados for update to authenticated
  using (app.puede_alguno(array['empleados','talento_humano','seguridad'], 'editar'))
  with check (app.puede_alguno(array['empleados','talento_humano','seguridad'], 'editar'));
create policy empleados_borrar on public.empleados for delete to authenticated using (app.es_superadmin());

create policy roles_ver on public.roles for select to authenticated using (app.empleado_id() is not null);
create policy roles_admin on public.roles for all to authenticated
  using (app.puede('seguridad', 'administrar'))
  with check (app.puede('seguridad', 'administrar'));

-- Perfil y permisos del usuario conectado. El frontend lo llama al iniciar sesión:
--   const { data } = await supabase.rpc('mi_perfil')
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
    'permisos', app.permisos_actuales()
  )
  from public.empleados e
  left join public.roles r on r.id = e.rol_id
  where e.auth_user_id = auth.uid() and e.estado = 'activo' and e.deleted_at is null;
$$;
revoke all on function public.mi_perfil() from public, anon;
grant execute on function public.mi_perfil() to authenticated;

-- Directorio para listas desplegables (asesor, responsable…) sin exponer datos sensibles.
create view public.v_directorio_empleados
with (security_barrier = true)
as
select e.id, e.nombre, e.email, e.cargo, e.departamento, e.empresa, e.foto_url,
       e.jefe_id, e.recibe_leads, e.orden_asignacion
from public.empleados e
where e.estado = 'activo' and e.deleted_at is null and app.empleado_id() is not null;
-- La vista corre con los permisos de su dueño a propósito: muestra solo estas columnas.
revoke all on public.v_directorio_empleados from anon;
grant select on public.v_directorio_empleados to authenticated;

-- ---------------------------------------------------------------------
-- Bitácora, archivos, notificaciones, tareas por módulo
-- ---------------------------------------------------------------------
create policy bitacora_ver on public.bitacora for select to authenticated
  using (app.puede('seguridad', 'ver'));
create policy bitacora_agregar on public.bitacora for insert to authenticated
  with check (app.empleado_id() is not null and (empleado_id is null or empleado_id = app.empleado_id()));

create policy archivos_ver on public.archivos for select to authenticated
  using (app.empleado_id() is not null and deleted_at is null);
create policy archivos_crear on public.archivos for insert to authenticated
  with check (app.empleado_id() is not null);
create policy archivos_editar on public.archivos for update to authenticated
  using (creado_por = app.empleado_id() or app.es_superadmin())
  with check (creado_por = app.empleado_id() or app.es_superadmin());
create policy archivos_borrar on public.archivos for delete to authenticated using (app.es_superadmin());

create policy notificaciones_mias on public.notificaciones for select to authenticated
  using (para_id = app.empleado_id());
create policy notificaciones_marcar on public.notificaciones for update to authenticated
  using (para_id = app.empleado_id()) with check (para_id = app.empleado_id());
create policy notificaciones_crear on public.notificaciones for insert to authenticated
  with check (app.empleado_id() is not null);

create policy tareas_modulo_ver on public.tareas_modulo for select to authenticated
  using (app.puede(modulo, 'ver') and deleted_at is null);
create policy tareas_modulo_crear on public.tareas_modulo for insert to authenticated
  with check (app.puede(modulo, 'crear'));
create policy tareas_modulo_editar on public.tareas_modulo for update to authenticated
  using (app.puede(modulo, 'editar') or responsable_id = app.empleado_id())
  with check (app.puede(modulo, 'editar') or responsable_id = app.empleado_id());

-- ---------------------------------------------------------------------
-- Talento humano: cada empleado ve lo suyo, el jefe lo de su equipo
-- ---------------------------------------------------------------------
create policy th_solicitudes_ver on public.th_solicitudes for select to authenticated using (
  deleted_at is null and (
    empleado_id = app.empleado_id()
    or app.es_yo_o_subordinado(empleado_id)
    or app.puede('talento_humano', 'ver')
  )
);
create policy th_solicitudes_crear on public.th_solicitudes for insert to authenticated
  with check (empleado_id = app.empleado_id() or app.puede('talento_humano', 'crear'));
create policy th_solicitudes_editar on public.th_solicitudes for update to authenticated
  using (
    (empleado_id = app.empleado_id() and estado = 'Pendiente')
    or (app.es_yo_o_subordinado(empleado_id) and empleado_id <> app.empleado_id())
    or app.puede('talento_humano', 'editar')
  )
  with check (
    -- el propio empleado solo puede dejarla pendiente o cancelarla; aprobar es del jefe o TTHH
    (empleado_id = app.empleado_id() and estado in ('Pendiente', 'Cancelada'))
    or (app.es_yo_o_subordinado(empleado_id) and empleado_id <> app.empleado_id())
    or app.puede('talento_humano', 'editar')
  );

create policy th_vacaciones_ver on public.th_vacaciones_movimientos for select to authenticated
  using (empleado_id = app.empleado_id() or app.puede('talento_humano', 'ver'));
create policy th_vacaciones_admin on public.th_vacaciones_movimientos for insert to authenticated
  with check (app.puede('talento_humano', 'crear'));

-- Monedas de la agenda: cada empleado ve las suyas (además de quien tiene el módulo)
create policy monedas_mias on public.monedas_movimientos for select to authenticated
  using (empleado_id = app.empleado_id());

-- ---------------------------------------------------------------------
-- Web pública (anon): categorías activas, aliados y catálogo
-- ---------------------------------------------------------------------
create policy categorias_publico on public.categorias for select to anon
  using (activo and deleted_at is null);
create policy aliados_publico on public.aliados for select to anon
  using (activo and deleted_at is null);
