import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Plus, X } from 'lucide-react'
import type { ChartConfiguration } from 'chart.js'
import { Grafico, baseOpts, usdTick, PALETA } from '../graficos'
import { supabase } from '../supabase'

/* Gráficos del CRM (CRMDashboard.html / FemedicsCRM.html: CHART_CATALOG + getExtendedDashboardStats).
   Se calculan con las mismas gestiones que ve la persona en el CRM (su alcance) y, para clientes nuevos y equipos,
   con la función crm_graficos de la base (también con su alcance). La elección de gráficos queda en este equipo. */
export type GestionGraf = { tipo: string; estado: string; asesorId: string | null; fechaTS: number; total: number }
type Extra = { clientesPorMes: { mes: string; n: number }[]; topCotizados: { nombre: string; n: number }[]; topVendidos: { nombre: string; n: number }[] }

const CATALOGO: [string, string][] = [
  ['estado', 'Leads por estado'], ['asesor', 'Carga por asesor'], ['tipoLead', 'Leads por tipo'], ['mensual', 'Cotizaciones (últimos 6 meses)'],
  ['ventasPorMes', 'Ventas por mes ($)'], ['visitasPorMes', 'Visitas por mes'], ['clientesPorMes', 'Clientes nuevos por mes'],
  ['topCotizados', 'Equipos más cotizados'], ['topVendidos', 'Equipos más vendidos'], ['rendimientoAsesores', 'Rendimiento por asesor (% conversión)'],
]
const CLAVE = 'vimedic_crm_charts_config'
const leerConfig = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(CLAVE) || 'null'); if (Array.isArray(v)) return v.filter((x) => x && x.visible !== false).map((x) => String(x.id ?? x)).filter((id) => CATALOGO.some(([k]) => k === id)) } catch { /* sin almacenamiento */ }
  return ['estado', 'asesor']
}
const meses6 = () => { const d = new Date(); return Array.from({ length: 6 }, (_, i) => { const x = new Date(d.getFullYear(), d.getMonth() - 5 + i, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') }) }
const mesDe = (ts: number) => { const x = new Date(ts); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') }
const etiquetaMes = (k: string) => new Date(k + '-15T12:00:00').toLocaleDateString('es-EC', { month: 'short', year: '2-digit' })
const corto = (t: string, n = 28) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

export default function CrmGraficos({ gestiones, asesores, empresa, colores, cerrar }: {
  gestiones: GestionGraf[]; asesores: { id: string; nombre: string }[]; empresa: string; colores: Record<string, string>; cerrar: () => void
}) {
  const [ids, setIds] = useState<string[]>(leerConfig)
  const [extra, setExtra] = useState<Extra | null>(null)
  const [menu, setMenu] = useState(false)
  useEffect(() => { try { localStorage.setItem(CLAVE, JSON.stringify(ids.map((id) => ({ id, visible: true })))) } catch { /* sin almacenamiento */ } }, [ids])
  const necesitaExtra = ids.some((id) => id === 'clientesPorMes' || id === 'topCotizados' || id === 'topVendidos')
  useEffect(() => { if (necesitaExtra && !extra) supabase.rpc('crm_graficos', { p_empresa: empresa }).then(({ data }) => setExtra((data as Extra) ?? { clientesPorMes: [], topCotizados: [], topVendidos: [] })) }, [necesitaExtra, extra, empresa])
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f) }, [cerrar])

  const nombre = useMemo(() => { const m = new Map(asesores.map((a) => [a.id, a.nombre.split(' (')[0]])); return (id: string | null) => (id ? m.get(id) ?? 'Otro' : 'Sin asignar') }, [asesores])
  const configs = useMemo(() => {
    const M = meses6(), L = M.map(etiquetaMes)
    const cuenta = (f: (g: GestionGraf) => string) => { const o: Record<string, number> = {}; for (const g of gestiones) { const k = f(g); o[k] = (o[k] || 0) + 1 } return o }
    const porMes = (filtro: (g: GestionGraf) => boolean, valor: (g: GestionGraf) => number = () => 1) => { const o: Record<string, number> = {}; for (const g of gestiones) if (filtro(g)) { const k = mesDe(g.fechaTS); o[k] = (o[k] || 0) + valor(g) } return M.map((k) => Math.round((o[k] || 0) * 100) / 100) }
    const barras = (labels: string[], data: number[], color: string, horizontal = false, dinero = false): ChartConfiguration => ({ type: 'bar', data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 6 }] },
      options: baseOpts({ indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: false } }, scales: { [horizontal ? 'x' : 'y']: { beginAtZero: true, ...(dinero ? { ticks: usdTick } : {}) } } }) as never })
    const dona = (o: Record<string, number>, colorDe?: (k: string, i: number) => string): ChartConfiguration => { const e = Object.entries(o).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]); return { type: 'doughnut', data: { labels: e.map((x) => x[0]), datasets: [{ data: e.map((x) => x[1]), backgroundColor: e.map(([k], i) => colorDe?.(k, i) ?? PALETA[i % PALETA.length]), borderWidth: 0 }] }, options: baseOpts({ cutout: '62%', plugins: { legend: { position: 'right' } } }) as never } }
    const out: Record<string, ChartConfiguration | null> = {}
    out.estado = dona(cuenta((g) => g.estado || 'Nuevo'), (k, i) => colores[k] ?? PALETA[i % PALETA.length])
    const carga = Object.entries(cuenta((g) => nombre(g.asesorId))).sort((a, b) => b[1] - a[1]).slice(0, 12)
    out.asesor = barras(carga.map((x) => corto(x[0], 22)), carga.map((x) => x[1]), '#055c9d', true)
    out.tipoLead = dona(cuenta((g) => g.tipo || 'Otro'))
    out.mensual = barras(L, porMes((g) => g.tipo === 'Cotización' || g.tipo === 'Venta'), '#17a9ba')
    out.ventasPorMes = barras(L, porMes((g) => g.estado === 'Ganado', (g) => g.total), '#04896f', false, true)
    out.visitasPorMes = barras(L, porMes((g) => g.tipo === 'Cita' || g.estado === 'Visita'), '#7c3aed')
    const tot: Record<string, number> = {}, gan: Record<string, number> = {}
    for (const g of gestiones) { const a = nombre(g.asesorId); tot[a] = (tot[a] || 0) + 1; if (g.estado === 'Ganado') gan[a] = (gan[a] || 0) + 1 }
    const rend = Object.keys(tot).map((a) => [a, Math.round(((gan[a] || 0) / tot[a]) * 100)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 12)
    out.rendimientoAsesores = { type: 'bar', data: { labels: rend.map((x) => corto(x[0], 22)), datasets: [{ data: rend.map((x) => x[1]), backgroundColor: '#c98a1f', borderRadius: 6 }] },
      options: baseOpts({ indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { raw: unknown }) => c.raw + ' %' } } }, scales: { x: { beginAtZero: true, max: 100, ticks: { callback: (v: string | number) => v + ' %' } } } }) as never }
    if (extra) {
      const cm = new Map(extra.clientesPorMes.map((x) => [x.mes, x.n]))
      out.clientesPorMes = barras(L, M.map((k) => Number(cm.get(k) || 0)), '#0e7490')
      out.topCotizados = barras(extra.topCotizados.map((x) => corto(x.nombre)), extra.topCotizados.map((x) => Number(x.n)), '#055c9d', true)
      out.topVendidos = barras(extra.topVendidos.map((x) => corto(x.nombre)), extra.topVendidos.map((x) => Number(x.n)), '#04896f', true)
    } else { out.clientesPorMes = null; out.topCotizados = null; out.topVendidos = null }
    return out
  }, [gestiones, nombre, colores, extra])

  const ocultos = CATALOGO.filter(([k]) => !ids.includes(k))
  return (
    <div className="fixed inset-0 z-[65] flex flex-col" style={{ background: 'rgba(15,23,42,.45)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white flex flex-col" style={{ margin: '12px', borderRadius: 18, flex: 1, minHeight: 0, boxShadow: '0 20px 60px rgba(15,23,42,.3)' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100" style={{ flexWrap: 'wrap' }}>
          <BarChart3 className="w-4 h-4" style={{ color: 'var(--primary)' }} />
          <h3 className="font-display font-bold text-sm text-slate-800" style={{ flex: 1 }}>Gráficos del CRM <span className="text-[11px] font-normal text-slate-400">· {gestiones.length} gestiones (según tus filtros)</span></h3>
          <div className="relative">
            <button className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-200 flex items-center gap-1.5" disabled={!ocultos.length} onClick={() => setMenu((v) => !v)}><Plus className="w-3.5 h-3.5" />Agregar gráfico</button>
            {menu && ocultos.length > 0 && <div className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-10 py-1" style={{ width: 260 }}>
              {ocultos.map(([k, t]) => <button key={k} className="w-full text-left text-xs font-semibold text-slate-700 px-3 py-2 hover:bg-slate-50" onClick={() => { setIds((x) => [...x, k]); setMenu(false) }}>{t}</button>)}</div>}
          </div>
          <button className="text-slate-400 hover:text-slate-600 p-1" aria-label="Cerrar" onClick={cerrar}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3" style={{ overflowY: 'auto', flex: 1, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', alignContent: 'start' }}>
          {!ids.length && <p className="text-xs text-slate-400 p-6">No hay gráficos. Usa "Agregar gráfico".</p>}
          {ids.map((k) => (
            <div key={k} className="rounded-2xl border border-slate-200 p-3" style={{ minWidth: 0 }}>
              <div className="flex items-center gap-2 mb-2"><b className="text-xs text-slate-800" style={{ flex: 1 }}>{CATALOGO.find(([x]) => x === k)?.[1]}</b>
                <button className="text-slate-300 hover:text-red-600" title="Quitar gráfico" aria-label="Quitar gráfico" onClick={() => setIds((x) => x.filter((y) => y !== k))}><X className="w-3.5 h-3.5" /></button></div>
              <div style={{ height: 240, position: 'relative' }}>{configs[k] ? <Grafico config={configs[k]} /> : <p className="text-xs text-slate-400">Cargando…</p>}</div>
            </div>))}
        </div>
      </div>
    </div>
  )
}
