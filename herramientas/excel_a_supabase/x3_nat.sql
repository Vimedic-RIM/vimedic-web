select json_build_object(
 'gal', (select json_agg(json_build_object('c', p.codigo, 'u', g.archivo_url, 'b', g.deleted_at is not null)) from producto_galeria g join productos p on p.id = g.producto_id),
 'fic', (select json_agg(json_build_object('c', p.codigo, 'u', f.url, 'v', f.version)) from fichas_tecnicas f join productos p on p.id = f.producto_id),
 'bit', (select json_agg(to_jsonb(b)) from bitacora b),
 'cat', (select json_agg(to_jsonb(c)) from catalogo_actividad c),
 'asi', (select json_agg(to_jsonb(a)) from asignacion_conversaciones a)
) j;
