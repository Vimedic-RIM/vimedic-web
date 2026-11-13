import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, BadgePercent, Check, FileDown, FolderUp, Megaphone, Package, Plus, Search, Send, Sparkles, Trash2, Users, X, XCircle } from 'lucide-react'
import { InversionAnuncios } from './MarketingAnuncios'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { imagen as imgUrl } from './Inventario'
import { armarProductos, CFG_DEF, ChipsStockProceso, GRUPOS, meses, useEstadoStock, type EstadoStock, type Prod } from './Ofertas'
import '../estilos/ofertas.css'

const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
async function aDataUrl(url: string): Promise<string> { try { const b = await (await fetch(url)).blob(); if (b.size > 4 * 1048576) return ''; return await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(''); r.readAsDataURL(b) }) } catch { return '' } }
const txtPdf = (v: unknown) => String(v ?? '').replace(/[\u{1F000}-\u{1FFFF}☀-➿️‍]/gu, '').replace(/[^\x20-\x7E -ÿ\n]/g, ' ').replace(/ +/g, ' ').trim()

const normalize = (v: unknown) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
function Ventana({ titulo, cerrar, children, pie, ancha }: { titulo: string; cerrar: () => void; children: React.ReactNode; pie: React.ReactNode; ancha?: boolean }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className={'bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden ' + (ancha ? 'sm:max-w-4xl' : 'sm:max-w-xl')}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">{children}</div>
        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 items-center flex-wrap">{pie}</div>
      </div>
    </div>
  )
}
const fecha = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

/* ============================ Anuncios ============================ */
export function Anuncios({ perfil, desde, hasta, aviso }: { perfil: Perfil; desde: string; hasta: string; aviso: (t: string) => void }) {
  const [leads, setLeads] = useState<{ anuncio: string; medio: string }[] | null>(null)
  const [activos, setActivos] = useState<{ id: string; nombre: string }[]>([])
  const [nuevo, setNuevo] = useState('')
  const [error, setError] = useState('')
  const editar = puede(perfil, 'marketing', 'editar')
  const cargar = useCallback(async () => {
    const [l, a] = await Promise.all([
      supabase.from('leads').select('anuncio,medio_captacion').is('deleted_at', null).gte('fecha', desde + 'T00:00:00-05:00').lte('fecha', hasta + 'T23:59:59-05:00').not('anuncio', 'is', null).limit(5000),
      supabase.from('anuncios_activos').select('id,nombre').is('deleted_at', null).order('nombre'),
    ])
    if (l.error || a.error) { setError((l.error || a.error)!.message); return }
    setError(''); setLeads(((l.data ?? []) as { anuncio: string; medio_captacion: string | null }[]).filter((x) => x.anuncio?.trim()).map((x) => ({ anuncio: x.anuncio.trim(), medio: x.medio_captacion ?? '' })))
    setActivos((a.data ?? []) as { id: string; nombre: string }[])
  }, [desde, hasta])
  useEffect(() => { cargar() }, [cargar])
  const filas = useMemo(() => {
    const m: Record<string, number> = {}; (leads ?? []).forEach((x) => { m[x.anuncio] = (m[x.anuncio] || 0) + 1 })
    activos.forEach((a) => { if (!(a.nombre in m)) m[a.nombre] = 0 })
    const tot = Object.values(m).reduce((s, n) => s + n, 0) || 1
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ nombre: n, leads: c, pct: Math.round((c / tot) * 100), activo: activos.find((a) => normalize(a.nombre) === normalize(n)) ?? null }))
  }, [leads, activos])
  async function activar(n: string) {
    const nombre = n.trim(); if (!nombre) return
    const { error } = await supabase.from('anuncios_activos').insert({ id: crypto.randomUUID(), nombre })
    if (error) aviso('No se pudo guardar: ' + error.message); else { setNuevo(''); cargar() }
  }
  async function desactivar(id: string) {
    const { error } = await supabase.from('anuncios_activos').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) aviso('No se pudo quitar: ' + error.message); else cargar()
  }
  return (
    <section className="space-y-4">
      <div className="card p-4 text-xs text-slate-600 flex gap-3 items-start"><Megaphone className="w-4 h-4 mt-0.5 shrink-0 text-[var(--violet)]" />
        <p>Inversión y resultados de cada anuncio (Zernio Ads) frente a los leads y ventas del CRM en el período elegido. Abajo, marca como <b>activos</b> los anuncios que están corriendo para que los asesores los elijan al registrar un lead.</p></div>
      <InversionAnuncios desde={desde} hasta={hasta} />
      {error && <p className="text-xs rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800">{error}</p>}
      {editar && <div className="flex gap-2"><input className="inp flex-1 max-w-sm" placeholder="Nombre del anuncio o campaña activa" value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') activar(nuevo) }} /><button className="btn btn-primary" onClick={() => activar(nuevo)}><Plus />Agregar activo</button></div>}
      <div className="card overflow-hidden">
        {!leads && <p className="p-6 text-center text-xs text-slate-400">Cargando…</p>}
        {leads && !filas.length && <p className="p-8 text-center text-sm text-slate-400">No hay leads con anuncio en este período.</p>}
        {filas.length > 0 && <table className="tbl"><thead><tr><th>Anuncio / campaña</th><th>Estado</th><th className="num">Leads</th><th className="num">% del total</th><th /></tr></thead><tbody>{filas.map((f) => (
          <tr key={f.nombre}><td><b className="text-slate-700">{f.nombre}</b></td>
            <td><span className="pill" style={f.activo ? { background: '#ecfaf5', color: '#04896f' } : { background: '#f1f5f9', color: '#64748b' }}>{f.activo ? 'Activo' : 'No marcado'}</span></td>
            <td className="num font-semibold">{f.leads}</td><td className="num text-slate-500">{f.pct}%</td>
            <td className="text-right">{editar && (f.activo ? <button className="btn" onClick={() => desactivar(f.activo!.id)}>Pausar</button> : <button className="btn" onClick={() => activar(f.nombre)}>Marcar activo</button>)}</td></tr>))}</tbody></table>}
      </div>
    </section>
  )
}

/* ============================ Material de proveedores (MaterialProveedores.gs) ============================ */
type Item = { clave: string; codigo?: string; nombre?: string; modelo?: string; codInterno?: string; marca?: string; imagen?: string; nota?: string; abierto?: boolean; pide?: Record<string, number> }
type Sol = { id: string; codigo: string | null; token: string | null; titulo: string; estado: string; vence: string | null; proveedor_texto: string | null; nota: string | null; productos: Item[] }
type Arch = { id: string; solicitud_id: string; clave: string | null; tipo: string | null; nombre: string | null; url: string | null; fecha: string; origen: string | null }
type Nuevo = { clave: string; codigo: string; nombre: string; modelo: string; codInterno: string; marca: string; proveedor: string; importacion: string; imagen: string; identificado: boolean }
const PIDE: Record<string, string> = { ficha: 'Ficha técnica', manual: 'Manual', cert: 'Certificados', video: 'Video', foto: 'Fotos', otro: 'Otros' }
const PIDE_K = ['ficha', 'manual', 'cert', 'video']
const enlaceMaterial = (token: string | null) => (token ? window.location.origin + '/material/?c=' + token : '')
const hoyMas = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)

/** Lista en PDF para enviar al proveedor: foto, modelo, código interno y lo que se pide (vmMatPdf). */
async function pdfSolicitud(s: Sol) {
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const fotos = await Promise.all(s.productos.slice(0, 60).map((p) => (p.imagen ? aDataUrl(imgUrl(p.imagen, 200)) : Promise.resolve(''))))
  const tipos: [string, string, string, string][] = [['ficha', 'Ficha técnica', 'Datasheet', '技术规格书'], ['manual', 'Manual', 'User manual', '使用手册'], ['cert', 'Certificaciones', 'Certificates (CE, ISO, FDA…)', '认证证书'], ['video', 'Videos', 'Videos', '产品视频']]
  const filas = s.productos.map((p, i) => `<tr><td style="width:18px;text-align:center;color:#8a95b3">${i + 1}</td><td style="width:58px;text-align:center">${fotos[i] ? `<img src="${fotos[i]}" style="width:54px;height:54px;object-fit:contain">` : ''}</td>
    <td>${p.modelo ? `<div style="font-size:13px;font-weight:bold;color:#055c9d">Model / 型号: ${esc(p.modelo)}</div>` : ''}${p.codInterno ? `<div style="font-size:11px;font-weight:bold">Code / 编码: ${esc(p.codInterno)}</div>` : ''}<div>${esc(p.nombre || p.modelo || p.clave)}</div><div style="color:#56607e;font-size:9.5px">${p.codigo ? 'VIMEDIC: ' + esc(p.codigo) : ''}${p.marca ? ' · ' + esc(p.marca) : ''}</div>${p.nota ? `<div style="color:#56607e;font-size:9.5px">${esc(p.nota)}</div>` : ''}${p.abierto === false ? '<div style="color:#a3341f;font-size:9.5px;font-weight:bold">Cerrado / Closed</div>' : ''}</td>
    ${tipos.map(([k]) => `<td style="width:70px;text-align:center;font-size:16px">${p.pide?.[k] ? '☐' : '—'}</td>`).join('')}</tr>`).join('')
  const html = `<div style="font-family:Arial,sans-serif;color:#1d2344;font-size:10.5px">
    <div style="background:#1d2344;color:#fff;padding:12px 16px;border-radius:10px"><div style="font-size:18px;font-weight:bold">VIMEDIC · Solicitud de material de productos</div><div style="color:#cfd6ea;font-size:11px;margin-top:3px">Product documentation request · 产品资料需求 · ${esc(s.codigo)}${s.proveedor_texto ? ' · ' + esc(s.proveedor_texto) : ''}</div></div>
    <div style="margin:10px 0;padding:9px 12px;border:1px solid #cfd6e4;border-radius:8px;background:#f5f8fc;font-size:11px">Suba los archivos en este enlace / Upload the files at this link / 请通过以下链接上传文件:<br><b style="color:#055c9d">${esc(enlaceMaterial(s.token))}</b><br>Válido hasta / Valid until / 有效期至: <b>${esc((s.vence ?? '').slice(0, 10) || '—')}</b>${s.nota ? '<br>' + esc(s.nota) : ''}</div>
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="5"><thead><tr style="background:#eef3f9;font-size:9px"><th>#</th><th>Foto</th><th>Producto / Product / 产品</th>${tipos.map(([, a, b, c]) => `<th>${a}<br><span style="font-weight:normal">${b}<br>${c}</span></th>`).join('')}</tr></thead><tbody>${filas}</tbody></table>
    <p style="color:#8a95b3;font-size:9px;margin-top:8px">☐ = se solicita / requested / 需要 · — = no se solicita / not requested / 不需要 · Generado ${new Date().toLocaleString('es-EC')}</p></div>`
  const html2pdf = (await import('html2pdf.js')).default
  const caja = document.createElement('div'); caja.style.cssText = 'position:fixed;left:-10000px;top:0;width:270mm;background:#fff'; caja.innerHTML = html; document.body.appendChild(caja)
  try { await html2pdf().set({ margin: 8, filename: 'Solicitud-material-' + (s.codigo || '') + (s.proveedor_texto ? '-' + s.proveedor_texto.replace(/[^\w]+/g, '-').slice(0, 40) : '') + '.pdf', image: { type: 'jpeg', quality: 0.92 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } }).from(caja).save() }
  finally { caja.remove() }
}

