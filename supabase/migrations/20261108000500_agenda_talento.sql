-- =====================================================================
-- VIMEDIC · Migración 005 · Agenda y Talento Humano
-- Reemplaza: Proyectos, Actividades, MonedasAgenda, PremiosAgenda,
--            SOL Solicitudes, SOL Tipos Permiso, SOL Vacaciones Movimientos.
-- =====================================================================

create table public.proyectos (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text unique,
  nombre              text not null,
  descripcion         text,
  responsable_id      uuid references public.empleados(id) on delete set null,
  estado              text,
  areas               text[] not null default '{}',
  fecha_inicio        date,
  fecha_fin_estimada  date
);
select app.estandarizar('public.proyectos');

create table public.actividades (
  id                       uuid primary key default gen_random_uuid(),
  codigo                   text unique,                -- "ID Actividad"
  proyecto_id              uuid references public.proyectos(id) on delete set null,
  descripcion              text not null,
  ubicacion                text,
  tipo                     text,
  fecha_programada         date,
  hora                     time,
  duracion_min             integer,
  prioridad                text check (prioridad in ('Urgente', 'Importante', 'Normal')),
  relacionado_con          text check (relacionado_con in ('Cliente', 'Compañero', 'Proveedor', 'Área interna', 'Proyecto', 'Otro')),
  con_quien                text,
  realiza_id               uuid references public.empleados(id) on delete set null,
  delegada                 boolean not null default false,
  delegado_a_id            uuid references public.empleados(id) on delete set null,
  estado                   text not null default 'Por hacer'
                           check (estado in ('Por hacer', 'En marcha', 'Pausado', 'Listo', 'Devuelto', 'Cancelado')),
  detalle                  text,
  evidencia_url            text,
  enlace_relacionado       text,
  -- Devolución / corrección
  devolucion               jsonb not null default '{}'::jsonb, -- motivo, comentario, devuelto_a, fecha_limite, evidencia
  -- Cierre
  resultado                text,
  quedo_pendiente          boolean,
  fecha_retomar            date,
  evidencia_final_url      text,
  fecha_finalizacion       timestamptz,
  finalizado_por           uuid references public.empleados(id) on delete set null,
  -- Supervisión y calificación
  requiere_supervision     boolean not null default false,
  calificacion             numeric(4,1),
  comentario_calificacion  text,
  calificado_por           uuid references public.empleados(id) on delete set null,
  fecha_calificacion       timestamptz,
  -- Tiempo
  segundos_trabajados      integer not null default 0,
  veces_iniciada           integer not null default 0,
  veces_pausada            integer not null default 0,
  historial_tiempo         jsonb not null default '[]'::jsonb,
  ajustes_tiempo           jsonb not null default '[]'::jsonb,
  ultima_sesion            jsonb,
  -- Gamificación
  moneda_otorgada          integer not null default 0,
  moneda_penalizada        integer not null default 0,
  avisos_pendientes        jsonb not null default '[]'::jsonb,
  -- Integraciones
  origen                   text,
  crm_gestion_id           text,                -- "ID Gestión CRM"
  area_usuario             text,
  calendar_event_id        text,
  invitados                text[] not null default '{}',
  enlace_meet              text,
  agregar_calendar         boolean not null default false
);
select app.estandarizar('public.actividades');
create index actividades_realiza_fecha_idx on public.actividades (realiza_id, fecha_programada);
create index actividades_delegado_idx      on public.actividades (delegado_a_id) where delegado_a_id is not null;
create index actividades_proyecto_idx      on public.actividades (proyecto_id);
create index actividades_estado_idx        on public.actividades (estado);

create table public.monedas_movimientos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique,
  empleado_id   uuid not null references public.empleados(id) on delete cascade,
  fecha         timestamptz not null default now(),
  cambio        integer not null,
  motivo        text,
  actividad_id  uuid references public.actividades(id) on delete set null
);
select app.estandarizar('public.monedas_movimientos');
create index monedas_movimientos_empleado_idx on public.monedas_movimientos (empleado_id, fecha desc);

create table public.premios_agenda (
  id           uuid primary key default gen_random_uuid(),
  codigo       text unique,
  emoji        text,
  nombre       text not null,
  costo        integer not null,
  categoria    text,
  activo       boolean not null default true,
  descripcion  text
);
select app.estandarizar('public.premios_agenda');

-- ---------------------------------------------------------------------
-- Talento humano: permisos, vacaciones y solicitudes
-- ---------------------------------------------------------------------
create table public.th_tipos_permiso (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text unique,
  nombre                 text not null,
  requiere_documento     boolean not null default false,
  remunerado             boolean not null default true,
  duracion_maxima        numeric(6,2),
  unidad_maxima          text,
  afecta_vacaciones      boolean not null default false,
  autorizacion_especial  boolean not null default false,
  clase                  text,
  confidencial           boolean not null default false,
  activo                 boolean not null default true,
  orden                  integer
);
select app.estandarizar('public.th_tipos_permiso');

create table public.th_solicitudes (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text unique,
  tipo                   text not null,
  subtipo                text,
  tipo_permiso_id        uuid references public.th_tipos_permiso(id) on delete set null,
  estado                 text not null default 'Pendiente',
  fecha_solicitud        timestamptz not null default now(),
  empleado_id            uuid not null references public.empleados(id) on delete cascade,
  jefe_id                uuid references public.empleados(id) on delete set null,
  modalidad              text,
  fecha_inicio           date,
  fecha_fin              date,
  fecha_reincorporacion  date,
  hora_inicio            time,
  hora_fin               time,
  duracion               numeric(6,2),
  unidad                 text,
  dias_vacaciones        numeric(6,2),
  motivo                 text,
  observaciones          text,
  confidencial           boolean not null default false,
  requiere_excepcion     boolean not null default false,
  excepcion_motivo       text,
  documento_drive_id     text,
  documento_nombre       text,
  -- Aprobación del jefe
  jefe_decision          text,
  jefe_decision_por      uuid references public.empleados(id) on delete set null,
  jefe_decision_fecha    timestamptz,
  jefe_observacion       text,
  -- Aprobación de Talento Humano
  tthh_decision          text,
  tthh_decision_por      uuid references public.empleados(id) on delete set null,
  tthh_decision_fecha    timestamptz,
  tthh_observacion       text,
  -- Horas
  horas_autorizadas      numeric(6,2),
  horas_trabajadas       numeric(6,2),
  horas_compensadas      numeric(6,2),
  verificada_pago        boolean not null default false,
  descuento_codigo       text,
  datos                  jsonb not null default '{}'::jsonb,
  historial              jsonb not null default '[]'::jsonb,
  request_key            text unique,
  version                integer not null default 1
);
select app.estandarizar('public.th_solicitudes');
create index th_solicitudes_empleado_idx on public.th_solicitudes (empleado_id, fecha_solicitud desc);
create index th_solicitudes_jefe_idx     on public.th_solicitudes (jefe_id, estado);

create table public.th_vacaciones_movimientos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique,
  fecha         timestamptz not null default now(),
  empleado_id   uuid not null references public.empleados(id) on delete cascade,
  tipo          text not null,
  dias          numeric(6,2) not null,
  solicitud_id  uuid references public.th_solicitudes(id) on delete set null,
  motivo        text,
  usuario_id    uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.th_vacaciones_movimientos');
create index th_vacaciones_empleado_idx on public.th_vacaciones_movimientos (empleado_id, fecha desc);
