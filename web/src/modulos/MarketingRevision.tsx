import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, CheckCheck, ExternalLink, FileText, Package, Megaphone, Pencil, RefreshCw, Save, Undo2, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { agrupar } from '../tiempoReal'
import { llamar } from './MarketingIntegraciones'

/* ============================ Revisión del equipo de Marketing ============================
   Como el original (MarketingFlujo.gs + InformesDesempeno.gs):
   · Coordinación: Por aprobar (agrupado por producto, con las diferencias resaltadas; aprobar, editar y
     aprobar, pedir cambios, rechazar, aprobar varios), Aplicados (lo que salió directo: revisado o
     deshacer), Equipo (desempeño por persona y "Publicación directa"), Informes en PDF y Ajustes de la ficha.
   · Asistente y Audiovisual: Mis envíos, con el estado y el comentario de Coordinación. */

type Item = {
  id: string; codigo: string | null; fecha: string; actualizado: string; productoId: string | null; producto: string | null; imagen: string | null
  campo: string; accion: boolean; nivel: string | null; anterior: string | null; nuevo: string | null; estado: string; autor: string | null; autorId: string | null
  rol: string | null; revisadoPor: string | null; fechaRevision: string | null; comentario: string | null; correcciones: number
}
type Rol = { rol?: string; coord?: boolean; directa?: boolean; nombre?: string; empleado_id?: string }
type Bandeja = { yo: Rol; pendientes: Item[]; aplicados: Item[]; conCambios: number }
type Miembro = {
  id: string; email: string; nombre: string; rol: string; directa: boolean; pendientes: number; conCambios: number; enviados: number; aprobados: number; primera: number
  devueltos: number; rechazados: number; directos: number; campos: number; productos: number; fotos: number; videos: number; videosTipo: Record<string, number>; piezas: number
  horasAprobacion: number | null; horasCorreccion: number | null; tasaPrimera: number | null
}
type Comercial = { asesor: string; leads: number; atendidos: number; resp: number | null; cot: number; ventas: number; monto: number; campana: number; conversion: number | null }

const CAMPO_T: Record<string, string> = {
  nombre: 'Nombre', categoria: 'Categoría', marca: 'Marca', modelo: 'Modelo', descripcion: 'Descripción', caracteristicas: 'Características', especificaciones: 'Especificaciones técnicas',
  destacados: 'Datos destacados de la ficha', accesorios: 'Incluye (accesorios)', certificaciones: 'Certificaciones', garantia: 'Garantía', publico: 'Visible al público',
  nuevo: 'Etiqueta "Nuevo"', imagen: 'Imagen principal', imagen_url: 'Imagen principal', galeria: 'Galería (fotos y videos)', album: 'Álbum de Drive', ficha: 'Enlace de ficha técnica',
  'accion:zernio_crear': 'Nueva publicación en redes', 'accion:mkPublicar': 'Nueva publicación en redes', 'accion:zernio_editar': 'Cambio en una publicación',
  'accion:mkEditarPublicacion': 'Cambio en una publicación', 'accion:zernio_reprogramar': 'Cambio de fecha de una publicación', 'accion:mkReprogramar': 'Cambio de fecha de una publicación',
}
const titulo = (c: string) => CAMPO_T[c] ?? (c.startsWith('accion:') ? 'Publicación en redes' : c)
const LISTAS = ['caracteristicas', 'especificaciones', 'accesorios', 'destacados', 'certificaciones']
const SIN_EDITAR = ['galeria', 'imagen', 'imagen_url', 'publico', 'nuevo', 'accion:mkReprogramar', 'accion:zernio_reprogramar']
const hace = (iso: string | null) => {
  const t = Date.parse(iso ?? ''); if (!isFinite(t)) return ''
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`
}
const fechaLarga = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
const driveImg = (u: string | null | undefined, w = 120) => { const v = String(u || ''); const m = v.match(/\/d\/([\w-]{20,})/) || v.match(/[?&]id=([\w-]{20,})/); return m && /google/.test(v) ? `https://lh3.googleusercontent.com/d/${m[1]}=w${w}` : v }
const hoyEc = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)

