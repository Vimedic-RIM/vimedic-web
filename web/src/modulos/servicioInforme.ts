/* Informe técnico / comprobante de recepción: HTML A4 → PDF en el navegador (sin guardar PDFs). */
import { supabase } from '../supabase'

export type OrdenDoc = {
  codigo: string; tipo: string; empresa: string; cobertura: string; modalidad: string; cliente: string; identificacion: string; direccion: string; ciudad: string; contacto: string; telefono: string
  factura: string; producto: string; serie: string; tecnico: string; tecnicoEmpresa: string; inicio: string; cierre: string; horas: number; falla: string; diagnostico: string; trabajo: string
  recomendaciones: string; estadoFinal: string; proximoMantenimiento: string; informeN: string; recepcionN: string
  checklist: { actividad: string; resultado: string; obs: string }[]
  mediciones: { parametro: string; valor: string; unidad: string; referencia: string; resultado: string }[]
  repuestos: { id: string; nombre: string; cantidad: number }[]
  asistentes: { nombre: string; cargo: string; cedula: string }[]
  fotos: { url: string; etapa: string; nota: string }[]
  recepcion: { accesorios?: string; estadoFisico?: string; entregadoPor?: string; cedula?: string; fecha?: string; recibidoPor?: string; firma?: string }
  firma: { png?: string; nombre?: string; cedula?: string; cargo?: string }
}
export type EquipoDoc = { marca: string; modelo: string; codigo: string; lote: string; fechaEntrega: string; garantia: string; garantiaHasta: string; ubicacion: string } | null

export const TITULOS: Record<string, string> = {
  'Instalación': 'Acta de Instalación y Puesta en Marcha', 'Capacitación': 'Acta de Capacitación', 'Mantenimiento preventivo': 'Informe de Mantenimiento Preventivo',
  'Mantenimiento correctivo': 'Informe de Mantenimiento Correctivo', 'Diagnóstico': 'Informe de Diagnóstico Técnico', 'Inspección técnica': 'Informe de Inspección Técnica',
  'Calibración': 'Informe de Calibración y Verificación', 'Baja técnica': 'Informe Técnico de Baja', recepcion: 'Comprobante de Recepción de Equipo',
}
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const br = (v: unknown) => esc(v).replace(/\n/g, '<br>')
const fd = (v: string | undefined, h?: boolean) => { if (!v) return '—'; const d = new Date(v.length === 10 ? v + 'T12:00:00' : v); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Guayaquil' }) + (h ? ' ' + d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Guayaquil' }) : '') }

/** Convierte una ruta de Storage en data URL (para que el PDF la incluya). */
export async function fotoDataUrl(ruta: string): Promise<string> {
  try {
    let url = ruta
    if (!/^https?:/i.test(ruta)) { const { data } = await supabase.storage.from('servicio-tecnico').createSignedUrl(ruta, 600); if (!data) return ''; url = data.signedUrl }
    const b = await (await fetch(url)).blob()
    if (b.size > 4 * 1048576) return ''
    return await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(''); r.readAsDataURL(b) })
  } catch { return '' }
}

