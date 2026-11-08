-- Las políticas de lectura de clientes, cotizaciones y leads llamaban a funciones de permisos una vez POR FILA
-- (miles de llamadas por consulta). Se envuelven en (select ...) para que Postgres las evalúe una sola vez.
-- La regla de acceso es exactamente la misma.
drop policy if exists clientes_ver on public.clientes;
create policy clientes_ver on public.clientes for select to authenticated using (
  (empresa = (select app.empresa_actual()) or (select app.puede('femedics', 'ver')))
  and (deleted_at is null or (select app.puede_alguno(array['clientes', 'crm'], 'eliminar')))
  and (
    (select app.puede('clientes', 'ver'))
    or (select app.puede_alguno(array['facturacion', 'bodega', 'logistica', 'servicio_tecnico', 'dashboard'], 'ver'))
    or ((select app.puede_alguno(array['crm', 'femedics'], 'ver'))
        and ((select app.puede_alguno(array['crm', 'femedics'], 'ver_todos')) or app.es_yo_o_subordinado(asesor_id)))
  )
);

drop policy if exists crm_ver on public.cotizaciones;
create policy crm_ver on public.cotizaciones for select to authenticated using (
  (select app.puede_alguno(array['crm', 'femedics'], 'ver'))
  and (empresa = (select app.empresa_actual()) or (select app.puede('femedics', 'ver')))
  and ((select app.puede_alguno(array['crm', 'femedics'], 'ver_todos')) or app.es_yo_o_subordinado(asesor_id))
  and (deleted_at is null or (select app.puede_alguno(array['crm', 'femedics'], 'eliminar')))
);

drop policy if exists crm_ver on public.leads;
create policy crm_ver on public.leads for select to authenticated using (
  (select app.puede_alguno(array['crm', 'femedics'], 'ver'))
  and (empresa = (select app.empresa_actual()) or (select app.puede('femedics', 'ver')))
  and ((select app.puede_alguno(array['crm', 'femedics'], 'ver_todos')) or app.es_yo_o_subordinado(asesor_id))
  and (deleted_at is null or (select app.puede_alguno(array['crm', 'femedics'], 'eliminar')))
);