export function Material({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [sols, setSols] = useState<Sol[] | null>(null)
  const [arch, setArch] = useState<Arch[]>([])
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<Sol | null>(null)
  const [nueva, setNueva] = useState(false)
  const editar = puede(perfil, 'marketing', 'editar')
  const cargar = useCallback(async () => {
    const [s, a] = await Promise.all([
      supabase.from('material_solicitudes').select('id,codigo,token,titulo,estado,vence,proveedor_texto,nota,productos').is('deleted_at', null).order('created_at', { ascending: false }).limit(200),
      supabase.from('material_archivos').select('id,solicitud_id,clave,tipo,nombre,url,fecha,origen').is('deleted_at', null).order('fecha', { ascending: false }).limit(2000),
    ])
    if (s.error || a.error) { setError((s.error || a.error)!.message); return null }
    const l = (s.data as unknown as Sol[]) ?? []
    setError(''); setSols(l); setArch((a.data as Arch[]) ?? [])
    return l
  }, [])
  useEffect(() => { cargar() }, [cargar])
  // Cambios de la solicitud abierta (vmMatActualizar): estado, vencimiento, productos abiertos/cerrados, qué se pide, agregar o quitar
  async function cambiar(s: Sol, c: Record<string, unknown>, ok?: string) {
    const { error } = await supabase.rpc('material_actualizar', { p_id: s.id, c })
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    if (ok) aviso(ok)
    const l = await cargar(); const x = l?.find((y) => y.id === s.id); if (x) setAbierta(x)
  }
  const hoy = new Date().toISOString().slice(0, 10)
  if (error) return <div className="card p-6 text-sm text-amber-800 bg-amber-50 border-amber-200">{error}</div>
  if (!sols) return <p className="text-xs text-slate-400">Cargando…</p>
  return (
    <section>
      <div className="card p-4 text-xs text-slate-600 flex gap-3 items-start mb-4"><FolderUp className="w-4 h-4 mt-0.5 shrink-0 text-[var(--primary)]" />
        <p style={{ flex: 1 }}>Pide a un proveedor fichas técnicas, manuales, certificaciones y videos de sus productos. Cada solicitud tiene un <b>enlace temporal</b> donde el proveedor sube los archivos sin crear una cuenta; se descarga en PDF para enviarla. Los archivos llegan a Google Drive y aparecen aquí.</p>
        {editar && <button className="btn btn-primary" onClick={() => setNueva(true)}><Plus />Nueva solicitud</button>}</div>
      {!sols.length && <div className="card p-10 text-center text-sm text-slate-400">Todavía no hay solicitudes.</div>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sols.map((s) => {
          const mias = arch.filter((a) => a.solicitud_id === s.id), vencida = s.vence && s.vence.slice(0, 10) < hoy && s.estado === 'Abierta'
          return (
            <article key={s.id} className="card p-4 cursor-pointer hover:shadow-md" onClick={() => setAbierta(s)}>
              <div className="flex items-center gap-2 flex-wrap"><span className="font-mono-spec text-[11px] text-slate-400">{s.codigo}</span>
                <span className="pill" style={s.estado === 'Abierta' ? (vencida ? { background: '#fdecea', color: '#c0392b' } : { background: '#eff6ff', color: '#055c9d' }) : { background: '#ecfaf5', color: '#04896f' }}>{vencida ? 'Vencida' : s.estado}</span>
                <span className="text-[10px] text-slate-400 ml-auto">vence {fecha(s.vence)}</span></div>
              <p className="text-sm font-bold text-slate-800 mt-1.5 line-clamp-2">{s.titulo}</p>
              <p className="text-[11px] text-slate-500 mt-1">{(s.productos ?? []).length} producto{(s.productos ?? []).length === 1 ? '' : 's'} · {mias.length} archivo{mias.length === 1 ? '' : 's'} recibido{mias.length === 1 ? '' : 's'}</p>
            </article>
          )
        })}
      </div>
      {abierta && <DetalleSolicitud s={abierta} arch={arch.filter((a) => a.solicitud_id === abierta.id)} editar={editar} cerrar={() => setAbierta(null)} cambiar={cambiar} aviso={aviso} />}
      {nueva && <NuevaSolicitud cerrar={() => setNueva(false)} aviso={aviso} creada={async (id) => { setNueva(false); const l = await cargar(); const x = l?.find((y) => y.id === id); if (x) setAbierta(x) }} />}
    </section>
  )
}

function DetalleSolicitud({ s, arch, editar, cerrar, cambiar, aviso }: { s: Sol; arch: Arch[]; editar: boolean; cerrar: () => void; cambiar: (s: Sol, c: Record<string, unknown>, ok?: string) => Promise<void>; aviso: (t: string) => void }) {
  const [agregar, setAgregar] = useState(false)
  const [pdf, setPdf] = useState(false)
  const link = enlaceMaterial(s.token)
  return (
    <Ventana titulo={s.titulo} cerrar={cerrar} ancha pie={<>
      <button className="btn" disabled={pdf} onClick={async () => { setPdf(true); try { await pdfSolicitud(s) } catch (e) { aviso('No se pudo generar el PDF: ' + (e as Error).message) } setPdf(false) }}><FileDown />{pdf ? 'Generando…' : 'Descargar PDF'}</button>
      <span style={{ flex: 1 }} />
      {editar && (s.estado === 'Abierta' ? <button className="btn btn-primary" onClick={() => cambiar(s, { estado: 'Cerrada' }, 'Solicitud cerrada: el enlace deja de funcionar.')}><Check />Cerrar solicitud</button> : <button className="btn" onClick={() => cambiar(s, { estado: 'Abierta' }, 'Solicitud reabierta.')}>Reabrir</button>)}</>}>
      <p className="text-[11px] text-slate-500">{s.codigo} · {s.proveedor_texto || 'Proveedor'} · vence {fecha(s.vence)}</p>
      {link && <div className="rounded-xl border border-slate-200 p-3 text-xs" style={{ background: '#f8fafc' }}>
        <p className="font-bold text-slate-700 mb-1">Enlace para el proveedor</p>
        <div className="flex gap-2 items-center flex-wrap"><code className="text-[11px] break-all" style={{ flex: 1 }}>{link}</code>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(link).then(() => aviso('Enlace copiado'), () => aviso(link))}>Copiar</button>
          <a className="btn" href={link} target="_blank" rel="noopener noreferrer">Abrir</a></div>
        {editar && <label className="flex items-center gap-2 mt-2">Vence<input type="date" className="inp" style={{ width: 'auto' }} defaultValue={(s.vence ?? '').slice(0, 10)} onBlur={(e) => { if (e.target.value && e.target.value !== (s.vence ?? '').slice(0, 10)) cambiar(s, { vence: e.target.value }, 'Vencimiento actualizado') }} /></label>}
      </div>}
      {s.nota && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5">{s.nota}</p>}
      <div className="space-y-2">{(s.productos ?? []).map((p) => {
        const recibidos = arch.filter((a) => a.clave === p.clave), cerrado = p.abierto === false
        return (
          <div key={p.clave} className="rounded-xl border border-slate-200 p-3" style={cerrado ? { opacity: 0.7 } : undefined}>
            <div className="flex gap-2 items-start">
              {p.imagen ? <img src={imgUrl(p.imagen, 96)} alt="" className="w-10 h-10 rounded-lg object-contain bg-slate-50" /> : null}
              <div style={{ flex: 1, minWidth: 0 }}><p className="text-xs font-bold text-slate-800">{p.nombre || p.codigo || p.clave}</p>
                <p className="text-[11px] text-slate-500">{[p.codigo, p.modelo ? 'Modelo ' + p.modelo : '', p.codInterno ? 'Código interno ' + p.codInterno : '', p.marca].filter(Boolean).join(' · ')}</p></div>
              {editar && <><button className="btn" onClick={() => cambiar(s, { productos: [{ clave: p.clave, abierto: cerrado }] })}>{cerrado ? 'Abrir' : 'Cerrar'}</button>
                <button className="btn" aria-label="Quitar producto" onClick={() => { if (confirm('¿Quitar ' + (p.nombre || p.clave) + ' de la solicitud?')) cambiar(s, { productos: [{ clave: p.clave, quitar: true }] }) }}><Trash2 /></button></>}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">{PIDE_K.map((k) => {
              const on = !!p.pide?.[k], n = recibidos.filter((r) => r.tipo === k).length
              return <button key={k} type="button" disabled={!editar} className="pill" style={{ border: 0, cursor: editar ? 'pointer' : 'default', ...(n ? { background: '#ecfaf5', color: '#04896f' } : on ? { background: '#fff7e8', color: '#b45309' } : { background: '#f1f5f9', color: '#94a3b8' }) }}
                onClick={() => { const pide = { ...(p.pide ?? {}) }; if (on) delete pide[k]; else pide[k] = 1; if (Object.keys(pide).length) cambiar(s, { productos: [{ clave: p.clave, pide }] }) }}>{n ? '✓ ' : ''}{PIDE[k]}{n ? ' (' + n + ')' : on ? '' : ' · no se pide'}</button>
            })}{cerrado && <span className="pill" style={{ background: '#fdecea', color: '#c0392b' }}>Cerrado para el proveedor</span>}</div>
            {recibidos.length ? <div className="flex flex-wrap gap-1.5 mt-2">{recibidos.map((r) => <a key={r.id} href={r.url ?? '#'} target="_blank" rel="noopener noreferrer" className="pill" style={{ background: '#eff6ff', color: '#055c9d' }}>{PIDE[r.tipo ?? ''] ?? r.tipo} · {r.nombre}{r.origen === 'Enlace' ? ' (enlace)' : ''}</a>)}</div>
              : <p className="text-[11px] text-amber-700 mt-1.5">Aún sin archivos.</p>}
          </div>)
      })}</div>
      {editar && (agregar ? <SelectorProductos excluir={(s.productos ?? []).map((p) => p.clave)} listo={(lista) => { setAgregar(false); if (lista.length) cambiar(s, { productos: lista.map((x) => ({ agregar: x })) }, lista.length + ' producto(s) agregado(s)') }} />
        : <button className="btn" onClick={() => setAgregar(true)}><Plus />Agregar productos</button>)}
    </Ventana>
  )
}

