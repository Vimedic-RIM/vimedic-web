-- =====================================================================
-- Términos y condiciones de las ofertas: generales (para todas las ofertas) y por campaña (se suman a los
-- generales). Se editan en Ofertas › Términos. Al guardar una cotización o venta con productos en oferta, la
-- app guarda una COPIA de los términos vigentes en la cotización (terminos_ofertas), así la proforma no cambia
-- si después se editan los términos. El asesor no los edita: solo decide mostrarlos u ocultarlos (mostrar_terminos).
-- =====================================================================

create table public.ofertas_terminos (
  id              uuid primary key default gen_random_uuid(),
  campana_id      uuid references public.promo_campanas(id) on delete cascade,   -- null = términos generales
  campos          jsonb not null default '{}'::jsonb,
  activo          boolean not null default true,
  actualizado_por uuid constraint ofertas_terminos_actualizado_por_fk references public.empleados(id) on delete set null
);
select app.estandarizar('public.ofertas_terminos');
create unique index ofertas_terminos_alcance_uk on public.ofertas_terminos (coalesce(campana_id, '00000000-0000-0000-0000-000000000000'::uuid)) where deleted_at is null;
select app.aplicar_rls('public.ofertas_terminos', array['ofertas', 'marketing'], array['ofertas']);
-- Todo empleado los lee: el asesor los copia en su cotización al guardarla.
create policy ofertas_terminos_leer_empleados on public.ofertas_terminos for select to authenticated
  using (deleted_at is null and (select app.empleado_id()) is not null);

-- Copia de los términos en la cotización y la opción de mostrarlos en la proforma.
alter table public.cotizaciones
  add column if not exists terminos_ofertas jsonb,
  add column if not exists mostrar_terminos boolean not null default true;

/** Guarda los términos generales (p_campana null) o los de una campaña. */
create or replace function public.ofertas_terminos_guardar(p_campana uuid, p_campos jsonb, p_activo boolean default true)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not (app.es_superadmin() or app.puede('ofertas', 'editar') or app.puede('marketing', 'administrar')) then
    raise exception 'No tienes permiso para editar los términos y condiciones de las ofertas.';
  end if;
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' then raise exception 'Términos no válidos.'; end if;
  if pg_column_size(p_campos) > 60000 then raise exception 'Los términos son demasiado largos.'; end if;
  if p_campana is not null and not exists (select 1 from public.promo_campanas where id = p_campana and deleted_at is null) then raise exception 'Campaña no encontrada.'; end if;
  select id into v_id from public.ofertas_terminos where coalesce(campana_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_campana, '00000000-0000-0000-0000-000000000000'::uuid) and deleted_at is null for update;
  if v_id is null then
    insert into public.ofertas_terminos (campana_id, campos, activo, actualizado_por) values (p_campana, p_campos, coalesce(p_activo, true), app.empleado_id());
  else
    update public.ofertas_terminos set campos = p_campos, activo = coalesce(p_activo, true), actualizado_por = app.empleado_id() where id = v_id;
  end if;
end;
$$;
revoke all on function public.ofertas_terminos_guardar(uuid, jsonb, boolean) from public, anon;
grant execute on function public.ofertas_terminos_guardar(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
