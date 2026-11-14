import { useMemo, useState } from 'react'
import { ImageOff, Search } from 'lucide-react'
import { imagen } from './inventarioUtil'

/* Biblioteca › "Por completar" y "Videos pendientes" (mkfPendientes del original): primero los equipos
   de la web y los más cotizados; se trabaja por partes y todo se guarda solo en el formulario. */

export type Pendiente = {
  id: string; codigo: string; nombre: string; categoria: string | null; marca: string | null; imagen: string | null; publico: boolean; web: boolean; cot: number
  nuevo: boolean; stock: number; falta: string[]; pct: number; fotos: number; videos: number; tiposVideo: Record<string, number>; faltanTipos: string[]
  enRevision: number; ficha: boolean; estado: 'sin_empezar' | 'progreso' | 'revision' | 'completo'
}
export type DatosPendientes = { productos: Pendiente[]; tiposVideo: string[]; videosCompleto: string[] }
const FALTA: Record<string, string> = { imagen: 'Imagen principal', fotos: '3 fotos', descripcion: 'Descripción', caracteristicas: 'Características', especificaciones: 'Especificaciones', video: 'Video' }
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function Etiquetas({ p }: { p: Pendiente }) {
  return <>
    {p.cot > 0 && <span className="rv-tag" style={{ background: '#fff7ed', color: '#c2410c' }}>🔥 {p.cot} cotizaci{p.cot === 1 ? 'ón' : 'ones'}</span>}
    {p.nuevo && <span className="rv-tag" style={{ background: '#fef3c7', color: '#92400e' }}>Nuevo</span>}
    {p.stock > 0 && <span className="rv-tag" style={{ background: '#eef6fd', color: '#055c9d' }}>En bodega · {p.stock}</span>}
    {p.enRevision > 0 && <span className="rv-tag rev">{p.enRevision} en revisión</span>}
  </>
}
function Fila({ p, abrir, children }: { p: Pendiente; abrir: (id: string) => void; children?: React.ReactNode }) {
  const img = imagen(p.imagen, 160)
  return (
    <button type="button" className="bib-row" onClick={() => abrir(p.id)}>
      {img ? <img src={img} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="ph"><ImageOff className="w-4 h-4" /></span>}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-mono-spec text-slate-400 truncate">{p.codigo}{p.categoria ? ' · ' + p.categoria : ''}</p>
        <p className="text-[12.5px] font-bold text-slate-800 line-clamp-2">{p.nombre}</p>
        {children}
      </div>
    </button>
  )
}

