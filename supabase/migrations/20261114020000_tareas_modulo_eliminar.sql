-- Tablero de Talento Humano / Financiero / Bodega (ModulosBase.gs) — Issue #33
-- En el original, eliminar un registro y restaurarlo desde la Papelera exige el permiso "eliminar"
-- del módulo (vmAccExigir_(modulo, 'eliminar')). Aquí bastaba con poder editar o ser el responsable.
-- Además, un registro no puede pasar de un módulo a otro.

create or replace function app.tg_tareas_modulo_eliminar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.modulo is distinct from old.modulo then
    raise exception 'Un registro no puede cambiar de módulo.';
  end if;
  if new.deleted_at is distinct from old.deleted_at and not app.puede(old.modulo, 'eliminar')
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
    raise exception 'No tienes permiso para eliminar o restaurar registros de este módulo.';
  end if;
  return new;
end;
$$;
revoke all on function app.tg_tareas_modulo_eliminar() from public, anon, authenticated;

drop trigger if exists tareas_modulo_eliminar on public.tareas_modulo;
create trigger tareas_modulo_eliminar before update on public.tareas_modulo
  for each row execute function app.tg_tareas_modulo_eliminar();
