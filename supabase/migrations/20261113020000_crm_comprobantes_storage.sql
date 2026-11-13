-- =====================================================================
-- Comprobante de transferencia (foto) al registrar una venta pagada —
-- migra subirComprobantePago_() de Leads.gs. Mismo patrón de bucket
-- privado + RLS por módulo que ya usa Bodega para evidencias.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm', 'crm', false, 10485760)
on conflict (id) do nothing;

drop policy if exists crm_storage_ver on storage.objects;
create policy crm_storage_ver on storage.objects for select to authenticated
  using (bucket_id = 'crm' and app.puede_alguno(array['crm', 'femedics'], 'ver'));

drop policy if exists crm_storage_subir on storage.objects;
create policy crm_storage_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'crm' and (app.puede_alguno(array['crm', 'femedics'], 'crear') or app.puede_alguno(array['crm', 'femedics'], 'editar')));

drop policy if exists crm_storage_borrar on storage.objects;
create policy crm_storage_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'crm' and app.puede_alguno(array['crm', 'femedics'], 'editar'));
