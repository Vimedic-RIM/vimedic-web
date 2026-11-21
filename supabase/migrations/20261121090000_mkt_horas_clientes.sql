-- =====================================================================
-- Marketing › Planificador › «Mejores horas» (como Metricool): ¿a qué hora escriben los clientes?
--   mkt_horas_clientes(p_dias): cuántos leads llegaron por día de la semana (0 = lunes) y hora de Ecuador, por red
--   (facebook, instagram, whatsapp, otros), en los últimos p_dias. Solo totales: ningún dato personal.
--   La Edge Function marketing-integraciones lo combina con las «mejores horas» de Zernio (interacción real de las
--   publicaciones) y la IA explica la recomendación.
-- =====================================================================

create or replace function public.mkt_horas_clientes(p_dias integer default 180)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app
as $$
begin
  if not app.puede('marketing', 'ver') then raise exception 'Sin acceso a Marketing.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('red', red, 'dia', dia, 'hora', hora, 'n', n) order by red, dia, hora)
      from (
        select case
                 when lower(coalesce(l.canal, '')) like '%instagram%' then 'instagram'
                 when lower(coalesce(l.canal, '')) like '%facebook%' then 'facebook'
                 when lower(coalesce(l.canal, '')) like '%whatsapp%' or l.origen_tipo = 'whatsapp' then 'whatsapp'
                 else 'otros'
               end as red,
               (extract(isodow from l.fecha at time zone 'America/Guayaquil')::int - 1) as dia,
               extract(hour from l.fecha at time zone 'America/Guayaquil')::int as hora,
               count(*)::int as n
          from public.leads l
         where l.deleted_at is null and l.fecha is not null
           and l.fecha > now() - make_interval(days => greatest(7, least(coalesce(p_dias, 180), 730)))
         group by 1, 2, 3
      ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.mkt_horas_clientes(integer) from public, anon;
grant execute on function public.mkt_horas_clientes(integer) to authenticated;

notify pgrst, 'reload schema';
