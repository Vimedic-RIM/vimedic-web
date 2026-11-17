-- =====================================================================
-- Facturación genera el acta de entrega y la etiqueta de envío en HTML (se ven e imprimen en un visor dentro de la
-- app, como la proforma) y guarda ese HTML en el bucket privado «despachos». Las guías ya iban a la carpeta guias/;
-- ahora también puede escribir en actas/. Facturación sigue sin acceso al resto del bucket (fotos de Bodega, etc.).
-- =====================================================================
drop policy if exists despachos_storage_subir on storage.objects;
create policy despachos_storage_subir on storage.objects for insert to authenticated
  with check (
    bucket_id = 'despachos' and (
      app.puede('bodega', 'editar')
      or ((storage.foldername(name))[1] in ('guias', 'actas') and app.puede('facturacion', 'editar'))
    )
  );

-- Para volver a generar («Editar acta» / «Editar guía») sobre el mismo archivo.
drop policy if exists despachos_storage_actualizar on storage.objects;
create policy despachos_storage_actualizar on storage.objects for update to authenticated
  using (
    bucket_id = 'despachos' and (
      app.puede('bodega', 'editar')
      or ((storage.foldername(name))[1] in ('guias', 'actas') and app.puede('facturacion', 'editar'))
    )
  );
