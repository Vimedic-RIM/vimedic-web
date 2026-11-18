import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChartConfiguration } from 'chart.js'
import { Award, CalendarDays, ChevronLeft, ChevronRight, Clock, Crosshair, Flame, Lightbulb, Rocket, Target, TrendingDown, TrendingUp, Trophy, Users, X, Zap, type LucideIcon } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { Grafico, money0, canal, CANAL_COLOR, PALETA, monthLabel, usdTick } from '../graficos'
import '../estilos/ventas.css'

/* Ventas y metas: cada asesor ve sus ventas, se pone su meta del mes y recibe gráficos y recomendaciones para llegar.
   Coordinación y dirección ven el equipo completo y fijan las metas (ven_panel / ven_meta_guardar en la base). */
type Meta = { monto: number; ventas: number | null; proformas: number | null; gestiones: number | null; minimo: number | null; nota: string | null; con_meta: number; fijada_por: string | null }
type Kpi = { monto: number; n: number; facturado: number; por_facturar: number; proformas: number; proformas_monto: number; gestiones: number; leads: number; prev_monto: number; prev_n: number; prev_al_dia: number }
type Op = { id: string; codigo: string; cliente: string; total: number; estado: string; dias: number; seguimiento: string | null; asesor: string }
type Miembro = { id: string; nombre: string; foto_url: string | null; empresa: string; meta: number | null; minimo: number | null; monto: number; n: number; prev: number; proformas: number; gestiones: number; cierre: number | null; pipeline: number }
type Panel = {
  yo: { id: string | null; general: boolean; todos: boolean }; general: boolean; asesor: { id: string; nombre: string; foto_url: string | null } | null
  equipo_lista: { id: string; nombre: string; empresa: string }[]; mes: string; hoy: string; meta: Meta; kpi: Kpi
  diario: { d: string; monto: number; n: number }[]; meses: { m: string; monto: number; n: number; proformas: number; meta: number | null }[]
  canales: { medio: string; monto: number; n: number }[]; categorias: { categoria: string; monto: number }[]; productos: { nombre: string; codigo: string; unidades: number; monto: number }[]
  calor: { dw: number; h: number; n: number }[]; dias_venta: { dw: number; monto: number; n: number }[]
  embudo: { leads: number; gestiones: number; proformas: number; ventas: number }; equipo_cierre: number | null; ciclo: number | null
  pipeline: { monto: number; n: number; frias: number; top: Op[] }; equipo?: Miembro[]; puesto?: { puesto: number; de: number }
}
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DIAS_C = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const usd = (n: number) => '$' + money0(n)
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const sinEmoji = (t: string) => t.replace(/^[^\p{L}\p{N}]+/u, '').trim() || t
const mesTexto = (m: string) => { const t = new Date(m + 'T12:00:00Z').toLocaleDateString('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' }); return t.charAt(0).toUpperCase() + t.slice(1) }
const sumarMes = (m: string, k: number) => { const d = new Date(m + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k, 1); return d.toISOString().slice(0, 10) }
/** Días hábiles (lunes a viernes) del mes y cuántos ya pasaron hasta hoy. */
function habiles(mes: string, hoy: string) {
  const dias: string[] = []; const d = new Date(mes + 'T12:00:00Z'), m = d.getUTCMonth()
  while (d.getUTCMonth() === m) { const w = d.getUTCDay(); if (w > 0 && w < 6) dias.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  const pasados = dias.filter((x) => x <= hoy).length
  return { dias, total: dias.length, pasados, restantes: dias.length - pasados }
}

export default function VentasMetas({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [mes, setMes] = useState(() => new Date(Date.now() - 5 * 36e5).toISOString().slice(0, 8) + '01')
  const [asesor, setAsesor] = useState('')
  const [d, setD] = useState<Panel | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [editMeta, setEditMeta] = useState<{ id: string; nombre: string; propia: boolean } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.rpc('ven_panel', { p_asesor: asesor || null, p_mes: mes })
    setCargando(false)
    if (error) { setError(error.message); return }
    setError(''); setD(data as Panel)
  }, [asesor, mes])
  useEffect(() => { cargar() }, [cargar])

  const actual = d && d.mes.slice(0, 7) === d.hoy.slice(0, 7)
  const futuro = d && d.mes > d.hoy
  const h = useMemo(() => (d ? habiles(d.mes, d.hoy) : null), [d])
  const meta = d?.meta.monto ?? 0, vendido = d?.kpi.monto ?? 0
  const proy = d && h ? (actual && h.pasados ? (vendido / h.pasados) * h.total : vendido) : 0
  const faltan = Math.max(0, meta - vendido)
  const porDia = h && h.restantes ? faltan / h.restantes : 0
  const cierre = d && d.embudo.proformas ? Math.round((d.embudo.ventas / d.embudo.proformas) * 1000) / 10 : null
  const titulo = d ? (d.general ? 'Equipo comercial' : d.asesor?.id === d.yo.id ? 'Mis ventas' : d.asesor?.nombre ?? '') : ''
  const verMeta = d && !d.general && d.asesor ? { id: d.asesor.id, nombre: d.asesor.nombre, propia: d.asesor.id === d.yo.id } : null

  return (
    <div className="vm-ven">
      <header className="hdr text-white">
        <div className="w-full px-4 lg:px-6 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Target style={{ width: 20, height: 20 }} /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Ventas y metas</h1><p className="text-[11px] text-white/70">{titulo || 'Cargando…'} · {perfil.nombre}</p></div>
          <div className="ml-auto flex gap-2 flex-wrap items-center">
            <div className="vt-mes"><button onClick={() => setMes(sumarMes(mes, -1))} aria-label="Mes anterior"><ChevronLeft /></button><span><CalendarDays />{mesTexto(mes)}</span><button onClick={() => setMes(sumarMes(mes, 1))} aria-label="Mes siguiente"><ChevronRight /></button></div>
            {d?.yo.general && (
              <select className="vt-sel" value={asesor} onChange={(e) => setAsesor(e.target.value)} aria-label="Asesor">
                <option value="">Todo el equipo</option>
                {d.yo.id && <option value={d.yo.id}>Mis ventas</option>}
                {d.equipo_lista.filter((x) => x.id !== d.yo.id).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            )}
            {verMeta && <button className="vt-btn" onClick={() => setEditMeta(verMeta)}><Crosshair />{verMeta.propia ? 'Mi meta' : 'Meta de ' + verMeta.nombre.split(' ')[0]}</button>}
          </div>
        </div>
      </header>

      <main className="w-full px-4 lg:px-6 py-4">
        {error && <div className="vt-card text-red-600 font-semibold text-sm">{error}</div>}
        {!d && !error && <div className="vt-card text-center text-slate-400 py-16"><span className="vt-spin" /> Cargando tus ventas…</div>}
        {d && h && (
          <div className={'vt-cuerpo' + (cargando ? ' cargando' : '')}>
            {/* ---------- Meta del mes ---------- */}
            <section className="vt-hero">
              <div className="vt-card vt-meta">
                <Medidor vendido={vendido} meta={meta} proy={proy} actual={!!actual} />
                <div className="vt-meta-txt">
                  {meta > 0 ? <>
                    <p className="vt-big">{usd(vendido)} <small>de {usd(meta)}</small></p>
                    {actual && <p className={'vt-proy ' + (proy >= meta ? 'ok' : 'baja')}>{proy >= meta ? <Rocket /> : <TrendingDown />}A este ritmo cierras en <b>{usd(proy)}</b> ({pct(proy, meta)}%)</p>}
                    {actual && faltan > 0 && <p className="vt-falta">Te faltan <b>{usd(faltan)}</b> · <b>{usd(porDia)}</b> por día hábil · quedan {h.restantes} días hábiles</p>}
                    {faltan === 0 && <p className="vt-proy ok"><Trophy />¡Meta cumplida! Vas {pct(vendido, meta)}%</p>}
                    {d.general && d.equipo && d.meta.con_meta < d.equipo.length && <p className="vt-nota">Suma de las metas de {d.meta.con_meta} de {d.equipo.length} asesores: fija las que faltan en la tabla del equipo.</p>}
                    {d.meta.fijada_por && <p className="vt-nota">Meta fijada por {d.meta.fijada_por}{d.meta.minimo && !d.general ? ' (mínimo ' + usd(d.meta.minimo) + ')' : ''}</p>}
                  </> : <>
                    <p className="vt-big">{usd(vendido)} <small>vendido en {mesTexto(d.mes).split(' ')[0]}</small></p>
                    <p className="vt-falta">{d.general ? 'Ningún asesor tiene meta este mes: fíjalas en la tabla del equipo.' : 'Aún no tienes meta para este mes.'}</p>
                    {verMeta && !futuro && <button className="vt-btn prim" onClick={() => setEditMeta(verMeta)}><Crosshair />Ponerme una meta</button>}
                  </>}
                  {d.puesto && d.puesto.de > 0 && <p className="vt-puesto"><Award />Puesto <b>#{d.puesto.puesto}</b> de {d.puesto.de} asesores este mes</p>}
                </div>
              </div>
              <div className="vt-kpis">
                <Kpi ic={TrendingUp} t="Ventas del mes" v={usd(vendido)} s={actual ? deltaTxt(vendido, d.kpi.prev_al_dia, 'vs mismo día del mes pasado') : 'Mes anterior ' + usd(d.kpi.prev_monto)} c="#04896f" />
                <Kpi ic={Zap} t="Nº de ventas" v={String(d.kpi.n)} s={d.meta.ventas ? `meta ${d.meta.ventas} · ${pct(d.kpi.n, d.meta.ventas)}%` : 'facturas ganadas'} c="#055c9d" barra={d.meta.ventas ? pct(d.kpi.n, d.meta.ventas) : undefined} />
                <Kpi ic={Target} t="Proformas" v={String(d.kpi.proformas)} s={d.meta.proformas ? `meta ${d.meta.proformas} · ${pct(d.kpi.proformas, d.meta.proformas)}%` : usd(d.kpi.proformas_monto) + ' cotizado'} c="#17a9ba" barra={d.meta.proformas ? pct(d.kpi.proformas, d.meta.proformas) : undefined} />
                <Kpi ic={Users} t="Gestiones" v={String(d.kpi.gestiones)} s={d.meta.gestiones ? `meta ${d.meta.gestiones} · ${pct(d.kpi.gestiones, d.meta.gestiones)}%` : d.kpi.leads + ' leads asignados'} c="#7c3aed" barra={d.meta.gestiones ? pct(d.kpi.gestiones, d.meta.gestiones) : undefined} />
                <Kpi ic={Crosshair} t="Cierre (90 días)" v={cierre != null ? cierre + '%' : '—'} s={d.equipo_cierre != null ? 'equipo ' + d.equipo_cierre + '% · ventas ÷ proformas' : 'ventas ÷ proformas'} c={cierre != null && d.equipo_cierre != null && cierre < d.equipo_cierre ? '#c0392b' : '#04896f'} />
                <Kpi ic={Award} t="Ticket promedio" v={usd(d.kpi.n ? vendido / d.kpi.n : 0)} s={d.ciclo != null ? `ciclo de venta ${d.ciclo} días` : 'por venta'} c="#c98a1f" />
              </div>
            </section>

            {d.general && d.equipo && <Equipo eq={d.equipo} mes={d.mes} h={h} actual={!!actual} ver={setAsesor} aviso={aviso} guardado={cargar} />}

            <Graficos d={d} h={h} meta={meta} actual={!!actual} proy={proy} />
            <section className="vt-g11">
              <Tarjeta ic={Target} t="Oportunidades para llegar a la meta" s={`${d.pipeline.n} proformas abiertas (120 días) · ${usd(d.pipeline.monto)}${d.pipeline.frias ? ' · ' + d.pipeline.frias + ' sin actividad hace más de 7 días' : ''}`}><Oportunidades ops={d.pipeline.top} faltan={faltan} general={d.general} /></Tarjeta>
              <Tarjeta ic={Lightbulb} t="Recomendaciones" s="Calculadas con los datos de este panel"><Consejos d={d} h={h} actual={!!actual} proy={proy} faltan={faltan} porDia={porDia} cierre={cierre} /></Tarjeta>
            </section>
          </div>
        )}
      </main>
      {editMeta && d && <ModalMeta emp={editMeta} d={d} cerrar={() => setEditMeta(null)} aviso={aviso} guardado={() => { setEditMeta(null); cargar() }} />}
    </div>
  )
}

/* Gráficos del panel: los hooks se llaman siempre, aquí (el panel solo se dibuja con datos). */
function Graficos({ d, h, meta, actual, proy }: { d: Panel; h: ReturnType<typeof habiles>; meta: number; actual: boolean; proy: number }) {
  const carrera = useCarrera(d, h, meta, actual, proy), meses = useMeses(d), canales = useCanales(d), dias = useDias(d), productos = useProductos(d), categorias = useCategorias(d)
  return (
    <>
      <section className="vt-g21">
        <Tarjeta ic={Rocket} t="Carrera hacia la meta" s={meta ? 'Acumulado del mes vs ritmo ideal (días hábiles) y proyección' : 'Acumulado del mes · ponte una meta para ver el ritmo ideal'}><div className="vt-alto"><Grafico config={carrera} /></div></Tarjeta>
        <Tarjeta ic={Crosshair} t="Embudo de 90 días" s="De cada etapa a la siguiente"><Embudo e={d.embudo} /></Tarjeta>
      </section>
      <section className="vt-g21">
        <Tarjeta ic={TrendingUp} t="Últimos 12 meses" s="Ventas sin IVA · verde = meta cumplida · línea = meta"><div className="vt-alto"><Grafico config={meses} /></div></Tarjeta>
        <Tarjeta ic={Flame} t="¿De dónde vienen las ventas?" s="Medio de captación · últimos 6 meses"><div className="vt-alto"><Grafico config={canales} /></div></Tarjeta>
      </section>
      <section className="vt-g21">
        <Tarjeta ic={Clock} t="Mapa de actividad" s="Gestiones por día y hora · últimos 90 días · más oscuro = más gestiones"><Calor c={d.calor} /></Tarjeta>
        <Tarjeta ic={CalendarDays} t="Mejores días para cerrar" s="Ventas por día de la semana · 6 meses"><div className="vt-alto"><Grafico config={dias} /></div></Tarjeta>
      </section>
      <section className="vt-g11">
        <Tarjeta ic={Trophy} t="Lo que más se vende" s="Top 10 productos · 6 meses"><div className="vt-alto alto2"><Grafico config={productos} /></div></Tarjeta>
        <Tarjeta ic={Award} t="Categorías" s="Ventas por categoría · 6 meses"><div className="vt-alto alto2"><Grafico config={categorias} /></div></Tarjeta>
      </section>
    </>
  )
}

function deltaTxt(a: number, b: number, txt: string) {
  if (!b) return a ? 'el mes pasado a esta fecha: $0' : txt
  const p = Math.round(((a - b) / b) * 100)
  return (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% ' + txt
}
function Kpi({ ic: I, t, v, s, c, barra }: { ic: LucideIcon; t: string; v: string; s: string; c: string; barra?: number }) {
  return (
    <div className="vt-kpi" style={{ ['--c' as string]: c }}>
      <span className="ic"><I /></span><span className="t">{t}</span><b>{v}</b><small>{s}</small>
      {barra != null && <i className="vt-bar"><i style={{ width: Math.min(100, barra) + '%' }} /></i>}
    </div>
  )
}
function Tarjeta({ ic: I, t, s, children }: { ic: LucideIcon; t: string; s: string; children: React.ReactNode }) {
  return <div className="vt-card"><div className="vt-card-h"><span><I /></span><div className="min-w-0"><h3>{t}</h3><p>{s}</p></div></div>{children}</div>
}

/* ---------- Medidor de la meta (media dona con el avance y una marca de la proyección) ---------- */
function Medidor({ vendido, meta, proy, actual }: { vendido: number; meta: number; proy: number; actual: boolean }) {
  const p = meta > 0 ? Math.min(1, vendido / meta) : 0
  const color = meta <= 0 ? '#94a3b8' : vendido >= meta ? '#04896f' : actual && proy >= meta ? '#17a9ba' : p >= 0.5 ? '#c98a1f' : '#e1306c'
  const config = useMemo<ChartConfiguration>(() => ({
    type: 'doughnut',
    data: { datasets: [{ data: meta > 0 ? [p, 1 - p] : [0, 1], backgroundColor: [color, '#e8eef5'], borderWidth: 0, borderRadius: [12, 0] as never }] },
    options: { rotation: -90, circumference: 180, cutout: '78%', responsive: true, maintainAspectRatio: false, animation: { duration: 1200, easing: 'easeOutQuart' }, plugins: { legend: { display: false }, tooltip: { enabled: false } } },
  }), [p, color, meta])
  return (
    <div className="vt-medidor">
      <Grafico config={config} />
      <div className="vt-medidor-c"><b style={{ color }}>{meta > 0 ? Math.round((vendido / meta) * 100) + '%' : '—'}</b><small>{meta > 0 ? 'de la meta' : 'sin meta'}</small></div>
    </div>
  )
}

/* ---------- Gráficos ---------- */
function useCarrera(d: Panel, h: ReturnType<typeof habiles>, meta: number, actual: boolean, proy: number) {
  return useMemo<ChartConfiguration>(() => {
    const dias: string[] = []; const x = new Date(d.mes + 'T12:00:00Z'), m = x.getUTCMonth()
    while (x.getUTCMonth() === m) { dias.push(x.toISOString().slice(0, 10)); x.setUTCDate(x.getUTCDate() + 1) }
    const por = Object.fromEntries(d.diario.map((r) => [r.d.slice(0, 10), Number(r.monto)]))
    let acc = 0
    const real = dias.map((k) => { acc += por[k] || 0; return k <= d.hoy ? Math.round(acc) : null })
    let hab = 0
    const ideal = dias.map((k) => { const w = new Date(k + 'T12:00:00Z').getUTCDay(); if (w > 0 && w < 6) hab++; return meta ? Math.round((meta * hab) / h.total) : null })
    const iHoy = dias.indexOf(d.hoy)
    const proyeccion = actual && iHoy >= 0 ? dias.map((_, i) => (i < iHoy ? null : Math.round(real[iHoy]! + ((proy - real[iHoy]!) * (i - iHoy)) / Math.max(1, dias.length - 1 - iHoy)))) : []
    return {
      type: 'line',
      data: { labels: dias.map((k) => String(+k.slice(8, 10))), datasets: [
        { label: 'Vendido', data: real, borderColor: '#04896f', borderWidth: 3, pointRadius: 0, tension: 0.3, fill: true,
          backgroundColor: (c: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => { const a = c.chart.chartArea; if (!a) return 'rgba(4,137,111,.15)'; const g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, 'rgba(4,137,111,.35)'); g.addColorStop(1, 'rgba(4,137,111,0)'); return g } },
        ...(meta ? [{ label: 'Ritmo ideal', data: ideal, borderColor: '#94a3b8', borderDash: [6, 5], borderWidth: 2, pointRadius: 0, fill: false }] : []),
        ...(proyeccion.length ? [{ label: 'Proyección', data: proyeccion, borderColor: '#17a9ba', borderDash: [3, 4], borderWidth: 2, pointRadius: 0, fill: false }] : []),
      ] as never },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number } }) => c.dataset.label + ': $' + money0(c.parsed.y) } } },
        scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 16 } } } } as never,
    }
  }, [d, h, meta, actual, proy])
}
function useMeses(d: Panel) {
  return useMemo<ChartConfiguration>(() => ({
    type: 'bar',
    data: { labels: d.meses.map((m) => monthLabel(m.m)), datasets: [
      { type: 'bar', label: 'Ventas', data: d.meses.map((m) => Math.round(m.monto)), backgroundColor: d.meses.map((m) => (m.meta && m.monto >= m.meta ? '#04896f' : m.m === d.mes.slice(0, 7) ? '#17a9ba' : '#055c9d')), borderRadius: 8, maxBarThickness: 34, order: 2 },
      { type: 'line', label: 'Meta', data: d.meses.map((m) => (m.meta ? Math.round(m.meta) : null)), borderColor: '#e1306c', borderDash: [5, 4], borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#e1306c', spanGaps: true, order: 1 },
    ] as never },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number }; dataIndex: number }) => c.dataset.label + ': $' + money0(c.parsed.y) + (c.dataset.label === 'Ventas' ? ' · ' + d.meses[c.dataIndex].n + ' ventas' : '') } } },
      scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } } as never,
  }), [d])
}
function useCanales(d: Panel) {
  return useMemo<ChartConfiguration>(() => {
    const g: Record<string, number> = {}
    d.canales.forEach((c) => { const k = canal(c.medio); g[k] = (g[k] || 0) + Number(c.monto) })
    const e = Object.entries(g).sort((a, b) => b[1] - a[1])
    return { type: 'doughnut', data: { labels: e.map((x) => x[0]), datasets: [{ data: e.map((x) => Math.round(x[1])), backgroundColor: e.map((x) => CANAL_COLOR[x[0]] || '#64748b'), borderWidth: 2, borderColor: '#fff', hoverOffset: 10 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c: { label: string; parsed: number }) => c.label + ': $' + money0(c.parsed) } } } } as never }
  }, [d])
}
function useDias(d: Panel) {
  return useMemo<ChartConfiguration>(() => {
    const orden = [1, 2, 3, 4, 5, 6, 0], por = Object.fromEntries(d.dias_venta.map((x) => [x.dw, x]))
    const vals = orden.map((w) => Math.round(Number(por[w]?.monto || 0))), max = Math.max(...vals)
    return { type: 'bar', data: { labels: orden.map((w) => DIAS_C[w]), datasets: [{ label: 'Ventas', data: vals, backgroundColor: vals.map((v) => (v === max && v > 0 ? '#c98a1f' : '#cbd5e1')), borderRadius: 8, maxBarThickness: 36 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { parsed: { y: number }; dataIndex: number }) => '$' + money0(c.parsed.y) + ' · ' + (por[orden[c.dataIndex]]?.n || 0) + ' ventas' } } },
        scales: { y: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } } as never }
  }, [d])
}
function useProductos(d: Panel) {
  return useMemo<ChartConfiguration>(() => ({
    type: 'bar',
    data: { labels: d.productos.map((p) => (p.nombre.length > 34 ? p.nombre.slice(0, 33) + '…' : p.nombre)), datasets: [{ label: 'Ventas', data: d.productos.map((p) => Math.round(Number(p.monto))), backgroundColor: d.productos.map((_, i) => PALETA[i % PALETA.length]), borderRadius: 6, barThickness: 16 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { parsed: { x: number }; dataIndex: number }) => '$' + money0(c.parsed.x) + ' · ' + d.productos[c.dataIndex].unidades + ' u.' } } },
      scales: { x: { beginAtZero: true, ticks: usdTick, grid: { color: '#f1f5f9' } }, y: { grid: { display: false }, ticks: { font: { size: 10.5 } } } } } as never,
  }), [d])
}
function useCategorias(d: Panel) {
  return useMemo<ChartConfiguration>(() => ({
    type: 'polarArea',
    data: { labels: d.categorias.map((c) => sinEmoji(c.categoria)), datasets: [{ data: d.categorias.map((c) => Math.round(Number(c.monto))), backgroundColor: d.categorias.map((_, i) => PALETA[i % PALETA.length] + 'cc'), borderColor: '#fff', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { r: { ticks: { display: false }, grid: { color: '#eef2f6' } } }, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c: { label: string; parsed: { r: number } }) => c.label + ': $' + money0(c.parsed.r) } } } } as never,
  }), [d])
}