/* ---------- diferencias resaltadas (mkfDiffPalabras / mkfDiffLineas) ---------- */
function diffPalabras(a: string, b: string) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/)
  if (A.length * B.length > 250000) return <><del>{a}</del>{'\n'}<ins>{b}</ins></>
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: { t: string; k: '' | 'del' | 'ins' }[] = []
  const push = (t: string, k: '' | 'del' | 'ins') => { const u = out[out.length - 1]; if (u && u.k === k) u.t += t; else out.push({ t, k }) }
  let i = 0, j = 0
  while (i < n && j < m) { if (A[i] === B[j]) { push(A[i], ''); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) push(A[i++], 'del'); else push(B[j++], 'ins') }
  while (i < n) push(A[i++], 'del'); while (j < m) push(B[j++], 'ins')
  return <>{out.map((x, k) => (x.k === 'del' ? <del key={k}>{x.t}</del> : x.k === 'ins' ? <ins key={k}>{x.t}</ins> : <Fragment key={k}>{x.t}</Fragment>))}</>
}
function diffLineas(a: string, b: string) {
  const A = a.split('\n').filter((x) => x.trim()), B = b.split('\n').filter((x) => x.trim()), sa = new Set(A), sb = new Set(B)
  const filas = [...B.map((x) => ({ t: '• ' + x, k: sa.has(x) ? '' : 'ins' })), ...A.filter((x) => !sb.has(x)).map((x) => ({ t: '• ' + x, k: 'del' }))]
  if (!filas.length) return <i>(vacío)</i>
  return <>{filas.map((x, k) => <Fragment key={k}>{x.k === 'ins' ? <ins>{x.t}</ins> : x.k === 'del' ? <del>{x.t}</del> : x.t}{'\n'}</Fragment>)}</>
}
function VistaCambio({ it }: { it: Item }) {
  if (it.accion) {
    let d: Record<string, unknown> = {}
    try { const j = JSON.parse(it.nuevo || '{}'); d = Array.isArray(j) ? (typeof j[0] === 'object' ? j[0] : { id: j[0], fechaISO: j[1] }) : j } catch { /* texto */ }
    const fecha = String(d.fechaISO || d.fecha || '')
    if (/reprogramar/i.test(it.campo)) return <div className="rv-diff">Mover la publicación a <b>{fecha ? fechaLarga(fecha) : '—'}</b></div>
    const media = d.media as { url?: string; type?: string } | null | undefined
    const redes = Array.isArray(d.redesTexto) ? (d.redesTexto as string[]) : Array.isArray(d.cuentas) ? [(d.cuentas as string[]).length + ' cuenta(s)'] : Array.isArray(d.accounts) ? [(d.accounts as string[]).length + ' cuenta(s)'] : []
    const fmt = ({ feed: 'Feed', story: 'Historia', reel: 'Reel' } as Record<string, string>)[String(d.formato || '')]
    return (
      <>
        <div className="rv-diff">{String(d.contenido ?? it.anterior ?? '') || '(Sin texto)'}</div>
        <p className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-2">{redes.length > 0 && <span>{redes.join(', ')}</span>}<span>{fecha ? 'Programada: ' + fechaLarga(fecha) : /crear|Publicar/.test(it.campo) ? 'Se publica al aprobar' : ''}</span>{fmt && <span>{fmt}</span>}
          {media?.url && <a href={media.url} target="_blank" rel="noopener noreferrer" className="font-bold" style={{ color: 'var(--primary)' }}>Ver {media.type === 'video' ? 'video' : 'imagen'} ↗</a>}</p>
      </>
    )
  }
  const a = it.anterior ?? '', b = it.nuevo ?? ''
  if (it.campo === 'publico') return <div className="rv-diff"><del>{a === 'SI' ? 'Visible al público' : 'Oculto'}</del> → <ins>{b === 'SI' ? 'Visible al público' : 'Oculto'}</ins></div>
  if (it.campo === 'nuevo') return <div className="rv-diff">{b === 'SI' ? 'Quitar la etiqueta "Nuevo"' : 'Mostrar la etiqueta "Nuevo"'}</div>
  if (['imagen', 'imagen_url', 'album', 'ficha'].includes(it.campo)) return <div className="rv-thumbs">{a && <img className="del" src={driveImg(a)} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />}<img className="add" src={driveImg(b)} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
    {['album', 'ficha'].includes(it.campo) && b && <a href={b} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold self-center" style={{ color: 'var(--primary)' }}>Abrir ↗</a>}</div>
  if (it.campo === 'galeria') {
    let A: { archivo: string; tipo?: string; tipoVideo?: string }[] = [], B: typeof A = []
    try { A = JSON.parse(a || '[]'); B = JSON.parse(b || '[]') } catch { /* dato viejo */ }
    const k = (x: { archivo: string }) => String(x.archivo).split('?')[0], ka = new Set(A.map(k)), kb = new Set(B.map(k))
    const add = B.filter((x) => !ka.has(k(x))), del = A.filter((x) => !kb.has(k(x)))
    const th = (x: { archivo: string; tipo?: string; tipoVideo?: string }, c: string, i: number) => (x.tipo === 'video' ? <span key={c + i} className={'rv-tag ' + (c === 'add' ? 'ok' : 'mal')}>▶ {x.tipoVideo || 'video'}</span> : <img key={c + i} className={c} src={driveImg(x.archivo)} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />)
    return <><p className="text-[11px] text-slate-500 mt-1">{[add.length ? add.length + ' agregado' + (add.length === 1 ? '' : 's') : '', del.length ? del.length + ' quitado' + (del.length === 1 ? '' : 's') : ''].filter(Boolean).join(' · ') || 'Orden o textos cambiados'}</p>
      <div className="rv-thumbs">{add.map((x, i) => th(x, 'add', i))}{del.map((x, i) => th(x, 'del', i))}</div></>
  }
  if (LISTAS.includes(it.campo)) return <div className="rv-diff">{diffLineas(a, b)}</div>
  return <div className="rv-diff">{a ? diffPalabras(a, b) : <ins>{b}</ins>}</div>
}

function agruparItems(l: Item[]) {
  const g = new Map<string, Item[]>()
  l.forEach((it) => { const k = it.productoId || 'redes:' + it.id; if (!g.has(k)) g.set(k, []); g.get(k)!.push(it) })
  return [...g.values()]
}
function Cabecera({ l, abrir }: { l: Item[]; abrir: (id: string) => void }) {
  const it = l[0]
  return (
    <div className="rv-grupo-h">
      {it.imagen ? <img src={driveImg(it.imagen, 120)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="ph">{it.accion ? <Megaphone className="w-4 h-4" /> : <Package className="w-4 h-4" />}</span>}
      <div className="min-w-0 flex-1"><p className="font-bold text-[13px] text-slate-800 truncate">{it.producto || (it.accion ? 'Publicación en redes' : '—')}</p></div>
      {it.productoId && <button type="button" className="btn" style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => abrir(it.productoId!)}><ExternalLink />Abrir</button>}
    </div>
  )
}

export function Revision({ perfil, aviso, irA }: { perfil: Perfil; aviso: (t: string) => void; irA?: (tab: string) => void }) {
  const [rol, setRol] = useState<Rol | null>(null)
  const [tab, setTab] = useState('')
  const [bandeja, setBandeja] = useState<Bandeja | null>(null)
  const [envios, setEnvios] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [ocultos, setOcultos] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [extra, setExtra] = useState<{ id: string; modo: 'editar' | 'devolver' | 'rechazar'; valor: string } | null>(null)
  const coord = !!rol?.coord

  const cargar = useCallback(async () => {
    const { data: r } = await supabase.rpc('marketing_mi_rol')
    const y = (r ?? {}) as Rol
    setRol(y)
    setTab((t) => t || (y.coord ? 'pendientes' : 'envios'))
    if (y.coord) {
      const { data, error } = await supabase.rpc('mkt_revision_bandeja')
      if (error) setError(error.message); else { setBandeja(data as Bandeja); setError('') }
    }
    const { data: me, error: e2 } = await supabase.rpc('mkt_mis_envios')
    if (!e2) setEnvios(((me as { items: Item[] } | null)?.items) ?? [])
    else if (!y.coord) setError(e2.message)
  }, [])
  useEffect(() => {
    cargar()
    const recargar = agrupar(() => cargar())
    const c = supabase.channel('mk-revision').on('postgres_changes', { event: '*', schema: 'public', table: 'marketing_cambios' }, recargar).subscribe()
    return () => { recargar.cancelar(); supabase.removeChannel(c) }
  }, [cargar])

  function abrirProducto(id: string) {
    try { sessionStorage.setItem('vm_mk_abrir_prod', id) } catch { /* sin almacenamiento */ }
    if (irA) irA('biblioteca'); else aviso('Ábrelo en Biblioteca.')
  }
  /* Revisión optimista: lo decidido desaparece al instante; si falla, vuelve a aparecer. */
  async function decidir(ids: string[], accion: 'aprobar' | 'devolver' | 'rechazar' | 'revisado' | 'deshacer', comentario = '', ediciones: Record<string, string> = {}) {
    if (!ids.length) return
    setOcultos((o) => new Set([...o, ...ids])); setExtra(null); setSel(new Set())
    const items = [...(bandeja?.pendientes ?? []), ...(bandeja?.aplicados ?? [])]
    const acciones = accion === 'aprobar' ? ids.filter((id) => items.find((x) => x.id === id)?.accion) : []
    const normales = ids.filter((id) => !acciones.includes(id))
    const fallos: string[] = []
    for (const id of acciones) {
      try { await llamar('zernio_aplicar', { cambioId: id, ...(ediciones[id] !== undefined ? { contenido: ediciones[id] } : {}) }) }
      catch (e) { fallos.push((e as Error).message) }
    }
    if (normales.length) {
      const { data, error } = await supabase.rpc('mkt_revision_decidir', { p_ids: normales, p_accion: accion, p_comentario: comentario || null, p_ediciones: ediciones })
      if (error) fallos.push(error.message)
      else ((data ?? []) as { ok: boolean; error?: string }[]).forEach((x) => { if (!x.ok && x.error) fallos.push(x.error) })
    }
    const ok = ids.length - fallos.length
    const etiqueta = { aprobar: 'aprobado', devolver: 'devuelto con tu comentario', rechazar: 'rechazado', revisado: 'revisado', deshacer: 'deshecho' }[accion]
    aviso(fallos.length ? `${ok} ${etiqueta}${ok === 1 ? '' : 's'} · ${fallos.length} con error: ${fallos[0]}` : ids.length === 1 ? etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1) + '.' : `${ids.length} ${etiqueta}s.`)
    await cargar()
    setOcultos(new Set())
  }

  if (error) return <div className="card p-6 text-sm" style={{ color: '#92400e', background: '#fffbeb' }}>{error}</div>
  if (!rol) return <p className="text-xs text-slate-400">Cargando…</p>
  const pend = (bandeja?.pendientes ?? []).filter((x) => !ocultos.has(x.id))
  const aplic = (bandeja?.aplicados ?? []).filter((x) => !ocultos.has(x.id))
  const tabs: [string, string, number][] = coord
    ? [['pendientes', 'Por aprobar', pend.length], ['aplicados', 'Aplicados (revisar después)', aplic.length], ['equipo', 'Equipo', 0], ['informes', 'Informes', 0], ['ajustes', 'Ajustes', 0], ['envios', 'Mis envíos', 0]]
    : [['envios', 'Mis envíos', 0]]

  const cajaExtra = (it: Item) => extra && extra.id === it.id && (
    <div className="mt-2">
      {extra.modo === 'editar'
        ? <textarea className="inp w-full" rows={String(extra.valor).length > 80 || /\n/.test(extra.valor) ? 6 : 2} value={extra.valor} onChange={(e) => setExtra({ ...extra, valor: e.target.value })} autoFocus />
        : <input className="inp w-full" maxLength={900} autoFocus value={extra.valor} onChange={(e) => setExtra({ ...extra, valor: e.target.value })} placeholder={extra.modo === 'devolver' ? '¿Qué hay que corregir? (obligatorio)' : 'Motivo del rechazo (opcional)'} />}
      <div className="rv-acc">
        {extra.modo === 'editar' && <button type="button" className="btn btn-primary" onClick={() => decidir([it.id], 'aprobar', '', { [it.id]: extra.valor })}><Check />Guardar y aprobar</button>}
        {extra.modo === 'devolver' && <button type="button" className="btn btn-primary" onClick={() => { if (extra.valor.trim().length < 3) { aviso('Escribe qué hay que corregir.'); return } decidir([it.id], 'devolver', extra.valor) }}>Enviar a corregir</button>}
        {extra.modo === 'rechazar' && <button type="button" className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => decidir([it.id], 'rechazar', extra.valor)}>Rechazar</button>}
        <button type="button" className="btn" onClick={() => setExtra(null)}>Cancelar</button>
      </div>
    </div>
  )
  function valorEditable(it: Item) {
    if (!it.accion) return it.nuevo ?? ''
    try { const j = JSON.parse(it.nuevo || '{}'); return String((Array.isArray(j) ? j[0] : j)?.contenido ?? '') } catch { return '' }
  }

  return (
    <section>
      <div className="card p-3 mb-3 flex items-center gap-2 flex-wrap">
        <div className="seg" style={{ flexWrap: 'wrap' }}>{tabs.map(([k, t, n]) => <button key={k} type="button" className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{t}{n > 0 && <span className="rv-badge">{n > 99 ? '99+' : n}</span>}</button>)}</div>
        <span className="text-[11px] text-slate-500 ml-auto">{coord ? 'Coordinación' : (rol.rol || 'Asistente') + (rol.directa ? ' · publicación directa' : '')}</span>
        <button type="button" className="btn" style={{ padding: '6px 8px' }} onClick={() => cargar()} aria-label="Actualizar"><RefreshCw /></button>
      </div>

      {tab === 'pendientes' && coord && (!pend.length
        ? <div className="rv-vacio"><Check className="w-8 h-8 mx-auto mb-2" style={{ color: '#10b981' }} />No hay cambios por aprobar.{bandeja?.conCambios ? <><br /><span className="text-[12px]">{bandeja.conCambios} devuelto{bandeja.conCambios === 1 ? '' : 's'} esperando corrección del equipo.</span></> : null}</div>
        : <>
          <div className="card p-3 mb-3 flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600"><input type="checkbox" checked={sel.size === pend.length && pend.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(pend.map((x) => x.id)) : new Set())} />Seleccionar todo</label>
            <button type="button" className="btn btn-primary" onClick={() => { if (!sel.size) { aviso('Marca al menos un cambio.'); return } decidir([...sel], 'aprobar') }}><Check />Aprobar seleccionados</button>
            <button type="button" className="btn" onClick={() => { if (confirm(`¿Aprobar los ${pend.length} cambios?`)) decidir(pend.map((x) => x.id), 'aprobar') }}><CheckCheck />Aprobar todo ({pend.length})</button>
            <span className="text-[11px] text-slate-400 ml-auto rv-diff" style={{ padding: '2px 8px', marginTop: 0, background: 'transparent' }}>Resaltado: <del>quitado</del> · <ins>nuevo</ins></span>
          </div>
          {agruparItems(pend).map((g) => (
            <div key={g[0].productoId || g[0].id} className="rv-grupo"><Cabecera l={g} abrir={abrirProducto} />
              {g.map((it) => (
                <div key={it.id} className="rv-it">
                  <div className="rv-it-h"><input type="checkbox" checked={sel.has(it.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(it.id); else n.delete(it.id); return n })} />
                    <b>{titulo(it.campo)}</b>{['especificaciones', 'certificaciones'].includes(it.campo) && <span className="rv-tag tec">técnico</span>}{it.correcciones > 0 && <span className="rv-tag rev">corrección {it.correcciones}</span>}
                    <span>{it.autor ?? '—'} · {hace(it.actualizado || it.fecha)}</span></div>
                  <VistaCambio it={it} />
                  {!extra || extra.id !== it.id ? <div className="rv-acc">
                    <button type="button" className="btn btn-primary" onClick={() => decidir([it.id], 'aprobar')}><Check />{it.accion ? 'Aprobar y publicar' : 'Aprobar'}</button>
                    {!SIN_EDITAR.includes(it.campo) && <button type="button" className="btn" onClick={() => setExtra({ id: it.id, modo: 'editar', valor: valorEditable(it) })}><Pencil />Editar y aprobar</button>}
                    <button type="button" className="btn" onClick={() => setExtra({ id: it.id, modo: 'devolver', valor: '' })}><Undo2 />Pedir cambios</button>
                    <button type="button" className="btn" style={{ color: '#b91c1c' }} onClick={() => setExtra({ id: it.id, modo: 'rechazar', valor: '' })}><X />Rechazar</button>
                  </div> : cajaExtra(it)}
                </div>
              ))}
            </div>
          ))}
        </>)}

      {tab === 'aplicados' && coord && (!aplic.length
        ? <div className="rv-vacio">No hay cambios aplicados pendientes de revisar.</div>
        : <>
          <div className="card p-3 mb-3 flex items-center gap-2 flex-wrap"><p className="text-[12px] text-slate-600 flex-1">Fotos, videos y correcciones pequeñas se publicaron al instante. Revísalos cuando puedas; si algo está mal, deshazlo.</p>
            <button type="button" className="btn" onClick={() => decidir(aplic.map((x) => x.id), 'revisado')}><CheckCheck />Todo bien</button></div>
          {agruparItems(aplic).map((g) => (
            <div key={g[0].productoId || g[0].id} className="rv-grupo"><Cabecera l={g} abrir={abrirProducto} />
              {g.map((it) => (
                <div key={it.id} className="rv-it">
                  <div className="rv-it-h"><b>{titulo(it.campo)}</b><span className="rv-tag ok">{it.nivel || 'Directo'}</span><span>{it.autor ?? '—'} · {hace(it.fecha)}</span></div>
                  <VistaCambio it={it} />
                  <div className="rv-acc"><button type="button" className="btn" onClick={() => decidir([it.id], 'revisado')}><Check />Revisado</button>
                    {it.campo !== 'galeria' && <button type="button" className="btn" style={{ color: '#b91c1c' }} onClick={() => { if (confirm('¿Deshacer este cambio? El producto vuelve a como estaba.')) decidir([it.id], 'deshacer') }}><Undo2 />Deshacer</button>}</div>
                </div>
              ))}
            </div>
          ))}
        </>)}

      {tab === 'equipo' && coord && <Equipo aviso={aviso} />}
      {tab === 'informes' && coord && <Informes perfil={perfil} aviso={aviso} />}
      {tab === 'ajustes' && coord && <Ajustes aviso={aviso} />}
      {tab === 'envios' && <MisEnvios items={envios} abrir={abrirProducto} />}
    </section>
  )
}

