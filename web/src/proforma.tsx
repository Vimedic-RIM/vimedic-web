import { useEffect, useRef } from 'react'
import { Printer, X } from 'lucide-react'
import { imagen } from './modulos/Inventario'

/* Proforma / comprobante de venta en HTML listo para imprimir o guardar como PDF en A4.
   Mismo diseño que la proforma de la app original (Documentos.gs → generateInternalQuotePDFBase_). */

export type ItemDoc = { id?: string; codigo?: string; nombre: string; imagen?: string; categoria?: string; descripcion?: string; precio: number; cantidad: number; descuento?: number; iva?: boolean; observacion?: string }
export type DatosDoc = {
  codigo: string; fecha: string; tipo: 'Cotización' | 'Venta'; empresa?: 'VIMEDIC' | 'FEMEDICS'
  cliente: { nombre: string; identificacion?: string | null; email?: string | null; telefono?: string | null }
  asesor: string; nota?: string | null; items: ItemDoc[]
  pagoEntrega?: { pago?: string; entrega?: string; detalle?: string[] } | null
}

const esc = (v: unknown) => (v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))
const m2 = (n: number) => '$' + n.toFixed(2)

export function htmlProforma(d: DatosDoc, base: string): string {
  const femedics = d.empresa === 'FEMEDICS'
  const pie = femedics ? 'FEMEDICS IMPORTACIONES · Distribuidor autorizado de la marca VIMEDIC' : 'Quito, Ecuador — Agende su visita a nuestras salas de exhibición'
  let total = 0, baseIva = 0
  const filas = d.items.map((i, k) => {
    const unit = Number(i.precio) || 0, cant = Number(i.cantidad) || 0, pct = Number(i.descuento) || 0
    const bruto = unit * cant, ahorro = bruto * (pct / 100), sub = bruto - ahorro
    total += sub; if (i.iva !== false) baseIva += sub
    const img = i.imagen ? `<img src="${esc(imagen(i.imagen, 160))}" style="width:64px;height:64px;object-fit:contain" onerror="this.style.visibility='hidden'" />` : '<div style="width:64px;height:64px"></div>'
    const tot =
      `<tr><td class="l">CANTIDAD:</td><td class="r">${cant}</td></tr>` +
      `<tr><td class="l">P. UNITARIO:</td><td class="r">${m2(unit)}</td></tr>` +
      (pct > 0 ? `<tr><td class="l">DESCUENTO (%):</td><td class="r" style="color:#c0392b">${pct.toFixed(2)}%</td></tr><tr><td class="l">AHORRO (USD):</td><td class="r" style="color:#c0392b">${m2(ahorro)}</td></tr><tr><td class="l" style="color:#0b2545">V. UNIT. CON DESC.:</td><td class="r" style="color:#04896f">${m2(unit * (1 - pct / 100))}</td></tr>` : '') +
      `<tr><td class="l" style="color:#0b2545;font-weight:bold;padding-top:4px;border-top:1px solid #e2e8f0">SUBTOTAL (USD):</td><td class="r" style="color:#055c9d;padding-top:4px;border-top:1px solid #e2e8f0">${m2(sub)}</td></tr>`
    return `<tr class="fila">
      <td style="text-align:center;font-size:11px">${k + 1}</td>
      <td style="text-align:center;width:70px">${img}</td>
      <td style="font-size:11px"><strong>${esc(i.nombre)}${i.codigo || i.id ? ' | ' + esc(i.codigo || i.id) : ''}</strong>${i.iva === false ? ' <span class="sin-iva">SIN IVA</span>' : ''}<br>
        ${i.categoria ? `<span style="color:#64748b;font-size:10px">${esc(i.categoria)}</span>` : ''}
        ${i.descripcion ? `<div style="color:#475569;font-size:9.5px;margin-top:5px;line-height:1.5;white-space:pre-line">${esc(i.descripcion)}</div>` : ''}
        ${i.observacion ? `<div style="margin-top:4px;font-size:9.5px;font-weight:bold;color:#b45309">📌 ${esc(i.observacion)}</div>` : ''}</td>
      <td style="width:155px"><table style="width:100%;font-size:9.5px;border-collapse:collapse">${tot}</table></td></tr>`
  }).join('')
  const iva = baseIva * 0.15, totalIva = total + iva
  const nota = d.nota ? `<div style="background:#fdecea;border:1.5px solid #c0392b;border-radius:8px;padding:10px 12px;margin-bottom:15px;font-size:11px;color:#c0392b;font-weight:bold"><strong style="text-transform:uppercase;font-size:10px">⚠ Nota importante:</strong> ${esc(d.nota).replace(/\r?\n/g, '<br>')}</div>` : ''
  const pe = d.pagoEntrega
  const cajaPago = pe ? `<div class="box" style="margin:0 0 15px"><div class="box-title">Detalles de Pago y Entrega</div>
    <table class="details-table"><tr><td style="width:85px"><strong>Pago:</strong></td><td>${esc(pe.pago || '—')}</td></tr>
    <tr><td><strong>Entrega:</strong></td><td>${esc(pe.entrega || '—')}${(pe.detalle ?? []).map((x) => '<br><span style="color:#64748b">' + esc(x) + '</span>').join('')}</td></tr></table></div>` : ''
  const titulo = d.tipo === 'Venta' ? 'COMPROBANTE DE VENTA' : 'PROFORMA / COTIZACIÓN'
  const etiqueta = d.tipo === 'Venta' ? 'Nº VENTA' : 'Nº SOLICITUD'

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(d.tipo === 'Venta' ? 'Venta_' : 'Proforma_')}${esc(d.codigo)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1e293b; background: #fff; width: 186mm; margin: 0 auto; padding: 0; font-size: 12px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 3px solid #055c9d; padding-bottom: 12px; }
  .logo { width: 160px; max-height: 60px; object-fit: contain; }
  .company-info { text-align: right; font-size: 11px; color: #365679; }
  .title { font-size: 18px; color: #055c9d; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
  .grid2 { display: flex; gap: 6px; margin-bottom: 15px; }
  .grid2 > div { flex: 1; }
  .box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; }
  .box-title { font-size: 11px; font-weight: bold; color: #055c9d; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
  .details-table { width: 100%; border-collapse: collapse; font-size: 11px; } .details-table td { padding: 2px 0; }
  .items { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .items th { background: #055c9d; color: #fff; padding: 8px; font-size: 11px; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .items td { padding: 10px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .fila { break-inside: avoid; page-break-inside: avoid; }
  .l { color: #64748b; padding: 1.5px 0; } .r { text-align: right; font-weight: bold; padding: 1.5px 0; }
  .sin-iva { background: #f1f5f9; color: #64748b; font-size: 8.5px; font-weight: bold; padding: 1px 5px; border-radius: 4px; }
  .totales { width: 260px; margin-left: auto; margin-top: 10px; font-size: 12px; border-collapse: collapse; break-inside: avoid; }
  .totales td { padding: 4px 6px; } .totales .grand td { font-weight: bold; font-size: 14px; color: #055c9d; border-top: 2px solid #055c9d; }
  .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; }
  .badge { background: #2ab9c7; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media screen { body { padding: 16px 0; } }
</style></head><body>
  <div class="header">
    <div>${femedics ? '<div style="font-size:20px;font-weight:bold;color:#055c9d">FEMEDICS</div>' : `<img src="${esc(base)}logo-documento.png" class="logo" alt="VIMEDIC" />`}</div>
    <div class="company-info"><div class="title">${titulo}</div>${femedics ? '' : '<div>' + pie + '</div>'}</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-bottom:15px">
    <span class="badge">${etiqueta}: ${esc(d.codigo)}</span>
    <span style="font-size:11px;color:#475569"><strong>Fecha:</strong> ${esc(d.fecha)}</span>
  </div>
  <div class="grid2">
    <div class="box"><div class="box-title">Datos del Cliente</div><table class="details-table">
      <tr><td style="width:85px"><strong>Nombre:</strong></td><td>${esc(d.cliente.nombre)}</td></tr>
      <tr><td><strong>Cédula / RUC:</strong></td><td>${esc(d.cliente.identificacion)}</td></tr>
      <tr><td><strong>Correo:</strong></td><td>${esc(d.cliente.email)}</td></tr>
      <tr><td><strong>Teléfono:</strong></td><td>${esc(d.cliente.telefono)}</td></tr></table></div>
    <div class="box"><div class="box-title">Asesor Comercial</div><table class="details-table"><tr><td style="width:85px"><strong>Nombre:</strong></td><td>${esc(d.asesor)}</td></tr></table></div>
  </div>
  ${nota}${cajaPago}
  <table class="items"><thead><tr><th style="width:25px;text-align:center">#</th><th style="width:70px;text-align:center">Img</th><th>Producto</th><th style="width:155px;text-align:right">Totales</th></tr></thead><tbody>${filas}</tbody></table>
  <table class="totales"><tr><td>Subtotal:</td><td style="text-align:right">${m2(total)}</td></tr><tr><td>IVA (15%):</td><td style="text-align:right">${m2(iva)}</td></tr><tr class="grand"><td>TOTAL:</td><td style="text-align:right">${m2(totalIva)}</td></tr></table>
  <div class="footer"><p>${pie}</p></div>
</body></html>`
}

/* Visor dentro de la app: vista previa A4 + botón para imprimir / guardar como PDF (sin ventanas emergentes). */
export function ProformaVisor({ datos, cerrar }: { datos: DatosDoc; cerrar: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const html = htmlProforma(datos, window.location.origin + '/')
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f) }, [cerrar])
  const imprimir = () => { const w = ref.current?.contentWindow; if (w) { w.focus(); w.print() } }
  return (
    <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: 'rgba(15,23,42,.72)' }}>
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
        <div className="min-w-0 flex-1"><p className="font-display font-bold text-sm truncate">{datos.tipo === 'Venta' ? 'Comprobante de venta' : 'Proforma'} · {datos.codigo}</p>
          <p className="text-[11px] text-white/70">Tamaño A4. En «Imprimir» elige «Guardar como PDF».</p></div>
        <button onClick={imprimir} className="text-xs font-bold px-3.5 py-2 rounded-lg bg-white flex items-center gap-1.5" style={{ color: 'var(--primary)' }}><Printer className="w-4 h-4" /> Imprimir / Guardar PDF</button>
        <button onClick={cerrar} className="w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20" aria-label="Cerrar"><X className="w-4 h-4" /></button>
      </div>
      <iframe ref={ref} title="Proforma" srcDoc={html} className="flex-1 w-full bg-white" style={{ border: 0 }} />
    </div>
  )
}
