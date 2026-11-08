-- Los triggers (updated_at, creado_por, borrado lógico) llaman funciones del esquema app al insertar/actualizar.
-- Sin USAGE el INSERT falla con 'permission denied for schema app'. Cada función sigue con sus propios permisos.
grant usage on schema app to authenticated;
