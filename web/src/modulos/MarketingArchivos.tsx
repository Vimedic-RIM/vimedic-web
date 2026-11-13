import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { LIMITE_APP_MB, LIMITE_DRIVE_MB, MIME_AV, fotogramaVideo, guardarMiniatura, prepararPortada, subirArchivoAv } from './audiovisualMedios'

function Ventana({ titulo, cerrar, children, pie }: { titulo: string; cerrar: () => void; children: React.ReactNode; pie: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden" style={{ maxWidth: 640 }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">{children}</div>
        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 items-center flex-wrap">{pie}</div>
      </div>
    </div>
  )
}
const fecha = (s: string) => new Date(s).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })

/* ============================ Buscador de productos (visibles al público primero) ============================ */
export type ProdBusq = { id: string; codigo: string; nombre: string }
export function BuscadorProducto({ valor, cambiar, placeholder = 'Producto (código o nombre)…' }: { valor: ProdBusq | null; cambiar: (p: ProdBusq | null) => void; placeholder?: string }) {
  const [q, setQ] = useState(valor ? valor.codigo + ' · ' + valor.nombre : '')
  const [opc, setOpc] = useState<ProdBusq[]>([])
  const [ver, setVer] = useState(false)
  useEffect(() => { setQ(valor ? valor.codigo + ' · ' + valor.nombre : '') }, [valor?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = q.replace(/[,()%*\\]/g, ' ').trim()
    if (!ver || t.length < 2 || (valor && q === valor.codigo + ' · ' + valor.nombre)) { setOpc([]); return }
    const h = window.setTimeout(() => {
      supabase.from('productos').select('id,codigo,nombre').is('deleted_at', null).or(`nombre.ilike.%${t}%,codigo.ilike.%${t}%`)
        .order('en_catalogo', { ascending: false }).order('nombre').limit(8).then(({ data }) => setOpc((data as ProdBusq[]) ?? []))
    }, 250)
    return () => window.clearTimeout(h)
  }, [q, ver, valor])
  return (
    <div className="relative">
      <input value={q} onChange={(e) => { setQ(e.target.value); setVer(true); if (valor) cambiar(null) }} onFocus={() => setVer(true)} onBlur={() => setTimeout(() => setVer(false), 180)} className="inp w-full" placeholder={placeholder} />
      {ver && opc.length > 0 && <div className="mk-ac">{opc.map((p) => (
        <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { cambiar(p); setQ(p.codigo + ' · ' + p.nombre); setVer(false) }}><b>{p.codigo}</b> · {p.nombre}</button>))}</div>}
    </div>
  )
}
export function useEquipo() {
  const [lista, setLista] = useState<{ id: string; nombre: string }[]>([])
  useEffect(() => { supabase.from('v_directorio_empleados').select('id,nombre').order('nombre').then(({ data }) => setLista((data as { id: string; nombre: string }[]) ?? [])) }, [])
  return lista
}

/* ============================ Subir material ============================
   Como el original (avStartUpload): varios archivos a la vez, con tipo, estado, fecha, responsable,
   producto, campaña, notas y portada para los videos. Los livianos se guardan en la app; los videos
   pesados (hasta 2 GB) van directo a Google Drive por partes, con enlace para Zernio. */
