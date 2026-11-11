-- =====================================================================
-- "Generar guía de envío" (Facturación) sube el PDF de la guía al mismo
-- bucket privado "despachos" que ya usa Bodega para sus evidencias, pero
-- solo dentro de la carpeta guias/ — Facturación no gana acceso a nada
-- más del bucket (fotos de bodega, etc. siguen siendo solo de bodega).
-- =====================================================================
drop policy if exists despachos_storage_subir on storage.objects;
create policy despachos_storage_subir on storage.objects for insert to authenticated
  with check (
    bucket_id = 'despachos' and (
      app.puede('bodega', 'editar')
      or ((storage.foldername(name))[1] = 'guias' and app.puede('facturacion', 'editar'))
    )
  );

-- Hace falta además para poder regenerar ("Editar guía") sobre el mismo archivo (upsert).
drop policy if exists despachos_storage_actualizar on storage.objects;
create policy despachos_storage_actualizar on storage.objects for update to authenticated
  using (
    bucket_id = 'despachos' and (
      app.puede('bodega', 'editar')
      or ((storage.foldername(name))[1] = 'guias' and app.puede('facturacion', 'editar'))
    )
  );
