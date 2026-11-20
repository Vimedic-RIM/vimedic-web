import { useCallback, useEffect, useRef, useState } from 'react'
import { BadgeCheck, BookOpen, ExternalLink, FileText, Film, Package, Pencil, RefreshCw, Search, Stamp, X, type LucideIcon } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { imagen } from './inventarioUtil'
import '../estilos/doctec.css'

/* Documentos técnicos: avance por producto (ficha técnica, manual, certificado, registro sanitario) con acceso a cada
   documento. Primero los prioritarios: visibles en el catálogo o importados. Calculado en la base (dt_avance). */
type Doc = { id: string; tipo: string; nombre: string; url: string | null; notas: string | null; vence: string | null; version: string | null; fecha: string }
type Fila = {
  id: string; codigo: string | null; codigo_unico: string | null; nombre: string; imagen_url: string | null; categoria: string | null
  catalogo: boolean; importado: boolean; prioridad: boolean; ficha: string | null; hoja: number; manual: number; cert: number; reg: number; otro: number; n: number; cumple: number; lista: Doc[]
}
type Resumen = {
  productos: number; completos: number; con_docs: number; prioritarios: number; prio_completos: number; prio_sin: number; prio_cumple: number
  catalogo: number; importados: number; documentos: number; falta_ficha: number; falta_manual: number; falta_cert: number; falta_reg: number
}
type Req = 'ficha' | 'manual' | 'cert' | 'reg' | 'otro'
const REQ: { k: Req; t: string; tipos: string[]; ic: LucideIcon }[] = [
  { k: 'ficha', t: 'Ficha técnica', tipos: ['Hoja de datos del fabricante'], ic: FileText },
  { k: 'manual', t: 'Manual', tipos: ['Manual de usuario', 'Manual de servicio'], ic: BookOpen },
  { k: 'cert', t: 'Certificado', tipos: ['Certificado'], ic: BadgeCheck },
  { k: 'reg', t: 'Registro sanitario', tipos: ['Registro sanitario'], ic: Stamp },
  { k: 'otro', t: 'Videos y otros', tipos: ['Otro'], ic: Film },
]
const TIPOS = ['Manual de usuario', 'Manual de servicio', 'Hoja de datos del fabricante', 'Certificado', 'Registro sanitario', 'Otro']
const FILTROS: [string, string][] = [['', 'Todos'], ['prioritarios', 'Prioritarios'], ['incompletos', 'Incompletos'], ['sin', 'Sin documentos'], ['completos', 'Completos'], ['catalogo', 'En catálogo'], ['importados', 'Importados']]
const POR_PAGINA = 25
const num = (n: number) => (Number(n) || 0).toLocaleString('es-EC')
const cuenta = (f: Fila, k: Req) => (k === 'ficha' ? f.hoja + (f.ficha ? 1 : 0) : f[k])

