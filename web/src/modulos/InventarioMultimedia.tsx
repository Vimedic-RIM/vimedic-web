import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Link2, Trash2, Upload, Video, X } from 'lucide-react'
import { supabase } from '../supabase'
import { imagenWebp, subirCatalogo } from './audiovisualMedios'

/* Inventario › "Editar multimedia" (getProductoRawMultimedia, actualizarMultimediaProducto, guardarGaleriaProducto
   del original): imagen principal, ficha técnica, carpeta de multimedia y galería (fotos y videos, orden, texto
   alternativo y tipo de video). Lo usa quien tiene "Editar Multimedia" aunque no edite el resto del producto. */

type ItemG = { id?: string; tipo: 'imagen' | 'video'; archivo_url: string; descripcion: string; tipo_video: string }
const TIPOS_VIDEO = ['Comercial', 'Informativo', 'Reel para redes', 'Técnico', 'Demostración en uso', 'Testimonio']
const MAX = 30
const miniatura = (url: string, w: number) => {
  const v = String(url || '').trim()
  try {
    const u = new URL(v)
    if (u.hostname !== 'drive.google.com' && !/^lh[0-9]+\.googleusercontent\.com$/.test(u.hostname)) return v
    const m = u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/), id = m ? m[1] : u.searchParams.get('id')
    return id ? `https://lh3.googleusercontent.com/d/${id}=w${w}` : v
  } catch { return v }
}
const ytMini = (url: string) => { const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/); return m ? `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg` : '' }
const https = (v: string) => /^https:\/\/\S+$/i.test(v.trim())

function Seccion({ n, t, children }: { n: number; t: string; children: React.ReactNode }) {
  return <section className="pf-sec"><header><span className="pf-num">{n}</span><h4>{t}</h4></header>{children}</section>
}

