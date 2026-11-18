// Cotizaciones y ventas (VIMEDIC y FEMEDICS)
const { auto, procesar, informe, L, fs } = require('./x3_motor.cjs')
const T = 'cotizaciones'
const item = (x) => ({ cantidad: L.aNum(x.cantidad) ?? 1, carpeta: x.driveFolderUrl ?? '', categoria: x.categoria ?? '', codigo: x.id ?? '', descripcion: x.descripcionCompleta ?? '', descuento: L.aNum(x.descuento) ?? 0, ficha: x.fichaTecnica ?? '', id: x.id ?? '', imagen: x.imagen ?? '', iva: !(x.ivaAplica === false || x.ivaAplica === 'false'), nombre: x.nombre ?? '', observacion: x.observacion ?? '', precio: L.aNum(x.precio) ?? 0, ...(x.precioDis != null && x.precioDis !== '' ? { precioDis: L.aNum(x.precioDis) } : {}) })
const items = (f) => { const a = L.aJson(f[17], []); return Array.isArray(a) ? a.map(item) : [] }
const total = (it) => { let s = 0, iv = 0; for (const i of it) { const l = i.precio * i.cantidad * (1 - (i.descuento || 0) / 100); s += l; if (i.iva !== false) iv += l * 0.15 } return Math.round((s + iv) * 100) / 100 }
const pe = (f) => { const o = L.aJson(f[19], {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {} }
const limpio = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') { const x = limpio(v); if (Object.keys(x).length) r[k] = x } else if (v != null && v !== '') r[k] = v } return r }
const detalle0 = (p) => { if (!Object.keys(p).length) return null; return limpio({ ciudadDestino: p.ciudad, destinatario: { cedula: p.cedulaDestinatario, email: p.emailDestinatario, nombre: p.nombreDestinatario, telefono: p.telefonoDestinatario }, direccionEnvio: p.direccionEnvio, empaque: { armado: p.empaqueArmado, caja: p.empaqueCaja, stretch: p.empaqueStretch }, observacionPago: p.observacionPago, remitente: { cedula: p.cedulaRemitente, nombre: p.nombreRemitente, telefono: p.telefonoRemitente }, transporte: p.transporte, quienRecibe: p.quienRecibe, telefonoEntregaLocal: p.telefonoEntregaLocal, direccionEntregaLocal: p.direccionEntregaLocal, urlGoogleMaps: p.urlGoogleMaps, cartaGarantia: p.cartaGarantia, plazoCredito: p.plazoCredito, tipoPago: p.tipoPago }) }
const detalle = (p) => {
  if (!Object.keys(p).length) return null
  const t = (k) => (p[k] == null ? '' : String(p[k]))
  const o = { destinatario: { cedula: t('cedulaDestinatario'), email: t('emailDestinatario'), nombre: t('nombreDestinatario'), telefono: t('telefonoDestinatario') },
    empaque: { armado: t('empaqueArmado'), caja: t('empaqueCaja'), stretch: t('empaqueStretch') }, remitente: { cedula: t('cedulaRemitente'), nombre: t('nombreRemitente'), telefono: t('telefonoRemitente') } }
  if (p.ciudad) o.ciudadDestino = p.ciudad; if (p.direccionEnvio) o.direccionEnvio = p.direccionEnvio; if (p.observacionPago) o.observacionPago = p.observacionPago; if (p.transporte) o.transporte = p.transporte
  return o
}
const ATR = { 29: 'origen', 30: 'utm_source', 31: 'utm_medium', 32: 'utm_campaign', 33: 'utm_content', 34: 'utm_term', 35: 'fbclid', 36: 'ttclid', 37: 'gclid', 38: 'wbraid', 39: 'gbraid', 40: 'epik', 41: 'landing_url', 42: 'referrer', 43: 'producto_id', 44: 'producto_nombre', 45: 'producto_categoria', 46: 'event_id', 48: 'campana_id', 49: 'grupo_anuncios_id', 50: 'anuncio_id', 51: 'producto_url', 52: 'conversion_url', 53: 'fecha_contacto_publicitario', 54: 'fecha_conversion_utc', 55: 'canal_conversion', 56: 'tipo_conversion', 57: 'contexto_producto', 59: 'primer_contacto_json', 60: 'ultima_campana_json', 61: 'version_atribucion', 62: 'estado_atribucion' }
function atribucion(f) {
  const o = {}
  for (const [i, k] of Object.entries(ATR)) { const v = L.aTexto(f[+i]); if (v) o[k] = v }
  if (f[12] && !L.empleado(f[12]) && !L.empleado(f[9])) o.asesor_original = String(f[12]).trim()
  if (f[13] && !L.empleado(f[13])) o.responsable_original = String(f[13]).trim()
  return o
}
const cfg = (n, empresa) => ({ n, ctx: { empresa } })
const r = procesar({
  tabla: T, idCol: 0, muestras: ['cotizaciones', 'cotizaciones_fm'], hojas: [cfg(61, 'VIMEDIC'), cfg(37, 'FEMEDICS')],
  cols: {
    ...auto(T, [['fecha', 1], ['solo_nombre', 2], ['identificacion', 3], ['nombre', 4], ['email', 5], ['telefono', 6], ['direccion', 7], ['ciudad', 8], ['detalle_equipos', 10], ['estado', 11],
      ['ultima_actividad', 15], ['proximo_seguimiento', 16], ['pdf_url', 18], ['nota_general', 47], ['medio_captacion_venta', 63], ['medio_captacion_lead', 64],
      ['nota_cotizacion', 65], ['nota_venta', 66], ['notas_separadas', 67], ['fecha_venta', 68]]),
    empresa: (f, c) => c.empresa,
    tipo_registro: (f) => L.aTexto(f[28]) || 'Histórico',
    estado_crm: (f) => (L.aTexto(f[14]) === 'Eliminado' ? 'Perdido' : L.aTexto(f[14]) || 'Nuevo'),
    asesor_id: (f) => L.empleado(f[12]) || L.empleado(f[9]),
    responsable_proforma_id: (f) => L.empleado(f[13]),
    cliente_id: (f, c) => (/^(CF-)?9+$/i.test(String(f[3] ?? '').trim()) ? null : L.cliente(c.empresa, f[3])),
    items: (f) => items(f),
    total: (f) => (items(f).length ? total(items(f)) : null),
    pago_entrega: (f) => pe(f),
    estado_pago: (f) => { const v = L.aTexto(f[21]); return v ? (/^true$/i.test(v) ? 'Pagado' : v) : (typeof pe(f).pago === 'string' && pe(f).pago ? pe(f).pago : null) },
    tipo_entrega: (f) => pe(f).entrega || L.aTexto(f[23]),
    direccion_entrega: (f) => L.aTexto(f[24]) || pe(f).direccionEnvio || pe(f).direccionEntregaLocal || null,
    fecha_entrega: (f) => L.aFecha(pe(f).fechaEntrega || f[25]),
    metodo_pago: (f) => L.aTexto(f[20]) || (pe(f).tipoPago || null),
    anticipo: (f) => L.aNum(f[22]),
    flete: (f) => L.aNum(f[26]),
    flete_lo_paga: (f) => L.aTexto(f[27]),
    productos_solicitados: (f) => { const a = L.aJson(f[58], []); return Array.isArray(a) ? a : [] },
    atribucion: (f) => atribucion(f),
    lead_sin_cliente: (f) => L.aBool(f[70]),
    detalle_venta: (f) => detalle(pe(f)),
  },
  actualizar: ['estado', 'estado_crm', 'ultima_actividad', 'proximo_seguimiento', 'pdf_url', 'tipo_registro', 'nota_general', 'nota_cotizacion', 'nota_venta', 'notas_separadas', 'fecha_venta',
    'medio_captacion_venta', 'medio_captacion_lead', 'email', 'telefono', 'direccion', 'ciudad', 'nombre', 'detalle_equipos', 'asesor_id', 'responsable_proforma_id',
    'items', 'total', 'pago_entrega', 'estado_pago', 'tipo_entrega', 'direccion_entrega', 'fecha_entrega', 'detalle_venta', 'metodo_pago'],
})
const ESTANDAR = new Set(['cantidad', 'carpeta', 'categoria', 'codigo', 'descripcion', 'descuento', 'ficha', 'id', 'imagen', 'iva', 'nombre', 'observacion', 'precio', 'precioDis'])
for (const c of r.cambios) {
  const editadoEnQa = Array.isArray(c.antes.items) && c.antes.items.some((i) => Object.keys(i).some((k) => !ESTANDAR.has(k)))
  if (('items' in c.cambios || 'total' in c.cambios) && (editadoEnQa || !('items' in c.cambios))) { delete c.cambios.items; delete c.cambios.total; delete c.antes.items; delete c.antes.total }
  if (!('pago_entrega' in c.cambios)) for (const k of ['detalle_venta', 'metodo_pago', 'direccion_entrega', 'estado_pago', 'tipo_entrega', 'fecha_entrega']) { delete c.cambios[k]; delete c.antes[k] }
}
r.cambios = r.cambios.filter((c) => Object.keys(c.cambios).length)
// nuevas: «Eliminado» en la hoja → se cargan dadas de baja, como las demás
const H = { ...Object.fromEntries(require('./x3_lib.cjs').hoja(61).filas.map((f) => [String(f[0]).trim(), f])), ...Object.fromEntries(require('./x3_lib.cjs').hoja(37).filas.map((f) => [String(f[0]).trim(), f])) }
for (const n of r.nuevos) { const f = H[n.codigo]; if (f && String(f[14] ?? '').trim() === 'Eliminado') { n.deleted_at = new Date().toISOString(); n.motivo_eliminacion = 'Eliminada en la app original' } }
informe('cotizaciones', r)
fs.writeFileSync(L.S + '/x3_out_cotizaciones.json', JSON.stringify(r))
module.exports = r
