// Facturación: ventas nuevas y cambios de estado / número / PDF hechos en la app original.
const { deducidas, auto, procesar, informe, L, fs } = require('./x3_motor.cjs')
const T = 'facturas'
const MAN = ['datos_completos', 'guia_envio_url', 'acta_garantia_url', 'total', 'total_neto', 'total_notas_credito', 'identificacion', 'numero_contifico']
const base = deducidas(T, 57, ['facturas'], MAN)
// Pago y entrega de la venta (hoja Cotizaciones), como en la recuperación del 16-nov
const PE = new Map(); for (const n of [61, 37]) for (const f of L.hoja(n).filas) if (f[19]) PE.set(String(f[0]).trim(), L.aJson(f[19], null))
const EMP = new Map(); for (const n of [[61, 'VIMEDIC'], [37, 'FEMEDICS']]) for (const f of L.hoja(n[0]).filas) EMP.set(String(f[0]).trim(), n[1])
const item = (x) => ({ cantidad: Math.abs(L.aNum(x.cantidad) ?? 1), codigo: x.itemId ?? x.id ?? '', descuento: L.aNum(x.descuento) ?? 0, id: x.itemId ?? x.id ?? '', imagen: x.imagenUrl ?? x.imagen ?? '',
  iva: !/^(SIN IVA|NO|false)$/i.test(String(x.iva ?? 'CON IVA').trim()), nombre: x.nombre ?? '', observacion: x.observacion ?? '', precio: L.aNum(x.precio) ?? 0 })
const items = (f) => { const a = L.aJson(f[13], []); return Array.isArray(a) ? a.map(item) : [] }
const sumas = (it) => { let s = 0, iv = 0; for (const i of it) { const l = i.precio * i.cantidad * (1 - (i.descuento || 0) / 100); s += l; if (i.iva !== false) iv += l * 0.15 } const r2 = (x) => Math.round(x * 100) / 100; return { subtotal: r2(s), iva: r2(iv), total: r2(s + iv) } }
const numero = (v) => { const s = L.aTexto(v); return s }
const r = procesar({
  tabla: T, idCol: 0, muestras: ['facturas'], hojas: [{ n: 57 }],
  codigo: (f) => { const s = L.aTexto(f[0]); return s },
  cols: {
    ...auto(T, base),
    identificacion: (f) => L.aTexto(f[1]),
    numero_contifico: (f) => numero(f[4]),
    empresa: (f) => EMP.get(String(f[0]).trim()) || 'VIMEDIC',
    asesor_id: (f) => L.empleado(f[2]), facturado_por: (f) => L.empleado(f[3]),
    cotizacion_id: (f) => L.porCodigo('cotizacion', f[0]),
    cliente_id: (f) => L.cliente(EMP.get(String(f[0]).trim()) || 'VIMEDIC', f[1]),
    datos_completos: (f) => L.aBool(f[12]) || !!(L.aJson(f[14], null) || PE.get(String(f[0]).trim())),
    guia_envio_url: (f) => L.aTexto(f[8]), acta_garantia_url: (f) => L.aTexto(f[7]),
    items: (f) => items(f),
    items_original: (f) => { const a = L.aJson(f[18], null); return Array.isArray(a) ? a.map(item) : null },
    subtotal: (f) => sumas(items(f)).subtotal, iva: (f) => sumas(items(f)).iva, total: (f) => sumas(items(f)).total,
    total_notas_credito: (f) => L.aNum(f[19]) ?? 0,
    total_neto: (f) => L.aNum(f[20]) ?? Math.round((sumas(items(f)).total - (L.aNum(f[19]) ?? 0)) * 100) / 100,
    pago_entrega: (f) => L.aJson(f[14], null) || PE.get(String(f[0]).trim()) || {},
    guia_datos: (f) => L.aJson(f[16], {}) || {}, acta_datos: (f) => L.aJson(f[17], {}) || {},
    historial: (f) => { const a = L.aJson(f[21], []); return Array.isArray(a) ? a : [] },
  },
  actualizar: ['estado', 'numero_contifico', 'pdf_url', 'observacion', 'fecha_facturacion', 'facturado_por', 'historial', 'medio_captacion_venta', 'acta_garantia_url', 'guia_envio_url', 'total_notas_credito', 'total_neto'],
})
// Enlaces de acta y guía: solo se llenan si en pruebas están vacíos (lo generado en qa se conserva)
for (const c of r.cambios) for (const k of ['acta_garantia_url', 'guia_envio_url']) if (k in c.cambios && c.antes[k] && !/^https?:/i.test(c.antes[k])) { delete c.cambios[k]; delete c.antes[k] }
// Totales: solo si cambiaron las notas de crédito
for (const c of r.cambios) if (!('total_notas_credito' in c.cambios)) { delete c.cambios.total_neto; delete c.antes.total_neto }
r.cambios = r.cambios.filter((c) => Object.keys(c.cambios).length)
informe('facturas', r)
for (const c of r.cambios) console.log(' ', c.codigo, JSON.stringify(c.antes).slice(0, 120), '→', JSON.stringify(c.cambios).slice(0, 140))
for (const n of r.nuevos) console.log(' NUEVA', n.codigo, n.estado, n.numero_contifico, n.total, n.empresa, 'cot', !!n.cotizacion_id, 'cli', !!n.cliente_id, 'pe', Object.keys(n.pago_entrega || {}).length)
fs.writeFileSync(L.S + '/x3_out_facturas.json', JSON.stringify(r))
