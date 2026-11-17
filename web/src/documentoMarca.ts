/* Marca común de TODOS los documentos que genera la app (proformas, actas, guías, constancias, informes, listas…):
   el logo y el encabezado de la proforma — logo a la izquierda, título en mayúsculas a la derecha con la leyenda de la
   empresa, línea de color debajo y, en la fila siguiente, el número (etiqueta) y la fecha — más su pie.
   Logo, colores, leyenda y pie se editan en «Plantillas de documentos» › Marca y pie (plantillas.ts los carga aquí);
   sin cambios, se usa el logo oficial public/logo-documento.png (el mismo de LOGO_COLOR en catalogoAssets.ts). */
import type { jsPDF } from 'jspdf'
import { LOGO_RATIO } from './catalogoAssets'

export const AZUL_DOC = '#055c9d'
export const TEAL_DOC = '#2ab9c7'
export const PIE_VIMEDIC = 'Quito, Ecuador — Agende su visita a nuestras salas de exhibición'
export const PIE_FEMEDICS = 'FEMEDICS IMPORTACIONES · Distribuidor autorizado de la marca VIMEDIC'
/** Logo de FEMEDICS (public/logo-femedics.svg). */
export const logoFemedicsUrl = (): string => window.location.origin + '/logo-femedics.svg'

/** Lo que se edita en Plantillas › Marca y pie. `logo` vacío = logo oficial. */
export type MarcaDoc = { logo: string; color: string; acento: string; leyenda: string; mostrarLeyenda: boolean; pie: string }
export const MARCA_DEF: MarcaDoc = { logo: '', color: AZUL_DOC, acento: TEAL_DOC, leyenda: PIE_VIMEDIC, mostrarLeyenda: true, pie: PIE_VIMEDIC }
let marcaActual: MarcaDoc = MARCA_DEF
let marcaBorrador: MarcaDoc | null = null
const hexValido = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : def)
/** La marca guardada (la fija plantillas.ts al cargar). */
export function fijarMarca(m: Partial<MarcaDoc> | null | undefined) {
  const x = { ...MARCA_DEF, ...(m ?? {}) }
  marcaActual = { ...x, color: hexValido(x.color, AZUL_DOC), acento: hexValido(x.acento, TEAL_DOC), logo: /^data:image\/(png|jpeg);base64,/.test(x.logo) ? x.logo : '' }
}
/** Vista previa del editor: arma un documento con una marca sin guardar. */
export function conMarcaBorrador<T>(m: MarcaDoc | null, fn: () => T): T {
  const antes = marcaBorrador; marcaBorrador = m
  try { return fn() } finally { marcaBorrador = antes }
}
export const marcaDoc = (): MarcaDoc => marcaBorrador ?? marcaActual
export const colorDoc = (): string => marcaDoc().color
export const acentoDoc = (): string => marcaDoc().acento

export const esFemedics = (empresa?: string | null): boolean => String(empresa || '').toUpperCase() === 'FEMEDICS'
export const pieDoc = (empresa?: string | null): string => (esFemedics(empresa) ? PIE_FEMEDICS : marcaDoc().pie)
/** Dirección del logo (o el logo cargado en Plantillas, como data URL). `base` = origen de la app (por defecto el actual). */
export const logoDocUrl = (base?: string): string => marcaDoc().logo || (base ?? window.location.origin + '/').replace(/\/?$/, '/') + 'logo-documento.png'

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }

let logoCache: Promise<string | null> | null = null
/** El logo como data URL (PNG): para jsPDF y para los documentos que se guardan y se abren fuera de la app. */
export function logoDocDataUrl(): Promise<string | null> {
  if (marcaDoc().logo) return Promise.resolve(marcaDoc().logo)
  if (!logoCache) {
    logoCache = fetch('/logo-documento.png')
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('sin logo'))))
      .then((b) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(new Error('sin logo')); r.readAsDataURL(b) }))
      .catch(() => { logoCache = null; return null })
  }
  return logoCache
}

export type EncabezadoDoc = {
  /** Título del documento (va en mayúsculas, en el color de la marca). `titulo2` es una segunda línea opcional. */
  titulo: string; titulo2?: string
  /** Etiqueta de la izquierda: «Nº VENTA: VEN-123», «Nº GUÍA: GD-…». */
  etiqueta?: string; numero?: string
  /** «Fecha: 17/11/2026» a la derecha; `lugarFecha` se imprime tal cual («Quito, 17 de noviembre de 2026»). */
  fecha?: string; lugarFecha?: string
  empresa?: string | null
  /** FEMEDICS: muestra su logo en lugar del nombre en texto. */
  conLogoFemedics?: boolean
  /** Logo como data URL cuando el documento se abre fuera de la app; si no, la dirección del logo. */
  logo?: string | null
  /** Algo más a la derecha de la fila del número (p. ej. un QR). */
  extraDerecha?: string
}

