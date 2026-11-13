import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { subirPorPartes } from './modulos/audiovisualMedios'
import './estilos/encuesta.css'

/* Material de productos que VIMEDIC pide a un proveedor (vmMatPublico / vmMatIniciarSubida / vmMatGuardarEnlace).
   Página pública sin cuenta: /material/?c=<código>. El proveedor sube fichas, manuales, certificaciones y videos. */
type Archivo = { tipo: string; nombre: string; tam: number; fecha: string; enlace: boolean }
type Prod = { clave: string; codigo: string; nombre: string; modelo: string; codInterno: string; marca: string; imagen: string; pide: Record<string, number>; nota: string; archivos: Archivo[] }
type Sol = { codigo: string; proveedor: string; titulo: string; vence: string; nota: string; vigente: boolean; estado: string; productos: Prod[] }
const TIPOS: [string, string, string][] = [['ficha', 'Ficha técnica', 'Datasheet'], ['manual', 'Manual', 'User manual'], ['cert', 'Certificaciones', 'Certificates'], ['video', 'Videos', 'Videos'], ['otro', 'Otros', 'Other']]
const tipoTxt = (k: string) => { const t = TIPOS.find((x) => x[0] === k); return t ? t[1] + ' / ' + t[2] : k }
const tam = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n ? n + ' B' : '')

export default function MaterialPublico() {
  const codigo = new URLSearchParams(window.location.search).get('c') ?? ''
  const [s, setS] = useState<Sol | null>(null)
  const [error, setError] = useState('')
  const [subiendo, setSubiendo] = useState<Record<string, { nombre: string; p: number }>>({})
  const [aviso, setAviso] = useState('')
  const cargar = useCallback(async () => {
    if (!codigo) { setError('Enlace no válido. / Invalid link.'); return }
    const { data, error: e } = await supabase.rpc('material_publico', { p_token: codigo })
    if (e) { setError(e.message); return }
    setS(data as Sol); document.title = 'VIMEDIC · ' + (data as Sol).titulo
  }, [codigo])
  useEffect(() => { document.title = 'VIMEDIC · Material de productos'; cargar() }, [cargar])

  async function subir(p: Prod, tipo: string, files: File[]) {
    setAviso('')
    for (const f of files) {
      const k = p.clave + ':' + f.name + ':' + Date.now()
      setSubiendo((x) => ({ ...x, [k]: { nombre: f.name, p: 0 } }))
      try {
        const ini = await supabase.functions.invoke('drive', { body: { accion: 'material_iniciar', token: codigo, clave: p.clave, tipo, nombre: f.name, mime: f.type || 'application/octet-stream', tamano: f.size } })
        const sesion = (ini.data as { sesion?: string } | null)?.sesion
        if (!sesion) throw new Error((ini.data as { error?: string } | null)?.error || 'No se pudo iniciar la subida. / Could not start the upload.')
        const d = await subirPorPartes(sesion, f, (v) => setSubiendo((x) => ({ ...x, [k]: { nombre: f.name, p: v } })))
        const reg = await supabase.functions.invoke('drive', { body: { accion: 'material_registrar', token: codigo, clave: p.clave, tipo, id: d.id, nombre: f.name } })
        if ((reg.data as { error?: string } | null)?.error || reg.error) throw new Error((reg.data as { error?: string } | null)?.error || reg.error?.message || 'Error')
        setAviso('✓ ' + f.name)
      } catch (e) { setAviso((e as Error).message) }
      setSubiendo((x) => { const y = { ...x }; delete y[k]; return y })
    }
    cargar()
  }
  async function enlace(p: Prod, tipo: string, url: string, nombre: string) {
    setAviso('')
    const { data, error: e } = await supabase.rpc('material_guardar_enlace', { p_token: codigo, d: { clave: p.clave, tipo, url, nombre } })
    if (e) { setAviso(e.message); return false }
    setS(data as Sol); setAviso('✓ Enlace guardado / Link saved'); return true
  }

  return (
    <div className="enc">
      <header className="enc-top"><div className="enc-wrap" style={{ maxWidth: 820 }}>
        <b className="enc-marca">VIMEDIC</b>
        <h1>Material de productos · Product documentation</h1>
        <p>{s ? <>{s.codigo}{s.proveedor ? ' · ' + s.proveedor : ''} · válido hasta / valid until {s.vence}</> : 'Fichas técnicas, manuales, certificaciones y videos'}</p>
      </div></header>
      <main className="enc-wrap" style={{ maxWidth: 820 }}>
        {error && <div className="enc-card"><p className="enc-msg err">{error}</p></div>}
        {!error && !s && <div className="enc-card"><div className="enc-spin" aria-label="Cargando" /></div>}
        {s && !s.vigente && <div className="enc-card"><p className="enc-msg err">{s.estado !== 'Abierta' ? 'Este enlace ya fue cerrado por VIMEDIC. / This link has been closed.' : 'Este enlace venció el ' + s.vence + '. / This link expired on ' + s.vence + '.'}</p></div>}
        {s?.vigente && <div className="enc-card">
          <p className="enc-msg info" style={{ marginTop: 0 }}>Suba los archivos de cada producto (PDF, Word, imágenes, videos hasta 1 GB) o pegue un enlace de descarga (WeTransfer, Google Drive…).<br />Upload the files for each product (PDF, Word, images, videos up to 1 GB) or paste a download link.</p>
          {s.nota && <p className="mt-nota">{s.nota}</p>}
          {aviso && <p className={'enc-msg ' + (aviso.startsWith('✓') ? 'info' : 'err')}>{aviso}</p>}
          {Object.values(subiendo).map((u, i) => <div key={i} className="mt-sub"><span>{u.nombre}</span><span className="sp-barra" style={{ flex: 1, margin: 0 }}><i style={{ width: Math.round(u.p * 100) + '%' }} /></span><b>{Math.round(u.p * 100)}%</b></div>)}
          {s.productos.map((p, n) => <ProductoMat key={p.clave} n={n + 1} p={p} subir={subir} enlace={enlace} ocupado={Object.keys(subiendo).some((k) => k.startsWith(p.clave + ':'))} />)}
          {!s.productos.length && <p className="enc-msg info">No hay productos abiertos en esta solicitud. / No open products.</p>}
        </div>}
        <p className="enc-pie">VIMEDIC · Equipos médicos</p>
      </main>
    </div>
  )
}

