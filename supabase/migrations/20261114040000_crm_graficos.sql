-- Gráficos del CRM (getExtendedDashboardStats) — Issue #35
-- Clientes nuevos por mes y equipos más cotizados / vendidos, calculados en la base.
-- security invoker: cada persona ve solo lo que su alcance del CRM le permite (como soloPropio del original).

create or replace function public.crm_graficos(p_empresa text) returns jsonb
language sql stable security invoker set search_path = public as $$
  with meses as (
    select to_char(date_trunc('month', (now() at time zone 'America/Guayaquil')) - make_interval(months => g), 'YYYY-MM') as mes
      from generate_series(5, 0, -1) g
  ),
  cli as (
    select to_char(coalesce(c.fecha_registro, c.created_at) at time zone 'America/Guayaquil', 'YYYY-MM') as mes, count(*) n
      from public.clientes c
     where c.deleted_at is null and c.empresa = p_empresa
       and coalesce(c.fecha_registro, c.created_at) >= date_trunc('month', now()) - interval '6 months'
     group by 1
  ),
  items as (
    select coalesce(nullif(btrim(it ->> 'nombre'), ''), 'Desconocido') as nombre,
           greatest(coalesce(nullif(it ->> 'cantidad', '')::numeric, 1), 0) as cant,
           q.estado_crm = 'Ganado' as ganado
      from public.cotizaciones q, jsonb_array_elements(case when jsonb_typeof(q.items) = 'array' then q.items else '[]'::jsonb end) it
     where q.deleted_at is null and q.empresa = p_empresa and q.tipo_registro <> 'Histórico'
  )
  select jsonb_build_object(
    'clientesPorMes', (select jsonb_agg(jsonb_build_object('mes', m.mes, 'n', coalesce(cli.n, 0)) order by m.mes) from meses m left join cli on cli.mes = m.mes),
    'topCotizados', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'n', n) order by n desc), '[]'::jsonb)
                       from (select nombre, sum(cant) n from items group by nombre order by 2 desc limit 7) t),
    'topVendidos', (select coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'n', n) order by n desc), '[]'::jsonb)
                      from (select nombre, sum(cant) n from items where ganado group by nombre order by 2 desc limit 7) t));
$$;
revoke all on function public.crm_graficos(text) from public, anon;
grant execute on function public.crm_graficos(text) to authenticated;
notify pgrst, 'reload schema';