type Subida = { id: string; archivo: File; titulo: string; estado: 'espera' | 'subiendo' | 'ok' | 'error'; msg: string; pct: number }
const AV_TIPOS = ['Foto', 'Video', 'Reel', 'Historia', 'Carrusel', 'Diseño']
const hoyEc = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)
export function SubirMaterial({ perfil, cerrar, hecho }: { perfil: Perfil; cerrar: () => void; hecho: () => void }) {
  const [lista, setLista] = useState<Subida[]>([])
  const [campana, setCampana] = useState('')
  const [estadoPieza, setEstadoPieza] = useState('Listo')
  const [tipo, setTipo] = useState('auto')
  const [fechaP, setFechaP] = useState(hoyEc)
  const [resp, setResp] = useState(perfil.id)
  const [prod, setProd] = useState<ProdBusq | null>(null)
  const [notas, setNotas] = useState('')
  const [portada, setPortada] = useState<File | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const equipo = useEquipo()
  function agregar(fs: FileList | File[]) {
    const nuevos: Subida[] = []
    Array.from(fs).forEach((f) => {
      const tipoOk = MIME_AV.test(f.type), grande = f.size > LIMITE_DRIVE_MB * 1048576
      nuevos.push({ id: crypto.randomUUID(), archivo: f, titulo: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(), estado: !tipoOk || grande ? 'error' : 'espera', pct: 0,
        msg: !tipoOk ? 'Formato no permitido (JPG, PNG, WebP, GIF, MP4, MOV o WebM).' : grande ? 'Supera los 2 GB.' : '' })
    })
    setLista((a) => [...a, ...nuevos])
  }
  async function subir() {
    setSubiendo(true)
    for (const it of lista) {
      if (it.estado !== 'espera') continue
      const marca = (e: Partial<Subida>) => setLista((a) => a.map((x) => (x.id === it.id ? { ...x, ...e } : x)))
      marca({ estado: 'subiendo', pct: 0, msg: 'Subiendo…' })
      const f = it.archivo
      try {
        const a = await subirArchivoAv(f, (pct, msg) => marca({ pct, msg }))
        marca({ pct: 0.97, msg: 'Guardando…' })
        const id = crypto.randomUUID()
        const { error } = await supabase.from('audiovisual').insert({
          id, codigo: 'AV-' + crypto.randomUUID().slice(0, 6).toUpperCase(), titulo: it.titulo.trim() || f.name,
          tipo: tipo === 'auto' ? (f.type.startsWith('video/') ? 'Video' : 'Foto') : tipo, estado: estadoPieza, fecha: fechaP ? fechaP + 'T12:00:00-05:00' : new Date().toISOString(),
          campana: campana.trim() || null, notas: notas.trim() || null, producto_id: prod?.id ?? null, responsable_id: resp || perfil.id,
          archivo_url: a.url, archivo_drive_id: a.driveId, enlace_publico: a.enlace, mime: a.mime, tamano_mb: a.tamanoMb,
        })
        if (error) throw new Error(error.message)
        marca({ estado: 'ok', pct: 1, msg: '✓ Subido' + (a.driveId ? ' a Drive' : '') })
        hecho()
        // Portada del video: la elegida o un fotograma (avSubirMiniatura).
        if (f.type.startsWith('video/')) {
          const b = portada ? await prepararPortada(portada).catch(() => null) : null
          const img = b ?? (await fotogramaVideo(f))
          if (img) { await guardarMiniatura(id, img).catch(() => undefined); hecho() }
        }
      } catch (e) { marca({ estado: 'error', msg: (e as Error).message }) }
    }
    setSubiendo(false)
  }
  const pend = lista.filter((x) => x.estado === 'espera').length
  const hayVideo = lista.some((x) => x.archivo.type.startsWith('video/'))
  return (
    <Ventana titulo="Subir material" cerrar={cerrar} pie={<>
      <span className="text-[11px] text-slate-500 flex-1">{lista.length ? `${lista.filter((x) => x.estado === 'ok').length} de ${lista.length} subidos${subiendo ? ' · puedes cerrar: sigue en segundo plano' : ''}` : `Hasta ${LIMITE_APP_MB} MB en la app; los videos más pesados (hasta 2 GB) van a Drive`}</span>
      <button className="btn" onClick={cerrar}>{lista.some((x) => x.estado === 'ok') && !pend ? 'Listo' : subiendo ? 'Cerrar' : 'Cancelar'}</button>
      <button className="btn btn-primary" onClick={subir} disabled={!pend || subiendo}>{subiendo ? 'Subiendo…' : `Subir ${pend || ''} archivo${pend === 1 ? '' : 's'}`}</button></>}>
      <label className={'block rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ' + (arrastrando ? 'bg-sky-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100')} style={arrastrando ? { borderColor: 'var(--primary)' } : undefined}
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }} onDragLeave={() => setArrastrando(false)} onDrop={(e) => { e.preventDefault(); setArrastrando(false); agregar(e.dataTransfer.files) }}>
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => { if (e.target.files) agregar(e.target.files); e.target.value = '' }} />
        <p className="text-3xl">📤</p><p className="text-sm font-bold text-slate-700 mt-1">Arrastra fotos y videos aquí</p><p className="text-[11px] text-slate-500">o toca para elegirlos del equipo o la galería</p>
      </label>
      {lista.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] font-bold text-slate-500">Tipo<select className="inp w-full mt-1" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="auto">Automático (foto / video)</option>{AV_TIPOS.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="block text-[11px] font-bold text-slate-500">Estado inicial<select className="inp w-full mt-1" value={estadoPieza} onChange={(e) => setEstadoPieza(e.target.value)}>{['Idea', 'En producción', 'En edición', 'Listo'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="block text-[11px] font-bold text-slate-500">Fecha<input type="date" className="inp w-full mt-1" value={fechaP} onChange={(e) => setFechaP(e.target.value)} /></label>
          <label className="block text-[11px] font-bold text-slate-500">Responsable<select className="inp w-full mt-1" value={resp} onChange={(e) => setResp(e.target.value)}>{!equipo.some((x) => x.id === perfil.id) && <option value={perfil.id}>{perfil.nombre}</option>}{equipo.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
          <div className="block text-[11px] font-bold text-slate-500 col-span-2">Producto (opcional)<div className="mt-1"><BuscadorProducto valor={prod} cambiar={setProd} /></div></div>
          <label className="block text-[11px] font-bold text-slate-500">Campaña (opcional)<input className="inp w-full mt-1" value={campana} onChange={(e) => setCampana(e.target.value)} /></label>
          {hayVideo ? <label className="block text-[11px] font-bold text-slate-500">Portada de los videos (opcional)<input type="file" accept="image/jpeg,image/png,image/webp" className="block mt-1 text-[11px] w-full" onChange={(e) => setPortada(e.target.files?.[0] ?? null)} /><span className="font-normal text-slate-400">Si no eliges, se toma un fotograma.</span></label> : <span />}
          <label className="block text-[11px] font-bold text-slate-500 col-span-2">Notas (opcional)<textarea rows={2} className="inp w-full mt-1" value={notas} onChange={(e) => setNotas(e.target.value)} /></label>
        </div>
      )}
      <div className="space-y-1.5">
        {lista.map((x) => (
          <div key={x.id} className="rounded-xl border border-slate-200 p-2">
            <div className="flex items-center gap-2">
              <input className="inp flex-1 min-w-0" value={x.titulo} disabled={x.estado !== 'espera'} onChange={(e) => setLista((a) => a.map((y) => (y.id === x.id ? { ...y, titulo: e.target.value } : y)))} />
              <span className="text-[10px] shrink-0 text-right" style={{ width: 120, color: x.estado === 'ok' ? '#04896f' : x.estado === 'error' ? '#c0392b' : '#64748b' }} title={x.msg}>
                {x.estado === 'espera' ? (x.archivo.size / 1048576).toFixed(1) + ' MB' + (x.archivo.size > LIMITE_APP_MB * 1048576 ? ' · Drive' : '') : x.msg.slice(0, 34) || 'Error'}</span>
              {x.estado !== 'subiendo' && x.estado !== 'ok' && <button className="text-slate-300 hover:text-red-600" onClick={() => setLista((a) => a.filter((y) => y.id !== x.id))} aria-label="Quitar"><X className="w-4 h-4" /></button>}
            </div>
            {x.estado === 'subiendo' && <div className="mk-cola-b"><i style={{ width: Math.round(x.pct * 100) + '%' }} /></div>}
          </div>
        ))}
      </div>
    </Ventana>
  )
}