export function PorCompletar({ datos, abrir }: { datos: DatosPendientes; abrir: (id: string) => void }) {
  const [estado, setEstado] = useState('')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [falta, setFalta] = useState('')
  const [nuevos, setNuevos] = useState(false)
  const l = datos.productos
  const cats = useMemo(() => [...new Set(l.map((p) => p.categoria).filter(Boolean) as string[])].sort(), [l])
  const cuenta = (e: string) => l.filter((p) => p.estado === e).length
  const lista = useMemo(() => {
    const n = norm(q)
    return l.filter((p) => (!n || norm([p.codigo, p.nombre, p.categoria, p.marca].join(' ')).includes(n)) && (!cat || p.categoria === cat) && (!falta || p.falta.includes(falta)) && (!nuevos || p.nuevo)
      && (estado ? p.estado === estado : p.estado !== 'completo'))
  }, [l, q, cat, falta, nuevos, estado])
  const kpis: [string, string, number][] = [['', 'Por completar', l.filter((p) => p.estado !== 'completo').length], ['sin_empezar', 'Sin empezar', cuenta('sin_empezar')], ['progreso', 'En progreso', cuenta('progreso')], ['revision', 'En revisión', cuenta('revision')], ['completo', 'Completos', cuenta('completo')]]
  return (
    <>
      <div className="bib-kpis">{kpis.map(([k, t, n]) => <button key={k || 'todos'} type="button" className={'bib-kpi' + (estado === k ? ' on' : '')} onClick={() => setEstado(estado === k ? '' : k)}><b>{n}</b><span>{t}</span></button>)}</div>
      <div className="flex items-center gap-2 flex-wrap my-3">
        <div className="relative flex-1" style={{ minWidth: 200, maxWidth: 380 }}><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp pl-9 w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar equipo, código o marca…" /></div>
        <select className="inp" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas las categorías</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="inp" style={{ width: 'auto' }} value={falta} onChange={(e) => setFalta(e.target.value)}><option value="">Falta cualquier cosa</option>{Object.entries(FALTA).map(([k, v]) => <option key={k} value={k}>Sin {v.toLowerCase()}</option>)}</select>
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><input type="checkbox" checked={nuevos} onChange={(e) => setNuevos(e.target.checked)} />Solo nuevos</label>
        <span className="text-[11px] text-slate-500 ml-auto">{lista.length} equipo{lista.length === 1 ? '' : 's'} · primero los más cotizados</span>
      </div>
      {!lista.length && <div className="rv-vacio">Nada con estos filtros.</div>}
      <div className="bib-list">
        {lista.slice(0, 240).map((p, i) => (
          <div key={p.id} style={{ display: 'contents' }}>
            {!p.web && (i === 0 || lista[i - 1].web) && <p className="bib-div">Otros productos (fletes, servicios, insumos, repuestos)</p>}
            <Fila p={p} abrir={abrir}>
              <div className="flex items-center gap-2 mt-1"><div className="bib-prog flex-1"><i style={{ width: p.pct + '%' }} /></div><span className="text-[10.5px] font-bold text-slate-600">{p.pct}%</span></div>
              <div className="flex flex-wrap gap-1 mt-1"><Etiquetas p={p} />{p.falta.map((k) => <span key={k} className="rv-tag mal">Sin {(FALTA[k] || k).toLowerCase()}</span>)}{p.ficha && <span className="rv-tag ok">Ficha ✓</span>}</div>
            </Fila>
          </div>
        ))}
      </div>
      {lista.length > 240 && <p className="text-[11px] text-slate-400 text-center mt-2">Se muestran los primeros 240. Usa la búsqueda o los filtros para ver los demás.</p>}
    </>
  )
}

export function VideosPendientes({ datos, abrir }: { datos: DatosPendientes; abrir: (id: string) => void }) {
  const [fil, setFil] = useState('sin')
  const [q, setQ] = useState('')
  const l = datos.productos, tc = datos.videosCompleto
  const sin = l.filter((p) => !p.videos), incomp = l.filter((p) => p.videos && p.faltanTipos.length), comp = l.filter((p) => p.videos && !p.faltanTipos.length)
  const base = fil === 'sin' ? sin : fil === 'incompleto' ? incomp : fil === 'completo' ? comp : l
  const n = norm(q), lista = n ? base.filter((p) => norm([p.codigo, p.nombre, p.categoria, p.marca].join(' ')).includes(n)) : base
  const total = l.reduce((a, p) => a + p.videos, 0)
  const kpis: [string, string, number][] = [['sin', 'Sin ningún video', sin.length], ['incompleto', 'Les falta algún tipo', incomp.length], ['completo', `Con los ${tc.length} tipos`, comp.length], ['todos', 'Videos publicados', total]]
  return (
    <>
      <div className="bib-kpis">{kpis.map(([k, t, v]) => <button key={k} type="button" className={'bib-kpi' + (fil === k ? ' on' : '')} onClick={() => setFil(k)}><b>{v}</b><span>{t}</span></button>)}</div>
      <div className="flex items-center gap-2 flex-wrap my-3">
        <div className="relative flex-1" style={{ minWidth: 200, maxWidth: 380 }}><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp pl-9 w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar equipo, código o marca…" /></div>
        <span className="text-[11px] text-slate-500 ml-auto">Tipos clave: {tc.join(', ')} · ordenados por cotizaciones</span>
      </div>
      {!lista.length && <div className="rv-vacio">Nada en este grupo.</div>}
      <div className="bib-list">
        {lista.slice(0, 240).map((p) => (
          <Fila key={p.id} p={p} abrir={abrir}>
            <div className="flex flex-wrap gap-1 mt-1"><Etiquetas p={p} />
              {Object.entries(p.tiposVideo).map(([t, c]) => <span key={t} className="rv-tag ok">▶ {c} {t.toLowerCase()}</span>)}
              {p.faltanTipos.map((t) => <span key={t} className="rv-tag mal">Falta {t.toLowerCase()}</span>)}
            </div>
          </Fila>
        ))}
      </div>
    </>
  )
}
