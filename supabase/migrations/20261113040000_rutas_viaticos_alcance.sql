-- =====================================================================
-- Rutas y viáticos (Rutas_viaticos.gs) ahora tienen pantalla en el CRM.
-- Faltaba el mismo alcance "por asesor" que ya tienen leads/cotizaciones/
-- clientes: sin esto, cualquiera con el permiso del módulo vería las rutas
-- y viáticos de TODOS los asesores. No se usó el mismo bloque genérico de
-- leads/cotizaciones porque ese exige una columna "empresa" que estas dos
-- tablas no tienen.
-- =====================================================================
drop policy if exists rls_ver on public.rutas;
create policy rls_ver on public.rutas for select to authenticated using (
  app.puede('crm', 'ver')
  and (deleted_at is null or app.puede('crm', 'eliminar'))
  and (app.puede('crm', 'ver_todos') or app.es_yo_o_subordinado(asesor_id))
);
drop policy if exists rls_editar on public.rutas;
create policy rls_editar on public.rutas for update to authenticated
  using (app.puede('crm', 'editar') and (app.puede('crm', 'ver_todos') or app.es_yo_o_subordinado(asesor_id)))
  with check (app.puede('crm', 'editar'));

-- Viáticos: financiero (quien aprueba) siempre ve y puede resolver todas; crm solo ve/edita las propias (o de su equipo) salvo ver_todos.
drop policy if exists rls_ver on public.viaticos;
create policy rls_ver on public.viaticos for select to authenticated using (
  (deleted_at is null or app.puede_alguno(array['crm', 'financiero'], 'eliminar'))
  and (
    app.puede('financiero', 'ver')
    or (app.puede('crm', 'ver') and (app.puede('crm', 'ver_todos') or app.es_yo_o_subordinado(asesor_id)))
  )
);
drop policy if exists rls_editar on public.viaticos;
create policy rls_editar on public.viaticos for update to authenticated
  using (
    app.puede('financiero', 'editar')
    or (app.puede('crm', 'editar') and (app.puede('crm', 'ver_todos') or app.es_yo_o_subordinado(asesor_id)))
  )
  with check (app.puede_alguno(array['crm', 'financiero'], 'editar'));
