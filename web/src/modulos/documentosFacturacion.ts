/* Documentos de Facturación, iguales a los de la app original (Documentos.gs):
   · Acta de Entrega / Entera Satisfacción + Carta de Garantía + Anexo de números de serie (generarActaCompleta, FOR.ADM.08 y FOR.ADM.09)
   · Guía de Envío: etiqueta con logo, franja de aviso, ciudad, destinatario y remitente, en una sola hoja (generarGuiaEnvio)
   El HTML se convierte a PDF en el navegador (html2pdf) y se guarda en Drive, como en el original.
   Los estilos van dentro de .vd para no tocar la página mientras se arma el PDF.
   Encabezado, colores y pie: los de la proforma (documentoMarca.ts), con el logo oficial. */
import { colorDoc, encabezadoDocHtml, logoDocUrl, pieDocHtml } from '../documentoMarca'
import { armarBloques, plantillaDe } from '../plantillas'

/** Color de la marca (Plantillas de documentos › Marca y pie). */
const NAVY = colorDoc
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** formatFechaLarga_: "16 de noviembre de 2026". */
export const fechaLarga = (d: Date): string => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`
/** sumarMeses_ */
export const sumarMeses = (d: Date, n: number): Date => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x }
/** "2026-11-16" → fecha local (sin correrse un día por la zona horaria). */
export const fechaDeTexto = (s: string): Date => { const p = String(s || '').split('-').map(Number); const d = p.length === 3 ? new Date(p[0], p[1] - 1, p[2]) : new Date(); return isNaN(d.getTime()) ? new Date() : d }
const esc = (v: unknown): string => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Firma de la Carta de Garantía (Core.gs: DIRECTOR_EJECUTIVO_NOMBRE / DIRECTOR_EJECUTIVO_CARGO). Hoy se edita en la plantilla
// «Carta de garantía» (bloque Firma); estos valores son los del diseño por defecto.
export const DIRECTOR_EJECUTIVO_NOMBRE = 'Victor Ricardo Lopez Cordonez'
export const DIRECTOR_EJECUTIVO_CARGO = 'Director Ejecutivo'
const logo = logoDocUrl

/* ============================ Acta completa ============================ */
export type EquipoActaDoc = { id: string; nombre: string; cantidad: number; series: string[]; garantia: string }
export type DatosActaDoc = {
  numeroFactura: string; fecha: Date
  cliente: { nombre: string; identificacion: string; ciudad: string; direccion: string; telefono: string; email: string }
  equipos: EquipoActaDoc[]; garantiaTxt: string; nMant: number; observaciones: string[]; anexo: boolean
}

function estiloActa(): string {
  return `.vd{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#1e293b;font-size:11px;line-height:1.55;width:186mm;background:#fff}
.vd p{margin:0 0 8px}
.vd .info-box{border:1px solid #dde6f0;border-radius:10px;padding:14px 18px;background:#f8fafc;margin-bottom:14px}
.vd .info-field{font-size:10.5px;margin-bottom:8px}
.vd table{border-collapse:collapse}
.vd table.doc-table{width:100%;margin:10px 0 16px}
.vd table.doc-table th{background:${NAVY()};color:#fff;padding:8px 9px;font-size:9.5px;text-transform:uppercase;letter-spacing:.03em;text-align:left}
.vd table.doc-table td{padding:8px 9px;border-bottom:1px solid #edf1f6;font-size:10.5px;vertical-align:top}
.vd table.doc-table tr:nth-child(even) td{background:#f8fafc}
.vd tr{page-break-inside:avoid}
.vd .doc-badge{display:inline-block;background:${NAVY()};color:#fff;font-weight:bold;padding:3px 10px;border-radius:6px}
.vd .pagebreak{page-break-before:always;height:0}`
}

/** Encabezado de la proforma con el título y el lugar de la plantilla; debajo el número de factura y el lugar y la fecha. */
function encabezado(codigo: string, fechaLetra: string, numero: string): string {
  const p = plantillaDe(codigo)
  return encabezadoDocHtml({ titulo: p.titulo, titulo2: p.titulo2, lugarFecha: (p.lugar ? p.lugar + ', ' : '') + fechaLetra, etiqueta: 'Nº FACTURA', numero })
}

/** seccionTitulo_: barra lateral del color de la marca, texto en mayúsculas y una línea hasta el margen. `html` ya viene escapado. */
function seccion(html: string): string {
  if (!html) return ''
  return `<div style="display:table;width:100%;margin:16px 0 10px">
<div style="display:table-cell;vertical-align:middle;padding-left:8px;border-left:4px solid ${NAVY()};white-space:nowrap"><span style="font-weight:700;color:${NAVY()};font-size:11px;text-transform:uppercase;letter-spacing:.06em">${html}</span></div>
<div style="display:table-cell;width:100%;vertical-align:middle;padding-left:10px"><div style="border-top:1px solid #cbd5e1"></div></div></div>`
}
const titulo = (t: string) => seccion(esc(t))

/** El mismo documento de generarActaCompleta: acta (única firma del cliente), carta de garantía (si hay equipos con garantía) y anexo opcional.
 *  Textos, orden de las partes y firma salen de las plantillas «acta_entrega», «carta_garantia» y «anexo_series». */
export function htmlActa(d: DatosActaDoc): string {
  const fechaLetra = fechaLarga(d.fecha)
  const conGarantia = d.equipos.filter((e) => e.garantia)
  const c = d.cliente
  const serieHtml = (e: EquipoActaDoc) => !e.series.length ? '<span style="color:#cbd5e1">—</span>'
    : e.series.map((s) => `<span style="display:inline-block;font-family:monospace;font-size:9.5px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:1px 5px;margin:1px 2px 1px 0">${esc(s)}</span>`).join('')
      + (e.series.length < e.cantidad ? `<div style="font-size:8.5px;color:#94a3b8">${e.series.length} de ${e.cantidad} registradas</div>` : '')
  const filasEntrega = d.equipos.map((e) => `<tr>
<td style="text-align:center;width:38px">${e.cantidad}</td>
<td style="font-style:italic;color:#7c93ac;width:75px">${esc(e.id)}</td>
<td>${esc(e.nombre)}</td>
<td style="width:150px">${serieHtml(e)}</td>
<td style="text-align:center;width:70px;font-weight:bold;color:${e.garantia ? '#04896f' : '#94a3b8'}">${esc(e.garantia || 'Sin garantía')}</td></tr>`).join('')
  const filasGarantia = conGarantia.map((e) => `<tr>
<td style="font-style:italic;color:#7c93ac;width:80px">${esc(e.id)}</td>
<td>${esc(e.nombre)}</td>
<td style="text-align:center;width:45px">${e.cantidad}</td>
<td style="width:150px">${serieHtml(e)}</td>
<td style="text-align:center;width:70px;font-weight:bold">${esc(e.garantia)}</td></tr>`).join('')
  const filasAnexo = d.equipos.map((e) => `<tr style="height:2.8cm">
<td style="padding:6px;border:1px solid #dde6f0;font-style:italic;color:#7c93ac;font-size:9.5px;vertical-align:top;width:1.6cm">${esc(e.id)}</td>
<td style="padding:6px;border:1px solid #dde6f0;font-size:9.5px;vertical-align:top;width:4.2cm">${esc(e.nombre)}</td>
<td style="padding:6px;border:1px solid #dde6f0;text-align:center;font-size:9.5px;vertical-align:top;width:1.2cm">${e.cantidad}</td>
<td style="padding:8px;border:1px solid #dde6f0"></td></tr>`).join('')
  let filasMant = ''
  for (let i = 1; i <= d.nMant; i++) {
    filasMant += `<tr><td style="text-align:center;padding:8px 9px;border-bottom:1px solid #edf1f6;font-size:10.5px">${fechaLarga(sumarMeses(d.fecha, 6 * i)).toUpperCase()}</td><td style="text-align:center;padding:8px 9px;border-bottom:1px solid #edf1f6;font-size:10.5px;color:#64748b">${esc(d.observaciones[i - 1] || '')}</td></tr>`
  }
  const th = (t: string, extra = '') => `<th style="background:${NAVY()};color:#fff;padding:8px 6px;font-size:9px;text-transform:uppercase;${extra}">${t}</th>`
  const vars: Record<string, string> = {
    cliente: esc(c.nombre), ruc: esc(c.identificacion || ''), fecha: fechaLetra, factura: esc(d.numeroFactura), ciudad: esc(c.ciudad || ''),
    garantia: esc(d.garantiaTxt || 'sin garantía'),
    con_carta: conGarantia.length ? ', junto con su respectiva Carta de Garantía' : '',
    clausulas_garantia: conGarantia.length
      ? '3. Junto con la presente acta se entrega al cliente la <strong>Carta de Garantía</strong> (adjunta) de los equipos indicados, por el período señalado para cada uno en la tabla anterior, cuyas condiciones el cliente declara conocer y aceptar.<br>'
        + '4. La firma de esta acta constituye la única firma de conformidad del cliente: acredita la recepción de los equipos y de su Carta de Garantía, la cual no requiere una firma adicional del cliente.'
      : '3. Los equipos detallados se entregan sin garantía adicional.',
    condicion_mantenimiento: d.nMant
      ? 'Para que la garantía se mantenga vigente, el acreedor deberá realizar con nuestra institución los mantenimientos preventivos cada 6 meses, conforme a las fechas establecidas.'
      : 'Para hacer válida la garantía, el equipo deberá ser revisado por nuestro departamento técnico.',
  }
  const comun = { vars, tituloSeccion: seccion }

  const acta = encabezado('acta_entrega', fechaLetra, d.numeroFactura) + armarBloques(plantillaDe('acta_entrega'), {
    ...comun,
    secciones: {
      cliente: (t) => titulo(t) + `<div class="info-box"><table style="width:100%"><tr>
<td style="width:50%;vertical-align:top">
<div class="info-field"><strong>Nombre del cliente:</strong> ${esc(c.nombre)}</div>
<div class="info-field"><strong>Cédula / RUC:</strong> ${esc(c.identificacion || '—')}</div>
<div class="info-field"><strong>Ciudad:</strong> ${esc(c.ciudad || '—')}</div></td>
<td style="width:50%;vertical-align:top">
<div class="info-field"><strong>Ubicación:</strong> ${esc(c.direccion || '—')}</div>
<div class="info-field"><strong>Contacto:</strong> ${esc(c.telefono || '—')}</div>
<div class="info-field"><strong>Email:</strong> ${esc(c.email || '—')}</div></td></tr></table></div>`,
      equipos: (t) => titulo(t) + `<table class="doc-table"><thead><tr><th style="text-align:center">Cant.</th><th>Código</th><th>Equipo</th><th>N° de serie</th><th style="text-align:center">Garantía</th></tr></thead><tbody>${filasEntrega}</tbody></table>`,
      firmas: (t) => titulo(t) + `<table style="width:100%;margin-top:22px"><tr>
<td style="width:50%;padding-right:10px;vertical-align:top"><div class="info-box"><strong style="color:${NAVY()}">Entregado por (VIMEDIC)</strong><br><br>Firma: ____________________<br>Nombre: ____________________<br>C.I.: ____________________<br>Cargo: ____________________</div></td>
<td style="width:50%;padding-left:10px;vertical-align:top"><div class="info-box"><strong style="color:${NAVY()}">Recibido a entera satisfacción por</strong><br><br>Firma: ____________________<br>Nombre: ____________________<br>C.I.: ____________________<br>Cargo: ____________________</div></td></tr></table>`,
    },
  }) + pieDocHtml()

  const carta = !conGarantia.length ? '' : '<div class="pagebreak"></div>'
    + encabezado('carta_garantia', fechaLetra, d.numeroFactura) + armarBloques(plantillaDe('carta_garantia'), {
      ...comun,
      secciones: {
        equipos_garantia: (t) => titulo(t) + `<table class="doc-table"><thead><tr><th>Código</th><th>Equipo</th><th style="text-align:center">Cant.</th><th>N° de serie</th><th style="text-align:center">Garantía</th></tr></thead><tbody>${filasGarantia}</tbody></table>`,
        cronograma: (t) => !d.nMant ? '' : titulo(t) + `<div style="width:78%;margin:0 auto 16px;border:1px solid #dde6f0;border-radius:12px;overflow:hidden">
<table style="width:100%"><thead><tr>
<th style="background:${NAVY()};color:#fff;padding:8px 9px;font-size:9.5px;text-transform:uppercase;text-align:center">Fecha de Mantenimiento</th>
<th style="background:${NAVY()};color:#fff;padding:8px 9px;font-size:9.5px;text-transform:uppercase;text-align:center">Observación</th></tr></thead><tbody>${filasMant}</tbody></table></div>`,
      },
    }) + pieDocHtml()

  const anexo = !d.anexo ? '' : '<div class="pagebreak"></div>'
    + encabezado('anexo_series', fechaLetra, d.numeroFactura) + armarBloques(plantillaDe('anexo_series'), {
      ...comun,
      secciones: {
        series: (t) => titulo(t) + `<table style="width:100%;border:1px solid #dde6f0"><thead><tr>${th('Código', 'width:60px')}${th('Equipo', 'width:160px')}${th('Cant.', 'text-align:center;width:45px')}${th('Espacio para sticker de serie')}</tr></thead><tbody>${filasAnexo}</tbody></table>`,
      },
    }) + pieDocHtml()

  return `<style>${estiloActa()}</style><div class="vd">${acta}${carta}${anexo}</div>`
}

/* ============================ Guía de envío ============================ */
export type DatosGuia = {
  nombreRemitente: string; cedulaRemitente: string; nombreDestinatario: string; cedulaDestinatario: string
  telefonoDestinatario: string; direccionEnvio: string; emailDestinatario: string; ciudad: string
}

/** crearHtmlGuia_ (estilo "etiqueta"): logo + rótulo navy, franja de aviso, ciudad, destinatario y remitente. Todo con el mismo tamaño de letra. */
export function htmlGuia(d: DatosGuia, tamano: number): string {
  const pad = Math.max(8, Math.round(tamano / 2)), tamBand = Math.max(12, Math.round(tamano * 0.6))
  const dato = (et: string, v: string, clase = '') => (!v && et ? '' : `<p class="dato ${clase}">${et ? `<span class="et">${et}:</span> ` : ''}${esc(v)}</p>`)
  const remitente = dato('', d.nombreRemitente, 'nombre') + dato('C.I./RUC', d.cedulaRemitente)
  const destinatario = dato('', d.nombreDestinatario, 'nombre') + dato('C.I./RUC', d.cedulaDestinatario) + dato('CEL', d.telefonoDestinatario) + dato('DIRECCIÓN', d.direccionEnvio) + dato('EMAIL', d.emailDestinatario)
  const css = `.vg{font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:${tamano}px;line-height:1.18;width:186mm;background:#fff}
.vg *{box-sizing:border-box}
.vg .aviso{display:block;width:100%;height:auto;margin:0 0 10px}
.vg .logo{height:${Math.max(38, Math.round(tamano * 1.9))}px;max-width:320px;display:block}
.vg .dato{margin:0 0 ${Math.max(4, Math.round(tamano / 3))}px;font-size:${tamano}px;white-space:pre-wrap;overflow-wrap:break-word;word-wrap:break-word}
.vg .dato:last-child{margin-bottom:0}
.vg .et{font-weight:700;color:${NAVY()}}
.vg .nombre{font-weight:700;color:${NAVY()}}
.vg .ciudad-txt{font-size:${tamano + 14}px;font-weight:800;color:${NAVY()};text-align:center;letter-spacing:1px;margin:0}
.vg .hdr{width:100%;border-collapse:collapse;margin:0 0 12px;border-bottom:3px solid ${NAVY()}}
.vg .hdr td{padding:0 0 10px;vertical-align:middle}
.vg .gtit{display:inline-block;color:${NAVY()};font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;letter-spacing:0;text-transform:uppercase;white-space:nowrap}
.vg .cb{border:3px solid ${NAVY()};border-radius:10px;padding:${pad}px 16px;margin:0 0 10px;text-align:center}
.vg .card{border:2px solid ${NAVY()};border-radius:10px;margin:0 0 10px}
.vg .bandc{color:${NAVY()};font-weight:bold;letter-spacing:3px;font-size:${tamBand}px;padding:6px 16px;border-bottom:2px solid ${NAVY()}}
.vg .cont{padding:${pad}px 16px}`
  const tarjeta = (t: string, c: string) => `<div class="card"><div class="bandc">${t}</div><div class="cont">${c}</div></div>`
  return `<style>${css}</style><div class="vg">
<table class="hdr"><tr><td><img class="logo" src="${logo()}" alt="VIMEDIC" crossorigin="anonymous"></td><td style="text-align:right"><span class="gtit">Guía de envío</span></td></tr></table>
<img class="aviso" src="${window.location.origin}/aviso-guia.jpg" alt="FRÁGIL - EQUIPO MÉDICO - NO COLOCAR PESO ENCIMA" crossorigin="anonymous">
<div class="cb"><p class="dato ciudad-txt">${esc(d.ciudad.toUpperCase())}</p></div>
${tarjeta('DESTINATARIO', destinatario)}${tarjeta('REMITENTE', remitente)}</div>`
}

/** Igual que el original: todos los datos con el mismo tamaño, el más grande (30 → 14 px) con el que la guía entra en UNA hoja A4.
 *  Se mide en el navegador (186 × 273 mm útiles). Devuelve null si ni con 14 px entra. */
export async function tamanoGuia(d: DatosGuia): Promise<number | null> {
  const caja = document.createElement('div')
  caja.style.cssText = 'position:fixed;left:-10000px;top:0;width:186mm;visibility:hidden'
  document.body.appendChild(caja)
  const altoHoja = 273 * 96 / 25.4
  try {
    for (const t of [30, 28, 26, 24, 22, 20, 18, 16, 14]) {
      caja.innerHTML = htmlGuia(d, t)
      await esperarImagenes(caja)
      if (caja.scrollHeight <= altoHoja - 4) return t
    }
    return null
  } finally { caja.remove() }
}

async function esperarImagenes(el: HTMLElement): Promise<void> {
  await Promise.all([...el.querySelectorAll('img')].map((img) => (img.complete ? Promise.resolve() : new Promise<void>((ok) => { img.onload = () => ok(); img.onerror = () => ok() }))))
}

/** PDF A4 del HTML (márgenes de 12 mm, saltos de página donde dice .pagebreak). */
export async function pdfDeHtml(html: string): Promise<Blob> {
  const html2pdf = (await import('html2pdf.js')).default
  return await html2pdf().set({
    margin: [12, 12, 12, 12], image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, allowTaint: false, logging: false, windowWidth: 794 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'], before: '.pagebreak', avoid: 'tr' },
  }).from(html, 'string').outputPdf('blob') as Blob
}
