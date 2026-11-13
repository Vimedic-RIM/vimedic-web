import { supabase } from '../supabase'

/* Medios de Audiovisual: miniaturas, portadas, enlace para Zernio y subida de archivos.
   Igual que el original (Data Audiovisual.gs + Marketing.html): los archivos viven en la app
   (hasta 45 MB) o en Google Drive (videos grandes, hasta 2 GB, subidos directo por partes). */

export type MedioAv = { url: string; mime: string; tipo: string; driveId?: string | null; enlace?: string | null; miniId?: string | null; miniUrl?: string | null }

export const LIMITE_APP_MB = 45
export const LIMITE_DRIVE_MB = 2048
export const MIME_AV = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|quicktime|webm))$/

export const idDrive = (url?: string | null) => { const m = String(url || '').match(/\/d\/([\w-]{20,})/) || String(url || '').match(/[?&]id=([\w-]{20,})/); return m ? m[1] : '' }
export const esVideoAv = (it: Pick<MedioAv, 'mime' | 'tipo'>) => /^video\//.test(it.mime || '') || (!/^image\//.test(it.mime || '') && ['Video', 'Reel'].includes(it.tipo))
const lh3 = (id: string, w: number) => `https://lh3.googleusercontent.com/d/${id}=w${w}`

/** Miniatura para tarjetas y calendario: portada propia, imagen del archivo o la de Drive. */
export function miniaturaAv(it: MedioAv, w = 480): string {
  if (it.miniUrl) return it.miniUrl
  if (it.miniId && /^[\w-]{10,}$/.test(it.miniId)) return lh3(it.miniId, w)
  const d = it.driveId || idDrive(it.url)
  if (d) return lh3(d, w)
  if (it.url && !esVideoAv(it)) return it.url
  return ''
}
/** Enlace directo que Zernio puede descargar (avPrepararZernio). */
export function enlaceZernio(it: MedioAv): string {
  if (it.enlace && /^https:\/\//.test(it.enlace)) return it.enlace
  const d = it.driveId || idDrive(it.url)
  if (d) return `https://drive.usercontent.google.com/download?id=${d}&export=download&confirm=t`
  return /^https:\/\//.test(it.url) ? it.url : ''
}

/** Un fotograma del video para usarlo de portada (avFotogramaVideo). */
export function fotogramaVideo(origen: File | string): Promise<Blob | null> {
  return new Promise((ok) => {
    try {
      const url = typeof origen === 'string' ? origen : URL.createObjectURL(origen)
      const v = document.createElement('video')
      let listo = false
      const fin = (b: Blob | null) => { if (listo) return; listo = true; if (typeof origen !== 'string') URL.revokeObjectURL(url); v.removeAttribute('src'); ok(b) }
      v.muted = true; v.preload = 'metadata'; v.playsInline = true
      if (typeof origen === 'string') v.crossOrigin = 'anonymous'
      v.onloadedmetadata = () => { try { v.currentTime = Math.min(1.5, (v.duration || 2) / 3) } catch { fin(null) } }
      v.onseeked = () => {
        try {
          const w = Math.min(640, v.videoWidth || 640), h = Math.round((w * (v.videoHeight || 360)) / (v.videoWidth || 640))
          const c = document.createElement('canvas'); c.width = w; c.height = h
          c.getContext('2d')!.drawImage(v, 0, 0, w, h)
          c.toBlob((b) => fin(b), 'image/jpeg', 0.72)
        } catch { fin(null) }
      }
      v.onerror = () => fin(null)
      setTimeout(() => fin(null), 15000)
      v.src = url
    } catch { ok(null) }
  })
}
/** Portada elegida por la persona: se reduce a 1280 px en JPG (avPrepararPortada). */
export function prepararPortada(f: File): Promise<Blob> {
  return new Promise((ok, no) => {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { no(new Error('Usa una imagen JPG, PNG o WebP.')); return }
    const url = URL.createObjectURL(f), im = new Image()
    im.onerror = () => { URL.revokeObjectURL(url); no(new Error('No se pudo leer la imagen.')) }
    im.onload = () => {
      URL.revokeObjectURL(url)
      const k = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight))
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k)
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height)
      c.toBlob((b) => (b ? ok(b) : no(new Error('No se pudo preparar la portada.'))), 'image/jpeg', 0.85)
    }
    im.src = url
  })
}
/** Guarda la portada de una pieza (avGuardarMiniatura). */
export async function guardarMiniatura(avId: string, b: Blob): Promise<string> {
  const ruta = `miniaturas/${avId}-${Date.now().toString(36)}.jpg`
  const s = await supabase.storage.from('audiovisual').upload(ruta, b, { contentType: 'image/jpeg', cacheControl: '31536000' })
  if (s.error) throw new Error('No se pudo subir la portada: ' + s.error.message)
  const url = supabase.storage.from('audiovisual').getPublicUrl(ruta).data.publicUrl
  const { error } = await supabase.from('audiovisual').update({ miniatura_url: url }).eq('id', avId)
  if (error) throw new Error('No se pudo guardar la portada: ' + error.message)
  return url
}

