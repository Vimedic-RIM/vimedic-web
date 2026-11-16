/* PDF de ofertas vigentes para el cliente (Issues #39 y #40). Se arma en el navegador con jsPDF (se descarga al usarlo).
   Dos formatos: catálogo con fotos (2 columnas, por categoría) y lista compacta (tabla con una foto pequeña por producto). */
import { LOGO_BLANCO, LOGO_RATIO } from '../catalogoAssets'
import { imagen } from './inventarioUtil'
import { agruparOfertas, campanasDe, fechaCorta, LIMITE_REAL, limiteDe, normalizar, preciosOferta, textoVigencia, type LimiteFecha, type OfertaInv } from './ofertasInv'

export type OpcionesPdf = {
  formato: 'fotos' | 'lista'; empresa: 'VIMEDIC' | 'FEMEDICS'; conIva: boolean; interna: boolean
  /** Para qué tipo de cliente es la lista (la portada lo dice): clientes PVP, distribuidores (DIS) o todos. */
  publico?: 'TODOS' | 'PVP' | 'DIS'
  /** Título de la portada: por defecto el nombre de la campaña (ej. "Black Sales 2026"). */
  titulo: string; nombre: string; telefono: string
  /** Fecha límite que ve el cliente: la real de cada oferta, otra elegida a mano u oculta. Solo cambia el PDF, no la oferta. */
  limite?: LimiteFecha
}
/** sinFoto: productos que salieron sin foto (sin imagen en el inventario + fallidas). fallidas: tenían imagen pero no se pudo descargar. */
export type ResultadoPdf = { blob: Blob; paginas: number; sinFoto: number; fallidas: number }

type RGB = [number, number, number]
const NAVY: RGB = [11, 37, 69], NARANJA: RGB = [194, 65, 12], TINTA: RGB = [15, 23, 42], GRIS: RGB = [100, 116, 139]
const LINEA: RGB = [226, 232, 240], FONDO: RGB = [248, 250, 252], CLARO: RGB = [203, 213, 225], TEAL: RGB = [8, 116, 130], AZUL: RGB = [5, 92, 157]

/** Las fuentes estándar del PDF solo tienen Latin-1: se quitan emojis y símbolos que no existen. */
export const limpiarPdf = (v: unknown) => String(v ?? '').normalize('NFC')
  .replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
  .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '').replace(/[ \t]+/g, ' ').trim()
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Foto = { data: string; w: number; h: number }
/** Carga la foto y la deja en JPEG liviano con fondo blanco (sirve para WebP/PNG con transparencia).
 *  Se carga COMO IMAGEN y no con fetch: la política de seguridad del sitio (web/public/_headers) permite mostrar imágenes de
 *  Google (img-src) pero no descargarlas por código (connect-src), así que con fetch el navegador las bloqueaba y todas
 *  salían "Imagen no disponible". crossOrigin = 'anonymous': Google responde con permiso CORS, el canvas no queda
 *  "contaminado" y se puede exportar. Un reintento por si la red falla un momento (el celular, sobre todo). */
async function fotoJpeg(src: string, max = 520, calidad = 0.82): Promise<Foto | null> {
  const cargar = () => new Promise<HTMLImageElement>((ok, mal) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    const t = setTimeout(() => mal(new Error('tiempo agotado')), 20000)
    i.onload = () => { clearTimeout(t); ok(i) }
    i.onerror = () => { clearTimeout(t); mal(new Error('no cargó')) }
    i.src = src
  })
  for (let intento = 0; intento < 2; intento++) {
    try {
      const img = await cargar()
      if (!img.naturalWidth || !img.naturalHeight) return null
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const g = c.getContext('2d')
      if (!g) return null
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h)
      return { data: c.toDataURL('image/jpeg', calidad), w, h }
    } catch { if (!intento) await new Promise((r) => setTimeout(r, 800)) }
  }
  return null
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

type Col = { k: 'hasta' | 'ahorro' | 'oferta' | 'antes' | 'stock'; w: number; al: 'right' | 'center' }