/* ---------- Mis envíos (mkfMisEnvios) ---------- */
const EST: Record<string, [string, string]> = { Pendiente: ['rev', 'En revisión'], 'Con cambios': ['mal', 'Corregir'], Aprobado: ['ok', 'Aprobado'], Aplicado: ['ok', 'Publicado'], Rechazado: ['mal', 'Rechazado'], Deshecho: ['mal', 'Deshecho'], Retirado: ['mal', 'Retirado'], Reemplazado: ['mal', 'Reemplazado'] }
function MisEnvios({ items, abrir }: { items: Item[] | null; abrir: (id: string) => void }) {
  if (!items) return <p className="text-xs text-slate-400">Cargando…</p>
  if (!items.length) return <div className="rv-vacio">Aún no tienes envíos. Lo que cambies en los productos y en el planificador aparecerá aquí con su estado.</div>
  const dev = items.filter((x) => x.estado === 'Con cambios')
  return (
    <>
      {dev.length > 0 && <div className="card p-3 mb-3 text-[12.5px]" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}><b>{dev.length} cambio{dev.length === 1 ? '' : 's'} para corregir.</b> Abre el producto, corrige y se reenvía solo.</div>}
      <div className="rv-grupo">{items.map((it) => { const e = EST[it.estado] ?? ['mal', it.estado]; return (
        <div key={it.id} className="rv-it">
          <div className="rv-it-h"><span className={'rv-tag ' + e[0]}>{e[1]}</span><b>{titulo(it.campo)}</b><span style={{ marginLeft: 0 }}>{it.producto || 'Redes'} · {hace(it.actualizado || it.fecha)}</span>
            {it.productoId && <button type="button" className="btn ml-auto" style={{ padding: '4px 9px', fontSize: 11 }} onClick={() => abrir(it.productoId!)}>Abrir</button>}</div>
          {it.comentario && it.estado !== 'Aplicado' && <div className="rv-diff" style={{ background: it.estado === 'Con cambios' ? '#fee2e2' : '#f1f5f9' }}><b>{it.revisadoPor || 'Coordinación'}:</b> {it.comentario}</div>}
        </div>) })}</div>
    </>
  )
}

