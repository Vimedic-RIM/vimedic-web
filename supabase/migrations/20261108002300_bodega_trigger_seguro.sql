-- Facturar nunca debe fallar por Bodega: si la orden no se puede crear, se registra un aviso y se sigue.
-- (Bodega la puede traer luego con "Traer facturas".)
create or replace function app.tg_factura_a_bodega()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'Facturado' and (tg_op = 'INSERT' or old.estado is distinct from 'Facturado') then
    begin
      perform public.bodega_crear_despacho(new.id);
    exception when others then
      raise warning 'Bodega: no se creó el despacho de la factura %: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;
