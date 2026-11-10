import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'

function Ventana({ titulo, cerrar, children, pie }: { titulo: string; cerrar: () => void; children: React.ReactNode; pie: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">{titulo}</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">{children}</div>
        <div className="shrink-0 border-t border-slate-100 p-4 flex gap-2 items-center flex-wrap">{pie}</div>
      </div>
    </div>
  )
}
const fecha = (s: string) => new Date(s).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })

/* ============================ Subir material (Supabase Storage) ============================ */
type Subida = { id: string; archivo: File; titulo: string; estado: 'espera' | 'subiendo' | 'ok' | 'error'; msg: string }
const MAX_MB = 50
export function SubirMaterial({ perfil, cerrar, hecho }: { perfil: Perfil; cerrar: () => void; hecho: () => void }) {
  const [lista, setLista] = useState<Subida[]>([])
  const [campana, setCampana] = useState('')
  const [estadoPieza, setEstadoPieza] = useState('Listo')
  const [arrastrando, setArrastrando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  function agregar(fs: FileList | File[]) {
    const nuevos: Subida[] = []
    Array.from(fs).forEach((f) => {
      const tipoOk = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm))$/.test(f.type)
      const grande = f.size > MAX_MB * 1048576
      nuevos.push({ id: crypto.randomUUID(), archivo: f, titulo: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(), estado: !tipoOk || grande ? 'error' : 'espera',
        msg: !tipoOk ? 'Formato no permitido (JPG, PNG, WEBP, GIF, MP4, MOV o WEBM).' : grande ? `Pesa más de ${MAX_MB} MB.` : '' })
    })
    setLista((a) => [...a, ...nuevos])
  }
  async function subir() {
    setSubiendo(true)
    let ok = 0
    for (const it of lista) {
      if (it.estado !== 'espera') continue
      const marca = (e: Partial<Subida>) => setLista((a) => a.map((x) => (x.id === it.id ? { ...x, ...e } : x)))
      marca({ estado: 'subiendo' })
      const f = it.archivo, ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
      const ruta = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`
      const sube = await supabase.storage.from('audiovisual').upload(ruta, f, { contentType: f.type, cacheControl: '31536000' })
      if (sube.error) { marca({ estado: 'error', msg: sube.error.message }); continue }
      const url = supabase.storage.from('audiovisual').getPublicUrl(ruta).data.publicUrl
      const { error } = await supabase.from('audiovisual').insert({
        id: crypto.randomUUID(), codigo: 'AV-' + crypto.randomUUID().slice(0, 6).toUpperCase(), titulo: it.titulo.trim() || f.name, tipo: f.type.startsWith('video/') ? 'Video' : 'Foto', estado: estadoPieza,
        campana: campana.trim() || null, responsable_id: perfil.id, archivo_url: url, mime: f.type, tamano_mb: Math.round((f.size / 1048576) * 100) / 100,
      })
      if (error) { marca({ estado: 'error', msg: error.message }); continue }
      ok++; marca({ estado: 'ok' })
    }
    setSubiendo(false)
    if (ok) hecho()
  }
  const pend = lista.filter((x) => x.estado === 'espera').length
  return (
    <Ventana titulo="Subir material" cerrar={cerrar} pie={<>
      <span className="text-[11px] text-slate-500 flex-1">{lista.length ? `${lista.filter((x) => x.estado === 'ok').length} de ${lista.length} subidos` : `Hasta ${MAX_MB} MB por archivo`}</span>
      <button className="btn" onClick={cerrar}>{lista.some((x) => x.estado === 'ok') && !pend ? 'Listo' : 'Cancelar'}</button>
      <button className="btn btn-primary" onClick={subir} disabled={!pend || subiendo}>{subiendo ? 'Subiendo…' : `Subir ${pend || ''} archivo${pend === 1 ? '' : 's'}`}</button></>}>
      <label className={'block rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ' + (arrastrando ? 'border-[var(--primary)] bg-sky-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100')}
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true) }} onDragLeave={() => setArrastrando(false)} onDrop={(e) => { e.preventDefault(); setArrastrando(false); agregar(e.dataTransfer.files) }}>
        <input type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => { if (e.target.files) agregar(e.target.files); e.target.value = '' }} />
        <p className="text-3xl">📤</p><p className="text-sm font-bold text-slate-700 mt-1">Arrastra fotos y videos aquí</p><p className="text-[11px] text-slate-500">o toca para elegirlos del equipo o la galería</p>
      </label>
      {lista.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] font-bold text-slate-500">Campaña (opcional)<input className="inp w-full mt-1" value={campana} onChange={(e) => setCampana(e.target.value)} /></label>
          <label className="block text-[11px] font-bold text-slate-500">Estado inicial<select className="inp w-full mt-1" value={estadoPieza} onChange={(e) => setEstadoPieza(e.target.value)}>{['Idea', 'En producción', 'En edición', 'Listo'].map((x) => <option key={x}>{x}</option>)}</select></label>
        </div>
      )}
      <div className="space-y-1.5">
        {lista.map((x) => (
          <div key={x.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2">
            <input className="inp flex-1 min-w-0" value={x.titulo} disabled={x.estado !== 'espera'} onChange={(e) => setLista((a) => a.map((y) => (y.id === x.id ? { ...y, titulo: e.target.value } : y)))} />
            <span className="text-[10px] shrink-0 w-28 text-right" style={{ color: x.estado === 'ok' ? '#04896f' : x.estado === 'error' ? '#c0392b' : '#64748b' }} title={x.msg}>
              {x.estado === 'ok' ? '✓ Subido' : x.estado === 'error' ? (x.msg.slice(0, 26) || 'Error') : x.estado === 'subiendo' ? 'Subiendo…' : (x.archivo.size / 1048576).toFixed(1) + ' MB'}</span>
            {x.estado !== 'subiendo' && x.estado !== 'ok' && <button className="text-slate-300 hover:text-red-600" onClick={() => setLista((a) => a.filter((y) => y.id !== x.id))} aria-label="Quitar"><X className="w-4 h-4" /></button>}
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