/* ---------- Equipo (mkfDesempeno + mkfDefinirDirecta) ---------- */
const fmtH = (h: number | null) => (h == null ? '—' : h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? Math.round(h * 10) / 10 + ' h' : Math.round(h / 24) + ' d')
function Equipo({ aviso }: { aviso: (t: string) => void }) {
  const [rango, setRango] = useState('7')
  const [lista, setLista] = useState<Miembro[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setLista(null)
    const hasta = hoyEc(), desde = new Date(Date.parse(hasta + 'T12:00:00Z') - (Number(rango) - 1) * 864e5).toISOString().slice(0, 10)
    supabase.rpc('mkt_desempeno', { p_desde: desde, p_hasta: hasta }).then(({ data, error }) => { if (error) setError(error.message); else { setError(''); setLista(((data as { equipo: Miembro[] }).equipo) ?? []) } })
  }, [rango])
  async function directa(m: Miembro, activa: boolean) {
    setLista((l) => (l ?? []).map((x) => (x.id === m.id ? { ...x, directa: activa } : x)))
    const { error } = await supabase.rpc('mkt_definir_directa', { p_empleado: m.id, p_activa: activa })
    if (error) { aviso(error.message); setLista((l) => (l ?? []).map((x) => (x.id === m.id ? { ...x, directa: !activa } : x))) }
    else aviso(activa ? 'Publicación directa activada.' : 'Sus cambios vuelven a pasar por tu aprobación.')
  }
  return (
    <>
      <div className="card p-3 mb-3 flex items-center gap-2 flex-wrap">
        <div className="seg">{[['1', 'Hoy'], ['7', '7 días'], ['30', '30 días'], ['90', '3 meses']].map(([k, t]) => <button key={k} type="button" className={rango === k ? 'active' : ''} onClick={() => setRango(k)}>{t}</button>)}</div>
        <span className="text-[11px] text-slate-500">Solo lo ves tú.</span>
      </div>
      {error && <div className="rv-vacio">{error}</div>}
      {!error && !lista && <p className="text-xs text-slate-400">Cargando…</p>}
      {lista && !lista.length && <div className="rv-vacio">No hay personas con acceso a Marketing.</div>}
      {lista && lista.length > 0 && <div className="rv-eq">{lista.map((m) => (
        <div key={m.id} className="rv-card">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-xs shrink-0" style={{ background: 'var(--primary)' }}>{(m.nombre || m.email).split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="font-bold text-[13px] text-slate-800 truncate">{m.nombre || m.email}</p><p className="text-[10.5px] text-slate-500">{m.rol}</p></div>
            {m.rol !== 'Coordinación' && <label className="text-[10.5px] font-semibold text-slate-600 flex items-center gap-1.5" title="Sus cambios salen directo y quedan en Aplicados para revisar después"><input type="checkbox" checked={m.directa} onChange={(e) => directa(m, e.target.checked)} />Publicación directa</label>}
          </div>
          <div className="rv-stats">
            <div><b>{m.productos}</b><span>productos trabajados</span></div><div><b>{m.campos}</b><span>campos llenados</span></div><div><b>{m.fotos}</b><span>fotos subidas</span></div>
            <div><b>{m.videos}</b><span>videos{Object.keys(m.videosTipo || {}).length ? ' · ' + Object.entries(m.videosTipo).map(([k, v]) => v + ' ' + k.toLowerCase()).join(', ') : ''}</span></div>
            <div><b>{m.piezas}</b><span>piezas audiovisual</span></div><div><b>{m.enviados}</b><span>enviados a revisión</span></div>
            <div><b>{m.tasaPrimera == null ? '—' : m.tasaPrimera + '%'}</b><span>aprobados a la primera</span></div><div><b>{m.devueltos}</b><span>devueltos con cambios</span></div>
            <div><b>{m.pendientes + m.conCambios}</b><span>pendientes ({m.conCambios} por corregir)</span></div>
            <div><b>{fmtH(m.horasAprobacion)}</b><span>tiempo hasta la aprobación</span></div><div><b>{fmtH(m.horasCorreccion)}</b><span>su tiempo de corrección</span></div><div><b>{m.rechazados}</b><span>rechazados</span></div>
          </div>
        </div>
      ))}</div>}
    </>
  )
}