export function EditarMultimedia({ producto, cerrar, guardado }: { producto: { id: string; codigo: string; nombre: string }; cerrar: () => void; guardado: () => void }) {
  const [imagen, setImagen] = useState('')
  const [ficha, setFicha] = useState('')
  const [carpeta, setCarpeta] = useState('')
  const [items, setItems] = useState<ItemG[] | null>(null)
  const [nuevoUrl, setNuevoUrl] = useState('')
  const [nuevoTipo, setNuevoTipo] = useState<'imagen' | 'video'>('imagen')
  const [subiendo, setSubiendo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('productos').select('imagen_url,ficha_tecnica_url,drive_carpeta_url').eq('id', producto.id).single(),
      supabase.from('producto_galeria').select('id,tipo,archivo_url,descripcion,tipo_video').eq('producto_id', producto.id).is('deleted_at', null).order('orden'),
    ]).then(([p, g]) => {
      const d = (p.data ?? {}) as { imagen_url?: string | null; ficha_tecnica_url?: string | null; drive_carpeta_url?: string | null }
      setImagen(d.imagen_url ?? ''); setFicha(d.ficha_tecnica_url ?? ''); setCarpeta(d.drive_carpeta_url ?? '')
      setItems(((g.data ?? []) as { id: string; tipo: string; archivo_url: string; descripcion: string | null; tipo_video: string | null }[])
        .map((x) => ({ id: x.id, tipo: x.tipo === 'video' ? 'video' : 'imagen', archivo_url: x.archivo_url, descripcion: x.descripcion ?? '', tipo_video: x.tipo_video ?? '' })))
    })
  }, [producto.id])

  async function subirPrincipal(f: File | undefined) {
    if (!f) return
    setSubiendo('Subiendo la imagen principal…'); setError('')
    try { setImagen(await subirCatalogo(await imagenWebp(f), 'productos/' + producto.codigo, 'webp', 'image/webp')) } catch (e) { setError((e as Error).message) }
    setSubiendo('')
  }
  async function subirGaleria(files: FileList | null) {
    if (!files || !items) return
    const lista = Array.from(files).slice(0, MAX - items.length)
    const nuevos: ItemG[] = []
    for (const [k, f] of lista.entries()) {
      setSubiendo(`Subiendo ${k + 1} de ${lista.length}…`)
      try {
        if (f.type.startsWith('image/')) nuevos.push({ tipo: 'imagen', archivo_url: await subirCatalogo(await imagenWebp(f), 'productos/' + producto.codigo + '/galeria', 'webp', 'image/webp'), descripcion: '', tipo_video: '' })
        else if (/^video\/(mp4|webm|quicktime)$/.test(f.type)) {
          if (f.size > 50 * 1048576) throw new Error(f.name + ' pesa más de 50 MB: súbelo a YouTube y pega el enlace.')
          nuevos.push({ tipo: 'video', archivo_url: await subirCatalogo(f, 'productos/' + producto.codigo + '/galeria', (f.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, ''), f.type), descripcion: '', tipo_video: '' })
        } else throw new Error(f.name + ': formato no admitido (JPG, PNG, WebP, MP4, WebM o MOV).')
      } catch (e) { setError((e as Error).message) }
    }
    setItems((l) => [...(l ?? []), ...nuevos]); setSubiendo('')
  }
  function agregarEnlace() {
    const u = nuevoUrl.trim()
    if (!https(u)) { setError('Pega un enlace que empiece con https://'); return }
    if ((items?.length ?? 0) >= MAX) { setError(`La galería admite hasta ${MAX} elementos.`); return }
    setItems((l) => [...(l ?? []), { tipo: nuevoTipo, archivo_url: u, descripcion: '', tipo_video: '' }]); setNuevoUrl(''); setError('')
  }
  const mover = (i: number, d: -1 | 1) => setItems((l) => { if (!l) return l; const j = i + d; if (j < 0 || j >= l.length) return l; const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c })
  const cambiar = (i: number, cambios: Partial<ItemG>) => setItems((l) => (l ?? []).map((x, k) => (k === i ? { ...x, ...cambios } : x)))

  async function guardar() {
    if (!items) return
    for (const [k, v] of [['imagen principal', imagen], ['ficha técnica', ficha], ['carpeta de multimedia', carpeta]] as const) if (v.trim() && !https(v)) { setError(`El enlace de ${k} debe empezar con https://`); return }
    setGuardando(true); setError('')
    const a = await supabase.rpc('inv_guardar_multimedia', { p_producto: producto.id, p_datos: { imagen: imagen.trim(), ficha: ficha.trim(), album: carpeta.trim() } })
    const b = a.error ? null : await supabase.rpc('inv_galeria_guardar', { p_producto: producto.id, p_items: items.map((x) => ({ id: x.id ?? null, tipo: x.tipo, archivo_url: x.archivo_url, descripcion: x.descripcion, tipo_video: x.tipo_video })) })
    setGuardando(false)
    const err = a.error ?? b?.error
    if (err) { setError(err.message); return }
    guardado()
  }

  return (
    <div style={{ zIndex: 135 }} className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="pf-shell w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-2xl flex flex-col overflow-hidden sm:rounded-3xl shadow-2xl">
        <div className="pf-head px-5 pt-4 pb-3 text-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><ImagePlus className="w-5 h-5" /></span>
            <div className="min-w-0"><h3 className="font-display font-bold text-base leading-tight">Editar multimedia</h3><p className="text-[11px] text-white/70 truncate">{producto.codigo} · {producto.nombre}</p></div>
            <button type="button" onClick={cerrar} className="pf-x" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
        </div>
        {!items ? <div style={{ padding: 24 }} className="flex-1 text-xs text-slate-400">Cargando…</div> : (
          <>
            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-3 bg-slate-50">
              <Seccion n={1} t="Imagen principal">
                <div className="pf-img">
                  <div className="pf-img-box">{imagen ? <img src={miniatura(imagen, 320)} alt="" /> : <span><ImagePlus className="w-7 h-7" />Sin imagen</span>}</div>
                  <div className="min-w-0 flex-1">
                    <label className="pf-img-btn" style={{ cursor: 'pointer' }}><Upload className="w-4 h-4" />Subir imagen<input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { subirPrincipal(e.target.files?.[0]); e.target.value = '' }} /></label>
                    <input type="text" className="pf-in mt-2" placeholder="…o pega el enlace (Drive o web)" value={imagen} onChange={(e) => setImagen(e.target.value)} />
                    {imagen && <button type="button" className="pf-img-btn pf-img-del mt-2" onClick={() => setImagen('')}><Trash2 className="w-4 h-4" />Quitar</button>}
                  </div>
                </div>
              </Seccion>
              <Seccion n={2} t="Ficha técnica y carpeta">
                <div className="pf-grid">
                  <label className="pf-f pf-full"><span>Ficha técnica (enlace al PDF)</span><input type="text" className="pf-in" placeholder="https://drive.google.com/…" value={ficha} onChange={(e) => setFicha(e.target.value)} /></label>
                  <label className="pf-f pf-full"><span>Carpeta de multimedia</span><input type="text" className="pf-in" placeholder="https://drive.google.com/drive/folders/…" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} /></label>
                </div>
              </Seccion>
              <Seccion n={3} t={`Galería del catálogo (${items.length} de ${MAX})`}>
                <p className="text-[11px] text-slate-500 mb-2">Fotos y videos que se ven en el catálogo después de la imagen principal.</p>
                <div className="space-y-2">
                  {items.map((x, i) => (
                    <div key={(x.id ?? '') + x.archivo_url + i} className="flex gap-2 items-start rounded-xl border border-slate-200 bg-white p-2">
                      <span className="w-14 h-14 rounded-lg bg-slate-100 overflow-hidden grid place-items-center shrink-0 text-slate-400">
                        {x.tipo === 'video' ? (ytMini(x.archivo_url) ? <img src={ytMini(x.archivo_url)} alt="" className="w-full h-full object-cover" /> : <Video className="w-5 h-5" />)
                          : <img src={miniatura(x.archivo_url, 160)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <input type="text" className="pf-in" placeholder="Texto alternativo (qué se ve)" value={x.descripcion} onChange={(e) => cambiar(i, { descripcion: e.target.value })} />
                        {x.tipo === 'video' && <select className="pf-in" value={x.tipo_video} onChange={(e) => cambiar(i, { tipo_video: e.target.value })}><option value="">Tipo de video…</option>{TIPOS_VIDEO.map((t) => <option key={t}>{t}</option>)}</select>}
                      </div>
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button type="button" className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button type="button" className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" disabled={i === items.length - 1} onClick={() => mover(i, 1)} aria-label="Bajar"><ArrowDown className="w-3.5 h-3.5" /></button>
                        <button type="button" className="p-1 text-red-500 hover:text-red-700" onClick={() => setItems((l) => (l ?? []).filter((_, k) => k !== i))} aria-label="Quitar"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 items-center mt-2">
                  <select className="pf-in" style={{ width: 'auto' }} value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value as 'imagen' | 'video')}><option value="imagen">Foto</option><option value="video">Video</option></select>
                  <input type="text" className="pf-in flex-1" style={{ minWidth: 160 }} placeholder={nuevoTipo === 'video' ? 'Enlace de YouTube o .mp4' : 'Enlace de la foto (https://)'} value={nuevoUrl} onChange={(e) => setNuevoUrl(e.target.value)} />
                  <button type="button" className="pf-img-btn" onClick={agregarEnlace}><Link2 className="w-4 h-4" />Agregar</button>
                  <label className="pf-img-btn" style={{ cursor: 'pointer' }}><Upload className="w-4 h-4" />Subir fotos o videos<input type="file" hidden multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={(e) => { subirGaleria(e.target.files); e.target.value = '' }} /></label>
                </div>
              </Seccion>
              {(subiendo || error) && <div className="text-xs font-semibold rounded-xl px-3 py-2" style={error ? { color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca' } : { color: '#055c9d', background: '#eef6fd' }}>{error || subiendo}</div>}
            </div>
            <div className="shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4">
              <button onClick={guardar} disabled={guardando || !!subiendo} className="pf-submit">{guardando ? 'Guardando…' : 'Guardar multimedia'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