function ProductoMat({ n, p, subir, enlace, ocupado }: { n: number; p: Prod; subir: (p: Prod, tipo: string, f: File[]) => void; enlace: (p: Prod, tipo: string, url: string, nombre: string) => Promise<boolean>; ocupado: boolean }) {
  const pedidos = TIPOS.filter(([k]) => p.pide?.[k])
  const [tipo, setTipo] = useState(pedidos[0]?.[0] ?? 'otro')
  const [url, setUrl] = useState('')
  const recibidos = (k: string) => p.archivos.filter((a) => a.tipo === k).length
  return (
    <section className="mt-prod">
      <div className="mt-cab">
        {p.imagen ? <img src={p.imagen} alt="" loading="lazy" /> : <span className="mt-n">{n}</span>}
        <div>
          {p.modelo && <b className="mt-mod">Model / 型号: {p.modelo}</b>}
          {p.codInterno && <b className="mt-ci">Code / 编码: {p.codInterno}</b>}
          <span className="mt-nom">{p.nombre}</span>
          <small>{[p.codigo ? 'VIMEDIC: ' + p.codigo : '', p.marca].filter(Boolean).join(' · ')}</small>
          {p.nota && <small>{p.nota}</small>}
        </div>
      </div>
      <div className="mt-pide">{pedidos.map(([k, es, en]) => <span key={k} className={recibidos(k) ? 'ok' : ''}>{recibidos(k) ? '✓ ' : ''}{es} / {en}{recibidos(k) ? ' (' + recibidos(k) + ')' : ''}</span>)}</div>
      <div className="mt-acc">
        <select className="enc-inp" style={{ marginTop: 0, maxWidth: 230 }} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de archivo / File type">{TIPOS.map(([k, es, en]) => <option key={k} value={k}>{es} / {en}</option>)}</select>
        <label className="mt-btn">{ocupado ? 'Subiendo… / Uploading…' : 'Subir archivos / Upload files'}<input type="file" multiple hidden disabled={ocupado} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) subir(p, tipo, f) }} /></label>
      </div>
      <div className="mt-acc">
        <input className="enc-inp" style={{ marginTop: 0, flex: 1 }} placeholder="https://… (WeTransfer, Google Drive, Baidu…)" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Enlace de descarga / Download link" />
        <button type="button" className="mt-btn sec" disabled={!url.trim()} onClick={async () => { if (await enlace(p, tipo, url.trim(), '')) setUrl('') }}>Guardar enlace / Save link</button>
      </div>
      {p.archivos.length > 0 && <ul className="mt-arch">{p.archivos.map((a, i) => <li key={i}><b>{tipoTxt(a.tipo)}</b> · {a.nombre}{a.tam ? ' · ' + tam(a.tam) : ''}{a.enlace ? ' · enlace / link' : ''}</li>)}</ul>}
    </section>
  )
}