/* ---------- Ajustes de la ficha técnica (mkfGuardarAjustes) ---------- */
export type AjustesFicha = { web: string; telefono: string; correo: string; certificaciones: string }
export async function leerAjustesFicha(): Promise<AjustesFicha> {
  const { data } = await supabase.from('marketing_ajustes').select('valor').eq('clave', 'ficha').is('deleted_at', null).maybeSingle()
  const v = ((data as { valor?: Partial<AjustesFicha> } | null)?.valor ?? {}) as Partial<AjustesFicha>
  return { web: v.web || 'vimedic.com.ec', telefono: v.telefono || '', correo: v.correo || '', certificaciones: v.certificaciones || '' }
}
function Ajustes({ aviso }: { aviso: (t: string) => void }) {
  const [a, setA] = useState<AjustesFicha | null>(null)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { leerAjustesFicha().then(setA) }, [])
  async function guardar() {
    if (!a) return
    setGuardando(true)
    const { data, error } = await supabase.rpc('mkt_guardar_ajustes', { p_valor: a })
    setGuardando(false)
    if (error) aviso(error.message); else { setA(data as AjustesFicha); aviso('Guardado. Las próximas fichas usarán estos datos.') }
  }
  if (!a) return <p className="text-xs text-slate-400">Cargando…</p>
  const campo = (k: keyof AjustesFicha, t: string, ph = '') => <label className="mkf-lbl">{t}<input className="inp w-full" value={a[k]} placeholder={ph} onChange={(e) => setA({ ...a, [k]: e.target.value })} /></label>
  return (
    <div className="rv-card" style={{ maxWidth: 640 }}>
      <p className="font-bold text-[13px] text-slate-800 mb-1">Contacto de la ficha técnica</p>
      <p className="text-[11px] text-slate-500 mb-3">Aparece en la franja final de cada ficha técnica que se genera en la Biblioteca.</p>
      <div className="grid sm:grid-cols-2 gap-3">{campo('web', 'Web')}{campo('telefono', 'Teléfono / WhatsApp')}{campo('correo', 'Correo')}{campo('certificaciones', 'Certificaciones por defecto', 'ISO 13485 · CE')}</div>
      <button type="button" className="btn btn-primary mt-3" onClick={guardar} disabled={guardando}><Save />{guardando ? 'Guardando…' : 'Guardar'}</button>
    </div>
  )
}

