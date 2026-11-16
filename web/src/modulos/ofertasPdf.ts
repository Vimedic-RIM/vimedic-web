/* PDF de ofertas vigentes para el cliente (Issue #39). Se arma en el navegador con jsPDF (se descarga al usarlo).
   Dos formatos: catálogo con fotos (2 columnas, por categoría) y lista compacta (tabla). */
import { LOGO_BLANCO, LOGO_RATIO } from '../catalogoAssets'
import { imagen } from './inventarioUtil'
import { agruparOfertas, fechaCorta, preciosOferta, textoVigencia, type OfertaInv } from './ofertasInv'

export type OpcionesPdf = {
  formato: 'fotos' | 'lista'; empresa: 'VIMEDIC' | 'FEMEDICS'; conIva: boolean; interna: boolean
  titulo: string; nombre: string; telefono: string
}
export type ResultadoPdf = { blob: Blob; paginas: number; sinFoto: number }

type RGB = [number, number, number]
const NAVY: RGB = [11, 37, 69], NARANJA: RGB = [194, 65, 12], TINTA: RGB = [15, 23, 42], GRIS: RGB = [100, 116, 139]
const LINEA: RGB = [226, 232, 240], FONDO: RGB = [248, 250, 252], CLARO: RGB = [203, 213, 225], TEAL: RGB = [8, 116, 130], AZUL: RGB = [5, 92, 157]

/** Las fuentes estándar del PDF solo tienen Latin-1: se quitan emojis y símbolos que no existen. */
export const limpiarPdf = (v: unknown) => String(v ?? '').normalize('NFC')
  .replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
  .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '').replace(/[ \t]+/g, ' ').trim()
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Descarga la foto y la deja en JPEG liviano con fondo blanco (sirve para WebP/PNG con transparencia). */
async function fotoJpeg(src: string, max = 520): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const r = await fetch(src)
    if (!r.ok) return null
    const b = await r.blob()
    if (b.size > 8 * 1048576) return null
    const url = URL.createObjectURL(b)
    try {
      const img = await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url })
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const g = c.getContext('2d')
      if (!g) return null
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h)
      return { data: c.toDataURL('image/jpeg', 0.82), w, h }
    } finally { URL.revokeObjectURL(url) }
  } catch { return null }
}

/** El logo es SVG: se pasa a PNG para el PDF. */
async function logoPng(): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = LOGO_BLANCO })
    const w = 1000, h = Math.round(w / LOGO_RATIO)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d')
    if (!g) return null
    g.drawImage(img, 0, 0, w, h)
    return c.toDataURL('image/png')
  } catch { return null }
}

