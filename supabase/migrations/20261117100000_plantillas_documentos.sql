-- =====================================================================
-- Plantillas de documentos: el diseño de cada documento que genera la app (proforma, comprobante de venta,
-- acta de entrega, carta de garantía, anexo de series, guía de despacho, constancia de entrega) y la marca
-- común (logo, colores, leyenda y pie, código «general»). Se editan en el módulo «Plantillas de documentos».
--   · Leer: todo empleado (cada uno arma sus documentos con la plantilla vigente).
--   · Guardar: quien tenga plantillas › editar (o superadmin), por la función plantilla_guardar, que deja
--     cada versión en el historial para poder volver a una anterior.
-- Sin fila guardada, la app usa el diseño por defecto (el mismo que tenía antes).
-- =====================================================================

create table public.plantillas_documento (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null check (codigo ~ '^[a-z_]{3,40}$'),
  nombre          text not null,
  contenido       jsonb not null default '{}'::jsonb,
  version         integer not null default 1,
  actualizado_por uuid constraint plantillas_documento_actualizado_por_fk references public.empleados(id) on delete set null
);
select app.estandarizar('public.plantillas_documento');
create unique index plantillas_documento_codigo_uk on public.plantillas_documento (codigo) where deleted_at is null;
select app.aplicar_rls('public.plantillas_documento', array['plantillas'], array['plantillas']);
-- Todo empleado activo lee las plantillas vigentes para generar sus documentos.
create policy plantillas_leer_empleados on public.plantillas_documento for select to authenticated
  using (deleted_at is null and (select app.empleado_id()) is not null);

create table public.plantillas_documento_versiones (
  id           uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references public.plantillas_documento(id),
  codigo       text not null,
  version      integer not null,
  contenido    jsonb not null,
  guardado_por uuid constraint plantillas_versiones_guardado_por_fk references public.empleados(id) on delete set null,
  nota         text
);
select app.estandarizar('public.plantillas_documento_versiones');
create index plantillas_versiones_codigo_idx on public.plantillas_documento_versiones (codigo, version desc);
select app.aplicar_rls('public.plantillas_documento_versiones', array['plantillas'], array['plantillas']);

-- Guarda una plantilla (crea o actualiza) y deja la versión en el historial. Devuelve el número de versión.
create or replace function public.plantilla_guardar(p_codigo text, p_nombre text, p_contenido jsonb, p_nota text default null)
returns integer
language plpgsql security definer set search_path = public, app
as $$
declare v_id uuid; v_ver integer;
begin
  if not app.puede('plantillas', 'editar') then raise exception 'No tienes permiso para editar las plantillas de documentos.'; end if;
  if coalesce(p_codigo, '') !~ '^[a-z_]{3,40}$' then raise exception 'Plantilla no válida.'; end if;
  if p_contenido is null or jsonb_typeof(p_contenido) <> 'object' then raise exception 'El contenido de la plantilla no es válido.'; end if;
  if pg_column_size(p_contenido) > 1500000 then raise exception 'La plantilla es demasiado grande: usa un logo o imágenes más livianas.'; end if;

  select id into v_id from public.plantillas_documento where codigo = p_codigo and deleted_at is null for update;
  if v_id is null then
    insert into public.plantillas_documento (codigo, nombre, contenido, version, actualizado_por)
    values (p_codigo, coalesce(nullif(btrim(p_nombre), ''), p_codigo), p_contenido, 1, app.empleado_id())
    returning id, version into v_id, v_ver;
  else
    update public.plantillas_documento
       set contenido = p_contenido, nombre = coalesce(nullif(btrim(p_nombre), ''), nombre), version = version + 1, actualizado_por = app.empleado_id()
     where id = v_id
    returning version into v_ver;
  end if;
  insert into public.plantillas_documento_versiones (plantilla_id, codigo, version, contenido, guardado_por, nota)
  values (v_id, p_codigo, v_ver, p_contenido, app.empleado_id(), nullif(btrim(coalesce(p_nota, '')), ''));
  return v_ver;
end;
$$;
revoke all on function public.plantilla_guardar(text, text, jsonb, text) from public, anon;
grant execute on function public.plantilla_guardar(text, text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