export async function htmlInforme(o: OrdenDoc, eq: EquipoDoc, variante: 'informe' | 'recepcion', logo = ''): Promise<{ titulo: string; cuerpo: string }> {
  const fm = o.empresa === 'FEMEDICS'
  const C = fm ? { p: '#0e5b66', a: '#14a3b4', s: '#e6f6f8', l: '#cfe9ed' } : { p: '#0b2545', a: '#1d72b8', s: '#eef4fb', l: '#d6e2ef' }
  const marca = fm ? 'FEMEDICS' : 'VIMEDIC', rec = variante === 'recepcion'
  const titulo = rec ? TITULOS.recepcion : TITULOS[o.tipo] || 'Informe Técnico'
  const numero = rec ? o.recepcionN : o.informeN
  const fechaDoc = rec ? o.recepcion.fecha || new Date().toISOString() : o.cierre || new Date().toISOString()
  const gar = eq ? (eq.garantia === 'Vigente' ? 'Vigente hasta ' + fd(eq.garantiaHasta) : eq.garantia === 'Vencida' ? 'Vencida (' + fd(eq.garantiaHasta) + ')' : eq.garantia) : '—'
  const colorEstado = ({ 'Operativo': '#0f8a5f', 'Operativo con observaciones': '#b7791f', 'No operativo': '#c0392b', 'Dado de baja': '#475569' } as Record<string, string>)[o.estadoFinal] || C.a
  const sec = (t: string) => `<table class="sec"><tr><td class="sec-t">${esc(t)}</td><td class="sec-l"><div></div></td></tr></table>`
  const kv = (rows: [string, string][]) => `<table class="kv">${rows.filter((r) => r[1] !== '' && r[1] != null).map((r) => `<tr><td class="k">${esc(r[0])}</td><td class="v">${r[1]}</td></tr>`).join('')}</table>`
  const caja = (t: string, inner: string) => `<div class="box"><div class="box-h">${esc(t)}</div><div class="box-b">${inner}</div></div>`
  const pill = (t: string, col: string) => `<span class="pill" style="background:${col}">${esc(t)}</span>`

  const css = `.stdoc{font-family:Helvetica,Arial,sans-serif;color:#1e293b;font-size:10.5px;line-height:1.45}.stdoc table{border-collapse:collapse;width:100%;font-size:inherit}.stdoc td,.stdoc th{font-size:inherit}
.stdoc .logo{height:46px;max-width:230px}.stdoc .doc-t{font-size:15px;font-weight:bold;color:${C.p};text-transform:uppercase;letter-spacing:.5px;text-align:right}.stdoc .doc-n{text-align:right;margin-top:4px}
.stdoc .num{display:inline-block;background:${C.p};color:#fff;font-weight:bold;font-size:11px;padding:4px 10px 8px;border-radius:4px;letter-spacing:.5px}
.stdoc .band{height:4px;background:${C.p};margin:10px 0 0}.stdoc .band2{height:2px;background:${C.a};margin:0 0 12px}
.stdoc .strip td{width:25%;border:1px solid ${C.l};background:${C.s};padding:7px 9px;vertical-align:top}.stdoc .strip .l{font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:bold}
.stdoc .strip .x{font-size:11.5px;font-weight:bold;color:${C.p};margin-top:2px}.stdoc .sec{margin:16px 0 8px}
.stdoc .sec-t{white-space:nowrap;font-size:10px;font-weight:bold;color:${C.p};text-transform:uppercase;letter-spacing:.8px;padding:0 10px 0 7px;border-left:4px solid ${C.a}}.stdoc .sec-l{width:100%}.stdoc .sec-l div{border-top:1px solid ${C.l}}
.stdoc .box{border:1px solid ${C.l};border-radius:6px}.stdoc .box-h{background:${C.p};color:#fff;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.8px;padding:5px 9px 9px}.stdoc .box-b{padding:6px 9px}
.stdoc .kv td{padding:3px 0;vertical-align:top;font-size:10px}.stdoc .kv .k{width:38%;color:#64748b;font-weight:bold;padding-right:8px}.stdoc .kv .v{color:#0f172a}
.stdoc .txt{border:1px solid ${C.l};border-left:3px solid ${C.a};background:#fbfdff;padding:8px 10px;border-radius:4px;font-size:10.5px}
.stdoc .grid th{background:${C.p};color:#fff;font-size:8.5px;text-transform:uppercase;letter-spacing:.6px;text-align:left;padding:6px 8px 9px}.stdoc .grid td{border-bottom:1px solid #e8eef5;padding:5px 8px;font-size:10px;vertical-align:top}.stdoc .grid tr.z td{background:${C.s}}
.stdoc .pill{display:inline-block;color:#fff;font-weight:bold;font-size:8.5px;padding:2px 8px 6px;border-radius:10px;letter-spacing:.3px}
.stdoc .fotos td{width:50%;padding:4px;vertical-align:top}.stdoc .fotos .ph{border:1px solid ${C.l};border-radius:5px;padding:4px;text-align:center}.stdoc .fotos img{max-width:100%;max-height:190px}.stdoc .cap{font-size:8.5px;color:#475569;margin-top:3px}
.stdoc .estado{border:2px solid ${colorEstado};border-radius:6px;padding:9px 12px}.stdoc .estado .e{font-size:14px;font-weight:bold;color:${colorEstado}}
.stdoc .firmas td{width:50%;vertical-align:bottom;text-align:center;padding:0 18px}.stdoc .firm-img{max-height:62px;max-width:100%}.stdoc .firm-l{border-top:1px solid #334155;margin-top:4px;padding-top:4px;font-size:9.5px}
.stdoc .foot{margin-top:18px;border-top:1px solid ${C.l};padding-top:7px;font-size:8px;color:#64748b;text-align:center}.stdoc .nb{page-break-inside:avoid}`

  let h = `<div class="stdoc"><table><tr><td style="width:50%">${logo ? `<img class="logo" src="${logo}">` : `<b style="font-size:22px;color:${C.p}">${marca}</b>`}</td>` +
    `<td style="width:50%"><div class="doc-t">${esc(titulo)}</div><div class="doc-n"><span class="num">N° ${esc(numero || '—')}</span></div></td></tr></table><div class="band"></div><div class="band2"></div>` +
    `<table class="strip"><tr><td><div class="l">${rec ? 'Fecha de recepción' : 'Fecha del servicio'}</div><div class="x">${fd(fechaDoc)}</div></td><td><div class="l">Orden de servicio</div><div class="x">${esc(o.codigo)}</div></td>` +
    `<td><div class="l">Tipo de servicio</div><div class="x">${esc(o.tipo)}</div></td><td><div class="l">${rec ? 'Modalidad' : 'Cobertura'}</div><div class="x">${esc(rec ? 'Ingreso a taller' : o.cobertura || '—')}</div></td></tr></table>`
  h += `<table style="margin-top:12px"><tr><td style="width:50%;padding-right:6px;vertical-align:top">` +
    caja('Datos del cliente', kv([['Cliente', esc(o.cliente)], ['RUC / C.I.', esc(o.identificacion)], ['Dirección', esc([o.direccion, o.ciudad].filter(Boolean).join(', '))], ['Contacto', esc([o.contacto, o.telefono].filter(Boolean).join(' · '))], ['Factura', esc(o.factura)]])) +
    `</td><td style="width:50%;padding-left:6px;vertical-align:top">` +
    caja('Datos del equipo', kv([['Equipo', `<b>${esc(o.producto)}</b>`], ['Marca / modelo', esc(eq ? [eq.marca, eq.modelo].filter(Boolean).join(' · ') : '')], ['N° de serie', `<b style="font-family:Courier,monospace">${esc(o.serie)}</b>`], ['Código', esc(eq?.codigo)], ['Lote', esc(eq?.lote)], ['Fecha de entrega', eq?.fechaEntrega ? fd(eq.fechaEntrega) : ''], ['Garantía', esc(gar)], ['Ubicación', esc(eq?.ubicacion)]])) + `</td></tr></table>`

  if (rec) {
    const r = o.recepcion
    h += sec('Motivo del ingreso / falla reportada') + `<div class="txt">${br(o.falla || '—')}</div>` +
      `<table style="margin-top:10px"><tr><td style="width:50%;padding-right:6px;vertical-align:top">${caja('Accesorios recibidos', `<div style="min-height:40px">${br(r.accesorios || 'Ninguno')}</div>`)}</td><td style="width:50%;padding-left:6px;vertical-align:top">${caja('Estado físico del equipo', `<div style="min-height:40px">${br(r.estadoFisico || '—')}</div>`)}</td></tr></table>`
  } else {
    h += sec('Datos del servicio') + `<table class="strip"><tr><td><div class="l">Técnico responsable</div><div class="x" style="font-size:10.5px">${esc(o.tecnico || '—')}${o.tecnicoEmpresa ? `<br><span style="font-weight:normal;color:#64748b;font-size:9px">${esc(o.tecnicoEmpresa)}</span>` : ''}</div></td>` +
      `<td><div class="l">Modalidad</div><div class="x" style="font-size:10.5px">${esc(o.modalidad)}</div></td><td><div class="l">Inicio / fin</div><div class="x" style="font-size:10px">${fd(o.inicio, true)}<br>${fd(o.cierre, true)}</div></td>` +
      `<td><div class="l">Tiempo de trabajo</div><div class="x" style="font-size:10.5px">${o.horas ? esc(o.horas) + ' h' : '—'}</div></td></tr></table>`
    if (o.falla && o.tipo !== 'Instalación' && o.tipo !== 'Capacitación') h += sec(o.tipo === 'Mantenimiento preventivo' ? 'Motivo del servicio' : 'Falla reportada por el cliente') + `<div class="txt">${br(o.falla)}</div>`
    if (o.diagnostico) h += sec('Diagnóstico técnico') + `<div class="txt">${br(o.diagnostico)}</div>`
    if (o.checklist.length) {
      const colR: Record<string, string> = { OK: '#0f8a5f', Corregido: '#1d72b8', Falla: '#c0392b', 'N/A': '#94a3b8' }
      h += sec(o.tipo === 'Capacitación' ? 'Temas tratados' : 'Actividades realizadas') + `<table class="grid"><tr><th style="width:4%">#</th><th style="width:52%">Actividad</th><th style="width:14%;text-align:center">Resultado</th><th>Observación</th></tr>` +
        o.checklist.map((x, i) => `<tr class="${i % 2 ? 'z' : ''}"><td style="color:#94a3b8">${i + 1}</td><td>${esc(x.actividad)}</td><td style="text-align:center">${x.resultado ? pill(x.resultado, colR[x.resultado] || '#64748b') : '—'}</td><td>${esc(x.obs)}</td></tr>`).join('') + '</table>'
    }
    if (o.mediciones.length) h += sec('Mediciones y pruebas') + `<table class="grid"><tr><th>Parámetro</th><th style="width:16%">Valor medido</th><th style="width:18%">Referencia</th><th style="width:16%;text-align:center">Resultado</th></tr>` +
      o.mediciones.map((x, i) => `<tr class="${i % 2 ? 'z' : ''}"><td>${esc(x.parametro)}</td><td><b>${esc(x.valor)}</b> ${esc(x.unidad)}</td><td>${esc(x.referencia)}${x.referencia && x.unidad && x.referencia !== '—' ? ' ' + esc(x.unidad) : ''}</td><td style="text-align:center">${x.resultado ? pill(x.resultado, x.resultado === 'Conforme' ? '#0f8a5f' : '#c0392b') : '—'}</td></tr>`).join('') + '</table>'
    if (o.trabajo) h += sec(o.tipo === 'Capacitación' ? 'Desarrollo de la capacitación' : 'Trabajo realizado') + `<div class="txt">${br(o.trabajo)}</div>`
    if (o.repuestos.length) h += sec('Repuestos y materiales utilizados') + `<table class="grid"><tr><th style="width:18%">Código</th><th>Descripción</th><th style="width:12%;text-align:center">Cantidad</th></tr>` +
      o.repuestos.map((x, i) => `<tr class="${i % 2 ? 'z' : ''}"><td style="font-family:Courier,monospace">${esc(x.id)}</td><td>${esc(x.nombre)}</td><td style="text-align:center">${esc(x.cantidad)}</td></tr>`).join('') + '</table>'
    if (o.asistentes.length) h += sec('Personal capacitado') + `<table class="grid"><tr><th style="width:5%">#</th><th>Nombre</th><th style="width:28%">Cargo</th><th style="width:20%">C.I.</th></tr>` +
      o.asistentes.map((x, i) => `<tr class="${i % 2 ? 'z' : ''}"><td style="color:#94a3b8">${i + 1}</td><td>${esc(x.nombre)}</td><td>${esc(x.cargo)}</td><td>${esc(x.cedula)}</td></tr>`).join('') + '</table>'
  }
  const fotos = o.fotos.filter((x) => (rec ? x.etapa === 'Recepción' : true)).slice(0, rec ? 4 : 8)
  if (fotos.length) {
    const celdas = (await Promise.all(fotos.map(async (x) => { const src = await fotoDataUrl(x.url); return src ? `<div class="ph nb"><img src="${src}"><div class="cap"><b>${esc(x.etapa)}</b>${x.nota ? ' · ' + esc(x.nota) : ''}</div></div>` : '' }))).filter(Boolean)
    if (celdas.length) { h += sec('Evidencia fotográfica') + '<table class="fotos">'; for (let i = 0; i < celdas.length; i += 2) h += `<tr class="nb"><td>${celdas[i]}</td><td>${celdas[i + 1] || ''}</td></tr>`; h += '</table>' }
  }
  if (!rec) h += `<div class="nb">${sec('Conclusión')}<table><tr><td style="width:42%;vertical-align:top;padding-right:8px"><div class="estado"><div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:bold">Estado final del equipo</div><div class="e">${esc(o.estadoFinal || '—')}</div>` +
    `${o.proximoMantenimiento ? `<div style="margin-top:5px;font-size:9.5px">Próximo mantenimiento: <b>${fd(o.proximoMantenimiento)}</b></div>` : ''}</div></td><td style="vertical-align:top"><div class="txt" style="min-height:44px"><b style="color:${C.p};font-size:9px;text-transform:uppercase;letter-spacing:.6px">Recomendaciones</b><br>${br(o.recomendaciones || 'Sin recomendaciones adicionales.')}</div></td></tr></table></div>`
  const fCli = rec ? { png: o.recepcion.firma, nombre: o.recepcion.entregadoPor, cedula: o.recepcion.cedula, cargo: 'Entrega el equipo' } : { ...o.firma, cargo: o.firma.cargo }
  h += `<table class="firmas nb" style="margin-top:26px"><tr><td><div style="height:62px"></div><div class="firm-l"><b>${esc(rec ? o.recepcion.recibidoPor : o.tecnico)}</b><br>${rec ? 'Recibe en taller' : 'Técnico responsable'}${o.tecnicoEmpresa && !rec ? ' · ' + esc(o.tecnicoEmpresa) : ''}<br>${marca}</div></td>` +
    `<td>${fCli.png ? `<img class="firm-img" src="${esc(fCli.png)}">` : '<div style="height:62px"></div>'}<div class="firm-l"><b>${esc(fCli.nombre || '')}</b><br>${esc([fCli.cargo || (rec ? '' : 'Recibe conforme'), fCli.cedula ? 'C.I. ' + fCli.cedula : ''].filter(Boolean).join(' · '))}<br>${esc(o.cliente)}</div></td></tr></table>`
  h += `<div class="foot">${rec ? `El equipo queda en custodia de ${marca} para su revisión. Presente este comprobante para retirarlo. ` : 'Este informe certifica el servicio técnico realizado al equipo descrito. '}<br>${marca} · Departamento de Servicio Técnico · Documento generado el ${fd(new Date().toISOString(), true)}</div></div>`
  return { titulo: `${rec ? 'Recepcion_' : 'Informe_'}${numero || o.codigo}_${o.cliente.replace(/[^\w]+/g, '_').slice(0, 30)}`, cuerpo: `<style>${css}</style>${h}` }
}

/** Genera el PDF A4 y lo descarga. */
export async function descargarInforme(o: OrdenDoc, eq: EquipoDoc, variante: 'informe' | 'recepcion', logo = '') {
  const { titulo, cuerpo } = await htmlInforme(o, eq, variante, logo)
  const html2pdf = (await import('html2pdf.js')).default
  const caja = document.createElement('div')
  caja.style.cssText = 'position:fixed;left:-10000px;top:0;width:184mm;background:#fff'
  caja.innerHTML = cuerpo
  document.body.appendChild(caja)
  try {
    await html2pdf().set({ margin: [12, 13, 14, 13], filename: titulo + '.pdf', image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4' }, pagebreak: { mode: ['css', 'legacy'], avoid: '.nb' } }).from(caja).save()
  } finally { caja.remove() }
}
