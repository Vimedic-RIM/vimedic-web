-- =====================================================================
-- Reparto de leads de Meta: SOLO a quien tiene el permiso en Empleados (pedido del 20-nov).
--   Antes: si el cliente ya existía, el lead iba a su asesor aunque no tuviera «Recibe clientes potenciales de
--   Meta» o ya no estuviera activo. Ahora el asesor del cliente se respeta solo si está activo, es de la misma
--   empresa y tiene el permiso; si no, entra al reparto justo normal (que ya solo elige a quienes lo tienen).
-- =====================================================================

create or replace function app.tg_leads_meta_reparto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cli record;
  v_tel text := right(regexp_replace(coalesce(new.telefono, ''), '\D', '', 'g'), 9);
begin
  if new.origen_tipo <> 'meta' or new.asesor_id is not null or new.fecha < now() - interval '1 day' then
    return new;
  end if;
  new.medio_captacion := coalesce(new.medio_captacion, '📣 Anuncio en Facebook o Instagram');

  -- ¿Ya es cliente? Solo cuenta su asesor si puede recibir leads de Meta (activo y con el permiso).
  select c.id, c.asesor_id into v_cli
    from public.clientes c
    join public.empleados e on e.id = c.asesor_id
   where c.deleted_at is null and c.empresa = new.empresa
     and e.deleted_at is null and e.estado = 'activo' and e.recibe_clientes_meta and e.empresa = new.empresa
     and ((new.cliente_id is not null and c.id = new.cliente_id)
          or (length(v_tel) = 9 and right(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g'), 9) = v_tel)
          or (coalesce(new.email, '') <> '' and lower(c.email) = lower(new.email)))
   order by (c.id = new.cliente_id) desc nulls last
   limit 1;

  if v_cli.asesor_id is not null then
    new.asesor_id := v_cli.asesor_id; new.cliente_id := coalesce(new.cliente_id, v_cli.id); new.asignacion := 'cliente existente';
  else
    new.asesor_id := app.meta_elegir_asesor(new.empresa);
    if new.asesor_id is not null then new.asignacion := 'reparto'; end if;
  end if;
  if new.asesor_id is not null then new.asignado_en := now(); end if;
  return new;
end;
$$;
