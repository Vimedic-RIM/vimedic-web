-- =====================================================================
-- VIMEDIC · Migración 001 · Base: extensiones, utilidades, seguridad
-- Reemplaza: Empleados, Roles, Accesos, PermisosRoles, Sesiones (→ Supabase Auth),
--            Bitácora, Papelera (→ columna deleted_at), Bodega / Financiero /
--            TalentoHumano (tareas por módulo).
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- Esquema privado para funciones internas (no se expone por la API de Supabase).
create schema if not exists app;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------

-- Mantiene updated_at al día en cada UPDATE (lo usa la app móvil para sincronizar).
create or replace function app.tg_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Agrega a una tabla las columnas estándar del proyecto:
--   created_at, updated_at, deleted_at (borrado lógico), creado_por
-- además del trigger de updated_at, un índice para sincronización y RLS activado.
-- Todas las tablas de negocio deben pasar por aquí.
create or replace function app.estandarizar(p_tabla regclass)
returns void
language plpgsql
as $$
declare
  v_nombre text := split_part(p_tabla::text, '.', 2);
begin
  if v_nombre = '' then v_nombre := p_tabla::text; end if;

  execute format('alter table %s add column if not exists created_at timestamptz not null default now()', p_tabla);
  execute format('alter table %s add column if not exists updated_at timestamptz not null default now()', p_tabla);
  execute format('alter table %s add column if not exists deleted_at timestamptz', p_tabla);
  execute format('alter table %s add column if not exists creado_por uuid references public.empleados(id) on delete set null', p_tabla);

  execute format('create index if not exists %I on %s (updated_at)', v_nombre || '_updated_at_idx', p_tabla);
  execute format('drop trigger if exists tg_updated_at on %s', p_tabla);
  execute format('create trigger tg_updated_at before update on %s for each row execute function app.tg_updated_at()', p_tabla);
  execute format('alter table %s enable row level security', p_tabla);
end;
$$;

-- Normaliza cédula / RUC ecuatoriano: quita todo lo que no sea dígito y
-- recupera el cero inicial que Google Sheets eliminó al guardarlo como número
-- (cédulas de 9 dígitos → 10, RUC de 12 → 13).
create or replace function app.normalizar_identificacion(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or btrim(p) = '' then null
    else (
      with d as (select regexp_replace(split_part(p, '.', 1), '\D', '', 'g') as v)
      select case
        when length(v) = 9  then lpad(v, 10, '0')
        when length(v) = 12 then lpad(v, 13, '0')
        when v = '' then null
        else v
      end
      from d
    )
  end;
$$;

-- Empresas que comparten el sistema (FEMEDICS es distribuidor autorizado).
create or replace function app.empresas_validas()
returns text[]
language sql
immutable
as $$ select array['VIMEDIC', 'FEMEDICS'] $$;

-- ---------------------------------------------------------------------
-- Roles y empleados
-- ---------------------------------------------------------------------

-- permisos: { "crm": ["ver","crear","editar","ver_todos"], "inventario": ["ver"], ... }
-- Acciones usadas: ver, crear, editar, eliminar, aprobar, exportar, ver_todos, administrar
create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null unique,
  descripcion   text,
  rol_crm       text,                       -- Asesor, Supervisor Comercial, Alta Dirección, Marketing…
  permisos      jsonb not null default '{}'::jsonb,
  alcance       text not null default 'propio'
                check (alcance in ('propio', 'departamento', 'subordinados', 'organizacion')),
  es_superadmin boolean not null default false,
  es_sistema    boolean not null default false
);

create table public.empleados (
  id                         uuid primary key default gen_random_uuid(),
  auth_user_id               uuid unique references auth.users(id) on delete set null,
  codigo                     text unique,                    -- "ID Empleado"
  email                      text not null unique check (email = lower(email)),
  nombre                     text not null,
  cedula                     text,
  telefono                   text,
  correo_personal            text,
  cumpleanos                 date,
  foto_url                   text,
  empresa                    text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  local                      text,
  departamento               text,
  cargo                      text,                           -- "Rol" de la hoja (Comercial, Bodega…)
  jefe_id                    uuid references public.empleados(id) on delete set null,
  rol_id                     uuid references public.roles(id) on delete set null,
  permisos_extra             jsonb not null default '{}'::jsonb, -- se suman a los del rol
  es_superadmin              boolean not null default false,
  -- Asignación automática de leads
  recibe_leads               boolean not null default false,
  recibe_leads_mensajes      boolean not null default false,
  recibe_clientes_meta       boolean not null default false,
  orden_asignacion           integer,
  -- Talento humano
  estado                     text not null default 'activo' check (estado in ('activo', 'inactivo')),
  estado_laboral             text,
  fecha_ingreso              date,
  jornada_laboral            text,
  hora_entrada               time,
  hora_salida                time,
  saldo_inicial_vacaciones   numeric(6,2),
  fecha_corte_vacaciones     date,
  preferencias               jsonb not null default '{}'::jsonb -- Rol Marketing, Agenda Rol, etc.
);

select app.estandarizar('public.empleados');
create index empleados_jefe_idx on public.empleados (jefe_id);
create index empleados_rol_idx  on public.empleados (rol_id);

-- roles no tiene creado_por obligatorio, pero sí las columnas estándar
select app.estandarizar('public.roles');

-- ---------------------------------------------------------------------
-- Funciones de permisos (security definer: leen empleados sin pasar por RLS)
-- ---------------------------------------------------------------------

create or replace function app.empleado_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.empleados e
  where e.auth_user_id = auth.uid()
    and e.estado = 'activo'
    and e.deleted_at is null
  limit 1;
$$;