/** Elegir productos: equipos nuevos de las importaciones o cualquiera del inventario. */
function SelectorProductos({ excluir, listo, nuevos: nuevosIni }: { excluir: string[]; listo: (l: Item[]) => void; nuevos?: Nuevo[] }) {
  const [nuevos, setNuevos] = useState<Nuevo[] | null>(nuevosIni ?? null)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ codigo: string; nombre: string; marca: string | null; imagen_url: string | null; codigo_unico: string | null; referencia_proveedor: string | null }[]>([])
  const [sel, setSel] = useState<Record<string, Item>>({})
  useEffect(() => { if (!nuevos) supabase.rpc('material_contexto').then(({ data }) => setNuevos(((data as { nuevos?: Nuevo[] } | null)?.nuevos) ?? [])) }, [nuevos])
  useEffect(() => {
    const t = q.trim().replace(/[,()%*\\"']/g, ' '); if (t.length < 2) { setRes([]); return }
    const h = setTimeout(() => {
      supabase.from('productos').select('codigo,nombre,marca,imagen_url,codigo_unico,referencia_proveedor').is('deleted_at', null).or(`nombre.ilike.%${t}%,codigo.ilike.%${t}%,codigo_unico.ilike.%${t}%`)
        .order('en_vista_publica', { ascending: false }).order('nombre').limit(30).then(({ data }) => setRes((data as never) ?? []))
    }, 250)
    return () => clearTimeout(h)
  }, [q])
  const marcar = (it: Item) => setSel((x) => { const y = { ...x }; if (y[it.clave]) delete y[it.clave]; else y[it.clave] = it; return y })
  const libres = (nuevos ?? []).filter((n) => !excluir.includes(n.clave))
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2">
      {libres.length > 0 && <><p className="text-xs font-bold text-slate-700">Equipos nuevos de las importaciones</p>
        <div className="space-y-1" style={{ maxHeight: 220, overflowY: 'auto' }}>{libres.map((n) => <label key={n.clave} className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={!!sel[n.clave]} onChange={() => marcar({ clave: n.clave, codigo: n.codigo, nombre: n.nombre, modelo: n.modelo, codInterno: n.codInterno, marca: n.marca, imagen: n.imagen })} />
          <span style={{ flex: 1, minWidth: 0 }}><b>{n.nombre || n.codigo}</b> <span className="text-slate-400">{[n.codigo, n.codInterno, n.importacion, n.proveedor].filter(Boolean).join(' · ')}</span></span></label>)}</div></>}
      <p className="text-xs font-bold text-slate-700">Buscar en el inventario</p>
      <div className="relative"><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp w-full" style={{ paddingLeft: 30 }} placeholder="Código, nombre o código interno" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {res.filter((p) => !excluir.includes(p.codigo.toUpperCase())).map((p) => <label key={p.codigo} className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={!!sel[p.codigo.toUpperCase()]} onChange={() => marcar({ clave: p.codigo.toUpperCase(), codigo: p.codigo, nombre: p.nombre, modelo: p.referencia_proveedor ?? '', codInterno: p.codigo_unico && p.codigo_unico !== p.codigo ? p.codigo_unico : '', marca: p.marca ?? '', imagen: p.imagen_url ?? '' })} />
        <span><b>{p.codigo}</b> · {p.nombre}</span></label>)}
      <div className="flex gap-2"><span className="text-[11px] text-slate-500" style={{ flex: 1 }}>{Object.keys(sel).length} elegido(s) · se pide ficha, manual, certificados y video (puedes cambiarlo después)</span>
        <button className="btn btn-primary" onClick={() => listo(Object.values(sel))}><Check />{Object.keys(sel).length ? 'Agregar' : 'Listo'}</button></div>
    </div>
  )
}

function NuevaSolicitud({ cerrar, aviso, creada }: { cerrar: () => void; aviso: (t: string) => void; creada: (id: string) => void }) {
  const [f, setF] = useState({ proveedor: '', titulo: '', vence: hoyMas(30), nota: '' })
  const [items, setItems] = useState<Item[]>([])
  const [provs, setProvs] = useState<string[]>([])
  const [eligiendo, setEligiendo] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { supabase.from('proveedores').select('nombre:razon_social').is('deleted_at', null).order('razon_social').limit(500).then(({ data }) => setProvs(((data ?? []) as { nombre: string }[]).map((x) => x.nombre))) }, [])
  return (
    <Ventana titulo="Nueva solicitud de material" cerrar={cerrar} ancha pie={<><button className="btn" onClick={cerrar}>Cancelar</button><span style={{ flex: 1 }} />
      <button className="btn btn-primary" disabled={ocupado || !items.length} onClick={async () => {
        setOcupado(true)
        const { data, error } = await supabase.rpc('material_crear', { d: { ...f, titulo: f.titulo || 'Material de productos — ' + f.proveedor, productos: items } })
        setOcupado(false)
        if (error) { aviso(error.message); return }
        aviso('Solicitud ' + (data as { codigo: string }).codigo + ' creada: copia el enlace o descarga el PDF para enviarla.'); creada((data as { id: string }).id)
      }}><Check />{ocupado ? 'Creando…' : 'Crear solicitud'}</button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-[11px] font-bold text-slate-500">Proveedor<input className="inp w-full mt-1" list="dlMatProv" value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} /><datalist id="dlMatProv">{provs.map((p) => <option key={p} value={p} />)}</datalist></label>
        <label className="block text-[11px] font-bold text-slate-500">Vence<input type="date" className="inp w-full mt-1" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} /></label>
      </div>
      <label className="block text-[11px] font-bold text-slate-500">Título<input className="inp w-full mt-1" value={f.titulo} placeholder={'Material de productos — ' + (f.proveedor || 'proveedor')} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></label>
      <label className="block text-[11px] font-bold text-slate-500">Nota para el proveedor (opcional)<textarea className="inp w-full mt-1" rows={2} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></label>
      <p className="text-xs font-bold text-slate-700">Productos ({items.length})</p>
      {items.map((it) => <div key={it.clave} className="flex items-center gap-2 text-xs rounded-lg border border-slate-200 px-2 py-1.5"><span style={{ flex: 1 }}><b>{it.nombre || it.codigo || it.clave}</b> <span className="text-slate-400">{it.codigo}</span></span><button className="btn" aria-label="Quitar" onClick={() => setItems((x) => x.filter((y) => y.clave !== it.clave))}><X /></button></div>)}
      {eligiendo ? <SelectorProductos excluir={items.map((x) => x.clave)} listo={(l) => { setItems((x) => [...x, ...l]); setEligiendo(false) }} />
        : <button className="btn" onClick={() => setEligiendo(true)}><Plus />Agregar productos</button>}
    </Ventana>
  )
}

/* ============================ Promociones ============================ */
type Hist = { fecha: string; por: string; accion: string; comentario?: string }
type ItemPromo = {
  id: string; desc?: number | null; descPropuesto?: number | null; unidades?: number | null; nota?: string; ofertaId?: string
  estadoAprobacion?: 'Pendiente' | 'Aprobado' | 'Rechazado'; descAprobado?: number; revisadoPor?: string; fechaRevision?: string; motivoRechazo?: string
}
type Camp = { id: string; codigo: string | null; nombre: string; inicio: string | null; fin: string | null; estado: string; items: ItemPromo[]; combos: unknown[]; preventa: boolean; comentario: string | null; descripcion: string | null; historial: Hist[] }
const COLOR_P: Record<string, [string, string]> = { Borrador: ['#64748b', '#f1f5f9'], 'En aprobación': ['#a16207', '#fff8eb'], Devuelta: ['#c2410c', '#fff1e6'], Aprobada: ['#04896f', '#ecfaf5'], Rechazada: ['#c0392b', '#fdecea'], Cancelada: ['#64748b', '#f1f5f9'] }