/** El encabezado de la proforma (proforma.tsx), con estilos en línea para que sirva en cualquier documento. */
export function encabezadoDocHtml(o: EncabezadoDoc): string {
  const fem = esFemedics(o.empresa), m = marcaDoc()
  const marca = fem && o.conLogoFemedics
    ? `<img src="${esc(logoFemedicsUrl())}" alt="FEMEDICS" style="display:block;width:170px;height:auto;max-height:70px;object-fit:contain">`
    : fem
    ? `<div style="font-size:20px;font-weight:bold;color:${m.color}">FEMEDICS</div>`
    : `<img src="${esc(m.logo || o.logo || logoDocUrl())}" alt="VIMEDIC" style="display:block;width:160px;height:auto;max-height:60px;object-fit:contain">`
  const titulo = `<div style="font-size:18px;color:${m.color};font-weight:bold;text-transform:uppercase;margin-bottom:2px;line-height:1.25">${esc(o.titulo)}${o.titulo2 ? '<br>' + esc(o.titulo2) : ''}</div>`
  const fechaTxt = o.lugarFecha ? esc(o.lugarFecha) : o.fecha ? `<strong>Fecha:</strong> ${esc(o.fecha)}` : ''
  const badge = o.numero ? `<span style="background:${m.acento};color:#fff;display:inline-block;line-height:13px;padding:3px 8px 8px;border-radius:4px;font-size:11px;font-weight:bold">${esc(o.etiqueta || 'Nº')}: ${esc(o.numero)}</span>` : ''
  const fila = badge || fechaTxt || o.extraDerecha
    ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:15px">${badge ? `<div>${badge}</div>` : `<div style="font-size:11px;color:#475569">${fechaTxt}</div>`}<div style="display:flex;align-items:center;gap:12px">${badge && fechaTxt ? `<span style="font-size:11px;color:#475569">${fechaTxt}</span>` : ''}${o.extraDerecha || ''}</div></div>`
    : ''
  const leyenda = !fem && m.mostrarLeyenda && m.leyenda ? `<div>${esc(m.leyenda)}</div>` : ''
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px;border-bottom:3px solid ${m.color};padding-bottom:12px">`
    + `<div style="flex-shrink:0">${marca}</div><div style="text-align:right;font-size:11px;color:#365679">${titulo}${leyenda}</div></div>${fila}`
}

/** Pie de la proforma. `extra` (HTML ya escapado) va antes de la leyenda de la empresa. */
export function pieDocHtml(empresa?: string | null, extra = ''): string {
  const pie = pieDoc(empresa)
  if (!extra && !pie) return ''
  return `<div style="margin-top:30px;text-align:center;font-size:10px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px">${extra ? `<p style="margin:0 0 4px">${extra}</p>` : ''}${pie ? `<p style="margin:0">${esc(pie)}</p>` : ''}</div>`
}

/** El mismo encabezado en los PDF que se dibujan con jsPDF (listas de ofertas, informes). Devuelve dónde sigue el contenido (mm). */
export function encabezadoPdf(doc: jsPDF, o: { titulo: string; subtitulo?: string; empresa?: string | null; logo: string | null; x?: number; y?: number; ancho?: number }): number {
  const x = o.x ?? 12, y = o.y ?? 9, W = o.ancho ?? doc.internal.pageSize.getWidth() - 2 * x, der = x + W
  const fem = esFemedics(o.empresa), m = marcaDoc(), c = rgb(m.color)
  const logo = m.logo || o.logo
  let anchoLogo = 42, altoLogo = anchoLogo / LOGO_RATIO
  if (!fem && logo) {
    try {
      const p = doc.getImageProperties(logo); altoLogo = Math.min(11, anchoLogo * (p.height / p.width)); anchoLogo = altoLogo * (p.width / p.height)
      doc.addImage(logo, p.fileType || 'PNG', x, y, anchoLogo, altoLogo)
    } catch { /* sin logo: queda el título */ }
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...c); doc.text(fem ? 'FEMEDICS' : 'VIMEDIC', x, y + 6.5)
  }
  let fs = 13.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(fs)
  const titulo = o.titulo.toUpperCase()
  while (fs > 8 && doc.getTextWidth(titulo) > W - anchoLogo - 6) { fs -= 0.5; doc.setFontSize(fs) }
  doc.setTextColor(...c); doc.text(titulo, der, y + 4.2, { align: 'right' })
  const linea2 = o.subtitulo ?? (fem || !m.mostrarLeyenda ? '' : m.leyenda)
  if (linea2) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(54, 86, 121)
    const t = doc.splitTextToSize(linea2, W - anchoLogo - 6)[0] as string
    doc.text(t, der, y + 8.6, { align: 'right' })
  }
  doc.setDrawColor(...c); doc.setLineWidth(0.8); doc.line(x, y + 12.5, der, y + 12.5)
  doc.setLineWidth(0.2)
  return y + 12.5 + 5
}
