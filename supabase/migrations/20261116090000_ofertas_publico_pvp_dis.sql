-- =====================================================================
-- Ofertas por tipo de cliente: PVP, DIS (distribuidores) o ambos.
-- Cada oferta (y cada campaña) dice a quién se da: 'PVP', 'DIS' o 'AMBOS' (por defecto 'AMBOS': así quedan las que ya existían).
-- El CRM (cotización y venta) la pone SOLA según el tipo del cliente: a un cliente PVP solo le llegan las de PVP o ambos; a un DIS, las de
-- DIS o ambos (y se queda con lo mejor entre su precio DIS y la oferta). Un producto puede tener una oferta para PVP y otra distinta para
-- DIS al mismo tiempo, cada una con su porcentaje.
-- =====================================================================
alter table public.ofertas add column if not exists aplica_a text not null default 'AMBOS' check (aplica_a in ('PVP', 'DIS', 'AMBOS'));
alter table public.promo_campanas add column if not exists aplica_a text not null default 'AMBOS' check (aplica_a in ('PVP', 'DIS', 'AMBOS'));

-- Las ofertas que nacen de aprobar una campaña heredan su "aplica a" (las funciones de aprobación no se tocan).
create or replace function app.tg_ofertas_publico_campana() returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if new.campana_id is not null and new.aplica_a = 'AMBOS' then
    select c.aplica_a into v from public.promo_campanas c where c.id = new.campana_id;
    if v is not null then new.aplica_a := v; end if;
  end if;
  return new;
end $$;
drop trigger if exists tg_ofertas_publico_campana on public.ofertas;
create trigger tg_ofertas_publico_campana before insert on public.ofertas for each row execute function app.tg_ofertas_publico_campana();

-- Cambiar a quién se da una campaña completa (la campaña y todas sus ofertas), con rastro en el historial de cada oferta.
create or replace function public.ofertas_aplicar_publico(p_campana_id uuid, p_aplica_a text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; v_nombre text;
begin
  if not (app.es_superadmin() or app.puede_alguno(array['ofertas', 'promociones', 'marketing'], 'editar')) then
    raise exception 'Sin permiso para cambiar las ofertas.';
  end if;
  if p_aplica_a not in ('PVP', 'DIS', 'AMBOS') then raise exception 'Elige PVP, DIS o ambos.'; end if;
  select nombre into v_nombre from public.empleados where id = app.empleado_id();
  update public.promo_campanas set aplica_a = p_aplica_a where id = p_campana_id and deleted_at is null;
  if not found then raise exception 'La campaña no existe.'; end if;
  update public.ofertas
     set aplica_a = p_aplica_a, actualizado_por = app.empleado_id(),
         historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('f', now(), 'por', coalesce(v_nombre, ''),
           'n', 'Se da a: ' || case p_aplica_a when 'PVP' then 'clientes PVP' when 'DIS' then 'clientes DIS' else 'clientes PVP y DIS' end))
   where campana_id = p_campana_id and deleted_at is null and aplica_a is distinct from p_aplica_a;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ofertas_aplicar_publico(uuid, text) from public, anon;
grant execute on function public.ofertas_aplicar_publico(uuid, text) to authenticated;