/* ---------- Informes de desempeño en PDF (mkfInformeDesempeno) ---------- */
function rangoInforme(periodo: 'semanal' | 'mensual', ref: string) {
  const dia = (s: string) => new Date(s + 'T12:00:00Z'), fmt = (d: Date) => d.toISOString().slice(0, 10), mas = (s: string, n: number) => fmt(new Date(dia(s).getTime() + n * 864e5))
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  if (periodo === 'mensual') {
    const y = +ref.slice(0, 4), m = +ref.slice(5, 7), desde = ref.slice(0, 8) + '01'
    const hasta = mas(fmt(new Date(Date.UTC(y, m, 1))), -1)
    const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y
    return { desde, hasta, pdesde: `${py}-${String(pm).padStart(2, '0')}-01`, phasta: mas(desde, -1), titulo: `Informe mensual · ${meses[m - 1]} ${y}`, prev: 'vs. ' + meses[pm - 1] }
  }
  const dow = (dia(ref).getUTCDay() + 6) % 7, lunes = mas(ref, -dow), dom = mas(lunes, 6)
  const dm = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7)
  return { desde: lunes, hasta: dom, pdesde: mas(lunes, -7), phasta: mas(lunes, -1), titulo: `Informe semanal · ${dm(lunes)} al ${dm(dom)}/${dom.slice(0, 4)}`, prev: 'vs. semana anterior' }
}
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function variacion(a: number | null, b: number | null, menosEsMejor = false) {
  if (a == null || b == null || !isFinite(a) || !isFinite(b)) return ''
  if (b === 0) return a > 0 ? '<span style="color:#04896f">nuevo</span>' : ''
  const p = Math.round(((a - b) / Math.abs(b)) * 100); if (!p) return '<span style="color:#94a3b8">= igual</span>'
  const bueno = menosEsMejor ? p < 0 : p > 0
  return `<span style="color:${bueno ? '#04896f' : '#c0392b'}">${p > 0 ? '▲ +' : '▼ '}${p}%</span>`
}
const kpi = (t: string, v: string | number, a: number | null, b: number | null, menos: boolean, et: string) =>
  `<td style="padding:5px;width:20%"><div style="border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#f8fafc"><div style="font-size:8.5px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;font-weight:bold">${t}</div><div style="font-size:19px;font-weight:bold;color:#0b2545;margin-top:3px">${v}</div><div style="font-size:8.5px;margin-top:2px">${variacion(a, b, menos)} <span style="color:#94a3b8">${et}</span></div></div></td>`
const barra = (v: number, max: number, c: string) => `<div style="background:#e2e8f0;border-radius:4px;height:7px;width:100%"><div style="background:${c};height:7px;border-radius:4px;width:${max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0}%"></div></div>`
const dinero0 = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-EC')