export function Promociones({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Camp[] | null>(null)
  const [error, setError] = useState('')
  const [abierta, setAbierta] = useState<Camp | null>(null)
  const [nueva, setNueva] = useState(false)
  const crear = puede(perfil, 'marketing', 'crear'), aprobar = puede(perfil, 'marketing', 'aprobar')
  const puedeEliminar = puede(perfil, 'marketing', 'eliminar') || puede(perfil, 'promociones', 'eliminar')
  const cargar = useCallback(() => {
    supabase.from('promo_campanas').select('id,codigo,nombre,inicio,fin,estado,items,combos,preventa,comentario,descripcion,historial').is('deleted_at', null).order('inicio', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setError(error.message); else { setError(''); setLista((data as unknown as Camp[]) ?? []) } })
  }, [])
  useEffect(() => { cargar() }, [cargar])
  async function mover(c: Camp, estado: string, comentario?: string) {
    if (estado === 'Aprobada') {
      // Al aprobar, cada producto con descuento pasa a Ofertas y Liquidación como oferta real
      // (validado contra el piso de margen); esto lo hace una función con privilegios propios
      // porque no siempre quien aprueba tiene permiso de ver costos.
      const { data, error } = await supabase.rpc('aprobar_campana_promocion', { p_campana_id: c.id, p_comentario: comentario ?? null })
      if (error) { aviso('No se pudo aprobar: ' + error.message); return }
      const r = data as { creadas?: number; actualizadas?: number } | null
      aviso(`Campaña aprobada: ${r?.creadas ?? 0} oferta(s) nueva(s)${r?.actualizadas ? ', ' + r.actualizadas + ' actualizada(s)' : ''} en Ofertas y Liquidación.`)
      setAbierta(null); cargar(); return
    }
    const h: Hist = { fecha: new Date().toISOString(), por: perfil.nombre, accion: estado, ...(comentario ? { comentario } : {}) }
    const cambios: Record<string, unknown> = { estado, historial: [...(c.historial ?? []), h], comentario: comentario ?? null }
    if (estado === 'En aprobación') cambios.enviado = new Date().toISOString()
    if (estado === 'Rechazada') {
      cambios.aprobado_por = perfil.id; cambios.fecha_aprobacion = new Date().toISOString()
      // Rechazo de toda la campaña: marca también cada producto pendiente, para que quede igual
      // de trazable que un rechazo uno por uno desde Ofertas y Liquidación.
      const ahora = new Date().toISOString()
      cambios.items = (c.items ?? []).map((it) => (!it.estadoAprobacion || it.estadoAprobacion === 'Pendiente')
        ? { ...it, estadoAprobacion: 'Rechazado' as const, revisadoPor: perfil.nombre, fechaRevision: ahora, motivoRechazo: comentario || 'Campaña rechazada' }
        : it)
    }
    const { error } = await supabase.from('promo_campanas').update(cambios).eq('id', c.id)
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    aviso('Campaña: ' + estado.toLowerCase() + '.'); setAbierta(null); cargar()
  }
  async function actualizarCampo(c: Camp, campos: Partial<Pick<Camp, 'nombre' | 'inicio' | 'fin' | 'items' | 'estado' | 'descripcion'>>) {
    const { error } = await supabase.from('promo_campanas').update(campos).eq('id', c.id)
    if (error) { aviso('No se pudo guardar: ' + error.message); return }
    setAbierta((a) => (a && a.id === c.id ? { ...a, ...campos } : a)); cargar()
  }
  async function eliminar(c: Camp) {
    if (!confirm(`¿Eliminar "${c.nombre}" (${c.codigo})? No se podrá deshacer desde aquí.`)) return
    const { error } = await supabase.from('promo_campanas').update({ deleted_at: new Date().toISOString() }).eq('id', c.id)
    if (error) { aviso('No se pudo eliminar: ' + error.message); return }
    aviso('Campaña eliminada.'); setAbierta(null); cargar()
  }
  if (error) return <div className="card p-6 text-sm text-amber-800 bg-amber-50 border-amber-200">{error}</div>
  if (!lista) return <p className="text-xs text-slate-400">Cargando…</p>
  // La campaña abierta ocupa toda el área de Marketing (con su barra superior y menú lateral a la vista).
  if (abierta) return <DetalleCampana c={abierta} perfil={perfil} aprobar={aprobar} editar={crear} puedeEliminar={puedeEliminar} cerrar={() => { setAbierta(null); cargar() }} mover={mover} eliminar={eliminar} actualizarCampo={actualizarCampo} />
  return (
    <section>
      <div className="flex items-center gap-2 mb-4"><p className="text-xs text-slate-500 mr-auto">{lista.length} campaña{lista.length === 1 ? '' : 's'}</p>
        {crear && <button className="btn btn-primary" onClick={() => setNueva(true)}><Plus />Nueva campaña</button>}</div>
      {!lista.length && <div className="card p-10 text-center text-sm text-slate-400">No hay campañas. Crea la primera (por ejemplo, Black Friday).</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {lista.map((c) => { const [col, bg] = COLOR_P[c.estado] ?? COLOR_P.Borrador; return (
          <article key={c.id} className="card p-4 cursor-pointer hover:shadow-md relative" onClick={() => setAbierta(c)}>
            {puedeEliminar && <button type="button" title="Eliminar campaña" className="absolute top-3 right-3 w-6 h-6 rounded-lg grid place-items-center text-slate-300 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); eliminar(c) }}><Trash2 className="w-3.5 h-3.5" /></button>}
            <div className="flex items-center gap-2 pr-7"><BadgePercent className="w-4 h-4 text-[var(--amber)]" /><span className="font-mono-spec text-[11px] text-slate-400">{c.codigo}</span><span className="pill ml-auto" style={{ background: bg, color: col }}>{c.estado}</span></div>
            <p className="text-sm font-bold text-slate-800 mt-1.5">{c.nombre}</p>
            {c.descripcion && <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{c.descripcion}</p>}
            <p className="text-[11px] text-slate-500 mt-1">{fecha(c.inicio)} → {fecha(c.fin)}{c.preventa ? ' · Preventa' : ''}</p>
            <p className="text-[11px] text-slate-400">{(c.items ?? []).length} producto{(c.items ?? []).length === 1 ? '' : 's'} · {(c.combos ?? []).length} combo{(c.combos ?? []).length === 1 ? '' : 's'}</p>
          </article>) })}
      </div>
      {nueva && <NuevaCampana perfil={perfil} cerrar={() => setNueva(false)} hecho={() => { setNueva(false); cargar(); aviso('Campaña creada.') }} aviso={aviso} />}
    </section>
  )
}

type ProdPromo = {
  id: string; codigo: string; nombre: string; categoria: string; pvp: number; costo: number | null; enCatalogo: boolean; imagen: string; desc: number; precioFinal: number; margen: number | null
  estadoAprobacion?: ItemPromo['estadoAprobacion']; descOriginal?: number; revisadoPor?: string; motivoRechazo?: string
  stock: number; dias: number; grupo: string; conObs: boolean; motivosObs: string[]; interes: number; capitalPvp: number
}
const ORDENES_PROMO: [string, string][] = [
  ['cat', 'Categoría (A-Z)'], ['costo', 'Costo (mayor a menor)'], ['desc', '% Descuento (mayor a menor)'],
  ['pvp', 'PVP (mayor a menor)'], ['margen', 'Margen (mayor a menor)'], ['nombre', 'Nombre (A-Z)'],
]

function DetalleCampana({ c, perfil, aprobar, editar, puedeEliminar, cerrar, mover, eliminar, actualizarCampo }: {
  c: Camp; perfil: Perfil; aprobar: boolean; editar: boolean; puedeEliminar: boolean; cerrar: () => void
  mover: (c: Camp, estado: string, comentario?: string) => void; eliminar: (c: Camp) => void
  actualizarCampo: (c: Camp, campos: Partial<Pick<Camp, 'nombre' | 'inicio' | 'fin' | 'items' | 'estado' | 'descripcion'>>) => Promise<void> | void
}) {
  const [com, setCom] = useState('')
  const [nombreEd, setNombreEd] = useState(c.nombre)
  const [inicioEd, setInicioEd] = useState(c.inicio ?? '')
  const [finEd, setFinEd] = useState(c.fin ?? '')
  const [descEd, setDescEd] = useState(c.descripcion ?? '')
  function guardarDescripcion() {
    const limpio = descEd.trim()
    if (limpio === (c.descripcion ?? '')) { setDescEd(limpio); return }
    actualizarCampo(c, { descripcion: limpio || null })
  }
  function guardarNombre() {
    const limpio = nombreEd.trim()
    if (!limpio || limpio === c.nombre) { setNombreEd(c.nombre); return }
    actualizarCampo(c, { nombre: limpio })
  }
  function guardarVigencia() {
    if (!inicioEd || !finEd) { setInicioEd(c.inicio ?? ''); setFinEd(c.fin ?? ''); return }
    if (finEd < inicioEd) { alert('La fecha de fin es anterior al inicio.'); setInicioEd(c.inicio ?? ''); setFinEd(c.fin ?? ''); return }
    if (inicioEd === c.inicio && finEd === c.fin) return
    actualizarCampo(c, { inicio: inicioEd, fin: finEd })
  }
  const verCostos = puede(perfil, 'promociones', 'ver_costos') || puede(perfil, 'ofertas', 'ver_costos')
  const [prods, setProds] = useState<ProdPromo[] | null>(null)
  const [analisis, setAnalisis] = useState<Prod[] | null>(null)
  const [orden, setOrden] = useState('cat')
  const [generando, setGenerando] = useState(false)
  const [vista, setVista] = useState<'productos' | 'agregar'>('productos')
  const [filtro, setFiltro] = useState('')
  const items = c.items ?? []
  useEffect(() => { window.scrollTo({ top: 0 }) }, [c.id])

  // Misma analítica de "stock dormido" que usa Oportunidades (antigüedad, interés, observaciones):
  // solo trae candidatos (dormidos o con novedades), por eso los que no aparecen ahí quedan en blanco.
  useEffect(() => {
    let vivo = true
    supabase.rpc('of_analisis').then(({ data }) => {
      if (!vivo) return
      const an = (data ?? { productos: [], estrellas: [] }) as { productos: unknown[]; estrellas: unknown[] }
      setAnalisis(armarProductos(an.productos as never[], an.estrellas as never[], CFG_DEF, {}))
    })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!items.length) { setProds([]); return }
    let vivo = true
    const codigos = items.map((i) => i.id)
    const porAnalisis = new Map((analisis ?? []).map((p) => [p.codigo, p]))
    ;(async () => {
      const { data: p, error } = await supabase.from('productos').select('id,codigo,nombre,pvp,stock,en_catalogo,imagen_url,categoria:categorias(nombre)').in('codigo', codigos).is('deleted_at', null)
      if (!vivo) return
      if (error) { setProds([]); return }
      const prodRows = (p ?? []) as unknown as { id: string; codigo: string; nombre: string; pvp: number | null; stock: number | null; en_catalogo: boolean | null; imagen_url: string | null; categoria: { nombre: string } | null }[]
      let costos: Record<string, number> = {}
      if (verCostos && prodRows.length) {
        const { data: co } = await supabase.from('productos_costos').select('producto_id,costo_importacion').in('producto_id', prodRows.map((x) => x.id)).is('deleted_at', null)
        costos = Object.fromEntries(((co ?? []) as { producto_id: string; costo_importacion: number | null }[]).map((x) => [x.producto_id, Number(x.costo_importacion) || 0]))
      }
      const porCodigo = new Map(prodRows.map((x) => [x.codigo, x]))
      const filas: ProdPromo[] = items.map((it) => {
        const p0 = porCodigo.get(it.id)
        const an = porAnalisis.get(it.id)
        const pvp = Number(p0?.pvp) || 0, desc = Number(it.desc) || 0
        const descEfectivo = it.estadoAprobacion === 'Aprobado' && it.descAprobado != null ? Number(it.descAprobado) : desc
        const precioFinal = Math.round(pvp * (1 - descEfectivo / 100) * 100) / 100
        const costo = p0 && verCostos ? (costos[p0.id] ?? 0) : null
        const margen = costo != null && costo > 0 && precioFinal > 0 ? Math.round((precioFinal - costo) / precioFinal * 1000) / 10 : null
        return {
          id: p0?.id ?? '', codigo: it.id, nombre: p0?.nombre ?? it.id, categoria: p0?.categoria?.nombre ?? '—', pvp, costo, enCatalogo: !!p0?.en_catalogo, imagen: p0?.imagen_url ?? '', desc: descEfectivo, precioFinal, margen,
          estadoAprobacion: it.estadoAprobacion, descOriginal: desc, revisadoPor: it.revisadoPor, motivoRechazo: it.motivoRechazo,
          stock: Number(p0?.stock) || 0, dias: an?.dias ?? 0, grupo: an?.grupo ?? '', conObs: an?.conObs ?? false, motivosObs: an?.motivosObs ?? [], interes: an?.interes ?? 0, capitalPvp: an?.capitalPvp ?? (Number(p0?.stock) || 0) * pvp,
        }
      })
      setProds(filas)
    })()
    return () => { vivo = false }
  }, [items, verCostos, analisis])

  const ventasPorId = useVentasTotales((prods ?? []).map((p) => p.id))
  const est = useEstadoStock()

  // Agrega uno o varios de una sola vez (un solo guardado, así no se pisan entre sí).
  async function agregarProductos(nuevos: { codigo: string; desc: number }[]) {
    const ya = new Set(items.map((i) => i.id))
    const lista = nuevos.filter((n) => !ya.has(n.codigo))
    if (!lista.length) return
    const todos = [...items, ...lista.map((n) => ({ id: n.codigo, desc: n.desc, descPropuesto: n.desc, nota: '' }))]
    const reabrir = lista.some((n) => n.desc > 0) && ['Aprobada', 'Rechazada'].includes(c.estado)
    await actualizarCampo(c, reabrir ? { items: todos, estado: 'En aprobación' } : { items: todos })
  }
  async function quitarProducto(codigo: string) {
    if (!confirm('¿Quitar este producto de la campaña?')) return
    await actualizarCampo(c, { items: items.filter((i) => i.id !== codigo) })
  }
  async function guardarDesc(codigo: string, nuevoDesc: number) {
    const nuevos = items.map((i) => (i.id === codigo ? { ...i, desc: nuevoDesc, descPropuesto: nuevoDesc } : i))
    // Si la campaña ya estaba cerrada (aprobada/rechazada) y se suma un producto con descuento,
    // vuelve a "En aprobación" para que aparezca en Ofertas › Por aprobar. Los ya aprobados no se tocan.
    const reabrir = nuevoDesc > 0 && ['Aprobada', 'Rechazada'].includes(c.estado)
    await actualizarCampo(c, reabrir ? { items: nuevos, estado: 'En aprobación' } : { items: nuevos })
  }

  const filas = useMemo(() => {
    if (!prods) return []
    const cmp: Record<string, (a: ProdPromo, b: ProdPromo) => number> = {
      cat: (a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'),
      costo: (a, b) => (b.costo ?? -1) - (a.costo ?? -1),
      desc: (a, b) => b.desc - a.desc,
      pvp: (a, b) => b.pvp - a.pvp,
      margen: (a, b) => (b.margen ?? -999) - (a.margen ?? -999),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    }
    // Visibles en el catálogo público primero, siempre; el criterio elegido decide el resto.
    return [...prods].sort((a, b) => (Number(b.enCatalogo) - Number(a.enCatalogo)) || cmp[orden](a, b))
  }, [prods, orden])

  async function exportarPdf() {
    setGenerando(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
      const fechaHoy = new Date().toLocaleDateString('es-EC')
      const fotos = new Map<string, string | null>()
      const totalPaginas = Math.max(1, Math.ceil(filas.length / 6))
      let faltan = 0
      for (let pagina = 0; pagina < totalPaginas; pagina++) {
        const lote = filas.slice(pagina * 6, pagina * 6 + 6)
        for (let k = 0; k < lote.length; k += 3) {
          await Promise.all(lote.slice(k, k + 3).map(async (f) => { if (fotos.has(f.codigo)) return; fotos.set(f.codigo, f.imagen ? (await aDataUrl(imgUrl(f.imagen, 600))) || null : null) }))
        }
        if (pagina) doc.addPage()
        doc.setFillColor(11, 37, 69); doc.rect(0, 0, 210, 27, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.text('VIMEDIC', 12, 12); doc.setFontSize(10); doc.text(c.nombre, 12, 20)
        doc.setTextColor(100, 116, 139); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(`${fechaHoy} · ${filas.length} producto(s) en promoción`, 12, 34)
        lote.forEach((f, i) => {
          const x = 12 + (i % 2) * 95, y = 40 + Math.floor(i / 2) * 79, w = 91, h = 75
          doc.setDrawColor(226, 232, 240); doc.setFillColor(255, 255, 255); doc.roundedRect(x, y, w, h, 3, 3, 'FD')
          const foto = fotos.get(f.codigo)
          if (foto) { try { const prop = doc.getImageProperties(foto), s = Math.min(34 / prop.width, 31 / prop.height); doc.addImage(foto, prop.fileType, x + 4 + (34 - prop.width * s) / 2, y + 3 + (31 - prop.height * s) / 2, prop.width * s, prop.height * s, undefined, 'FAST') } catch { faltan++; doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('Imagen no disponible', x + 4, y + 19) } }
          else { faltan++; doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('Sin imagen disponible', x + 4, y + 19) }
          if (f.desc > 0) { doc.setFillColor(194, 65, 12); doc.roundedRect(x + w - 24, y + 4, 20, 10, 2, 2, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(`-${f.desc}%`, x + w - 14, y + 10.5, { align: 'center' }) }
          doc.setTextColor(11, 37, 69); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
          doc.text(doc.splitTextToSize(txtPdf(f.nombre), 45).slice(0, 4), x + 41, y + 8)
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text(txtPdf(f.codigo) + (f.categoria !== '—' ? ' · ' + txtPdf(f.categoria) : ''), x + 41, y + 32)
          if (f.desc > 0) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(148, 163, 184); const antes = `Antes: ${money(f.pvp)}`; doc.text(antes, x + 4, y + 44); const aw = doc.getTextWidth(antes); doc.setDrawColor(148, 163, 184); doc.line(x + 4, y + 43, x + 4 + aw, y + 43) }
          doc.setFont('helvetica', 'bold'); doc.setTextColor(194, 65, 12); doc.setFontSize(13); doc.text(`${money(f.precioFinal)}`, x + 4, y + 53)
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('+ IVA', x + 4 + doc.getTextWidth(money(f.precioFinal)) + 2, y + 53)
          doc.setFontSize(7); doc.setTextColor(71, 85, 105); doc.text(`Válido hasta ${fecha(c.fin)}`, x + 4, y + 62)
        })
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139); doc.text('Precios sujetos a disponibilidad de stock. Consulta con tu asesor VIMEDIC.', 12, 284); doc.text(`${pagina + 1} / ${totalPaginas}`, 195, 284, { align: 'right' })
      }
      doc.save(`VIMEDIC-Promo-${(c.codigo || c.nombre).replace(/[^a-z0-9]+/gi, '-')}.pdf`)
      if (faltan) setTimeout(() => alert(`${faltan} producto(s) sin imagen disponible.`), 300)
    } catch (e) { alert((e as Error).message) }
    setGenerando(false)
  }

  const [col, bg] = COLOR_P[c.estado] ?? COLOR_P.Borrador
  const puedeAgregar = editar && c.estado !== 'Cancelada'
  const conDesc = items.filter((i) => Number(i.desc) > 0)
  const res = {
    aprobados: items.filter((i) => i.estadoAprobacion === 'Aprobado').length,
    rechazados: items.filter((i) => i.estadoAprobacion === 'Rechazado').length,
    pendientes: conDesc.filter((i) => !i.estadoAprobacion || i.estadoAprobacion === 'Pendiente').length,
    promedio: conDesc.length ? Math.round(conDesc.reduce((a, i) => a + (Number(i.desc) || 0), 0) / conDesc.length * 10) / 10 : 0,
    ahorro: (prods ?? []).reduce((a, p) => a + Math.max(0, p.pvp - p.precioFinal), 0),
  }
  const palabras = normalize(filtro).split(/\s+/).filter(Boolean)
  const visibles = palabras.length ? filas.filter((f) => palabras.every((w) => normalize([f.codigo, f.nombre, f.categoria].join(' ')).includes(w))) : filas

  return (
    <section className="mkc">
      <div className="mkc-bar">
        <button className="btn" onClick={cerrar} title="Volver a las campañas"><ArrowLeft className="w-4 h-4" />Campañas</button>
        <div className="min-w-0 flex-1">
          <p className="font-mono-spec text-[11px] text-slate-400">{c.codigo}{c.preventa ? ' · Preventa' : ''}</p>
          <p className="font-bold text-[15px] text-slate-800 truncate">{c.nombre}</p>
        </div>
        <span className="pill" style={{ background: bg, color: col }}>{c.estado}</span>
        {editar && ['Borrador', 'Devuelta'].includes(c.estado) && <button className="btn btn-primary" onClick={() => mover(c, 'En aprobación')}><Send className="w-4 h-4" />Enviar a aprobación</button>}
        {aprobar && c.estado === 'En aprobación' && <>
          <button className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => mover(c, 'Rechazada', com.trim())}>Rechazar campaña</button>
          <button className="btn" onClick={() => { if (!com.trim()) { alert('Escribe en el panel lateral qué se debe corregir.'); return } mover(c, 'Devuelta', com.trim()) }}>Devolver</button>
          {conDesc.length === 0 && <button className="btn btn-primary" onClick={() => mover(c, 'Aprobada', com.trim())}><Check className="w-4 h-4" />Aprobar</button>}
        </>}
        {editar && ['Aprobada', 'Borrador'].includes(c.estado) && <button className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => { if (confirm('¿Cancelar esta campaña?')) mover(c, 'Cancelada') }}><X className="w-4 h-4" />Cancelar</button>}
        {puedeEliminar && <button className="btn" title="Eliminar campaña" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => eliminar(c)}><Trash2 className="w-4 h-4" /></button>}
      </div>

      <div className="mkc-cuerpo">
        <aside className="mkc-lado">
          <div className="card p-4 space-y-2.5">
            <p className="text-[10px] font-bold uppercase text-slate-400">Datos de la campaña</p>
            {editar ? (
              <>
                <label className="block text-[11px] font-bold text-slate-500">Nombre
                  <input className="inp w-full mt-1 font-bold" value={nombreEd} onChange={(e) => setNombreEd(e.target.value)} onBlur={guardarNombre}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></label>
                <label className="block text-[11px] font-bold text-slate-500">Vigente desde
                  <input type="date" className="inp w-full mt-1" value={inicioEd} onChange={(e) => setInicioEd(e.target.value)} onBlur={guardarVigencia} /></label>
                <label className="block text-[11px] font-bold text-slate-500">Vigente hasta
                  <input type="date" className="inp w-full mt-1" value={finEd} onChange={(e) => setFinEd(e.target.value)} onBlur={guardarVigencia} /></label>
                <label className="block text-[11px] font-bold text-slate-500">Descripción
                  <textarea className="inp w-full mt-1 font-normal" rows={3} maxLength={300} value={descEd} onChange={(e) => setDescEd(e.target.value)} onBlur={guardarDescripcion}
                    placeholder="Qué busca esta campaña (objetivo, público, canal)…" />
                  <span className="block text-right text-[10px] font-normal text-slate-400">{descEd.length}/300</span></label>
              </>
            ) : <><p className="text-xs text-slate-600">{fecha(c.inicio)} → {fecha(c.fin)}</p>{c.descripcion && <p className="text-xs text-slate-600 mt-1">{c.descripcion}</p>}</>}
          </div>

          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Resumen</p>
            <div className="mkc-res">
              <div><small>Productos</small><b>{items.length}</b></div>
              <div><small>Con descuento</small><b>{conDesc.length}</b></div>
              <div><small>Por aprobar</small><b style={{ color: '#a16207' }}>{res.pendientes}</b></div>
              <div><small>Aprobados</small><b style={{ color: '#04896f' }}>{res.aprobados}</b></div>
              <div><small>Rechazados</small><b style={{ color: '#c0392b' }}>{res.rechazados}</b></div>
              <div><small>% promedio</small><b>{res.promedio}%</b></div>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Ahorro total para clientes: <b className="text-slate-700">{money(res.ahorro)}</b> <span className="text-slate-400">(una unidad de cada uno)</span></p>
            {res.pendientes > 0 && c.estado === 'En aprobación' && <p className="text-[11px] text-slate-500 mt-1.5">Los productos se aprueban uno por uno en Ofertas y Liquidación › Por aprobar.</p>}
          </div>

          {(c.comentario || (aprobar && c.estado === 'En aprobación')) && (
            <div className="card p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase text-slate-400">Comentarios</p>
              {c.comentario && <p className="text-xs rounded-lg p-2.5 bg-amber-50 text-amber-800">{c.comentario}</p>}
              {aprobar && c.estado === 'En aprobación' && <textarea className="inp w-full" rows={3} placeholder="Comentario para quien envió la campaña (obligatorio para devolver)" value={com} onChange={(e) => setCom(e.target.value)} />}
            </div>
          )}

          <div className="card p-4">
            <p className="text-[10px] font-bold uppercase text-slate-400 mb-1.5">Historial</p>
            {!(c.historial ?? []).length && <p className="text-[11px] text-slate-400">Sin movimientos.</p>}
            <ul className="space-y-1.5">{[...(c.historial ?? [])].reverse().map((h, i) => <li key={i} className="text-[11px] text-slate-600"><b>{h.accion}</b> · {h.por} · {new Date(h.fecha).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })}{h.comentario ? ' — ' + h.comentario : ''}</li>)}</ul>
          </div>
        </aside>

        <div className="space-y-3 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="seg">
              <button type="button" className={vista === 'productos' ? 'active' : ''} onClick={() => setVista('productos')}>Productos de la campaña ({items.length})</button>
              {puedeAgregar && <button type="button" className={vista === 'agregar' ? 'active' : ''} onClick={() => setVista('agregar')}><Plus className="w-3.5 h-3.5 inline -mt-0.5" /> Agregar productos</button>}
            </div>
            {vista === 'productos' && <>
              <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="inp w-full" style={{ paddingLeft: 34 }} placeholder="Buscar dentro de la campaña…" value={filtro} onChange={(e) => setFiltro(e.target.value)} /></div>
              <select className="inp" style={{ width: 'auto' }} value={orden} onChange={(e) => setOrden(e.target.value)}>{ORDENES_PROMO.map(([v, t]) => (!verCostos && (v === 'costo' || v === 'margen')) ? null : <option key={v} value={v}>{t}</option>)}</select>
              <button className="btn" disabled={!filas.length || generando} onClick={exportarPdf}><FileDown className="w-4 h-4" />{generando ? 'Generando…' : 'Exportar PDF'}</button>
            </>}
          </div>

          {vista === 'productos' && <>
            {!prods && <p className="p-4 text-center text-xs text-slate-400">Cargando productos…</p>}
            {prods && !filas.length && (
              <div className="card p-10 text-center text-sm text-slate-400">Esta campaña todavía no tiene productos.
                {puedeAgregar && <div className="mt-3"><button className="btn btn-primary" onClick={() => setVista('agregar')}><Plus className="w-4 h-4" />Agregar productos</button></div>}</div>
            )}
            {filas.length > 0 && !visibles.length && <p className="p-4 text-center text-xs text-slate-400">Ningún producto coincide con la búsqueda.</p>}
            {visibles.length > 0 && (
              <div className="vm-of" style={ESTILO_TARJETAS}><div className="grid-p">{visibles.map((f) => (
                <TarjetaPromo key={f.codigo} f={f} est={est?.[f.id]} ventas={f.id ? ventasPorId[f.id] : undefined}
                  editable={editar && (!f.estadoAprobacion || f.estadoAprobacion === 'Pendiente')}
                  onGuardar={(d) => guardarDesc(f.codigo, d)} onQuitar={() => quitarProducto(f.codigo)} />
              ))}</div></div>
            )}
          </>}

          {vista === 'agregar' && puedeAgregar && (
            <AgregarProductos excluir={items.map((i) => i.id)} analisis={analisis} est={est} agregar={agregarProductos} />
          )}
        </div>
      </div>
    </section>
  )
}