export default function DocTecnicos({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [total, setTotal] = useState(0)
  const [res, setRes] = useState<Resumen | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [qDeb, setQDeb] = useState('')
  const [filtro, setFiltro] = useState('')
  const [orden, setOrden] = useState('')
  const [pagina, setPagina] = useState(1)
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState<{ id: string; req?: Req } | null>(null)
  const peticion = useRef(0)
  const editar = ['documentos_tecnicos', 'servicio_tecnico', 'marketing'].some((m) => puede(perfil, m, 'editar'))

  useEffect(() => { const t = setTimeout(() => { setQDeb(q); setPagina(1) }, 250); return () => clearTimeout(t) }, [q])
  const cargar = useCallback(async () => {
    const n = ++peticion.current
    setCargando(true)
    const { data, error } = await supabase.rpc('dt_avance', { p_q: qDeb.trim(), p_filtro: filtro, p_orden: orden, p_desde: (pagina - 1) * POR_PAGINA, p_limite: POR_PAGINA })
    if (n !== peticion.current) return
    setCargando(false)
    if (error) { setError(error.message); return }
    const d = data as { total: number; filas: Fila[]; resumen: Resumen }
    setError(''); setFilas(d.filas ?? []); setTotal(d.total ?? 0); setRes(d.resumen ?? null)
  }, [qDeb, filtro, orden, pagina])
  useEffect(() => { cargar() }, [cargar])

  const totPag = Math.max(1, Math.ceil(total / POR_PAGINA))
  const nums: (number | '…')[] = []
  for (let i = 1; i <= totPag; i++) { if (i === 1 || i === totPag || Math.abs(i - pagina) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…') }
  const avancePrio = res && res.prioritarios ? Math.round((res.prio_cumple / (res.prioritarios * 4)) * 100) : 0
  const elegir = (f: string) => { setFiltro(f); setPagina(1) }
  const fila = abierto ? filas?.find((f) => f.id === abierto.id) ?? null : null

  return (
    <div className="vm-dt">
      <header className="hdr text-white">
        <div className="w-full px-4 lg:px-6 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><FileText style={{ width: 20, height: 20 }} /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Documentos técnicos</h1><p className="text-[11px] text-white/70">Avance por producto · primero los visibles en catálogo e importados · {perfil.nombre}</p></div>
          <div className="ml-auto"><button className="btn btn-g" onClick={cargar} title="Actualizar"><RefreshCw className={cargando ? 'animate-spin' : ''} />Actualizar</button></div>
        </div>
      </header>
      <main className="w-full px-4 lg:px-6 py-4">
        <div className="dt-kpis">
          <button className={'dt-kpi prin' + (filtro === 'prioritarios' ? ' on' : '')} onClick={() => elegir(filtro === 'prioritarios' ? '' : 'prioritarios')}>
            <span>Avance de prioritarios</span><b>{res ? avancePrio + '%' : '—'}</b>
            <i className="dt-bar"><i style={{ width: avancePrio + '%' }} /></i>
            <small>{res ? `${num(res.prioritarios)} productos: ${num(res.catalogo)} en catálogo · ${num(res.importados)} importados` : ''}</small>
          </button>
          <button className={'dt-kpi' + (filtro === 'completos' ? ' on' : '')} onClick={() => elegir(filtro === 'completos' ? '' : 'completos')}><span>Prioritarios completos</span><b>{res ? num(res.prio_completos) : '—'}</b><small>{res ? `de ${num(res.prioritarios)} · los 4 requisitos` : ''}</small></button>
          <button className={'dt-kpi rojo' + (filtro === 'sin' ? ' on' : '')} onClick={() => elegir(filtro === 'sin' ? '' : 'sin')}><span>Prioritarios sin documentos</span><b>{res ? num(res.prio_sin) : '—'}</b><small>ningún documento cargado</small></button>
          <div className="dt-kpi falta"><span>Les falta (prioritarios)</span>
            <div className="dt-faltan">{res && ([['Ficha', res.falta_ficha], ['Manual', res.falta_manual], ['Certificado', res.falta_cert], ['Registro', res.falta_reg]] as [string, number][]).map(([t, n]) => <p key={t}><b>{num(n)}</b>{t}</p>)}</div>
          </div>
          <div className="dt-kpi"><span>Documentos cargados</span><b>{res ? num(res.documentos) : '—'}</b><small>{res ? `${num(res.con_docs)} de ${num(res.productos)} productos con algún documento` : ''}</small></div>
        </div>

        <div className="dt-barra">
          <div className="relative flex-1 min-w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp w-full" style={{ paddingLeft: 36 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto, código o categoría…" /></div>
          <div className="seg">{FILTROS.map(([k, t]) => <button key={k} className={filtro === k ? 'on' : ''} onClick={() => elegir(k)}>{t}</button>)}</div>
          <select className="inp" value={orden} onChange={(e) => { setOrden(e.target.value); setPagina(1) }} aria-label="Orden">
            <option value="">Prioridad y lo que más falta</option><option value="avance">Más avanzados primero</option><option value="nombre">Nombre</option>
          </select>
        </div>

        <div className="dt-tabla">
          <div className="overflow-auto">
            <table className="t">
              <thead><tr><th>Producto</th>{REQ.map((r) => <th key={r.k} className="text-center">{r.t}</th>)}<th>Avance</th></tr></thead>
              <tbody>
                {error && <tr><td colSpan={7} className="text-center py-10 text-red-600 font-semibold">{error}</td></tr>}
                {!error && filas === null && <tr><td colSpan={7} className="text-center py-10 text-slate-400"><span className="spin" /> Cargando…</td></tr>}
                {filas && !filas.length && <tr><td colSpan={7} className="text-center py-10 text-slate-400">Ningún producto con estos filtros.</td></tr>}
                {filas?.map((f) => (
                  <tr key={f.id} className={f.prioridad ? 'prio' : ''} onClick={() => setAbierto({ id: f.id })} title="Ver todos los documentos">
                    <td className="dt-prod">
                      <span className="th">{f.imagen_url ? <img loading="lazy" alt="" src={imagen(f.imagen_url, 80)} onError={(e) => e.currentTarget.remove()} /> : <Package />}</span>
                      <span className="min-w-0">
                        <b>{f.nombre}</b>
                        <small><span className="mono">{f.codigo || '—'}</span>{f.codigo_unico ? <> · interno <span className="mono">{f.codigo_unico}</span></> : null}</small>
                        <span className="dt-tags">{f.catalogo && <em className="cat">Catálogo</em>}{f.importado && <em className="imp">Importado</em>}{f.categoria && <em>{f.categoria}</em>}</span>
                      </span>
                    </td>
                    {REQ.map((r) => {
                      const n = cuenta(f, r.k)
                      return (
                        <td key={r.k} className="text-center">
                          {n > 0
                            ? <button type="button" className="dt-ok" onClick={(e) => { e.stopPropagation(); setAbierto({ id: f.id, req: r.k }) }} title={'Ver ' + r.t.toLowerCase()}>✓ {n}</button>
                            : r.k === 'otro' ? <span className="text-slate-300">—</span> : <span className={'dt-falta' + (f.prioridad ? ' prio' : '')}>Falta</span>}
                        </td>
                      )
                    })}
                    <td className="dt-av"><i className="dt-bar"><i style={{ width: (f.cumple / 4) * 100 + '%', background: f.cumple === 4 ? '#04896f' : f.cumple >= 2 ? '#17a9ba' : '#f59e0b' }} /></i><small>{f.cumple} de 4</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dt-pie">
            <span>{total ? `${num((pagina - 1) * POR_PAGINA + 1)}–${num((pagina - 1) * POR_PAGINA + (filas?.length ?? 0))} de ${num(total)} productos` : ''}</span>
            {totPag > 1 && <div className="pg ml-auto"><button disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} aria-label="Página anterior">‹</button>{nums.map((x, i) => (x === '…' ? <span key={'g' + i}>…</span> : <button key={x} className={x === pagina ? 'on' : ''} onClick={() => setPagina(x)}>{x}</button>))}<button disabled={pagina >= totPag} onClick={() => setPagina(pagina + 1)} aria-label="Página siguiente">›</button></div>}
          </div>
        </div>
        <p className="dt-nota">Completo = 4 requisitos: ficha técnica (la de la app o la del fabricante), manual (de usuario o de servicio), certificado y registro sanitario. Los videos y otros archivos no cuentan para el avance.</p>
      </main>
      {fila && <Panel f={fila} req={abierto?.req} editar={editar} cerrar={() => setAbierto(null)} aviso={aviso} guardado={cargar} />}
    </div>
  )
}

/* Panel del producto: todos sus documentos por requisito, con acceso y edición de tipo, nombre y observaciones. */
function Panel({ f, req, editar, cerrar, aviso, guardado }: { f: Fila; req?: Req; editar: boolean; cerrar: () => void; aviso: (t: string) => void; guardado: () => Promise<void> }) {
  const [ed, setEd] = useState<{ id: string; tipo: string; nombre: string; notas: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  useEffect(() => { if (req) ref.current?.querySelector('#dt-sec-' + req)?.scrollIntoView({ block: 'start' }) }, [req])
  async function guardar() {
    if (!ed) return
    if (!ed.nombre.trim()) { aviso('Escribe el nombre del documento.'); return }
    setGuardando(true)
    const { error } = await supabase.from('documentos_tecnicos').update({ tipo: ed.tipo, nombre: ed.nombre.trim().slice(0, 300), notas: ed.notas.trim() || null }).eq('id', ed.id)
    setGuardando(false)
    if (error) { aviso(error.message); return }
    aviso('Documento actualizado'); setEd(null); await guardado()
  }
  return (
    <>
      <div className="dt-velo" onClick={cerrar} />
      <aside className="dt-panel" ref={ref}>
        <div className="dt-panel-h">
          <span className="th th-lg">{f.imagen_url ? <img loading="lazy" decoding="async" alt="" src={imagen(f.imagen_url, 160)} onError={(e) => e.currentTarget.remove()} /> : <Package />}</span>
          <div className="min-w-0 flex-1"><p className="font-display font-bold leading-tight">{f.nombre}</p><p className="text-[11px] text-white/70 mono">{f.codigo}{f.codigo_unico ? ' · interno ' + f.codigo_unico : ''}</p><p className="text-[11px] text-white/80 mt-0.5">{f.cumple} de 4 requisitos{f.catalogo ? ' · Catálogo' : ''}{f.importado ? ' · Importado' : ''}</p></div>
          <button className="btn btn-g !px-2" onClick={cerrar} aria-label="Cerrar"><X /></button>
        </div>
        <div className="dt-panel-b">
          {REQ.map((r) => {
            const docs = f.lista.filter((d) => r.tipos.includes(d.tipo))
            const I = r.ic, falta = r.k !== 'otro' && !docs.length && !(r.k === 'ficha' && f.ficha)
            return (
              <section key={r.k} id={'dt-sec-' + r.k} className={'dt-sec' + (req === r.k ? ' on' : '')}>
                <h4><I />{r.t}{falta && <span className="dt-falta prio">Falta</span>}</h4>
                {r.k === 'ficha' && f.ficha && <a className="dt-doc" href={f.ficha} target="_blank" rel="noopener noreferrer"><span className="min-w-0 flex-1"><b>Ficha técnica de la app</b><small>Generada en Inventario</small></span><ExternalLink /></a>}
                {docs.map((d) => ed?.id === d.id ? (
                  <div key={d.id} className="dt-ed">
                    <label>Tipo<select className="inp w-full" value={ed.tipo} onChange={(e) => setEd({ ...ed, tipo: e.target.value })}>{TIPOS.map((t) => <option key={t}>{t}</option>)}</select></label>
                    <label>Nombre<input className="inp w-full" value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} /></label>
                    <label>Observaciones<textarea className="inp w-full" rows={2} value={ed.notas} onChange={(e) => setEd({ ...ed, notas: e.target.value })} placeholder="Ej. ISO 13485 vigente, versión en inglés" /></label>
                    <div className="flex gap-2 justify-end"><button className="btn" onClick={() => setEd(null)}>Cancelar</button><button className="btn btn-p" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button></div>
                  </div>
                ) : (
                  <div key={d.id} className="dt-doc">
                    <a className="min-w-0 flex-1" href={d.url || undefined} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (!d.url) e.preventDefault() }}>
                      <b>{d.nombre}</b>
                      <small>{d.tipo}{d.version ? ' · v' + d.version : ''}{d.vence ? ' · vence ' + d.vence.split('-').reverse().join('/') : ''}</small>
                      {d.notas && <small className="obs">{d.notas}</small>}
                    </a>
                    {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" title="Abrir" className="dt-ic"><ExternalLink /></a>}
                    {editar && <button type="button" className="dt-ic" title="Cambiar tipo y observaciones" onClick={() => setEd({ id: d.id, tipo: d.tipo, nombre: d.nombre, notas: d.notas ?? '' })}><Pencil /></button>}
                  </div>
                ))}
                {!docs.length && !(r.k === 'ficha' && f.ficha) && <p className="dt-vacio">{r.k === 'otro' ? 'Sin videos ni otros archivos.' : 'Todavía no hay ' + r.t.toLowerCase() + '.'}</p>}
              </section>
            )
          })}
        </div>
      </aside>
    </>
  )
}
