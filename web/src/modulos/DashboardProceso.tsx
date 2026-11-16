import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowRight, CheckCircle2, CircleDashed, Clock, ExternalLink, Flag, ShoppingBag, Table, Timer, Workflow, XCircle } from 'lucide-react'
import type { ChartConfiguration } from 'chart.js'
import { supabase } from '../supabase'
import { Grafico, keyLabel } from '../graficos'
import '../estilos/dashboard-proceso.css'

/* Mapa de proceso de los pedidos (Issue #38, fase 4): cada etapa del seguimiento con los pedidos que
   están ahí ahora, cuántos van atrasados, cuánto tardó la etapa frente al objetivo y sus errores.
   Los cálculos los hace la base (RPC trk_proceso); aquí solo se dibujan. */
type Etapa = {
  clave: string; nombre: string; area: string; objetivo: number; objetivoProvincia: number | null
  ahora: number; atrasados: number; diasAhora: number; pasaron: number; promedio: number | null; mediana: number | null; maximo: number | null
  aTiempo: number | null; errores: number
}
type Actual = { id: string; codigo: string; cliente: string; empresa: string; etapa: string; zona: string; asesor: string; dias: number; objetivo: number; atrasado: boolean; errores: number }
type Err = { id: string; pedidoId: string; codigo: string; cliente: string; etapa: string; titulo: string; detalle: string | null; fecha: string; area: string | null }
type Semana = { semana: string; creados: number; entregados: number; lead: number | null; errores: number }
type Datos = {
  etapas: Etapa[]; actuales: Actual[]; errores: Err[]; semanal: Semana[]; asesores: { id: string; nombre: string }[]
  totales: { creados: number; entregados: number; completados: number; cancelados: number; enCurso: number; atrasados: number; errores: number; conErrores: number
    leadPromedio: number | null; leadMediana: number | null; leadObjetivoLocal: number; leadObjetivoProvincia: number; entregaATiempo: number | null }
}
type Estado = 'ok' | 'amb' | 'mal' | 'neutro'

// Colores de estado (validados: se distinguen con visión normal y con daltonismo); siempre van con ícono y texto.
const ESTADO: Record<Estado, { c: string; t: string; I: typeof CheckCircle2 }> = {
  ok: { c: '#04896f', t: 'En tiempo', I: CheckCircle2 },
  amb: { c: '#ca8a04', t: 'Al límite', I: Clock },
  mal: { c: '#c0392b', t: 'Con atraso', I: AlertTriangle },
  neutro: { c: '#94a3b8', t: 'Sin datos aún', I: CircleDashed },
}
const PESO: Record<Estado, number> = { neutro: 0, ok: 1, amb: 2, mal: 3 }
const n1 = (v: number | null | undefined) => (v == null ? '—' : Number(v).toLocaleString('es-EC', { maximumFractionDigits: 1 }))
const dd = (v: number | null | undefined) => (v == null ? '—' : n1(v) + ' d')
const fH = (s: string) => new Date(s).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const objTxt = (e: Etapa) => (e.objetivoProvincia != null ? `${n1(e.objetivo)} d local · ${n1(e.objetivoProvincia)} d provincia` : `${n1(e.objetivo)} d`)

/** Estado de la etapa: lo peor entre su historial (promedio frente al objetivo) y la foto actual (atrasados). */
function estadoDe(e: Etapa): Estado {
  const obj = e.objetivoProvincia != null ? Math.max(e.objetivo, e.objetivoProvincia) : e.objetivo
  let h: Estado = 'neutro'
  if (e.promedio != null && obj > 0) h = e.promedio <= obj ? 'ok' : e.promedio <= obj * 1.25 ? 'amb' : 'mal'
  let a: Estado = e.ahora > 0 ? 'ok' : 'neutro'
  if (e.atrasados > 0) a = e.atrasados * 2 >= e.ahora ? 'mal' : 'amb'
  return PESO[h] >= PESO[a] ? h : a
}
const abrirPedido = (id: string) => { window.location.hash = 'tracking/' + id }