/* ============================ Papelera de Audiovisual ============================ */
export function PapeleraAv({ cerrar, restaurado }: { cerrar: () => void; restaurado: () => void }) {
  const [lista, setLista] = useState<{ id: string; titulo: string; codigo: string | null; tipo: string | null; deleted_at: string }[] | null>(null)
  const cargar = useCallback(() => {
    supabase.from('audiovisual').select('id,titulo,codigo,tipo,deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100).then(({ data }) => setLista((data as never) ?? []))
  }, [])
  useEffect(() => { cargar() }, [cargar])
  async function restaurar(id: string) {
    const { error } = await supabase.from('audiovisual').update({ deleted_at: null }).eq('id', id)
    if (error) { alert('No se pudo restaurar: ' + error.message); return }
    cargar(); restaurado()
  }
  return (
    <Ventana titulo="Papelera · Audiovisual" cerrar={cerrar} pie={<button className="btn" onClick={cerrar}>Cerrar</button>}>
      {!lista && <p className="text-xs text-slate-400">Cargando…</p>}
      {lista && !lista.length && <p className="text-xs text-slate-400 text-center py-6">La papelera está vacía.</p>}
      {lista?.map((x) => (
        <div key={x.id} className="flex items-center gap-3 py-2 border-b border-dashed border-slate-200 last:border-0">
          <div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-800 truncate">{x.titulo}</p><p className="text-[11px] text-slate-500">{x.codigo} · {x.tipo} · eliminado {fecha(x.deleted_at)}</p></div>
          <button className="btn" onClick={() => restaurar(x.id)}>Restaurar</button>
        </div>
      ))}
    </Ventana>
  )
}
