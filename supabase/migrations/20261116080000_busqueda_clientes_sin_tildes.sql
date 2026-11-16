-- Búsqueda de clientes sin tildes ni mayúsculas, en todos los buscadores.
-- Antes: "jose" no encontraba a "José" ni "munoz" a "Muñoz" (ilike distingue tildes). Ahora cada cliente guarda un texto de búsqueda
-- ya normalizado (sin tildes, en minúsculas) con nombre, cédula/RUC, institución, correo, teléfonos, ciudad, contacto y código,
-- y los buscadores comparan contra ese texto con el índice trigram.
-- Es una columna GENERADA: se mantiene sola al crear o editar un cliente (no se escribe a mano).

create or replace function public.sin_tildes(p text) returns text
language sql immutable parallel safe as $$
  select lower(translate(coalesce(p, ''),
    'áàäâãåÁÀÄÂÃÅéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ',
    'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC'));
$$;
grant execute on function public.sin_tildes(text) to anon, authenticated;

alter table public.clientes add column if not exists busqueda text
  generated always as (public.sin_tildes(
    coalesce(nombre, '') || ' ' || coalesce(identificacion, '') || ' ' || coalesce(institucion, '') || ' ' || coalesce(email, '') || ' ' ||
    coalesce(telefono, '') || ' ' || coalesce(telefono2, '') || ' ' || coalesce(ciudad, '') || ' ' || coalesce(persona_contacto, '') || ' ' ||
    coalesce(codigo, ''))) stored;
create index if not exists clientes_busqueda_trgm on public.clientes using gin (busqueda gin_trgm_ops);

-- La lista del módulo Clientes también debe poder buscar con el texto normalizado (misma consulta de siempre + la columna al final).
create or replace view public.v_clientes_lista with (security_invoker = true) as
 SELECT c.id, c.empresa, c.identificacion, c.nombre, c.institucion, c.ciudad, c.telefono, c.email, c.asesor_id, d.nombre AS asesor,
    COALESCE(c.fecha_registro, c.created_at) AS registro, r.total_cotizaciones, r.total_ventas, r.monto_ventas, r.ultima_cotizacion, r.ultima_venta,
    GREATEST(r.ultima_venta::timestamp with time zone, r.ultima_cotizacion) AS ultima_actividad,
    c.busqueda
   FROM clientes c
   LEFT JOIN v_clientes_resumen r ON r.id = c.id
   LEFT JOIN v_directorio_empleados d ON d.id = c.asesor_id
  WHERE c.deleted_at IS NULL;
