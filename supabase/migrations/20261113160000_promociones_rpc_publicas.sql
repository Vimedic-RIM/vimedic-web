-- Arreglo: las funciones de aprobar promociones quedaron solo en el esquema interno "app" y la app
-- (que solo puede llamar funciones de "public") mostraba "Could not find the function
-- public.revisar_item_promocion ... in the schema cache". Se publican en "public" como puente,
-- sin cambiar su lógica (permisos, piso de margen y creación de ofertas siguen en app.*).

create or replace function public.revisar_item_promocion(
  p_campana_id uuid, p_item_codigo text, p_decision text, p_desc_aprobado numeric default null, p_comentario text default null
)
returns jsonb language sql security definer set search_path = public, app as $$
  select app.revisar_item_promocion(p_campana_id, p_item_codigo, p_decision, p_desc_aprobado, p_comentario)
$$;

create or replace function public.aprobar_campana_promocion(p_campana_id uuid, p_comentario text default null)
returns jsonb language sql security definer set search_path = public, app as $$
  select app.aprobar_campana_promocion(p_campana_id, p_comentario)
$$;

revoke all on function public.revisar_item_promocion(uuid, text, text, numeric, text), public.aprobar_campana_promocion(uuid, text) from public, anon;
grant execute on function public.revisar_item_promocion(uuid, text, text, numeric, text), public.aprobar_campana_promocion(uuid, text) to authenticated;

notify pgrst, 'reload schema';