export async function generarPdfOfertas(items: OfertaInv[], op: OpcionesPdf, prog: (t: string) => void): Promise<ResultadoPdf> {
  if (!items.length) throw new Error('No hay productos seleccionados.')
  prog('Preparando el PDF…')
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), op.empresa === 'VIMEDIC' ? logoPng() : Promise.resolve(null)])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const fem = op.empresa === 'FEMEDICS'
  const grupos = agruparOfertas(items)
  const camps = campanasDe(items), multiCamp = camps.length > 1
  const lim = op.limite ?? LIMITE_REAL, sinFecha = lim.modo === 'ocultar'
  const titulo = limpiarPdf(op.titulo) || 'Ofertas vigentes'
  const precios = (o: OfertaInv) => preciosOferta(o, { femedics: fem, conIva: op.conIva })
  const ivaTxt = (o: OfertaInv) => (!o.iva ? 'IVA 0%' : op.conIva ? 'IVA incluido' : '+ IVA')
  /** La fecha límite que se imprime para esta oferta (la real, la elegida a mano o ninguna). Una fecha anterior al inicio de una oferta próxima no se imprime. */
  const finDe = (o: OfertaInv): string | null => { const f = limiteDe(o.fin, lim); return f && o.inicio && f < o.inicio ? null : f }
  const vigencia = (o: OfertaInv): string => {
    const fin = finDe(o)
    if (o.proxima) return fin ? `Desde el ${fechaCorta(o.inicio)} hasta el ${fechaCorta(fin)}` : `Desde el ${fechaCorta(o.inicio)}`
    if (fin) return `Válido hasta el ${fechaCorta(fin)}`
    return sinFecha ? '' : 'Hasta agotar stock'
  }
  const LIM = 279, BANDA = 54

  /* ---------- Cabeceras ---------- */
  const marca = (x: number, y: number, alto: number) => {
    if (logo) { doc.addImage(logo, 'PNG', x, y, alto * LOGO_RATIO, alto); return }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(alto * 2.2); doc.setTextColor(255, 255, 255); doc.text(fem ? 'FEMEDICS' : 'VIMEDIC', x, y + alto * 0.82)
  }
  const portada = () => {
    doc.setFillColor(...NAVY); doc.rect(0, 0, 210, BANDA, 'F')
    doc.setFillColor(...NARANJA); doc.rect(0, BANDA, 210, 1.4, 'F')
    marca(14, 11, 9)
    if (fem) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...CLARO); doc.text('Distribuidor autorizado de la marca VIMEDIC', 14, 25) }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...CLARO)
    doc.text(limpiarPdf(new Date().toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' })), 196, 15, { align: 'right' })
    if (op.interna) {
      const t = 'VERSIÓN INTERNA · NO ENVIAR AL CLIENTE'
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); const w = doc.getTextWidth(t) + 6
      doc.setFillColor(...NARANJA); doc.roundedRect(196 - w, 19, w, 6, 1.5, 1.5, 'F'); doc.setTextColor(255, 255, 255); doc.text(t, 196 - w / 2, 23.1, { align: 'center' })
    }
    // El nombre de la campaña es el título; "OFERTAS VIGENTES" va como rótulo encima (salvo que el título ya sea ese texto).
    if (normalizar(titulo) !== 'ofertas vigentes') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...CLARO); doc.setCharSpace(0.8); doc.text('OFERTAS VIGENTES', 14, 31.5); doc.setCharSpace(0)
    }
    let fs = 21
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs)
    while (fs > 12 && doc.getTextWidth(titulo) > 182) { fs -= 1; doc.setFontSize(fs) }   // un título largo se reduce para que quepa
    doc.setTextColor(255, 255, 255); doc.text(titulo, 14, 41)
    const n = items.length, c = grupos.length
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...CLARO)
    const sub = doc.splitTextToSize(limpiarPdf([`${n} producto${n === 1 ? '' : 's'} en oferta`, `${c} categoría${c === 1 ? '' : 's'}`, multiCamp ? 'Campañas: ' + camps.join(', ') : '', op.publico === 'PVP' ? 'Precios para clientes PVP' : op.publico === 'DIS' ? 'Precios para distribuidores (DIS)' : '', textoVigencia(items, lim)].filter(Boolean).join('  ·  ')), 182) as string[]
    const subL = sub.slice(0, 2)
    doc.text(subL, 14, subL.length > 1 ? 47 : 48.5)
  }
  const cabecera = () => {
    doc.setFillColor(...NAVY); doc.rect(0, 0, 210, 14, 'F')
    marca(14, 4, 6)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...CLARO); doc.text(titulo + (op.interna ? '  ·  VERSIÓN INTERNA' : ''), 196, 8.8, { align: 'right' })
  }
  const pies = () => {
    const total = doc.getNumberOfPages()
    const contacto = limpiarPdf([op.nombre && 'Atiende: ' + op.nombre, op.telefono && 'WhatsApp ' + op.telefono, fem ? '' : 'www.vimedic.com.ec'].filter(Boolean).join('   ·   '))
    const vigPie = sinFecha ? 'Sujetos a disponibilidad de stock.' : 'Válidos hasta la fecha indicada o hasta agotar stock.'
    for (let i = 1; i <= total; i++) {
      doc.setPage(i)
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.3); doc.line(12, 283, 198, 283)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...GRIS)
      doc.text(`Precios en dólares ${op.conIva ? 'con IVA incluido' : 'más IVA'}. ${vigPie} Imágenes referenciales.`, 12, 287)
      if (contacto) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.4); doc.setTextColor(...TINTA); doc.text(contacto, 12, 291.6) }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...GRIS); doc.text(`Página ${i} de ${total}`, 198, 291.6, { align: 'right' })
    }
  }
  /** Precio tachado: el texto y una línea encima. */
  const tachado = (t: string, x: number, y: number, derecha = false) => {
    const w = doc.getTextWidth(t), x0 = derecha ? x - w : x
    doc.text(t, x0, y); doc.setDrawColor(...GRIS); doc.setLineWidth(0.25); doc.line(x0 - 0.3, y - 1.05, x0 + w + 0.3, y - 1.05)
  }

  /* ---------- Fotos: de 4 en 4 (grandes en el catálogo, miniaturas en la lista) ---------- */
  let sinFoto = 0, fallidas = 0
  const fotos = new Map<string, Foto | null>()
  const pend = items.filter((o) => o.img)
  let k = 0, hechas = 0
  const tarea = async () => {
    while (k < pend.length) {
      const o = pend[k++]
      fotos.set(o.productoId, op.formato === 'fotos' ? await fotoJpeg(imagen(o.img, 600)) : await fotoJpeg(imagen(o.img, 200), 160, 0.74))
      hechas++; prog(`Preparando fotos: ${hechas} de ${pend.length}…`)
    }
  }
  await Promise.all([tarea(), tarea(), tarea(), tarea()])
  fallidas = pend.filter((o) => !fotos.get(o.productoId)).length
  prog('Armando las páginas…')

  if (op.formato === 'fotos') {
    /* ---------- Catálogo con fotos ---------- */
    // Sin fecha ni stock no hay línea al pie de la tarjeta: se acorta para que no quede un hueco.
    const X0 = 12, CW = 90, GAP = 6, CH = !sinFecha || op.interna ? 59 : 55
    let y = BANDA + 1.4 + 8.6
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
      let puesta = false
      if (f) {
        const s = Math.min((F - 3) / f.w, (F - 3) / f.h), w = f.w * s, h = f.h * s
        try { doc.addImage(f.data, 'JPEG', x + 4 + (F - w) / 2, y + 4 + (F - h) / 2, w, h, undefined, 'FAST'); puesta = true } catch { fallidas++ }
      }
      if (!puesta) {
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
      // Si se mezclan varias campañas, cada producto dice la suya.
      if (multiCamp && o.campana) {
        doc.setFontSize(6.8); doc.setTextColor(...AZUL)
        doc.text((doc.splitTextToSize(limpiarPdf(o.campana), tw) as string[]).slice(0, 1), tx, ty); ty += 3.6
      }
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
      const pie = [vigencia(o), op.interna ? `Stock: ${o.stock}` : ''].filter(Boolean).join('   ·   ')
      if (pie) { doc.setFontSize(7); doc.setTextColor(...TINTA); doc.text(limpiarPdf(pie), x + 4, py + 12.6) }
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
    /* ---------- Lista compacta: una foto pequeña por producto ---------- */
    const FOTO = 11, X_FOTO = 14, X_NOM = X_FOTO + FOTO + 3, H = 13
    // Columnas de derecha a izquierda; al nombre le queda lo que sobra. Sin fecha límite no hay columna "Hasta".
    const cols: Col[] = [
      ...(sinFecha ? [] : [{ k: 'hasta', w: 19, al: 'right' } as Col]),
      { k: 'ahorro', w: 14, al: 'center' }, { k: 'oferta', w: 25, al: 'right' }, { k: 'antes', w: 22, al: 'right' },
      ...(op.interna ? [{ k: 'stock', w: 10, al: 'right' } as Col] : []),
    ]
    const X: Partial<Record<Col['k'], number>> = {}
    let borde = 196.5
    for (const c of cols) { X[c.k] = c.al === 'center' ? borde - c.w / 2 : borde; borde -= c.w }
    const ANCHO_NOM = borde - 2 - X_NOM
    let y = BANDA + 1.4 + 6.6
    const encabezado = () => {
      doc.setFillColor(241, 245, 249); doc.rect(12, y, 186, 7, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...GRIS)
      doc.text('PRODUCTO', X_FOTO, y + 4.7)
      if (X.stock != null) doc.text('STOCK', X.stock, y + 4.7, { align: 'right' })
      doc.text('ANTES', X.antes as number, y + 4.7, { align: 'right' }); doc.text('OFERTA', X.oferta as number, y + 4.7, { align: 'right' })
      doc.text('AHORRO', X.ahorro as number, y + 4.7, { align: 'center' })
      if (X.hasta != null) doc.text('HASTA', X.hasta, y + 4.7, { align: 'right' })
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
      if (y + 6.6 + H > LIM) nueva()
      filaCat(g.categoria, g.items.length, false)
      for (const o of g.items) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
        const nom = (doc.splitTextToSize(limpiarPdf(o.nombre), ANCHO_NOM) as string[]).slice(0, 2)
        if (y + H > LIM) { nueva(); filaCat(g.categoria, g.items.length, true) }
        const { antes, ahora, ahorro } = precios(o)
        // Foto pequeña
        doc.setFillColor(...FONDO); doc.roundedRect(X_FOTO, y + 1, FOTO, FOTO, 1.2, 1.2, 'F')
        const f = fotos.get(o.productoId)
        let puesta = false
        if (f) {
          const s = Math.min((FOTO - 1.2) / f.w, (FOTO - 1.2) / f.h), w = f.w * s, h = f.h * s
          try { doc.addImage(f.data, 'JPEG', X_FOTO + (FOTO - w) / 2, y + 1 + (FOTO - h) / 2, w, h, undefined, 'FAST'); puesta = true } catch { fallidas++ }
        }
        if (!puesta) {
          sinFoto++
          doc.setFont('helvetica', 'normal'); doc.setFontSize(5); doc.setTextColor(...GRIS); doc.text('Sin foto', X_FOTO + FOTO / 2, y + 1 + FOTO / 2 + 0.7, { align: 'center' })
        }
        // Nombre y código
        const ny = nom.length > 1 ? y + 3.9 : y + 5.3
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...TINTA); doc.text(nom, X_NOM, ny)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...GRIS)
        doc.text((doc.splitTextToSize(limpiarPdf([o.codigo, o.marca, multiCamp ? o.campana : '', o.proxima ? 'desde el ' + fechaCorta(o.inicio) : ''].filter(Boolean).join(' · ')), ANCHO_NOM) as string[]).slice(0, 1), X_NOM, ny + nom.length * 3.3 + 0.3)
        // Precios
        const my = y + H / 2 + 0.6
        if (X.stock != null) { doc.setFontSize(7.5); doc.setTextColor(...TINTA); doc.text(String(o.stock), X.stock, my, { align: 'right' }) }
        doc.setFontSize(7.5); doc.setTextColor(...GRIS); tachado(usd(antes), X.antes as number, my, true)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...NARANJA); doc.text(usd(ahora), X.oferta as number, my, { align: 'right' })
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.8); doc.setTextColor(...GRIS); doc.text(ivaTxt(o), X.oferta as number, my + 3, { align: 'right' })
        if (ahorro > 0) { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...NARANJA); doc.text(`-${ahorro}%`, X.ahorro as number, my, { align: 'center' }) }
        if (X.hasta != null) { const fin = finDe(o); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...TINTA); doc.text(fin ? fechaCorta(fin) : '-', X.hasta, my, { align: 'right' }) }
        doc.setDrawColor(...LINEA); doc.setLineWidth(0.25); doc.line(12, y + H, 198, y + H)
        y += H
      }
    }
  }
  pies()
  prog('')
  return { blob: doc.output('blob'), paginas: doc.getNumberOfPages(), sinFoto, fallidas }
}