export default function DashboardProceso({ desde, hasta, version }: { desde: string; hasta: string; version: number }) {
  const [empresa, setEmpresa] = useState('')
  const [zona, setZona] = useState('')
  const [asesor, setAsesor] = useState('')
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [tabla, setTabla] = useState(false)

  useEffect(() => {
    let vivo = true
    setError('')
    supabase.rpc('trk_proceso', { p_desde: desde, p_hasta: hasta, p_empresa: empresa, p_asesor: asesor || null, p_zona: zona }).then(({ data, error: e }) => {
      if (!vivo) return
      if (e) { setError(e.message); return }
      setD(data as Datos)
    })
    return () => { vivo = false }
  }, [desde, hasta, version, empresa, zona, asesor])

  // Cuello de botella: la etapa con más pedidos atrasados ahora; si no hay, la más lenta frente a su objetivo.
  const cuello = useMemo(() => {
    if (!d) return null
    const conAtraso = [...d.etapas].filter((e) => e.atrasados > 0).sort((a, b) => b.atrasados - a.atrasados)[0]
    if (conAtraso) return { e: conAtraso, motivo: `${conAtraso.atrasados} pedido${conAtraso.atrasados === 1 ? '' : 's'} atrasado${conAtraso.atrasados === 1 ? '' : 's'} ahora` }
    const lenta = [...d.etapas].filter((e) => e.promedio != null && e.objetivo > 0 && e.promedio > e.objetivo).sort((a, b) => b.promedio! / b.objetivo - a.promedio! / a.objetivo)[0]
    return lenta ? { e: lenta, motivo: `tarda ${dd(lenta.promedio)} en promedio (objetivo ${objTxt(lenta)})` } : null
  }, [d])
  const etapaSel = d?.etapas.find((e) => e.clave === (sel ?? cuello?.e.clave ?? '')) ?? null

  const cfgSemanas = useMemo<ChartConfiguration | null>(() => {
    if (!d) return null
    return {
      type: 'bar',
      data: { labels: d.semanal.map((s) => keyLabel(s.semana, { day: 'numeric', month: 'short' })), datasets: [
        { label: 'Ventas que entraron', data: d.semanal.map((s) => s.creados), backgroundColor: '#055c9d', borderRadius: 4, maxBarThickness: 18 },
        { label: 'Pedidos entregados', data: d.semanal.map((s) => s.entregados), backgroundColor: '#17a9ba', borderRadius: 4, maxBarThickness: 18 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: '#eef2f7' } } } },
    }
  }, [d])
  const cfgLead = useMemo<ChartConfiguration | null>(() => {
    if (!d) return null
    return {
      type: 'line',
      data: { labels: d.semanal.map((s) => keyLabel(s.semana, { day: 'numeric', month: 'short' })), datasets: [
        { label: 'Días venta → entrega', data: d.semanal.map((s) => s.lead), borderColor: '#055c9d', backgroundColor: '#055c9d', borderWidth: 2, pointRadius: 4, spanGaps: true, tension: 0.25 },
        { label: 'Objetivo (local)', data: d.semanal.map(() => d.totales.leadObjetivoLocal), borderColor: '#94a3b8', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${x.parsed.y == null ? 'sin entregas' : n1(x.parsed.y) + ' días'}` } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { beginAtZero: true, ticks: { font: { size: 10 } }, grid: { color: '#eef2f7' } } } },
    }
  }, [d])

  const filtros = (
    <div className="dp-filtros">
      <div className="seg sm">{([['', 'Todas'], ['VIMEDIC', 'VIMEDIC'], ['FEMEDICS', 'FEMEDICS']] as const).map(([k, t]) => <button key={k} type="button" className={empresa === k ? 'active' : ''} onClick={() => setEmpresa(k)}>{t}</button>)}</div>
      <div className="seg sm">{([['', 'Todo el país'], ['local', 'Local'], ['provincia', 'Provincia']] as const).map(([k, t]) => <button key={k} type="button" className={zona === k ? 'active' : ''} onClick={() => setZona(k)}>{t}</button>)}</div>
      <select className="dp-sel" value={asesor} onChange={(e) => setAsesor(e.target.value)} aria-label="Asesor">
        <option value="">Todos los asesores</option>{d?.asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
      </select>
      <button type="button" className={'dp-btn' + (tabla ? ' on' : '')} onClick={() => setTabla(!tabla)}><Table />{tabla ? 'Ver mapa' : 'Ver tabla'}</button>
    </div>
  )

  return (
    <div className="dp">
      <div className="sec-h"><div><h2><Workflow />Proceso de pedidos</h2><p>Del CRM a la entrega: dónde se acumulan los pedidos, cuánto tarda cada etapa frente a su objetivo (días hábiles) y dónde hay errores.</p></div>
        <div className="ml-auto">{filtros}</div></div>
      {error && <div className="card p-4 text-xs text-red-700">No se pudo cargar el proceso: {error}</div>}
      {!error && !d && <div className="sk" style={{ height: 320 }} />}
      {d && <>
        <div className="dp-kpis">
          <Kpi I={ShoppingBag} t="En curso ahora" v={String(d.totales.enCurso)} s={`${d.totales.creados} ventas entraron en el período`} />
          <Kpi I={AlertTriangle} t="Atrasados ahora" v={String(d.totales.atrasados)} s={d.totales.enCurso ? `${Math.round((d.totales.atrasados / d.totales.enCurso) * 100)}% de los pedidos en curso` : 'sin pedidos en curso'} alerta={d.totales.atrasados > 0} />
          <Kpi I={Timer} t="Venta → entrega" v={dd(d.totales.leadPromedio)} s={`objetivo ${n1(d.totales.leadObjetivoLocal)} d local · ${n1(d.totales.leadObjetivoProvincia)} d provincia`} />
          <Kpi I={Flag} t="Entregados a tiempo" v={d.totales.entregaATiempo == null ? '—' : d.totales.entregaATiempo + '%'} s={`${d.totales.entregados} entregado${d.totales.entregados === 1 ? '' : 's'} en el período`} />
          <Kpi I={XCircle} t="Errores" v={String(d.totales.errores)} s={`${d.totales.conErrores} pedido${d.totales.conErrores === 1 ? '' : 's'} con novedades en el período`} alerta={d.totales.errores > 0} />
        </div>

        {!d.totales.creados && !d.totales.enCurso && !d.totales.entregados && <p className="dp-aviso"><CircleDashed />Todavía no hay pedidos del proceso nuevo con estos filtros. El mapa se llena solo cuando las ventas del CRM pasan a Facturación (desde el 16-nov-2026).</p>}
        {cuello && <p className="dp-cuello"><AlertTriangle />Cuello de botella: <b>{cuello.e.nombre}</b> ({cuello.e.area}) — {cuello.motivo}.</p>}

        <article className="card dp-mapa">
          {tabla ? <TablaEtapas etapas={d.etapas} /> : (
            <div className="dp-flujo" role="list" aria-label="Etapas del pedido">
              <Hito t="Venta" s="CRM" />
              {d.etapas.map((e) => {
                const est = estadoDe(e)
                const sep = e.clave === 'instalacion'
                return (
                  <div key={e.clave} className={'dp-paso' + (sep ? ' opc' : '')} role="listitem">
                    {sep && <><Flecha /><Hito t="Entregada" s="Logística" fin /></>}
                    <Flecha />
                    <Caja e={e} est={est} activa={etapaSel?.clave === e.clave} elegir={() => { setSel(e.clave); window.setTimeout(() => document.getElementById('dp-det')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60) }} opcional={sep} />
                  </div>
                )
              })}
            </div>
          )}
          <div className="dp-leyenda">{(['ok', 'amb', 'mal', 'neutro'] as Estado[]).map((k) => { const { c, t, I } = ESTADO[k]; return <span key={k}><I style={{ color: c }} />{t}</span> })}
            <span className="dp-nota">Barra: promedio de la etapa · la marca es el objetivo. "Ahora" no depende del período.</span></div>
        </article>

        {etapaSel && <Detalle e={etapaSel} actuales={d.actuales.filter((a) => a.etapa === etapaSel.clave)} errores={d.errores.filter((x) => x.etapa === etapaSel.clave)} />}

        <div className="dp-graficos">
          <article className="card p-4"><h3 className="dp-h3">Pedidos por semana</h3><p className="dp-sub">Ventas que entraron al proceso y pedidos entregados</p><div className="dp-chart"><Grafico config={cfgSemanas} /></div></article>
          <article className="card p-4"><h3 className="dp-h3">Días de venta a entrega</h3><p className="dp-sub">Promedio de los pedidos entregados cada semana (días hábiles)</p><div className="dp-chart"><Grafico config={cfgLead} /></div></article>
        </div>
      </>}
    </div>
  )
}

function Kpi({ I, t, v, s, alerta }: { I: typeof Clock; t: string; v: string; s: string; alerta?: boolean }) {
  return <div className="card dp-kpi"><span className="dp-kpi-t"><I style={{ color: alerta ? ESTADO.mal.c : 'var(--primary)' }} />{t}</span><b>{v}</b><small>{s}</small></div>
}
function Hito({ t, s, fin }: { t: string; s: string; fin?: boolean }) {
  return <div className={'dp-hito' + (fin ? ' fin' : '')}><span>{fin ? <Flag /> : <ShoppingBag />}</span><b>{t}</b><small>{s}</small></div>
}
function Flecha() {
  return <span className="dp-flecha" aria-hidden="true"><ArrowRight className="h" /><ArrowDown className="v" /></span>
}

function Caja({ e, est, activa, elegir, opcional }: { e: Etapa; est: Estado; activa: boolean; elegir: () => void; opcional: boolean }) {
  const { c, t, I } = ESTADO[est]
  const obj = e.objetivoProvincia != null ? Math.max(e.objetivo, e.objetivoProvincia) : e.objetivo
  // Escala de la barra: hasta el doble del objetivo (o el promedio si es mayor); la marca vertical es el objetivo.
  const tope = Math.max(obj * 2, e.promedio ?? 0, 0.1)
  const ancho = e.promedio == null ? 0 : Math.min(100, (e.promedio / tope) * 100)
  const marca = obj > 0 ? Math.min(100, (obj / tope) * 100) : 0
  return (
    <button type="button" className={'dp-caja' + (activa ? ' on' : '')} style={{ ['--st' as string]: c }} onClick={elegir}
      title={`${e.nombre}: ${e.ahora} ahora, ${e.atrasados} atrasados. Promedio ${dd(e.promedio)} (mediana ${dd(e.mediana)}, máximo ${dd(e.maximo)}) · objetivo ${objTxt(e)}. ${e.pasaron} pasaron en el período.`}>
      <span className="dp-caja-h"><b>{e.nombre}</b><small>{e.area}{opcional ? ' · si aplica' : ''}</small></span>
      <span className="dp-ahora"><b>{e.ahora}</b><small>ahora</small>{e.atrasados > 0 && <em><AlertTriangle />{e.atrasados} atrasado{e.atrasados === 1 ? '' : 's'}</em>}</span>
      <span className="dp-meter" aria-hidden="true"><i style={{ width: ancho + '%' }} />{marca > 0 && <u style={{ left: marca + '%' }} />}</span>
      <span className="dp-cifras">Promedio <b>{dd(e.promedio)}</b> · objetivo {objTxt(e)}</span>
      <span className="dp-pie"><span className="dp-est"><I style={{ color: c }} />{t}</span>
        <span>{e.aTiempo == null ? `${e.pasaron} pasaron` : `${e.aTiempo}% a tiempo`}</span>
        {e.errores > 0 && <span className="dp-err"><XCircle />{e.errores}</span>}</span>
    </button>
  )
}

function Detalle({ e, actuales, errores }: { e: Etapa; actuales: Actual[]; errores: Err[] }) {
  return (
    <article id="dp-det" className="card p-4 dp-det">
      <div className="dp-det-h"><h3 className="dp-h3">{e.nombre} <small>· {e.area}</small></h3>
        <span className="dp-sub">{e.pasaron} pedidos salieron de esta etapa en el período · mediana {dd(e.mediana)} · máximo {dd(e.maximo)} · objetivo {objTxt(e)}</span></div>
      <div className="dp-det-g">
        <div>
          <h4>Pedidos en esta etapa ahora ({actuales.length})</h4>
          {!actuales.length ? <p className="dp-vacio">No hay pedidos en esta etapa.</p> : (
            <div className="dp-tw"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Asesor</th><th>Días / objetivo</th><th /></tr></thead>
              <tbody>{actuales.map((a) => (
                <tr key={a.id} onClick={() => abrirPedido(a.id)} className="cl">
                  <td><b>{a.codigo}</b><small>{a.empresa} · {a.zona}</small></td><td>{a.cliente}</td><td>{a.asesor || '—'}</td>
                  <td><span className={'dp-pill ' + (a.atrasado ? 'mal' : 'ok')}>{a.atrasado ? <AlertTriangle /> : <CheckCircle2 />}{n1(a.dias)} / {n1(a.objetivo)} d{a.atrasado ? ' · atrasado' : ''}</span>{a.errores > 0 && <span className="dp-err"><XCircle />{a.errores}</span>}</td>
                  <td><ExternalLink className="dp-ir" /></td>
                </tr>))}</tbody></table></div>)}
        </div>
        <div>
          <h4>Errores del período en esta etapa ({errores.length})</h4>
          {!errores.length ? <p className="dp-vacio">Sin errores registrados en el período.</p> : (
            <ul className="dp-errores">{errores.map((x) => (
              <li key={x.id}><button type="button" onClick={() => abrirPedido(x.pedidoId)}><b>{x.titulo}</b>{x.detalle ? ' · ' + x.detalle : ''}<small>{x.codigo} · {x.cliente} · {fH(x.fecha)}{x.area ? ' · ' + x.area : ''}</small></button></li>))}</ul>)}
        </div>
      </div>
    </article>
  )
}

function TablaEtapas({ etapas }: { etapas: Etapa[] }) {
  return (
    <div className="dp-tw"><table>
      <thead><tr><th>Etapa</th><th>Área</th><th>Ahora</th><th>Atrasados</th><th>Pasaron</th><th>Promedio</th><th>Mediana</th><th>Máximo</th><th>Objetivo</th><th>A tiempo</th><th>Errores</th><th>Estado</th></tr></thead>
      <tbody>{etapas.map((e) => { const est = ESTADO[estadoDe(e)]; return (
        <tr key={e.clave}><td><b>{e.nombre}</b></td><td>{e.area}</td><td>{e.ahora}</td><td>{e.atrasados}</td><td>{e.pasaron}</td><td>{dd(e.promedio)}</td><td>{dd(e.mediana)}</td><td>{dd(e.maximo)}</td>
          <td>{objTxt(e)}</td><td>{e.aTiempo == null ? '—' : e.aTiempo + '%'}</td><td>{e.errores}</td><td><span className="dp-est"><est.I style={{ color: est.c }} />{est.t}</span></td></tr>) })}</tbody>
    </table></div>
  )
}