// Las tarjetas reusan los estilos de Ofertas, que viven bajo .vm-of; se anula su alto/fondo de pantalla completa.
const ESTILO_TARJETAS: React.CSSProperties = { minHeight: 0, background: 'transparent' }

/* Mismas etiquetas que Ofertas › Por aprobar, para leer igual los productos en los dos lados. */
function EtiquetasProducto({ conObs, grupo, dias, ventas, stock, interes, est }: { conObs: boolean; grupo: string; dias: number; ventas?: number; stock: number; interes: number; est?: EstadoStock }) {
  const g = GRUPOS[grupo]
  return (
    <div className="flex gap-1.5 flex-wrap mb-1">
      {conObs && <span className="pill" style={{ background: '#f3e8ff', color: '#6d28d9' }}><AlertTriangle style={{ width: 11, height: 11 }} />Con observaciones</span>}
      {g && <span className="pill" style={{ background: g.hex + '1f', color: g.hex }}>Antigüedad · {meses(dias)}</span>}
      {ventas != null && (ventas === 0
        ? <span className="pill" style={{ background: '#f1f5f9', color: '#334155' }}>Nunca vendido</span>
        : <span className="pill" style={{ background: '#ecfdf5', color: '#047857' }}>{ventas} venta{ventas === 1 ? '' : 's'} registrada{ventas === 1 ? '' : 's'}</span>)}
      {stock >= 3 && <span className="pill" style={{ background: '#fff1e6', color: '#c2410c' }}>Sobrestock · {stock} u.</span>}
      {interes > 0 && <span className="pill" style={{ background: '#fff7ed', color: '#c2410c' }}><Users style={{ width: 11, height: 11 }} />{interes} cotizaron sin comprar</span>}
      <ChipsStockProceso e={est} />
    </div>
  )
}

