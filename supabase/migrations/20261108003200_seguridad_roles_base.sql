-- Roles del sistema que existían en la hoja "Roles" de la app original y aún no están en la base nueva.
insert into public.roles (nombre, descripcion, rol_crm, alcance, es_superadmin, es_sistema, permisos)
select v.nombre, v.descripcion, null, 'organizacion', false, true, v.permisos::jsonb
from (values
  ('Administrador del sistema', 'Usuarios, permisos, seguridad y bases de datos. Sin operación comercial.',
   '{"empleados":["ver","crear","editar","eliminar","exportar","administrar"],"seguridad":["ver","crear","editar","eliminar","exportar","administrar"]}'),
  ('Auditor', 'Solo lectura de la bitácora, roles y tablas; puede exportar para revisión.',
   '{"seguridad":["ver","exportar"]}'),
  ('Usuario de consulta', 'Solo consulta catálogos e inventario.',
   '{"inventario":["ver"],"catalogos":["ver"]}')
) as v(nombre, descripcion, permisos)
where not exists (select 1 from public.roles r where lower(r.nombre) = lower(v.nombre) and r.deleted_at is null);