function Informes({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [tipo, setTipo] = useState<'marketing' | 'comercial'>('marketing')
  const [periodo, setPeriodo] = useState<'semanal' | 'mensual'>('semanal')
  const [ref, setRef] = useState(hoyEc())
  const [ocupado, setOcupado] = useState(false)
  const [hechos, setHechos] = useState<{ url: string; titulo: string; rango: string; res: string }[]>([])
  const R = useMemo(() => rangoInforme(periodo, ref), [periodo, ref])
  async function generar() {
    setOcupado(true)
    try {
      const rango = `Del ${R.desde.split('-').reverse().join('/')} al ${R.hasta.split('-').reverse().join('/')}`
      let cuerpo = '', res = ''
      if (tipo === 'marketing') {
        const [a, b] = await Promise.all([supabase.rpc('mkt_desempeno', { p_desde: R.desde, p_hasta: R.hasta }), supabase.rpc('mkt_desempeno', { p_desde: R.pdesde, p_hasta: R.phasta })])
        if (a.error || b.error) throw new Error((a.error || b.error)!.message)
        const A = ((a.data as { equipo: Miembro[] }).equipo ?? []).filter((m) => m.rol !== 'Coordinación' || m.enviados || m.campos || m.fotos || m.videos)
        const prev = new Map(((b.data as { equipo: Miembro[] }).equipo ?? []).map((m) => [m.id, m]))
        const B = A.map((m) => prev.get(m.id)).filter(Boolean) as Miembro[]
        const sum = (l: Miembro[], k: keyof Miembro) => l.reduce((s, m) => s + (Number(m[k]) || 0), 0)
        const tA = { env: sum(A, 'enviados'), apr: sum(A, 'aprobados'), pri: sum(A, 'primera'), dev: sum(A, 'devueltos'), prod: sum(A, 'productos'), fot: sum(A, 'fotos'), vid: sum(A, 'videos') }
        const tB = { env: sum(B, 'enviados'), apr: sum(B, 'aprobados'), pri: sum(B, 'primera'), dev: sum(B, 'devueltos'), prod: sum(B, 'productos'), fot: sum(B, 'fotos'), vid: sum(B, 'videos') }
        const pA = tA.apr ? Math.round((tA.pri / tA.apr) * 100) : null, pB = tB.apr ? Math.round((tB.pri / tB.apr) * 100) : null
        cuerpo += `<table style="margin-top:12px"><tr>${kpi('Trabajo enviado', tA.env, tA.env, tB.env, false, R.prev)}${kpi('Aprobado a la primera', pA == null ? '—' : pA + ' %', pA, pB, false, '')}${kpi('Correcciones pedidas', tA.dev, tA.dev, tB.dev, true, '')}${kpi('Productos trabajados', tA.prod, tA.prod, tB.prod, false, '')}${kpi('Fotos y videos', tA.fot + tA.vid, tA.fot + tA.vid, tB.fot + tB.vid, false, tA.vid + ' videos')}</tr></table>`
        const vol = (m?: Miembro) => (m ? m.campos + m.fotos + m.videos + m.piezas : 0), maxT = Math.max(1, ...A.map((m) => vol(m)))
        cuerpo += '<h2>Por persona</h2><table><tr><th style="text-align:left">Persona</th><th>Enviado</th><th>A la primera</th><th>Correcciones</th><th>Horas corrigiendo</th><th>Productos</th><th>Fotos</th><th>Videos</th><th>Piezas AV</th><th style="width:120px">Volumen de trabajo</th></tr>' +
          A.map((m, i) => `<tr style="background:${i % 2 ? '#fff' : '#f8fafc'}"><td style="padding:6px"><b>${esc(m.nombre || m.email)}</b><br><span style="color:#94a3b8;font-size:8px">${esc(m.rol)}${m.directa ? ' · publicación directa' : ''}</span></td><td style="text-align:center">${m.enviados}</td><td style="text-align:center">${m.tasaPrimera == null ? '—' : m.tasaPrimera + ' %'}</td><td style="text-align:center">${m.devueltos}</td><td style="text-align:center">${m.horasCorreccion == null ? '—' : m.horasCorreccion + ' h'}</td><td style="text-align:center">${m.productos}</td><td style="text-align:center">${m.fotos}</td><td style="text-align:center">${m.videos}</td><td style="text-align:center">${m.piezas}</td><td style="padding:6px">${barra(vol(m), maxT, '#055c9d')}<div style="font-size:8px;text-align:right;margin-top:2px">${vol(m)} ${variacion(vol(m), vol(prev.get(m.id)))}</div></td></tr>`).join('') +
          (A.length ? '' : '<tr><td colspan="10" style="padding:10px;color:#64748b">Sin actividad en el período.</td></tr>') + '</table>' +
          '<p style="font-size:8.5px;color:#64748b;margin-top:6px">Enviado: cambios que pasaron por revisión. A la primera: aprobados sin pedir correcciones. Volumen: campos editados + fotos + videos + piezas de Audiovisual.</p>'
        res = `${tA.env} enviados · ${pA == null ? '—' : pA + ' %'} a la primera`
      } else {
        const [a, b] = await Promise.all([supabase.rpc('mkt_informe_comercial', { p_desde: R.desde, p_hasta: R.hasta }), supabase.rpc('mkt_informe_comercial', { p_desde: R.pdesde, p_hasta: R.phasta })])
        if (a.error || b.error) throw new Error((a.error || b.error)!.message)
        type C = { lista: Comercial[]; total: Omit<Comercial, 'asesor'> }
        const CA = a.data as C, CB = b.data as C, pB = new Map(CB.lista.map((x) => [x.asesor, x])), t = CA.total, u = CB.total
        cuerpo += `<table style="margin-top:12px"><tr>${kpi('Leads recibidos', t.leads, t.leads, u.leads, false, R.prev)}${kpi('Primera respuesta', t.resp == null ? '—' : t.resp + ' h', t.resp, u.resp, true, 'mediana')}${kpi('Cotizaciones', t.cot, t.cot, u.cot, false, '')}${kpi('Ventas', t.ventas + ' · ' + dinero0(t.monto), t.monto, u.monto, false, '')}${kpi('Conversión', t.conversion == null ? '—' : t.conversion + ' %', t.conversion, u.conversion, false, 'ventas / leads')}</tr></table>`
        const maxM = Math.max(1, ...CA.lista.map((x) => x.monto))
        cuerpo += '<h2>Por asesor</h2><table><tr><th style="text-align:left">Asesor</th><th>Leads</th><th>Atendidos</th><th>1.ª respuesta</th><th>Cotizaciones</th><th>Ventas</th><th>Conversión</th><th>Con campaña</th><th style="width:140px">Monto vendido</th></tr>' +
          CA.lista.map((x, i) => { const p = pB.get(x.asesor); return `<tr style="background:${i % 2 ? '#fff' : '#f8fafc'}"><td style="padding:6px"><b>${esc(x.asesor)}</b></td><td style="text-align:center">${x.leads} ${variacion(x.leads, p?.leads ?? 0)}</td><td style="text-align:center">${x.leads ? Math.round((x.atendidos / x.leads) * 100) + ' %' : '—'}</td><td style="text-align:center">${x.resp == null ? '—' : x.resp + ' h'}</td><td style="text-align:center">${x.cot}</td><td style="text-align:center">${x.ventas}</td><td style="text-align:center">${x.conversion == null ? '—' : x.conversion + ' %'}</td><td style="text-align:center">${x.campana || '—'}</td><td style="padding:6px">${barra(x.monto, maxM, '#04896f')}<div style="font-size:8px;text-align:right;margin-top:2px"><b>${dinero0(x.monto)}</b> ${variacion(x.monto, p?.monto ?? 0)}</div></td></tr>` }).join('') +
          (CA.lista.length ? '' : '<tr><td colspan="9" style="padding:10px;color:#64748b">Sin leads ni ventas en el período.</td></tr>') + '</table>' +
          '<p style="font-size:8.5px;color:#64748b;margin-top:6px">Leads: cotizaciones, contactos, WhatsApp, citas y Meta creados en el período. Primera respuesta: mediana de horas hasta la primera interacción registrada por una persona. Ventas: registros ganados en el período, con el monto del carrito.</p>'
        res = `${t.leads} leads · ${t.ventas} ventas · ${dinero0(t.monto)}`
      }
      let logo = ''
      try { const bl = await (await fetch('/logo-documento.png')).blob(); logo = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(bl) }) } catch { /* sin logo */ }
      const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#1e293b;padding:22px;width:780px;box-sizing:border-box"><style>h2{font-size:11.5px;color:#055c9d;text-transform:uppercase;letter-spacing:.06em;margin:18px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}table{border-collapse:collapse;width:100%}th{background:#0b2545;color:#fff;font-size:8.5px;padding:6px;text-align:center}td{font-size:9.5px}</style>
        <table><tr><td style="background:#0b2545;padding:16px 20px;border-radius:12px"><table><tr><td>${logo ? `<img src="${logo}" style="height:36px;background:#fff;border-radius:6px;padding:4px">` : '<b style="color:#fff;font-size:18px">VIMEDIC</b>'}</td>
        <td style="text-align:right;color:#fff"><div style="font-size:9px;letter-spacing:.14em;color:#7dd3fc;font-weight:bold">${tipo === 'marketing' ? 'DESEMPEÑO DEL EQUIPO DE MARKETING' : 'DESEMPEÑO DEL EQUIPO COMERCIAL'}</div><div style="font-size:20px;font-weight:bold">${esc(R.titulo)}</div><div style="font-size:9.5px;color:#cbd5e1">${esc(rango)}</div></td></tr></table></td></tr></table>
        ${cuerpo}<p style="margin-top:22px;font-size:8px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:8px">Generado el ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })} por ${esc(perfil.nombre)} · VIMEDIC</p></div>`
      const html2pdf = (await import('html2pdf.js')).default
      const blob = await html2pdf().set({ margin: 8, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, logging: false }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } }).from(html, 'string').toPdf().output('blob') as Blob
      const base64 = await new Promise<string>((ok, no) => { const r = new FileReader(); r.onerror = () => no(new Error('No se pudo leer el PDF.')); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob) })
      const nombre = `Informe-${tipo}-${periodo}-${R.desde}.pdf`
      const { data, error } = await supabase.functions.invoke('drive', { body: { accion: 'subir', modulo: 'marketing', carpeta: 'Informes', nombre, mime: 'application/pdf', base64 } })
      const d = data as { enlace?: string; error?: string } | null
      let url = d?.enlace || ''
      if (error || d?.error || !url) { url = URL.createObjectURL(blob); aviso('No se pudo guardar en Drive (' + (d?.error || error?.message || 'sin enlace') + '); se abre el PDF aquí.') }
      else aviso('Informe listo.')
      setHechos((h) => [{ url, titulo: R.titulo, rango, res }, ...h])
      window.open(url, '_blank', 'noopener')
    } catch (e) { aviso('No se pudo generar: ' + (e as Error).message) }
    setOcupado(false)
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rv-card">
        <p className="font-bold text-[14px] text-slate-900">Informe de desempeño en PDF</p>
        <p className="text-[11.5px] text-slate-500 mb-3">Con el diseño de VIMEDIC, comparado con el período anterior. Queda en Drive, carpeta “Informes”.</p>
        <span className="mkf-lbl mb-1">Equipo</span>
        <div className="seg mb-3" style={{ flexWrap: 'wrap' }}>{([['marketing', 'Marketing (asistente y audiovisual)'], ['comercial', 'Comercial (asesores)']] as const).map(([k, t]) => <button key={k} type="button" className={tipo === k ? 'active' : ''} onClick={() => setTipo(k)}>{t}</button>)}</div>
        <span className="mkf-lbl mb-1">Período</span>
        <div className="seg mb-3">{([['semanal', 'Semanal (lun a dom)'], ['mensual', 'Mensual']] as const).map(([k, t]) => <button key={k} type="button" className={periodo === k ? 'active' : ''} onClick={() => setPeriodo(k)}>{t}</button>)}</div>
        <label className="mkf-lbl">{periodo === 'mensual' ? 'Cualquier día del mes' : 'Cualquier día de la semana'}<input type="date" className="inp w-full" max={hoyEc()} value={ref} onChange={(e) => setRef(e.target.value || hoyEc())} /></label>
        <p className="text-[11px] text-slate-500 mt-2">{R.titulo} · del {R.desde.split('-').reverse().join('/')} al {R.hasta.split('-').reverse().join('/')}</p>
        <div className="flex justify-end mt-3"><button type="button" className="btn btn-primary" onClick={generar} disabled={ocupado}><FileText />{ocupado ? 'Generando…' : 'Generar PDF'}</button></div>
      </div>
      <div className="rv-card">
        <p className="font-bold text-[13px] text-slate-800 mb-2">Generados en esta sesión</p>
        {!hechos.length && <p className="text-[12px] text-slate-400">Aún no generas informes.</p>}
        {hechos.map((h, i) => <a key={i} href={h.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
          <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: '#e0f2fe', color: '#075985' }}><FileText className="w-4 h-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[12.5px] font-semibold text-slate-800 truncate">{h.titulo}</span><span className="block text-[11px] text-slate-500 truncate">{h.rango} · {h.res}</span></span></a>)}
      </div>
    </div>
  )
}