export async function generarPdfOfertas(items: OfertaInv[], op: OpcionesPdf, prog: (t: string) => void): Promise<ResultadoPdf> {
  if (!items.length) throw new Error('No hay productos seleccionados.')
  prog('Preparando el PDF…')
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), op.empresa === 'VIMEDIC' ? logoPng() : Promise.resolve(null)])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const fem = op.empresa === 'FEMEDICS'
  const grupos = agruparOfertas(items)
  const titulo = limpiarPdf(op.titulo) || 'Ofertas vigentes'
  const precios = (o: OfertaInv) => preciosOferta(o, { femedics: fem, conIva: op.conIva })
  const ivaTxt = (o: OfertaInv) => (!o.iva ? 'IVA 0%' : op.conIva ? 'IVA incluido' : '+ IVA')
  const vigencia = (o: OfertaInv) => (o.proxima ? `Desde el ${fechaCorta(o.inicio)} hasta el ${fechaCorta(o.fin)}` : o.fin ? `Válido hasta el ${fechaCorta(o.fin)}` : 'Hasta agotar stock')
  const LIM = 279

  /* ---------- Cabeceras ---------- */
  const marca = (x: number, y: number, alto: number) => {
    if (logo) { doc.addImage(logo, 'PNG', x, y, alto * LOGO_RATIO, alto); return }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(alto * 2.2); doc.setTextColor(255, 255, 255); doc.text(fem ? 'FEMEDICS' : 'VIMEDIC', x, y + alto * 0.82)
  }
  const portada = () => {
    doc.setFillColor(...NAVY); doc.rect(0, 0, 210, 50, 'F')
    doc.setFillColor(...NARANJA); doc.rect(0, 50, 210, 1.4, 'F')
    marca(14, 11, 9)
    if (fem) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...CLARO); doc.text('Distribuidor autorizado de la marca VIMEDIC', 14, 25) }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...CLARO)
    doc.text(limpiarPdf(new Date().toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' })), 196, 15, { align: 'right' })
    if (op.interna) {
      const t = 'VERSIÓN INTERNA · NO ENVIAR AL CLIENTE'
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); const w = doc.getTextWidth(t) + 6
      doc.setFillColor(...NARANJA); doc.roundedRect(196 - w, 19, w, 6, 1.5, 1.5, 'F'); doc.setTextColor(255, 255, 255); doc.text(t, 196 - w / 2, 23.1, { align: 'center' })
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(21); doc.setTextColor(255, 255, 255); doc.text(titulo, 14, 37)
    const n = items.length, c = grupos.length
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...CLARO)
    doc.text(limpiarPdf([`${n} producto${n === 1 ? '' : 's'} en oferta`, `${c} categoría${c === 1 ? '' : 's'}`, textoVigencia(items)].filter(Boolean).join('  ·  ')), 14, 44.5)
  }
  const cabecera = () => {
    doc.setFillColor(...NAVY); doc.rect(0, 0, 210, 14, 'F')
    marca(14, 4, 6)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...CLARO); doc.text(titulo + (op.interna ? '  ·  VERSIÓN INTERNA' : ''), 196, 8.8, { align: 'right' })
  }
  const pies = () => {
    const total = doc.getNumberOfPages()
    const contacto = limpiarPdf([op.nombre && 'Atiende: ' + op.nombre, op.telefono && 'WhatsApp ' + op.telefono, fem ? '' : 'www.vimedic.com.ec'].filter(Boolean).join('   ·   '))
    for (let i = 1; i <= total; i++) {
      doc.setPage(i)
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.3); doc.line(12, 283, 198, 283)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...GRIS)
      doc.text(`Precios en dólares ${op.conIva ? 'con IVA incluido' : 'más IVA'}. Válidos hasta la fecha indicada o hasta agotar stock.${op.formato === 'fotos' ? ' Imágenes referenciales.' : ''}`, 12, 287)
      if (contacto) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.4); doc.setTextColor(...TINTA); doc.text(contacto, 12, 291.6) }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRIS); doc.text(`Página ${i} de ${total}`, 198, 291.6, { align: 'right' })
    }
  }
  /** Precio tachado: el texto y una línea encima. */
  const tachado = (t: string, x: number, y: number, derecha = false) => {
    const w = doc.getTextWidth(t), x0 = derecha ? x - w : x
    doc.text(t, x0, y); doc.setDrawColor(...GRIS); doc.setLineWidth(0.25); doc.line(x0 - 0.3, y - 1.05, x0 + w + 0.3, y - 1.05)
  }

  let sinFoto = 0
  if (op.formato === 'fotos') {
    /* ---------- Fotos: de 4 en 4 ---------- */
    const fotos = new Map<string, { data: string; w: number; h: number } | null>()
    const pend = items.filter((o) => o.img)
    let k = 0, hechas = 0
    const tarea = async () => {
      while (k < pend.length) {
        const o = pend[k++]
        fotos.set(o.productoId, await fotoJpeg(imagen(o.img, 600)))
        hechas++; prog(`Preparando fotos: ${hechas} de ${pend.length}…`)
      }
    }
    await Promise.all([tarea(), tarea(), tarea(), tarea()])
    prog('Armando las páginas…')

    const X0 = 12, CW = 90, GAP = 6, CH = 59
    let y = 60
    const nueva = () => { doc.addPage(); cabecera(); y = 22 }
    const tituloCat = (nombre: string, n: number, sigue: boolean) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...NAVY)
      doc.text(limpiarPdf(nombre) + (sigue ? ' (continuación)' : ''), X0, y + 6)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS); doc.text(`${n} producto${n === 1 ? '' : 's'}`, 198, y + 6, { align: 'right' })
      doc.setDrawColor(...AZUL); doc.setLineWidth(0.7); doc.line(X0, y + 8.6, X0 + 24, y + 8.6)
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.3); doc.line(X0 + 24, y + 8.6, 198, y + 8.6)
      y += 12
    }
    const tarjeta = (o: OfertaInv, x: number) => {
      const { antes, ahora, ahorro } = precios(o)
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.3); doc.setFillColor(255, 255, 255); doc.roundedRect(x, y, CW, CH, 3, 3, 'FD')
      const F = 34
      doc.setFillColor(...FONDO); doc.roundedRect(x + 4, y + 4, F, F, 2, 2, 'F')
      const f = fotos.get(o.productoId)
      if (f) {
        const s = Math.min((F - 3) / f.w, (F - 3) / f.h), w = f.w * s, h = f.h * s
        try { doc.addImage(f.data, 'JPEG', x + 4 + (F - w) / 2, y + 4 + (F - h) / 2, w, h, undefined, 'FAST') } catch { sinFoto++ }
      } else {
        sinFoto++
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRIS); doc.text('Imagen no disponible', x + 4 + F / 2, y + 4 + F / 2, { align: 'center' })
      }
      if (ahorro > 0) {
        doc.setFillColor(...NARANJA); doc.roundedRect(x + 2, y + 2, 16, 7, 1.6, 1.6, 'F')
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255); doc.text(`-${ahorro}%`, x + 10, y + 6.9, { align: 'center' })
      }
      const tx = x + 42, tw = CW - 46
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NAVY)
      const nom = (doc.splitTextToSize(limpiarPdf(o.nombre), tw) as string[]).slice(0, 4)
      doc.text(nom, tx, y + 8.5)
      let ty = y + 8.5 + nom.length * 3.75 + 0.8
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRIS)
      doc.text((doc.splitTextToSize(limpiarPdf([o.codigo, o.marca].filter(Boolean).join(' · ')), tw) as string[]).slice(0, 1), tx, ty)
      ty += 4
      const extra = limpiarPdf([o.regalo && 'Incluye: ' + o.regalo, o.combo && 'Combo con: ' + o.combo, o.texto].filter(Boolean).join('. '))
      if (extra && ty < y + 37) {
        doc.setFontSize(6.8); doc.setTextColor(...TEAL)
        doc.text((doc.splitTextToSize(extra, tw) as string[]).slice(0, Math.max(1, Math.floor((y + 39 - ty) / 3))), tx, ty)
      }
      const py = y + 44
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRIS)
      doc.text('Antes', x + 4, py); tachado(usd(antes), x + 4 + doc.getTextWidth('Antes '), py)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NARANJA)
      const sp = usd(ahora); doc.text(sp, x + 4, py + 7.4); const wp = doc.getTextWidth(sp)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRIS); doc.text(ivaTxt(o), x + 4 + wp + 1.6, py + 7.4)
      doc.setFontSize(7); doc.setTextColor(...TINTA)
      doc.text(limpiarPdf(vigencia(o) + (op.interna ? `   ·   Stock: ${o.stock}` : '')), x + 4, py + 12.6)
    }
    portada()
    for (const g of grupos) {
      if (y + 12 + CH > LIM) nueva()
      tituloCat(g.categoria, g.items.length, false)
      for (let i = 0; i < g.items.length; i += 2) {
        if (y + CH > LIM) { nueva(); tituloCat(g.categoria, g.items.length, true) }
        tarjeta(g.items[i], X0)
        if (g.items[i + 1]) tarjeta(g.items[i + 1], X0 + CW + GAP)
        y += CH + 4
      }
      y += 2
    }
  } else {
    /* ---------- Lista compacta ---------- */
    prog('Armando la lista…')
    const C = op.interna
      ? { ancho: 80, stock: 108, antes: 132, oferta: 158, ahorro: 172, hasta: 196 }
      : { ancho: 94, stock: 0, antes: 132, oferta: 158, ahorro: 172, hasta: 196 }
    let y = 58
    const encabezado = () => {
      doc.setFillColor(241, 245, 249); doc.rect(12, y, 186, 7, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...GRIS)
      doc.text('PRODUCTO', 14, y + 4.7)
      if (C.stock) doc.text('STOCK', C.stock, y + 4.7, { align: 'right' })
      doc.text('ANTES', C.antes, y + 4.7, { align: 'right' }); doc.text('OFERTA', C.oferta, y + 4.7, { align: 'right' })
      doc.text('AHORRO', C.ahorro, y + 4.7, { align: 'center' }); doc.text('HASTA', C.hasta, y + 4.7, { align: 'right' })
      y += 7
    }
    const nueva = () => { doc.addPage(); cabecera(); y = 20; encabezado() }
    const filaCat = (nombre: string, n: number, sigue: boolean) => {
      doc.setFillColor(238, 246, 251); doc.rect(12, y, 186, 6.6, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.2); doc.setTextColor(...NAVY); doc.text(limpiarPdf(nombre) + (sigue ? ' (continuación)' : ''), 14, y + 4.5)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRIS); doc.text(`${n} producto${n === 1 ? '' : 's'}`, 196, y + 4.5, { align: 'right' })
      y += 6.6
    }
    portada(); encabezado()
    for (const g of grupos) {
      if (y + 6.6 + 9 > LIM) nueva()
      filaCat(g.categoria, g.items.length, false)
      for (const o of g.items) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
        const nom = (doc.splitTextToSize(limpiarPdf(o.nombre), C.ancho) as string[]).slice(0, 2)
        const h = nom.length > 1 ? 11.6 : 8.6
        if (y + h > LIM) { nueva(); filaCat(g.categoria, g.items.length, true); doc.setFont('helvetica', 'bold'); doc.setFontSize(8) }
        const { antes, ahora, ahorro } = precios(o)
        doc.setTextColor(...TINTA); doc.text(nom, 14, y + 3.9)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GRIS)
        doc.text((doc.splitTextToSize(limpiarPdf([o.codigo, o.marca, o.proxima ? 'desde el ' + fechaCorta(o.inicio) : ''].filter(Boolean).join(' · ')), C.ancho) as string[]).slice(0, 1), 14, y + 3.9 + nom.length * 3.4)
        const my = y + h / 2 + 0.6
        if (C.stock) { doc.setFontSize(7.5); doc.setTextColor(...TINTA); doc.text(String(o.stock), C.stock, my, { align: 'right' }) }
        doc.setFontSize(7.5); doc.setTextColor(...GRIS); tachado(usd(antes), C.antes, my, true)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NARANJA); doc.text(usd(ahora), C.oferta, my, { align: 'right' })
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); doc.setTextColor(...GRIS); doc.text(ivaTxt(o), C.oferta, my + 3, { align: 'right' })
        if (ahorro > 0) { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NARANJA); doc.text(`-${ahorro}%`, C.ahorro, my, { align: 'center' }) }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...TINTA); doc.text(fechaCorta(o.fin) || '-', C.hasta, my, { align: 'right' })
        doc.setDrawColor(...LINEA); doc.setLineWidth(0.25); doc.line(12, y + h, 198, y + h)
        y += h
      }
    }
  }
  pies()
  prog('')
  return { blob: doc.output('blob'), paginas: doc.getNumberOfPages(), sinFoto }
}
