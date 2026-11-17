/* Visor de documentos de Facturación (acta de entrega, guía de despacho, etiqueta de envío): vista previa A4
   dentro de la app con «Imprimir» y «Descargar PDF», igual que la proforma. El documento sale al instante en HTML
   (no hay que esperar a que se arme un PDF ni que el navegador permita abrir otra pestaña); el PDF se arma solo
   si se pide. Lo guardado en el sistema es ese mismo HTML (bucket privado «despachos»). */
import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Pencil, Printer, X } from 'lucide-react'
import { supabase } from '../supabase'

export type DocVisor = {
  titulo: string
  /** Documento HTML completo; vacío mientras se descarga. */
  html: string
  /** Nombre del PDF al descargarlo. */
  archivo: string
  /** Arma el PDF (si no se puede, solo queda «Imprimir» → «Guardar como PDF»). */
  pdf?: () => Promise<Blob>
  /** Abre el formulario para cambiar el documento. */
  editar?: () => void
  error?: string
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const INI = '<!--vm-cuerpo-->', FIN = '<!--/vm-cuerpo-->'

/** Envuelve el cuerpo del documento en una página A4 lista para imprimir (márgenes de 12 mm). */
export function documentoCompleto(cuerpo: string, titulo: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>@page{size:A4 portrait;margin:12mm}html,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media screen{html{background:#e2e8f0}body{background:#e2e8f0;padding:16px 0}.vm-hoja{width:186mm;margin:0 auto;padding:12mm;background:#fff;box-shadow:0 2px 14px rgba(15,23,42,.14);box-sizing:content-box}}</style>
</head><body><div class="vm-hoja">${INI}${cuerpo}${FIN}</div></body></html>`
}
/** El cuerpo guardado entre las marcas (para volver a armar el PDF de un documento ya generado). */
export const cuerpoDe = (html: string): string | null => { const i = html.indexOf(INI), f = html.indexOf(FIN); return i >= 0 && f > i ? html.slice(i + INI.length, f) : null }

/** Guarda el documento en el bucket privado «despachos» (carpetas actas/ y guias/). */
export async function guardarDocumento(ruta: string, html: string): Promise<void> {
  const { error } = await supabase.storage.from('despachos').upload(ruta, new Blob([html], { type: 'text/html;charset=utf-8' }), { contentType: 'text/html;charset=utf-8', upsert: true })
  if (error) throw new Error(error.message)
}
/** Lee un documento guardado. */
export async function leerDocumento(ruta: string): Promise<string> {
  const { data, error } = await supabase.storage.from('despachos').download(ruta)
  if (error || !data) throw new Error(error?.message || 'No se encontró el documento.')
  return await data.text()
}

export function VisorDocumento({ doc, cerrar }: { doc: DocVisor; cerrar: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [descargando, setDescargando] = useState(false)
  const [angosto, setAngosto] = useState(() => window.innerWidth < 640)
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f) }, [cerrar])
  useEffect(() => { const f = () => setAngosto(window.innerWidth < 640); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])

  /* En el teléfono la hoja A4 se reduce para verla completa (solo en pantalla: al imprimir sale a tamaño real). */
  const ajustar = () => {
    const f = ref.current, d = f?.contentDocument; if (!f || !d?.head) return
    const k = Math.min(1, (f.clientWidth - 8) / 830)
    let s = d.getElementById('vm-zoom') as HTMLStyleElement | null
    if (!s) { s = d.createElement('style'); s.id = 'vm-zoom'; d.head.appendChild(s) }
    s.textContent = k < 1 ? `@media screen{html{zoom:${k.toFixed(3)}}}` : ''
  }
  useEffect(() => { window.addEventListener('resize', ajustar); return () => window.removeEventListener('resize', ajustar) })

  const imprimir = () => { const w = ref.current?.contentWindow; if (w) { w.focus(); w.print() } }
  async function descargar() {
    if (!doc.pdf) return
    setDescargando(true)
    try {
      const b = await doc.pdf()
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = doc.archivo; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 30000)
    } catch (e) { alert('No se pudo armar el PDF (' + ((e as Error).message || e) + '). Usa «Imprimir» y elige «Guardar como PDF».') }
    finally { setDescargando(false) }
  }

  const btn = (fondo: string, color: string): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 6, minHeight: 38, padding: angosto ? '0 11px' : '0 14px', borderRadius: 10, border: 0, background: fondo, color, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' })
  const ic = { width: 16, height: 16 }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', background: 'rgba(15,23,42,.72)', color: '#0f172a' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', color: '#fff', background: 'linear-gradient(135deg,#0b2545,#055c9d)' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.titulo}</p>
          {!angosto && <p style={{ margin: 0, fontSize: 11, opacity: 0.75 }}>Tamaño A4 · «Imprimir» lo manda a la impresora{doc.pdf ? ' · «Descargar PDF» lo baja directo' : ' o «Guardar como PDF»'}.</p>}
        </div>
        {doc.html && <button type="button" onClick={imprimir} style={btn('#fff', '#055c9d')} title="Imprimir"><Printer style={ic} />{!angosto && 'Imprimir'}</button>}
        {doc.html && doc.pdf && <button type="button" onClick={descargar} disabled={descargando} style={{ ...btn('rgba(255,255,255,.14)', '#fff'), opacity: descargando ? 0.6 : 1 }} title="Descargar PDF">{descargando ? <Loader2 className="animate-spin" style={ic} /> : <Download style={ic} />}{!angosto && (descargando ? 'Armando PDF…' : 'Descargar PDF')}</button>}
        {doc.editar && <button type="button" onClick={doc.editar} style={btn('rgba(255,255,255,.14)', '#fff')} title="Editar"><Pencil style={ic} />{!angosto && 'Editar'}</button>}
        <button type="button" onClick={cerrar} aria-label="Cerrar" style={{ ...btn('rgba(255,255,255,.14)', '#fff'), width: 38, padding: 0, justifyContent: 'center' }}><X style={ic} /></button>
      </div>
      {doc.error && <p style={{ margin: 0, padding: '8px 14px', background: '#fff7ed', color: '#9a3412', fontSize: 12.5, fontWeight: 600, borderBottom: '1px solid #fed7aa' }}>{doc.error}</p>}
      {doc.html
        ? <iframe ref={ref} title={doc.titulo} srcDoc={doc.html} onLoad={ajustar} style={{ flex: 1, width: '100%', border: 0, background: '#e2e8f0' }} />
        : <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14, fontWeight: 600 }}>{doc.error ? '' : <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Loader2 className="animate-spin" style={ic} />Abriendo el documento…</span>}</div>}
    </div>
  )
}
