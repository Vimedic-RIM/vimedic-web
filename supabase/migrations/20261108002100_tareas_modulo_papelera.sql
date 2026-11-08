-- Quien puede "eliminar" en el módulo también ve los registros eliminados (Papelera para restaurar).
drop policy if exists tareas_modulo_ver on public.tareas_modulo;
create policy tareas_modulo_ver on public.tareas_modulo for select to authenticated
  using (app.puede(modulo, 'ver') and (deleted_at is null or app.puede(modulo, 'eliminar')));