/* ---------- Embudo ---------- */
const UNO = ['lead', 'gestión', 'proforma']
function Embudo({ e }: { e: Panel['embudo'] }) {
  const pasos: [string, number, string][] = [['Leads asignados', e.leads, '#055c9d'], ['Gestiones', e.gestiones, '#7c3aed'], ['Proformas', e.proformas, '#17a9ba'], ['Ventas', e.ventas, '#04896f']]
  const max = Math.max(1, ...pasos.map((p) => p[1]))
  return (
    <div className="vt-embudo">
      {pasos.map(([t, n, c], i) => (
        <div key={t} className="vt-emb">
          <div className="vt-emb-bar" style={{ width: Math.max(14, (n / max) * 100) + '%', background: c }}><b>{n.toLocaleString('es-EC')}</b></div>
          <span>{t}{i > 0 && pasos[i - 1][1] > 0 ? <em>{n <= pasos[i - 1][1] ? Math.round((n / pasos[i - 1][1]) * 100) + '% de ' + pasos[i - 1][0].toLowerCase() : (n / pasos[i - 1][1]).toLocaleString('es-EC', { maximumFractionDigits: 1 }) + ' por cada ' + UNO[i - 1]}</em> : null}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Mapa de calor (día × hora) ---------- */
function Calor({ c }: { c: Panel['calor'] }) {
  const horas = Array.from({ length: 14 }, (_, i) => i + 7), orden = [1, 2, 3, 4, 5, 6, 0]
  const m: Record<string, number> = {}; c.forEach((x) => { m[x.dw + '|' + x.h] = (m[x.dw + '|' + x.h] || 0) + x.n })
  const max = Math.max(1, ...Object.values(m))
  if (!c.length) return <p className="vt-vacio">Todavía no hay gestiones registradas en los últimos 90 días.</p>
  return (
    <div className="vt-calor">
      <div className="vt-calor-h"><span />{horas.map((x) => <span key={x}>{x}h</span>)}</div>
      {orden.map((w) => (
        <div key={w} className="vt-calor-f"><span>{DIAS_C[w]}</span>{horas.map((x) => { const n = m[w + '|' + x] || 0; return <i key={x} title={`${DIAS[w]} ${x}:00 · ${n} gestiones`} style={{ background: n ? `rgba(124,58,237,${0.12 + 0.88 * (n / max)})` : '#f1f5f9' }} /> })}</div>
      ))}
    </div>
  )
}

/* ---------- Oportunidades (proformas abiertas) ---------- */
function Oportunidades({ ops, faltan, general }: { ops: Op[]; faltan: number; general: boolean }) {
  if (!ops.length) return <p className="vt-vacio">No hay proformas abiertas en los últimos 120 días. Genera nuevas oportunidades.</p>
  let acc = 0
  return (
    <div className="vt-ops">
      {ops.map((o) => {
        const antes = acc; acc += Number(o.total) / 1.15
        const clave = faltan > 0 && antes < faltan
        return (
          <div key={o.id} className={'vt-op' + (clave ? ' clave' : '')}>
            <div className="min-w-0 flex-1"><b>{o.cliente || o.codigo}</b><small>{o.codigo} · {o.estado}{general ? ' · ' + o.asesor : ''}</small></div>
            <span className={'vt-dias' + (o.dias > 7 ? ' frio' : '')} title="Días sin actividad">{o.dias > 7 ? '❄ ' : ''}{o.dias} d</span>
            <b className="vt-op-m">{usd(o.total)}</b>
          </div>
        )
      })}
      {faltan > 0 && <p className="vt-nota"><Target />Las marcadas cubren lo que falta para la meta (montos sin IVA).</p>}
    </div>
  )
}

/* ---------- Recomendaciones ---------- */
function Consejos({ d, h, actual, proy, faltan, porDia, cierre }: { d: Panel; h: ReturnType<typeof habiles>; actual: boolean; proy: number; faltan: number; porDia: number; cierre: number | null }) {
  const it: { ic: LucideIcon; c: string; t: string }[] = []
  const meta = d.meta.monto, previos = d.meses.slice(0, -1).slice(-3), prom = previos.length ? previos.reduce((s, m) => s + Number(m.monto), 0) / previos.length : 0
  if (!meta) it.push({ ic: Crosshair, c: '#7c3aed', t: `Sin meta este mes. El promedio de los últimos 3 meses es ${usd(prom)}: una meta de ${usd(Math.ceil((prom * 1.1) / 100) * 100)} (+10%) reta sin ser imposible.` })
  else if (actual) it.push(proy >= meta ? { ic: Rocket, c: '#04896f', t: `Vas en camino: a este ritmo cierras en ${usd(proy)} (${pct(proy, meta)}% de la meta). Mantén el ritmo de ${usd(h.pasados ? d.kpi.monto / h.pasados : 0)} por día hábil.` }
    : { ic: TrendingDown, c: '#e1306c', t: `A este ritmo cierras en ${usd(proy)} (${pct(proy, meta)}%). Para llegar necesitas ${usd(porDia)} por día hábil en los ${h.restantes} días que quedan.` })
  if (actual && d.kpi.prev_al_dia > 0) { const p = Math.round(((d.kpi.monto - d.kpi.prev_al_dia) / d.kpi.prev_al_dia) * 100); it.push({ ic: p >= 0 ? TrendingUp : TrendingDown, c: p >= 0 ? '#04896f' : '#c98a1f', t: `Vas ${Math.abs(p)}% ${p >= 0 ? 'arriba' : 'abajo'} del mes pasado a la misma fecha (${usd(d.kpi.prev_al_dia)}).` }) }
  if (faltan > 0 && d.pipeline.top.length) {
    let acc = 0, k = 0; for (const o of d.pipeline.top) { if (acc >= faltan) break; acc += Number(o.total) / 1.15; k++ }
    it.push(acc >= faltan ? { ic: Target, c: '#055c9d', t: `Cerrar ${k} de las proformas abiertas más grandes cubre lo que falta (${usd(faltan)}). Empieza por ${d.pipeline.top[0].cliente || d.pipeline.top[0].codigo}.` }
      : { ic: Flame, c: '#c0392b', t: `Las proformas abiertas no alcanzan para la meta: hace falta generar más oportunidades (proformas nuevas o reactivar clientes).` })
  }
  if (d.pipeline.frias) it.push({ ic: Clock, c: '#c98a1f', t: `${d.pipeline.frias} proforma${d.pipeline.frias === 1 ? '' : 's'} lleva${d.pipeline.frias === 1 ? '' : 'n'} más de 7 días sin actividad: un seguimiento hoy puede reactivarlas.` })
  if (cierre != null && d.equipo_cierre != null && !d.general) it.push(cierre < d.equipo_cierre - 3 ? { ic: Crosshair, c: '#c0392b', t: `Cierre de ${cierre}% frente a ${d.equipo_cierre}% del equipo: revisa objeciones de precio y entrega en las proformas en negociación.` }
    : { ic: Award, c: '#04896f', t: `Cierras ${cierre}% de tus proformas (equipo ${d.equipo_cierre}%): más proformas se traducen directo en más ventas.` })
  const g: Record<string, number> = {}; let tot = 0; d.canales.forEach((c) => { const k = canal(c.medio); g[k] = (g[k] || 0) + Number(c.monto); tot += Number(c.monto) })
  const top = Object.entries(g).sort((a, b) => b[1] - a[1])[0]
  if (top && tot) it.push({ ic: Flame, c: CANAL_COLOR[top[0]] || '#055c9d', t: `El canal más fuerte es ${top[0]} (${pct(top[1], tot)}% de las ventas en 6 meses): dale prioridad a esos contactos.` })
  const dv = [...d.dias_venta].sort((a, b) => Number(b.monto) - Number(a.monto))[0]
  if (dv && Number(dv.monto) > 0) it.push({ ic: CalendarDays, c: '#c98a1f', t: `El mejor día para cerrar es el ${DIAS[dv.dw].toLowerCase()}: agenda ahí las llamadas de cierre y las visitas.` })
  if (d.categorias[0]) it.push({ ic: Trophy, c: '#7c3aed', t: `Categoría estrella: ${sinEmoji(d.categorias[0].categoria)}. Ofrece productos complementarios de esa línea a los clientes que ya compraron.` })
  return <div className="vt-consejos">{it.map((x, i) => { const I = x.ic; return <div key={i} className="vt-consejo" style={{ ['--c' as string]: x.c }}><span><I /></span><p>{x.t}</p></div> })}</div>
}

/* ---------- Equipo (vista general): ranking con barra de meta y metas editables ---------- */
function Equipo({ eq, mes, h, actual, ver, aviso, guardado }: { eq: Miembro[]; mes: string; h: ReturnType<typeof habiles>; actual: boolean; ver: (id: string) => void; aviso: (t: string) => void; guardado: () => void }) {
  const [metas, setMetas] = useState<Record<string, string>>({})
  useEffect(() => { setMetas(Object.fromEntries(eq.map((m) => [m.id, m.meta != null ? String(Math.round(m.meta)) : '']))) }, [eq])
  const max = Math.max(1, ...eq.map((m) => Math.max(m.monto, m.meta || 0)))
  async function guardar(m: Miembro) {
    const v = metas[m.id]; if (v === (m.meta != null ? String(Math.round(m.meta)) : '')) return
    const n = Number(v); if (!(n >= 0) || v.trim() === '') { aviso('Escribe la meta en dólares.'); return }
    const { error } = await supabase.rpc('ven_meta_guardar', { p_empleado: m.id, p_mes: mes, p_monto: n })
    if (error) { aviso(error.message); return }
    aviso('Meta de ' + m.nombre + ': ' + usd(n)); guardado()
  }
  return (
    <section className="vt-card vt-equipo">
      <div className="vt-card-h"><span><Users /></span><div className="min-w-0"><h3>Equipo · {mesTexto(mes)}</h3><p>Barra = vendido · marca = meta · escribe la meta y presiona Enter · toca un nombre para ver su panel</p></div></div>
      <div className="vt-eq-lista">
        {eq.map((m, i) => {
          const p = m.meta ? pct(m.monto, m.meta) : null, proy = actual && h.pasados ? (m.monto / h.pasados) * h.total : m.monto
          return (
            <div key={m.id} className="vt-eq">
              <span className={'vt-pos' + (i < 3 ? ' p' + (i + 1) : '')}>{i + 1}</span>
              <button className="vt-eq-n" onClick={() => ver(m.id)}><b>{m.nombre}</b><small>{m.n} ventas · {m.proformas} proformas · {m.gestiones} gestiones{m.cierre != null ? ' · cierre ' + (m.cierre > 100 ? '100%+' : m.cierre + '%') : ''}</small></button>
              <div className="vt-eq-bar">
                <i className="v" style={{ width: (m.monto / max) * 100 + '%', background: m.meta && m.monto >= m.meta ? '#04896f' : actual && m.meta && proy >= m.meta ? '#17a9ba' : '#055c9d' }} />
                {m.meta ? <i className="m" style={{ left: (m.meta / max) * 100 + '%' }} title={'Meta ' + usd(m.meta)} /> : null}
              </div>
              <div className="vt-eq-v"><b>{usd(m.monto)}</b><small>{p != null ? p + '% de la meta' : 'sin meta'}{actual && m.meta ? ' · proy. ' + pct(proy, m.meta) + '%' : ''}</small></div>
              <label className="vt-eq-meta">Meta<span>$</span><input inputMode="decimal" value={metas[m.id] ?? ''} placeholder="—" onChange={(e) => setMetas({ ...metas, [m.id]: e.target.value.replace(/[^\d.]/g, '') })} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} onBlur={() => guardar(m)} /></label>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ---------- Ventana de la meta ---------- */
function ModalMeta({ emp, d, cerrar, aviso, guardado }: { emp: { id: string; nombre: string; propia: boolean }; d: Panel; cerrar: () => void; aviso: (t: string) => void; guardado: () => void }) {
  const m = d.meta
  const [f, setF] = useState({ monto: m.monto ? String(Math.round(m.monto)) : '', ventas: m.ventas != null ? String(m.ventas) : '', proformas: m.proformas != null ? String(m.proformas) : '', gestiones: m.gestiones != null ? String(m.gestiones) : '', nota: m.nota ?? '' })
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  const previos = d.meses.slice(0, -1).slice(-3)
  const prom = previos.length ? previos.reduce((s, x) => s + Number(x.monto), 0) / previos.length : 0
  const promN = previos.length ? previos.reduce((s, x) => s + x.n, 0) / previos.length : 0
  const promP = previos.length ? previos.reduce((s, x) => s + x.proformas, 0) / previos.length : 0
  const sugerir = () => setF({ ...f, monto: String(Math.ceil((prom * 1.1) / 100) * 100), ventas: String(Math.ceil(promN * 1.1)), proformas: String(Math.ceil(promP * 1.1)) })
  const n = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.round(Number(s))))
  async function guardar() {
    const monto = Number(f.monto)
    if (!(monto > 0)) { aviso('Escribe la meta en dólares.'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('ven_meta_guardar', { p_empleado: emp.id, p_mes: d.mes, p_monto: monto, p_ventas: n(f.ventas), p_proformas: n(f.proformas), p_gestiones: n(f.gestiones), p_nota: f.nota })
    setOcupado(false)
    if (error) { aviso(error.message); return }
    aviso('Meta guardada: ' + usd(monto)); guardado()
  }
  return (
    <div className="vt-ovl" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vt-modal">
        <div className="flex items-center gap-2"><h3 className="flex-1">{emp.propia ? 'Mi meta' : 'Meta de ' + emp.nombre} · {mesTexto(d.mes)}</h3><button className="vt-x" onClick={cerrar} aria-label="Cerrar"><X /></button></div>
        {m.minimo != null && emp.propia && <p className="vt-aviso">Tu coordinación fijó un mínimo de <b>{usd(m.minimo)}</b>: puedes subirla, no bajarla.</p>}
        <label className="vt-f grande">Meta de ventas (USD sin IVA) *<input inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value.replace(/[^\d.]/g, '') })} placeholder="Ej. 25000" autoFocus /></label>
        <div className="grid grid-cols-3 gap-2">
          <label className="vt-f">Nº de ventas<input inputMode="numeric" value={f.ventas} onChange={(e) => setF({ ...f, ventas: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="vt-f">Proformas<input inputMode="numeric" value={f.proformas} onChange={(e) => setF({ ...f, proformas: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="vt-f">Gestiones<input inputMode="numeric" value={f.gestiones} onChange={(e) => setF({ ...f, gestiones: e.target.value.replace(/\D/g, '') })} /></label>
        </div>
        <label className="vt-f">Mi estrategia para lograrla<textarea rows={2} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} placeholder="Ej. reactivar clientes de quirófano, 3 visitas por semana" /></label>
        {prom > 0 && <button type="button" className="vt-sug" onClick={sugerir}><Lightbulb />Sugerir: promedio de los últimos 3 meses ({usd(prom)}) + 10%</button>}
        <div className="flex justify-end gap-2 mt-1"><button className="vt-btn sec" onClick={cerrar}>Cancelar</button><button className="vt-btn prim" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar meta'}</button></div>
      </div>
    </div>
  )
}
