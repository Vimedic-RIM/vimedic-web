-- Galería del producto (producto_galeria): quitar una foto o un video es parte de editar la multimedia.
-- El control general de borrado lógico (app.tg_controlar_borrado_logico) pide "eliminar" en inventario o marketing, y el rol
-- Marketing (y quien tiene la bandera "Editar Multimedia") solo tiene editar: las fotos no se podían quitar ni en
-- Marketing › ficha del producto ni en Inventario › Editar multimedia («No tienes permiso para eliminar o restaurar este registro»).
-- Aquí se permite quitar a quien puede editar la multimedia (app.puede_multimedia, la misma regla de inv_galeria_guardar).
-- Restaurar una foto ya quitada sigue pidiendo "eliminar". Es borrado lógico: la fila queda con deleted_at.

create or replace function app.tg_borrado_galeria()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null
     and not app.puede_alguno(array['inventario', 'marketing'], 'eliminar')
     and not (old.deleted_at is null and new.deleted_at is not null and app.puede_multimedia()) then
    raise exception 'No tienes permiso para eliminar o restaurar este registro';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_borrado_logico on public.producto_galeria;
create trigger tg_borrado_logico before update of deleted_at on public.producto_galeria
  for each row execute function app.tg_borrado_galeria();

-- Marketing › ficha del producto quita la foto con esta función: la tabla oculta las filas borradas a quien no tiene "eliminar"
-- y la actualización directa no puede devolver la fila ya borrada.
create or replace function public.galeria_quitar(p_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_id uuid;
begin
  if not app.puede_multimedia() then raise exception 'No tienes permiso para editar la galería.'; end if;
  update public.producto_galeria set deleted_at = now() where id = p_id and deleted_at is null returning id into v_id;
  if v_id is null then raise exception 'Esa foto ya no está en la galería.'; end if;
end;
$$;

revoke all on function public.galeria_quitar(uuid) from public, anon;
grant execute on function public.galeria_quitar(uuid) to authenticated;
notify pgrst, 'reload schema';