create or replace function app.es_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select e.es_superadmin or coalesce(r.es_superadmin, false)
    from public.empleados e
    left join public.roles r on r.id = e.rol_id
    where e.auth_user_id = auth.uid()
      and e.estado = 'activo'
      and e.deleted_at is null
    limit 1
  ), false);
$$;

-- Permisos efectivos = permisos del rol + permisos_extra del empleado.
create or replace function app.permisos_actuales()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.permisos, '{}'::jsonb) || coalesce(e.permisos_extra, '{}'::jsonb)
  from public.empleados e
  left join public.roles r on r.id = e.rol_id
  where e.auth_user_id = auth.uid()
    and e.estado = 'activo'
    and e.deleted_at is null
  limit 1;
$$;

-- ¿El usuario actual puede hacer <accion> en <modulo>?
create or replace function app.puede(p_modulo text, p_accion text default 'ver')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.es_superadmin()
      or coalesce((app.permisos_actuales() -> p_modulo) ? p_accion, false);
$$;

-- ¿El empleado indicado es el usuario actual o alguien a su cargo (directo o indirecto)?
create or replace function app.es_yo_o_subordinado(p_empleado uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive equipo as (
    select app.empleado_id() as id
    union
    select e.id from public.empleados e join equipo q on e.jefe_id = q.id
  )
  select p_empleado is not null and exists (select 1 from equipo where id = p_empleado);
$$;

-- Evita que alguien sin permiso de Seguridad cambie su propio rol, permisos o superadmin.
create or replace function app.tg_proteger_permisos_empleado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.rol_id is distinct from old.rol_id
      or new.permisos_extra is distinct from old.permisos_extra
      or new.es_superadmin is distinct from old.es_superadmin
      or new.auth_user_id is distinct from old.auth_user_id)
     and auth.uid() is not null
     and not app.puede('seguridad', 'administrar') then
    raise exception 'No tienes permiso para cambiar roles o permisos de empleados';
  end if;
  return new;
end;
$$;

create trigger tg_proteger_permisos
before update on public.empleados
for each row execute function app.tg_proteger_permisos_empleado();

-- Vincula automáticamente la cuenta de Supabase Auth con el empleado por correo
-- la primera vez que inicia sesión.
create or replace function app.tg_vincular_auth_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.empleados
     set auth_user_id = new.id
   where email = lower(new.email)
     and auth_user_id is null;
  return new;
end;
$$;

create trigger tg_vincular_empleado
after insert on auth.users
for each row execute function app.tg_vincular_auth_usuario();

-- ---------------------------------------------------------------------
-- Bitácora (solo se agrega; nunca se edita)
-- ---------------------------------------------------------------------
create table public.bitacora (
  id            bigint generated always as identity primary key,
  fecha         timestamptz not null default now(),
  empleado_id   uuid references public.empleados(id) on delete set null,
  usuario_email text,
  modulo        text,
  accion        text,
  registro      text,
  resultado     text check (resultado in ('OK', 'Denegado', 'Error', 'Pendiente')),
  detalle       text,
  sesion        text,
  origen        text
);
alter table public.bitacora enable row level security;
create index bitacora_fecha_idx  on public.bitacora (fecha desc);
create index bitacora_modulo_idx on public.bitacora (modulo, fecha desc);

-- ---------------------------------------------------------------------
-- Archivos (referencias a Google Drive o Cloudflare R2)
-- ---------------------------------------------------------------------
create table public.archivos (
  id              uuid primary key default gen_random_uuid(),
  almacenamiento  text not null check (almacenamiento in ('drive', 'r2', 'externo')),
  drive_id        text,
  r2_bucket       text,
  r2_key          text,
  url             text,
  nombre          text,
  mime            text,
  tamano_bytes    bigint,
  publico         boolean not null default false,
  entidad         text,         -- 'producto', 'factura', 'cliente', 'despacho'…
  entidad_id      uuid,
  tipo            text,         -- 'imagen', 'video', 'pdf', 'ficha_tecnica', 'evidencia'…
  descripcion     text,
  check (
    (almacenamiento = 'drive' and drive_id is not null)
    or (almacenamiento = 'r2' and r2_key is not null)
    or (almacenamiento = 'externo' and url is not null)
  )
);
select app.estandarizar('public.archivos');
create index archivos_entidad_idx on public.archivos (entidad, entidad_id);

-- ---------------------------------------------------------------------
-- Tareas por módulo (hojas Bodega, Financiero, TalentoHumano → ModulosBase.gs)
-- ---------------------------------------------------------------------
create table public.tareas_modulo (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,
  modulo            text not null,                 -- 'bodega', 'financiero', 'talento_humano'…
  fecha             timestamptz not null default now(),
  titulo            text not null,
  detalle           text,
  estado            text not null default 'Pendiente'
                    check (estado in ('Pendiente', 'En proceso', 'Completado', 'Cancelado')),
  prioridad         text not null default 'Media'
                    check (prioridad in ('Baja', 'Media', 'Alta', 'Urgente')),
  responsable_id    uuid references public.empleados(id) on delete set null,
  fecha_compromiso  date,
  actualizado_por   uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.tareas_modulo');
create index tareas_modulo_modulo_idx on public.tareas_modulo (modulo, estado);

-- ---------------------------------------------------------------------
-- Notificaciones internas (SOL Notificaciones y avisos de otros módulos)
-- ---------------------------------------------------------------------
create table public.notificaciones (
  id            uuid primary key default gen_random_uuid(),
  para_id       uuid not null references public.empleados(id) on delete cascade,
  modulo        text,
  evento        text,
  tipo          text,
  texto         text not null,
  entidad       text,
  entidad_id    uuid,
  leida_en      timestamptz
);
select app.estandarizar('public.notificaciones');
create index notificaciones_para_idx on public.notificaciones (para_id, leida_en);