-- inv_ofertas_vigentes: la oferta que gana se elige por tipo de cliente (PVP y DIS por separado). Cada oferta sale con
--   aplicaA  = a quién la configuraron ('PVP', 'DIS' o 'AMBOS')
--   ganaPara = para qué tipos de cliente es la que se aplica (['PVP'], ['DIS'] o ambos).
-- Un producto sale una vez si la misma oferta gana para los dos, y dos veces si tiene una oferta distinta para cada tipo.
-- Todo lo demás (desempate, apagada, quedan, sin costo ni margen) queda igual que en 20261116050000.
create or replace function public.inv_ofertas_vigentes(p_proximas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  hoy date := (now() at time zone 'America/Guayaquil')::date;
  r jsonb;
begin
  if not (app.es_superadmin() or app.puede_alguno(array['inventario', 'ofertas', 'crm', 'femedics'], 'ver')) then
    raise exception 'Sin permiso para ver las ofertas.';
  end if;

  with cand as (
    select o.id, o.producto_id, o.inicio, o.descuento_pct, o.created_at, s.slot
    from public.ofertas o
    cross join (values ('PVP'), ('DIS')) s(slot)
    where o.deleted_at is null and o.producto_id is not null
      and coalesce(o.estado, '') not in ('Cancelada', 'Pausada', 'Finalizada')
      and coalesce(o.precio_oferta, 0) > 0
      and (o.fin is null or o.fin >= hoy)
      and (o.inicio is null or o.inicio <= hoy or p_proximas)
      and (o.aplica_a = 'AMBOS' or o.aplica_a = s.slot)
  ),
  ganadora as (
    select distinct on (c.producto_id, c.slot) c.id, c.slot
    from cand c
    order by c.producto_id, c.slot,
             (c.inicio is null or c.inicio <= hoy) desc,
             case when c.inicio > hoy then c.inicio end nulls first,
             coalesce(c.descuento_pct, 0) desc,
             c.created_at desc
  ),
  una as (
    select o.*, array_agg(g.slot order by g.slot) as gana_para
    from ganadora g join public.ofertas o on o.id = g.id
    group by o.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'ofertaId', u.id, 'codigoOferta', u.codigo, 'productoId', p.id, 'codigo', p.codigo, 'nombre', p.nombre,
      'marca', coalesce(p.marca, ''), 'categoriaId', p.categoria_id, 'categoria', coalesce(c.nombre, 'Sin categoría'), 'catOrden', c.orden,
      'img', coalesce(p.imagen_url, ''), 'publico', p.en_vista_publica, 'stock', coalesce(p.stock, 0),
      'pvp', coalesce(nullif(u.pvp_base, 0), p.pvp, 0), 'precio', u.precio_oferta, 'descuento', coalesce(u.descuento_pct, 0),
      'iva', p.aplica_iva is not false, 'tipo', coalesce(u.tipo, ''),
      'inicio', to_char(u.inicio, 'YYYY-MM-DD'), 'fin', to_char(u.fin, 'YYYY-MM-DD'),
      'proxima', u.inicio is not null and u.inicio > hoy,
      'texto', coalesce(u.texto_cliente, ''), 'regalo', coalesce(u.regalo, ''), 'combo', coalesce(u.combo_con, ''),
      'campana', coalesce(pc.nombre, ''),
      'limite', coalesce(u.unidades_limite, 0), 'quedan', q.quedan, 'deCampana', u.campana_id is not null,
      'apagada', coalesce(q.quedan = 0 and (coalesce(u.unidades_limite, 0) > 0 or u.campana_id is not null), false),
      'aplicaA', u.aplica_a, 'ganaPara', to_jsonb(u.gana_para))
    order by p.en_vista_publica desc, c.orden nulls last, c.nombre, p.orden nulls last, p.nombre, u.gana_para), '[]'::jsonb)
  into r
  from una u
  join public.productos p on p.id = u.producto_id and p.deleted_at is null
    and lower(coalesce(p.estado, '')) <> 'inactivo'
  left join public.categorias c on c.id = p.categoria_id
  left join public.promo_campanas pc on pc.id = u.campana_id
  cross join lateral (
    select case
      when p.stock is null then null
      when not (coalesce(u.unidades_limite, 0) > 0) then greatest(0, p.stock)
      else greatest(0, least(greatest(0, p.stock),
             u.unidades_limite - case when coalesce(u.stock_inicial, 0) > 0 then greatest(0, u.stock_inicial - greatest(0, p.stock)) else 0 end))
    end as quedan
  ) q;

  return r;
end $$;

revoke all on function public.inv_ofertas_vigentes(boolean) from public, anon;
grant execute on function public.inv_ofertas_vigentes(boolean) to authenticated;
notify pgrst, 'reload schema';
