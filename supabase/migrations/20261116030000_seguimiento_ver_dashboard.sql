-- Seguimiento de pedidos — Issue #38, fase 4
-- Quien ve el Dashboard Ejecutivo puede abrir los pedidos desde el mapa de proceso (verlos y anotarles, igual que el asesor).
-- Ya ve todas las ventas en el Dashboard; editar tiempos o cancelar sigue siendo del permiso "tracking".
create or replace function app.trk_ve(p_asesor uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.puede('tracking', 'ver') or app.puede('dashboard', 'ver') or app.puede_alguno(array['crm', 'femedics'], 'ver_todos')
      or (p_asesor is not null and app.es_yo_o_subordinado(p_asesor));
$$;
