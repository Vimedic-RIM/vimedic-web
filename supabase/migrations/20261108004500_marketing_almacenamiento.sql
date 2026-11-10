-- Almacenamiento de material audiovisual en Supabase Storage (fotos y videos de Marketing).
-- Bucket público para lectura (las piezas se publican en redes y catálogos); solo Marketing escribe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audiovisual', 'audiovisual', true, 52428800,
        array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = true, file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'];

drop policy if exists audiovisual_subir on storage.objects;
create policy audiovisual_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'audiovisual' and app.puede('marketing', 'crear'));
drop policy if exists audiovisual_editar on storage.objects;
create policy audiovisual_editar on storage.objects for update to authenticated
  using (bucket_id = 'audiovisual' and app.puede('marketing', 'editar'));
drop policy if exists audiovisual_borrar on storage.objects;
create policy audiovisual_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'audiovisual' and app.puede('marketing', 'eliminar'));
