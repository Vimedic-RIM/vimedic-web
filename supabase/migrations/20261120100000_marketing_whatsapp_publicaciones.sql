-- =====================================================================
-- Marketing › WhatsApp en las publicaciones de Facebook e Instagram.
--   Al publicar desde el Planificador (Zernio), la Edge Function agrega al final del texto:
--     · Facebook: enlace wa.me que abre el chat con un mensaje ya escrito que dice de qué publicación viene;
--     · Instagram: el número (allí los enlaces del texto no se pueden tocar).
--   Ajuste en marketing_ajustes (clave 'whatsapp_publicaciones'): {"empleado_id","nombre","activo"}.
--   El teléfono no se guarda en el ajuste: la función lo lee de Empleados al publicar.
--   Por defecto: Victor Lopez (pedido del 20-nov). Se cambia en Marketing › Configuración.
-- =====================================================================

insert into public.marketing_ajustes (clave, valor)
select 'whatsapp_publicaciones', jsonb_build_object('empleado_id', e.id, 'nombre', e.nombre, 'activo', true)
  from public.empleados e
 where e.deleted_at is null and e.estado = 'activo' and e.nombre ilike 'victor lopez'
   and length(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g')) >= 9
 order by e.created_at
 limit 1
on conflict (clave) do nothing;

-- Quién puede ser el contacto (empleados activos con celular) y el ajuste actual. Solo quien administra Marketing.
create or replace function public.mkt_whatsapp_opciones()
returns jsonb
language plpgsql stable security definer set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar este ajuste.'; end if;
  return jsonb_build_object(
    'actual', (select valor from public.marketing_ajustes where clave = 'whatsapp_publicaciones' and deleted_at is null),
    'empleados', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'nombre', e.nombre, 'cargo', e.cargo,
                                          'termina', right(regexp_replace(e.telefono, '\D', '', 'g'), 4)) order by e.nombre)
        from public.empleados e
       where e.deleted_at is null and e.estado = 'activo' and length(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g')) >= 9
    ), '[]'::jsonb));
end;
$$;

create or replace function public.mkt_whatsapp_guardar(p_empleado uuid, p_activo boolean)
returns jsonb
language plpgsql security definer set search_path = public, app
as $$
declare v_nombre text; v_valor jsonb;
begin
  if not app.puede('marketing', 'administrar') then raise exception 'Solo quien administra Marketing puede cambiar este ajuste.'; end if;
  select e.nombre into v_nombre from public.empleados e
   where e.id = p_empleado and e.deleted_at is null and e.estado = 'activo' and length(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g')) >= 9;
  if v_nombre is null then raise exception 'Elige un empleado activo que tenga celular en Empleados.'; end if;
  v_valor := jsonb_build_object('empleado_id', p_empleado, 'nombre', v_nombre, 'activo', coalesce(p_activo, true));
  insert into public.marketing_ajustes (clave, valor) values ('whatsapp_publicaciones', v_valor)
  on conflict (clave) do update set valor = excluded.valor, deleted_at = null;
  return v_valor;
end;
$$;

revoke all on function public.mkt_whatsapp_opciones(), public.mkt_whatsapp_guardar(uuid, boolean) from public, anon;
grant execute on function public.mkt_whatsapp_opciones(), public.mkt_whatsapp_guardar(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