function TarjetaPromo({ f, est, ventas, editable, onGuardar, onQuitar }: { f: ProdPromo; est?: EstadoStock; ventas?: number; editable: boolean; onGuardar: (desc: number) => void; onQuitar: () => void }) {
  const original = f.descOriginal ?? f.desc
  const [valor, setValor] = useState(String(original))
  useEffect(() => { setValor(String(original)) }, [original])
  const desc = Math.max(0, Math.min(90, Number(valor) || 0))
  const mostrar = editable ? desc : f.desc
  const precio = f.pvp > 0 ? Math.round(f.pvp * (1 - mostrar / 100) * 100) / 100 : 0
  const ahorro = f.pvp > 0 ? Math.round((f.pvp - precio) * 100) / 100 : 0
  function guardar() { if (desc !== original) onGuardar(desc) }
  return (
    <article className="pc">
      <div className="pc-top"><div className="ph">{f.imagen ? <img loading="lazy" src={imgUrl(f.imagen, 300)} alt="" onError={(ev) => ev.currentTarget.remove()} /> : <Package style={{ width: 28, height: 28 }} />}</div>
        <div className="min-w-0 flex-1">
          <EtiquetasProducto conObs={f.conObs} grupo={f.grupo} dias={f.dias} ventas={ventas} stock={f.stock} interes={f.interes} est={est} />
          <p className="font-bold text-[14px] leading-snug text-slate-800 line-clamp-2">{f.nombre}</p>
          <p className="text-[11px] text-slate-400 mono">{f.codigo} · {f.categoria}{!f.enCatalogo ? ' · No está en el catálogo' : ''}</p>
          <p className="text-[12px] text-slate-600 mt-1"><b>{f.stock}</b> u. · {money(f.capitalPvp)} detenido</p>
          {f.conObs && <p className="text-[11.5px] text-violet-700 font-semibold mt-1 line-clamp-2">{f.motivosObs.join(' · ')}</p>}
        </div>
      </div>
      <div className="jug">
        <div className="t"><BadgePercent style={{ width: 13, height: 13 }} />% de descuento propuesto</div>
        <div className="flex items-center gap-2 mt-1.5">
          {editable
            ? <input type="number" min="0" max="90" step="0.5" className="inp font-bold" style={{ fontSize: 26, height: 48, width: 92, color: 'var(--acc)' }} value={valor}
                onChange={(ev) => setValor(ev.target.value)} onBlur={guardar} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }} />
            : <span className="font-bold" style={{ fontSize: 26, color: 'var(--acc)' }}>{f.desc}</span>}
          <span className="text-lg font-bold" style={{ color: 'var(--acc)' }}>%</span>
          <div className="ml-auto text-right">
            {f.pvp > 0 && mostrar > 0 && <span className="precio-a">{money(f.pvp)}</span>} <span className="precio-n">{money(precio)}</span>
          </div>
        </div>
        {f.pvp > 0 && mostrar > 0 && <p className="text-[11.5px] font-semibold mt-1.5" style={{ color: '#04896f' }}>El cliente ahorra {money(ahorro)}</p>}
      </div>
      {f.estadoAprobacion === 'Aprobado' && (
        <p className="text-[11px] font-semibold rounded-lg px-2 py-1" style={{ background: '#ecfaf5', color: '#04896f', margin: '0 12px 12px' }}>
          Aprobado por {f.revisadoPor}{f.descOriginal != null && f.descOriginal !== f.desc ? ' · se propuso -' + f.descOriginal + '%, se aprobó -' + f.desc + '%' : ''}
        </p>
      )}
      {f.estadoAprobacion === 'Rechazado' && (
        <p className="text-[11px] font-semibold rounded-lg px-2 py-1" style={{ background: '#fdecea', color: '#c0392b', margin: '0 12px 12px' }}>
          Rechazado por {f.revisadoPor}{f.motivoRechazo ? ': ' + f.motivoRechazo : ''}
        </p>
      )}
      {editable && (
        <div style={{ margin: '0 12px 12px' }}>
          <button className="btn w-full" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={onQuitar}><XCircle className="w-4 h-4" />Quitar de la campaña</button>
        </div>
      )}
    </article>
  )
}