type Parte = { status: number; texto: string; rango: string | null }
function enviarParte(sesion: string, blob: Blob | null, desde: number, total: number, alAvanzar: (n: number) => void): Promise<Parte> {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest()
    x.open('PUT', sesion)
    x.setRequestHeader('Content-Range', blob ? `bytes ${desde}-${desde + blob.size - 1}/${total}` : `bytes */${total}`)
    if (blob) x.upload.onprogress = (e) => alAvanzar(e.loaded)
    x.onload = () => ok({ status: x.status, texto: x.responseText, rango: x.getResponseHeader('Range') })
    x.onerror = () => no(new Error('Se cortó la conexión con Google Drive.'))
    x.send(blob)
  })
}
const siguiente = (rango: string | null) => (rango ? Number(rango.split('-')[1]) + 1 : 0)

/** Sube a Drive por partes de 16 MB y reintenta desde donde quedó (avSubirArchivo / avSubirParte / avEstadoSubida). */
async function subirADrive(f: File, prog: (p: number) => void): Promise<{ id: string; webViewLink?: string }> {
  const ini = await supabase.functions.invoke('drive', { body: { accion: 'subida_iniciar', modulo: 'marketing', carpeta: 'Audiovisual/' + new Date().toISOString().slice(0, 7), nombre: f.name, mime: f.type, tamano: f.size } })
  const sesion = (ini.data as { sesion?: string; error?: string } | null)?.sesion
  if (ini.error || !sesion) throw new Error((ini.data as { error?: string } | null)?.error || ini.error?.message || 'Drive no abrió la subida.')
  const PARTE = 16 * 1024 * 1024
  let desde = 0, intentos = 0
  for (;;) {
    try {
      const r = await enviarParte(sesion, f.slice(desde, Math.min(desde + PARTE, f.size)), desde, f.size, (n) => prog((desde + n) / f.size))
      if (r.status === 200 || r.status === 201) return JSON.parse(r.texto)
      if (r.status === 308) { desde = siguiente(r.rango); intentos = 0; prog(desde / f.size); continue }
      throw new Error(`Google Drive respondió ${r.status}.`)
    } catch (e) {
      if (++intentos > 3) throw e
      await new Promise((r) => setTimeout(r, 1500 * intentos))
      const st = await enviarParte(sesion, null, 0, f.size, () => undefined).catch(() => null)
      if (st && (st.status === 200 || st.status === 201)) return JSON.parse(st.texto)
      if (st && st.status === 308) desde = siguiente(st.rango)
    }
  }
}

export type ArchivoSubido = { url: string; mime: string; tamanoMb: number; driveId: string | null; enlace: string | null }
/** Sube un archivo de Audiovisual: a la app si es liviano, a Drive si es grande. */
export async function subirArchivoAv(f: File, prog: (p: number, texto: string) => void): Promise<ArchivoSubido> {
  if (!MIME_AV.test(f.type)) throw new Error('Formato no permitido (JPG, PNG, WebP, GIF, MP4, MOV o WebM).')
  const tamanoMb = Math.round((f.size / 1048576) * 100) / 100
  if (tamanoMb > LIMITE_DRIVE_MB) throw new Error('El archivo supera los 2 GB.')
  if (tamanoMb <= LIMITE_APP_MB) {
    prog(0.1, 'Subiendo…')
    const ext = (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
    const ruta = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`
    const s = await supabase.storage.from('audiovisual').upload(ruta, f, { contentType: f.type, cacheControl: '31536000' })
    if (s.error) throw new Error(s.error.message)
    const url = supabase.storage.from('audiovisual').getPublicUrl(ruta).data.publicUrl
    return { url, mime: f.type, tamanoMb, driveId: null, enlace: url }
  }
  prog(0.02, 'Subiendo a Drive…')
  const d = await subirADrive(f, (p) => prog(0.02 + p * 0.9, `Subiendo a Drive… ${Math.round(p * 100)} %`))
  prog(0.95, 'Creando el enlace…')
  const c = await supabase.functions.invoke('drive', { body: { accion: 'compartir', modulo: 'marketing', id: d.id } })
  const info = (c.data ?? {}) as { enlace?: string; descarga?: string; error?: string }
  return { url: info.enlace || d.webViewLink || `https://drive.google.com/file/d/${d.id}/view`, mime: f.type, tamanoMb, driveId: d.id, enlace: info.descarga || null }
}
