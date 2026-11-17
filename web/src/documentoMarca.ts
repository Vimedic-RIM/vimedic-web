/* Marca común de TODOS los documentos que genera la app (proformas, actas, guías, constancias, informes, listas…):
   el logo oficial y el encabezado de la proforma — logo a la izquierda, título azul en mayúsculas a la derecha con la
   leyenda de la empresa, línea azul debajo y, en la fila siguiente, el número (etiqueta celeste) y la fecha — más su pie.
   El logo es public/logo-documento.png (el mismo del manual de marca, LOGO_COLOR en catalogoAssets.ts). */
import type { jsPDF } from 'jspdf'
import { LOGO_RATIO } from './catalogoAssets'

export const AZUL_DOC = '#055c9d'
export const TEAL_DOC = '#2ab9c7'
export const PIE_VIMEDIC = 'Quito, Ecuador — Agende su visita a nuestras salas de exhibición'
export const PIE_FEMEDICS = 'FEMEDICS IMPORTACIONES · Distribuidor autorizado de la marca VIMEDIC'
export const esFemedics = (empresa?: string | null): boolean => String(empresa || '').toUpperCase() === 'FEMEDICS'
export const pieDoc = (empresa?: string | null): string => (esFemedics(empresa) ? PIE_FEMEDICS : PIE_VIMEDIC)
/** Dirección del logo dentro de la app (sirve para los PDF que se arman en el navegador). */
export const logoDocUrl = (): string => window.location.origin + '/logo-documento.png'

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

let logoCache: Promise<string | null> | null = null
/** El logo como data URL (PNG): para jsPDF y para los documentos que se guardan y se abren fuera de la app. */
export function logoDocDataUrl(): Promise<string | null> {
  if (!logoCache) {
    logoCache = fetch('/logo-documento.png')
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('sin logo'))))
      .then((b) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(new Error('sin logo')); r.readAsDataURL(b) }))
      .catch(() => { logoCache = null; return null })
  }
  return logoCache
}

export type EncabezadoDoc = {
  /** Título del documento (va en mayúsculas, azul). `titulo2` es una segunda línea opcional. */
  titulo: string; titulo2?: string
  /** Etiqueta celeste de la izquierda: «Nº VENTA: VEN-123», «Nº GUÍA: GD-…». */
  etiqueta?: string; numero?: string
  /** «Fecha: 17/11/2026» a la derecha; `lugarFecha` se imprime tal cual («Quito, 17 de noviembre de 2026»). */
  fecha?: string; lugarFecha?: string
  empresa?: string | null
  /** Logo como data URL cuando el documento se abre fuera de la app; si no, la dirección del logo. */
  logo?: string | null
  /** Algo más a la derecha de la fila del número (p. ej. un QR). */
  extraDerecha?: string
}

/** El encabezado de la proforma (proforma.tsx), con estilos en línea para que sirva en cualquier documento. */
export function encabezadoDocHtml(o: EncabezadoDoc): string {
  const fem = esFemedics(o.empresa)
  const marca = fem
    ? `<div style="font-size:20px;font-weight:bold;color:${AZUL_DOC}">FEMEDICS</div>`
    : `<img src="${esc(o.logo || logoDocUrl())}" alt="VIMEDIC" style="display:block;width:160px;height:auto;max-height:60px;object-fit:contain">`
  const titulo = `<div style="font-size:18px;color:${AZUL_DOC};font-weight:bold;text-transform:uppercase;margin-bottom:2px;line-height:1.25">${esc(o.titulo)}${o.titulo2 ? '<br>' + esc(o.titulo2) : ''}</div>`
  const fechaTxt = o.lugarFecha ? esc(o.lugarFecha) : o.fecha ? `<strong>Fecha:</strong> ${esc(o.fecha)}` : ''
  const badge = o.numero ? `<span style="background:${TEAL_DOC};color:#fff;display:inline-block;line-height:13px;padding:3px 8px 8px;border-radius:4px;font-size:11px;font-weight:bold">${esc(o.etiqueta || 'Nº')}: ${esc(o.numero)}</span>` : ''
  const fila = badge || fechaTxt || o.extraDerecha
    ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:15px">${badge ? `<div>${badge}</div>` : `<div style="font-size:11px;color:#475569">${fechaTxt}</div>`}<div style="display:flex;align-items:center;gap:12px">${badge && fechaTxt ? `<span style="font-size:11px;color:#475569">${fechaTxt}</span>` : ''}${o.extraDerecha || ''}</div></div>`
    : ''
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px;border-bottom:3px solid ${AZUL_DOC};padding-bottom:12px">`
    + `<div style="flex-shrink:0">${marca}</div><div style="text-align:right;font-size:11px;color:#365679">${titulo}${fem ? '' : `<div>${PIE_VIMEDIC}</div>`}</div></div>${fila}`
}

/** Pie de la proforma. `extra` (HTML ya escapado) va antes de la leyenda de la empresa. */
export function pieDocHtml(empresa?: string | null, extra = ''): string {
  return `<div style="margin-top:30px;text-align:center;font-size:10px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px">${extra ? `<p style="margin:0 0 4px">${extra}</p>` : ''}<p style="margin:0">${esc(pieDoc(empresa))}</p></div>`
}

/** El mismo encabezado en los PDF que se dibujan con jsPDF (listas de ofertas, informes). Devuelve dónde sigue el contenido (mm). */
export function encabezadoPdf(doc: jsPDF, o: { titulo: string; subtitulo?: string; empresa?: string | null; logo: string | null; x?: number; y?: number; ancho?: number }): number {
  const x = o.x ?? 12, y = o.y ?? 9, W = o.ancho ?? doc.internal.pageSize.getWidth() - 2 * x, der = x + W
  const fem = esFemedics(o.empresa)
  const anchoLogo = 42, altoLogo = anchoLogo / LOGO_RATIO
  if (!fem && o.logo) {
    try { doc.addImage(o.logo, 'PNG', x, y, anchoLogo, altoLogo) } catch { /* sin logo: queda el título */ }
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(5, 92, 157); doc.text(fem ? 'FEMEDICS' : 'VIMEDIC', x, y + 6.5)
  }
  let fs = 13.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(fs)
  const titulo = o.titulo.toUpperCase()
  while (fs > 8 && doc.getTextWidth(titulo) > W - anchoLogo - 6) { fs -= 0.5; doc.setFontSize(fs) }
  doc.setTextColor(5, 92, 157); doc.text(titulo, der, y + 4.2, { align: 'right' })
  const linea2 = o.subtitulo ?? (fem ? '' : PIE_VIMEDIC)
  if (linea2) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(54, 86, 121)
    const t = doc.splitTextToSize(linea2, W - anchoLogo - 6)[0] as string
    doc.text(t, der, y + 8.6, { align: 'right' })
  }
  doc.setDrawColor(5, 92, 157); doc.setLineWidth(0.8); doc.line(x, y + 12.5, der, y + 12.5)
  doc.setLineWidth(0.2)
  return y + 12.5 + 5
}