/* Ventas totales de siempre (movimientos de salida) por id de producto; pide solo los que faltan, en tandas. */
function useVentasTotales(ids: string[]) {
  const [v, setV] = useState<Record<string, number>>({})
  const pedidos = useRef(new Set<string>())
  const clave = [...new Set(ids.filter(Boolean))].sort().join(',')
  useEffect(() => {
    const faltan = clave ? clave.split(',').filter((id) => !pedidos.current.has(id)) : []
    if (!faltan.length) return
    faltan.forEach((id) => pedidos.current.add(id))
    for (let i = 0; i < faltan.length; i += 20) {
      const tanda = faltan.slice(i, i + 20)
      supabase.from('movimientos_inventario').select('producto_id,cantidad').in('producto_id', tanda).eq('tipo', 'SALIDA').is('deleted_at', null).then(({ data }) => {
        const porId: Record<string, number> = Object.fromEntries(tanda.map((id) => [id, 0]))
        ;((data ?? []) as { producto_id: string; cantidad: number }[]).forEach((m) => { porId[m.producto_id] = (porId[m.producto_id] || 0) + Math.abs(Number(m.cantidad) || 0) })
        setV((x) => ({ ...x, ...porId }))
      })
    }
  }, [clave])
  return v
}

/* Agregar productos: sin buscar, recomienda lo que conviene liquidar (lo mismo que Oportunidades) y que aún no
   está en la campaña; al escribir, busca en TODO el inventario, sin depender de lo que sugiera el sistema. */
