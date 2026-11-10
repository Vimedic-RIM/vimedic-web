-- =====================================================================
-- Autoservicio de perfil: cada empleado puede completar sus propios datos
-- de contacto (teléfono, correo personal, cédula, cumpleaños, foto) y su
-- contraseña, sin necesitar el permiso "empleados editar".
--
-- La contraseña la cambia Supabase Auth directamente (auth.updateUser),
-- no pasa por esta tabla. Aquí solo se habilita la edición de la FICHA.
--
-- También se afina la verificación en dos pasos (MFA) para empleados:
-- en vez de exigirla en CUALQUIER actualización de la tabla (lo que
-- frenaría a cualquiera corrigiendo su propio teléfono), se exige
-- específicamente cuando cambian rol, permisos o superadmin — que es
-- el trigger que ya protegía esos campos.
-- =====================================================================

-- Un empleado puede actualizar su propia fila (el trigger de abajo limita qué columnas).
drop policy if exists empleados_auto_servicio on public.empleados;
create policy empleados_auto_servicio on public.empleados for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- Quien edita su propia ficha sin el permiso "empleados/talento_humano/seguridad editar"
-- solo puede tocar sus datos de contacto; todo lo demás (cargo, departamento, estado,
-- jefe, horarios, asignación de leads…) sigue necesitando ese permiso.
create or replace function app.tg_empleados_auto_servicio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or app.puede_alguno(array['empleados', 'talento_humano', 'seguridad'], 'editar') then
    return new;
  end if;
  if new.auth_user_id is distinct from auth.uid() or old.auth_user_id is distinct from auth.uid() then
    raise exception 'No tienes permiso para editar este empleado';
  end if;
  if new.codigo is distinct from old.codigo or new.email is distinct from old.email or new.nombre is distinct from old.nombre
     or new.empresa is distinct from old.empresa or new.local is distinct from old.local
     or new.departamento is distinct from old.departamento or new.cargo is distinct from old.cargo
     or new.jefe_id is distinct from old.jefe_id or new.rol_id is distinct from old.rol_id
     or new.permisos_extra is distinct from old.permisos_extra or new.es_superadmin is distinct from old.es_superadmin
     or new.recibe_leads is distinct from old.recibe_leads or new.recibe_leads_mensajes is distinct from old.recibe_leads_mensajes
     or new.recibe_clientes_meta is distinct from old.recibe_clientes_meta or new.orden_asignacion is distinct from old.orden_asignacion
     or new.estado is distinct from old.estado or new.estado_laboral is distinct from old.estado_laboral
     or new.fecha_ingreso is distinct from old.fecha_ingreso or new.jornada_laboral is distinct from old.jornada_laboral
     or new.hora_entrada is distinct from old.hora_entrada or new.hora_salida is distinct from old.hora_salida
     or new.saldo_inicial_vacaciones is distinct from old.saldo_inicial_vacaciones or new.fecha_corte_vacaciones is distinct from old.fecha_corte_vacaciones
     or new.preferencias is distinct from old.preferencias then
    raise exception 'Solo puedes actualizar tus datos de contacto (teléfono, correo personal, cédula, cumpleaños, foto). Para otros cambios, pide ayuda en Empleados.';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_empleados_auto_servicio on public.empleados;
create trigger tg_empleados_auto_servicio
before update on public.empleados
for each row execute function app.tg_empleados_auto_servicio();

-- Verificación en dos pasos exigida (si ya se inscribió) específicamente al cambiar
-- rol, permisos, superadmin o el vínculo con la cuenta de Auth — sin importar de quién
-- sea la fila. Reemplaza la política RESTRICTIVE genérica que frenaba cualquier edición.
create or replace function app.tg_proteger_permisos_empleado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.rol_id is distinct from old.rol_id
      or new.permisos_extra is distinct from old.permisos_extra
      or new.es_superadmin is distinct from old.es_superadmin
      or new.auth_user_id is distinct from old.auth_user_id)
     and auth.uid() is not null then
    if not app.puede('seguridad', 'administrar') then
      raise exception 'No tienes permiso para cambiar roles o permisos de empleados';
    end if;
    if not app.exigir_mfa() then
      raise exception 'Este cambio (rol, permisos o superadmin) exige completar la verificación en dos pasos.';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists rls_mfa_update on public.empleados;

-- Foto de perfil: cada quien sube/reemplaza SOLO su propio archivo (nombre = su auth_user_id).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists avatares_subir on storage.objects;
create policy avatares_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and name like auth.uid()::text || '-%');
drop policy if exists avatares_reemplazar on storage.objects;
create policy avatares_reemplazar on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and name like auth.uid()::text || '-%');
drop policy if exists avatares_borrar on storage.objects;
create policy avatares_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and name like auth.uid()::text || '-%');
