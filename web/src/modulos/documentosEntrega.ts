/* Documentos de la entrega, armados con su plantilla (Plantillas de documentos):
   · Guía de despacho (Facturación): HTML completo que se guarda y se abre después; lleva el logo dentro y el QR de seguimiento.
   · Constancia de entrega (Logística): HTML que se pasa a PDF en el navegador. */
import { colorDoc, encabezadoDocHtml, pieDocHtml } from '../documentoMarca'
import { armarBloques, plantillaDe } from '../plantillas'

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Título de sección como en la proforma (azul de la marca, mayúsculas). `html` ya escapado. */
const tituloCaja = (html: string) => (html ? `<div style="font-size:11px;font-weight:bold;color:${colorDoc()};text-transform:uppercase;margin:14px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:6px">${html}</div>` : '')

/* ============================ Guía de despacho ============================ */
export type DatosDespacho = {
  numeroGuia: string; fecha: string; empresa?: string | null
  /** Logo como data URL (el archivo se abre fuera de la app) y QR de seguimiento. */
  logo: string | null; qr: string
  cliente: string; identificacion: string; factura: string; asesor: string
  direccion: string; ciudad: string; recibe: string; telefono: string; nota: string; enlace: string
  lineas: { codigo: string; nombre: string; cantidad: number; observacion?: string }[]
}
export function htmlGuiaDespacho(d: DatosDespacho): string {
  const p = plantillaDe('guia_despacho'), c = colorDoc()
  const filas = d.lineas.map((it) => `<tr>
    <td style="font-family:monospace;font-size:10px">${esc(it.codigo)}</td>
    <td><strong>${esc(it.nombre)}</strong></td>
    <td style="text-align:center">${esc(Math.abs(it.cantidad))}</td>
    <td style="font-size:10.5px;color:#64748b">${esc(it.observacion || '')}</td></tr>`).join('')
  const vars: Record<string, string> = {
    cliente: esc(d.cliente), ruc: esc(d.identificacion), fecha: esc(d.fecha), guia: esc(d.numeroGuia), factura: esc(d.factura || '—'), asesor: esc(d.asesor),
    direccion: esc(d.direccion), ciudad: esc(d.ciudad), recibe: esc(d.recibe), telefono: esc(d.telefono), enlace: esc(d.enlace),
  }
  const cuerpo = armarBloques(p, {
    vars, tituloSeccion: tituloCaja,
    secciones: {
      datos: (t) => tituloCaja(esc(t)) + `<div style="display:flex;gap:6px;margin-bottom:15px">
        <div class="box"><div class="box-title">Datos del Cliente</div><table class="dt">
          <tr><td style="width:95px"><strong>Nombre:</strong></td><td>${vars.cliente}</td></tr>
          <tr><td><strong>Cédula / RUC:</strong></td><td>${vars.ruc}</td></tr>
          <tr><td><strong>Factura:</strong></td><td>${vars.factura}</td></tr>
          <tr><td><strong>Asesor:</strong></td><td>${vars.asesor}</td></tr></table></div>
        <div class="box"><div class="box-title">Datos de Entrega</div><table class="dt">
          <tr><td style="width:95px"><strong>Dirección:</strong></td><td>${vars.direccion}${d.ciudad ? ', ' + vars.ciudad : ''}</td></tr>
          <tr><td><strong>Recibe:</strong></td><td>${vars.recibe}</td></tr>
          <tr><td><strong>Teléfono:</strong></td><td>${vars.telefono}</td></tr></table></div>
      </div>`,
      productos: (t) => tituloCaja(esc(t)) + `<table class="items"><thead><tr><th style="width:90px">Código</th><th>Producto</th><th style="width:50px;text-align:center">Cant.</th><th style="width:170px">Observación</th></tr></thead><tbody>${filas}</tbody></table>`,
      observaciones: (t) => (d.nota ? `<div class="box" style="margin-top:14px">${t ? `<div class="box-title">${esc(t)}</div>` : ''}<p style="font-size:11px">${esc(d.nota)}</p></div>` : ''),
      firmas: (t) => tituloCaja(esc(t)) + `<div style="display:flex;justify-content:space-between;margin-top:46px;font-size:11px">
        <div style="width:30%;text-align:center;border-top:1px solid #94a3b8;padding-top:4px">Bodega (preparó)</div>
        <div style="width:30%;text-align:center;border-top:1px solid #94a3b8;padding-top:4px">Logística (retiró)</div>
        <div style="width:30%;text-align:center;border-top:1px solid #94a3b8;padding-top:4px">Cliente (recibió conforme)</div></div>`,
    },
  })
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía de despacho ${esc(d.numeroGuia)}</title>
    <style>@page{size:A4;margin:12mm}html{background:#e2e8f0}body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1e293b;font-size:12px;margin:0 auto;padding:12mm;width:210mm;min-height:297mm;box-sizing:border-box;background:#fff;box-shadow:0 0 0 1px #cbd5e1}@media print{html{background:#fff}body{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}p{margin:0}
    .box{background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:10px;flex:1}.box-title{font-size:11px;font-weight:bold;color:${c};text-transform:uppercase;margin-bottom:6px;border-bottom:1px solid #e2e8f0;padding-bottom:7px}
    .dt{width:100%;border-collapse:collapse;font-size:11px}.dt td{padding:2px 0;vertical-align:top}
    .items{width:100%;border-collapse:collapse;margin-top:12px}.items th{background:${c};color:#fff;padding:7px 8px;font-size:11px;text-align:left}.items td{padding:9px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:11px}</style></head>
    <body>
      ${encabezadoDocHtml({ titulo: p.titulo, titulo2: p.titulo2, etiqueta: 'Nº GUÍA', numero: d.numeroGuia, fecha: d.fecha, empresa: d.empresa, logo: d.logo, extraDerecha: d.qr ? `<img src="${d.qr}" width="92" height="92" alt="QR de seguimiento">` : '' })}
      ${cuerpo}
      ${pieDocHtml(d.empresa, d.enlace ? 'Seguimiento del pedido: ' + esc(d.enlace) : '')}
    </body></html>`
}

/* ============================ Constancia de entrega ============================ */
export type DatosConstancia = {
  codigo: string; fecha: string; empresa?: string | null
  cliente: string; factura: string; direccion: string; modalidad: string
  productos: { cantidad: number; nombre: string; id: string; series?: string[] }[]
  recibio: string; cedula: string; fechaHora: string; ubicacion: string; firma: string; nota: string; entregadoPor: string
}
export function htmlConstancia(d: DatosConstancia): string {
  const p = plantillaDe('constancia_entrega'), c = colorDoc()
  const filas = d.productos.map((x) => `<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:center">${esc(x.cantidad)}</td><td style="padding:8px;border-bottom:1px solid #e2e8f0"><strong>${esc(x.nombre)}</strong><br><span style="color:#64748b;font-size:10px">${esc(x.id)}</span></td><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:10px">${(x.series || []).map(esc).join('<br>')}</td></tr>`).join('')
  const vars: Record<string, string> = {
    cliente: esc(d.cliente), ruc: '', fecha: esc(d.fecha), numero: esc(d.codigo), factura: esc(d.factura || '—'), entregado_por: esc(d.entregadoPor), recibio: esc(d.recibio || '—'),
  }
  const cuerpo = armarBloques(p, {
    vars, tituloSeccion: tituloCaja, letra: 12,
    secciones: {
      datos: (t) => tituloCaja(esc(t)) + `<p style="margin:0 0 8px"><b>Cliente:</b> ${vars.cliente} &nbsp; <b>Factura:</b> ${vars.factura}</p><p style="margin:0 0 8px"><b>Dirección:</b> ${esc(d.direccion)}</p><p style="margin:0 0 8px"><b>Modalidad:</b> ${esc(d.modalidad)}</p>`,
      productos: (t) => tituloCaja(esc(t)) + `<table style="width:100%;border-collapse:collapse;margin:12px 0"><thead><tr style="background:${c};color:#fff"><th style="padding:6px 6px 10px;text-align:center;width:50px">Cant.</th><th style="padding:6px 6px 10px;text-align:left">Producto</th><th style="padding:6px 6px 10px;text-align:left">N° de serie</th></tr></thead><tbody>${filas}</tbody></table>`,
      recepcion: (t) => tituloCaja(esc(t)) + `<p style="margin:0 0 8px"><b>Recibió:</b> ${vars.recibio}${d.cedula ? ' · C.I. ' + esc(d.cedula) : ''}</p><p style="margin:0 0 8px"><b>Fecha y hora:</b> ${esc(d.fechaHora)}${d.ubicacion ? ' · Ubicación: ' + esc(d.ubicacion) : ''}</p>`
        + (d.firma ? `<p style="margin:0 0 8px"><b>Firma:</b><br><img src="${esc(d.firma)}" style="height:90px;border-bottom:1px solid #94a3b8"></p>` : '') + (d.nota ? `<p style="margin:0 0 8px"><b>Observación:</b> ${esc(d.nota)}</p>` : ''),
    },
  })
  return `<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1e293b;font-size:12px">`
    + encabezadoDocHtml({ titulo: p.titulo, titulo2: p.titulo2, etiqueta: 'Nº ENTREGA', numero: d.codigo, fecha: d.fecha, empresa: d.empresa })
    + cuerpo + pieDocHtml(d.empresa) + '</div>'
}