type Cand = { id: string; codigo: string; nombre: string; categoria: string; img: string; pvp: number; stock: number; enCatalogo: boolean | null; an?: Prod }
type ProdBusqueda = { id: string; codigo: string; nombre: string; pvp: number | null; stock: number | null; imagen_url: string | null; en_catalogo: boolean | null; categoria: { nombre: string } | null }
const FILTROS_REC: [string, string, (p: Prod, e?: EstadoStock) => boolean][] = [
  ['', 'Todos', () => true],
  ['12', 'Más de 12 meses', (p) => p.grupo === '12'],
  ['612', '6 a 12 meses', (p) => p.grupo === '612'],
  ['36', '3 a 6 meses', (p) => p.grupo === '36'],
  ['obs', 'Con observaciones', (p) => p.conObs],
  ['int', 'Con interesados', (p) => p.interes > 0],
  ['sob', 'Sobrestock', (p) => p.stock >= 3],
  ['rev', 'Por revisar', (_p, e) => (e?.revision ?? 0) > 0],
  ['nunca', 'Nunca vendidos', (p) => p.nuncaVendido],
]
function AgregarProductos({ excluir, analisis, est, agregar }: { excluir: string[]; analisis: Prod[] | null; est: Record<string, EstadoStock> | null; agregar: (n: { codigo: string; desc: number }[]) => Promise<void> }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<ProdBusqueda[] | null>(null)
  const [orden, setOrden] = useState('urg')
  const [filtro, setFiltro] = useState('')
  const [cat, setCat] = useState('')
  const [mostrar, setMostrar] = useState(24)
  const [pct, setPct] = useState<Record<string, string>>({})
  const [agregando, setAgregando] = useState('')
  const porCodigo = useMemo(() => new Map((analisis ?? []).map((p) => [p.codigo, p])), [analisis])
  const fuera = useMemo(() => new Set(excluir), [excluir])
  const buscando = normalize(q).trim().length > 0

  useEffect(() => {
    const palabras = normalize(q).split(/\s+/).filter(Boolean)
    if (!palabras.length) { setRes(null); return }
    let vivo = true
    const t = setTimeout(() => {
      let consulta = supabase.from('productos').select('id,codigo,nombre,pvp,stock,imagen_url,en_catalogo,categoria:categorias(nombre)').is('deleted_at', null)
      for (const w of palabras) consulta = consulta.ilike('busqueda_normalizada', `%${w}%`)
      consulta.limit(60).then(({ data }) => { if (vivo) setRes((data as unknown as ProdBusqueda[]) ?? []) })
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [q])
  useEffect(() => { setMostrar(24) }, [q, filtro, cat, orden])

  const recomendados = useMemo(() => {
    const f = FILTROS_REC.find(([k]) => k === filtro)?.[2] ?? (() => true)
    return (analisis ?? []).filter((p) => !fuera.has(p.codigo) && !p.oculto && p.pvp > 0 && f(p, est?.[p.id]) && (!cat || p.categoria === cat))
  }, [analisis, fuera, filtro, cat, est])
  const categorias = useMemo(() => [...new Set((analisis ?? []).filter((p) => !fuera.has(p.codigo)).map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [analisis, fuera])

  const lista: Cand[] = useMemo(() => {
    const base: Cand[] = buscando
      ? (res ?? []).map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria?.nombre ?? '—', img: p.imagen_url ? imgUrl(p.imagen_url, 300) : '', pvp: Number(p.pvp) || 0, stock: Number(p.stock) || 0, enCatalogo: p.en_catalogo, an: porCodigo.get(p.codigo) }))
      : recomendados.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, categoria: p.categoria, img: p.img, pvp: p.pvp, stock: p.stock, enCatalogo: null, an: p }))
    const cmp: Record<string, (a: Cand, b: Cand) => number> = {
      urg: (a, b) => (b.an?.urgencia ?? -1) - (a.an?.urgencia ?? -1),
      cat: (a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'),
      pvp: (a, b) => b.pvp - a.pvp,
      desc: (a, b) => (b.an?.estrategia.descuento ?? 0) - (a.an?.estrategia.descuento ?? 0),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    }
    // Visibles en el catálogo público primero; luego el orden elegido.
    return [...base].sort((a, b) => (Number(!!b.enCatalogo) - Number(!!a.enCatalogo)) || cmp[orden](a, b))
  }, [buscando, res, recomendados, porCodigo, orden])
  const pagina = lista.slice(0, mostrar)
  const ventas = useVentasTotales(pagina.map((p) => p.id))
  const descDe = (p: Cand) => Math.max(0, Math.min(90, Number(pct[p.codigo] ?? p.an?.estrategia.descuento ?? 0) || 0))

  async function agregarUno(p: Cand) { setAgregando(p.codigo); await agregar([{ codigo: p.codigo, desc: descDe(p) }]); setAgregando('') }
  async function agregarPagina() {
    const nuevos = pagina.filter((p) => !fuera.has(p.codigo))
    if (!nuevos.length || !confirm(`¿Agregar estos ${nuevos.length} producto(s) a la campaña, cada uno con el % que muestra su tarjeta?`)) return
    setAgregando('*'); await agregar(nuevos.map((p) => ({ codigo: p.codigo, desc: descDe(p) }))); setAgregando('')
  }

  return (
    <div className="space-y-3">
      <div className="card p-3 space-y-2.5">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus className="inp w-full" style={{ paddingLeft: 34 }} placeholder="Buscar cualquier producto del inventario por nombre, código o marca…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {!buscando && <select className="inp" style={{ width: 'auto' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas las categorías</option>{categorias.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
          <select className="inp" style={{ width: 'auto' }} value={orden} onChange={(e) => setOrden(e.target.value)}>
            <option value="urg">Más urgentes de liquidar</option><option value="cat">Categoría (A-Z)</option><option value="pvp">Precio (mayor a menor)</option>
            <option value="desc">% sugerido (mayor a menor)</option><option value="nombre">Nombre (A-Z)</option></select>
        </div>
        {!buscando && <div className="mkc-chips">{FILTROS_REC.filter(([k]) => k !== 'rev' || est).map(([k, t]) => <button key={k} type="button" className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{t}</button>)}</div>}
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12px] text-slate-500 mr-auto">
            {buscando
              ? (res === null ? 'Buscando…' : `${lista.length} resultado(s) en todo el inventario.`)
              : analisis === null ? 'Cargando recomendaciones…' : <><Sparkles className="w-3.5 h-3.5 inline -mt-0.5 text-[var(--amber)]" /> {lista.length} producto(s) recomendados que aún no están en la campaña (stock dormido o con novedades).</>}
          </p>
          {!buscando && pagina.length > 0 && <button className="btn" disabled={agregando === '*'} onClick={agregarPagina}><Plus className="w-4 h-4" />{agregando === '*' ? 'Agregando…' : `Agregar estos ${pagina.length}`}</button>}
        </div>
      </div>

      {buscando && res && !res.length && <p className="text-xs text-slate-400 text-center py-6">Sin resultados.</p>}
      {!buscando && analisis && !lista.length && <div className="card p-8 text-center text-sm text-slate-400">No hay más recomendaciones con este filtro. Usa el buscador para agregar cualquier otro producto.</div>}
      {pagina.length > 0 && (
        <div className="vm-of" style={ESTILO_TARJETAS}><div className="grid-p">{pagina.map((p) => {
          const ya = fuera.has(p.codigo), an = p.an, d = descDe(p)
          const precio = p.pvp > 0 ? Math.round(p.pvp * (1 - d / 100) * 100) / 100 : 0
          return (
            <article key={p.id} className="pc">
              <div className="pc-top"><div className="ph">{p.img ? <img loading="lazy" src={p.img} alt="" onError={(ev) => ev.currentTarget.remove()} /> : <Package style={{ width: 28, height: 28 }} />}</div>
                <div className="min-w-0 flex-1">
                  <EtiquetasProducto conObs={an?.conObs ?? false} grupo={an?.grupo ?? ''} dias={an?.dias ?? 0} ventas={ventas[p.id]} stock={p.stock} interes={an?.interes ?? 0} est={est?.[p.id]} />
                  <p className="font-bold text-[14px] leading-snug text-slate-800 line-clamp-2">{p.nombre}</p>
                  <p className="text-[11px] text-slate-400 mono">{p.codigo} · {p.categoria}{p.enCatalogo === false ? ' · No está en el catálogo' : ''}</p>
                  <p className="text-[12px] text-slate-600 mt-1"><b>{p.stock}</b> u.{an ? ` · ${money(an.capitalPvp)} detenido` : ''}</p>
                  {an?.conObs && <p className="text-[11.5px] text-violet-700 font-semibold mt-1 line-clamp-2">{an.motivosObs.join(' · ')}</p>}
                </div>
              </div>
              {ya ? (
                <div style={{ margin: '0 12px 12px' }}><button className="btn w-full" disabled><Check className="w-4 h-4" />Ya está en la campaña</button></div>
              ) : (
                <div className="jug">
                  <div className="t"><BadgePercent style={{ width: 13, height: 13 }} />{an && an.estrategia.descuento > 0 ? `Sugerido: ${an.estrategia.tipo} -${an.estrategia.descuento}%` : '% de descuento'}</div>
                  {an?.estrategia.porque && <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{an.estrategia.porque}</p>}
                  <div className="flex items-center gap-2 mt-1.5">
                    <input type="number" min="0" max="90" step="0.5" className="inp font-bold" style={{ fontSize: 20, height: 42, width: 78, color: 'var(--acc)' }} value={pct[p.codigo] ?? String(an?.estrategia.descuento ?? 0)} onChange={(e) => setPct((x) => ({ ...x, [p.codigo]: e.target.value }))} />
                    <span className="font-bold" style={{ color: 'var(--acc)' }}>%</span>
                    <div className="ml-auto text-right">{p.pvp > 0 && d > 0 && <span className="precio-a">{money(p.pvp)}</span>} <span className="precio-n">{money(precio)}</span></div>
                  </div>
                  <button className="btn w-full mt-2" disabled={agregando === p.codigo || agregando === '*'} style={{ background: '#04896f', borderColor: '#04896f', color: '#fff' }} onClick={() => agregarUno(p)}>
                    <Plus className="w-4 h-4" />{agregando === p.codigo ? 'Agregando…' : d > 0 ? `Agregar con -${d}%` : 'Agregar sin descuento'}
                  </button>
                </div>
              )}
            </article>
          )
        })}</div></div>
      )}
      {lista.length > mostrar && <div className="text-center"><button className="btn" onClick={() => setMostrar(mostrar + 24)}>Ver más ({lista.length - mostrar})</button></div>}
    </div>
  )
}

function NuevaCampana({ perfil, cerrar, hecho, aviso }: { perfil: Perfil; cerrar: () => void; hecho: () => void; aviso: (t: string) => void }) {
  const [n, setN] = useState(''); const [ini, setIni] = useState(''); const [fin, setFin] = useState(''); const [pre, setPre] = useState(false); const [desc, setDesc] = useState('')
  async function guardar() {
    if (!n.trim() || !ini || !fin) { aviso('Completa nombre y fechas.'); return }
    if (fin < ini) { aviso('La fecha final es anterior al inicio.'); return }
    const { error } = await supabase.from('promo_campanas').insert({ id: crypto.randomUUID(), codigo: 'PR-' + crypto.randomUUID().slice(0, 6).toUpperCase(), nombre: n.trim(), descripcion: desc.trim() || null, inicio: ini, fin, preventa: pre, estado: 'Borrador', historial: [{ fecha: new Date().toISOString(), por: perfil.nombre, accion: 'Creada' }], actualizado_por: perfil.id })
    if (error) aviso('No se pudo crear: ' + error.message); else hecho()
  }
  return (
    <Ventana titulo="Nueva campaña" cerrar={cerrar} pie={<button className="btn btn-primary" onClick={guardar}>Crear campaña</button>}>
      <label className="block text-[11px] font-bold text-slate-500">Nombre<input className="inp w-full mt-1" value={n} onChange={(e) => setN(e.target.value)} placeholder="Ej. Black Friday 2026" /></label>
      <label className="block text-[11px] font-bold text-slate-500">Descripción (opcional)<textarea className="inp w-full mt-1 font-normal" rows={2} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Qué busca esta campaña (objetivo, público, canal)…" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block text-[11px] font-bold text-slate-500">Inicio<input type="date" className="inp w-full mt-1" value={ini} onChange={(e) => setIni(e.target.value)} /></label>
        <label className="block text-[11px] font-bold text-slate-500">Fin<input type="date" className="inp w-full mt-1" value={fin} onChange={(e) => setFin(e.target.value)} /></label></div>
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} />Con preventa</label>
    </Ventana>
  )
}
