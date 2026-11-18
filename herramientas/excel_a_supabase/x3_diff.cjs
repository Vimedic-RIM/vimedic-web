// Compara los ID de cada hoja con los códigos de su tabla en pruebas: cuántos faltan en la base.
const fs = require('fs'), S = process.argv[2]
const cod = JSON.parse(fs.readFileSync(S + '/x3_codigos.json'))
const hoja = (n) => JSON.parse(fs.readFileSync(S + '/x3/' + n + '.json'))
const MAP = [
  [55, 'clientes', 0], [38, 'clientes', 0], [52, 'leads', 0], [67, 'leads', 0], [68, 'leads', 0], [62, 'leads', 0],
  [61, 'cotizaciones', 0], [37, 'cotizaciones', 0], [69, 'interacciones', 0], [57, 'facturas', 0], [58, 'ingresos_proveedor', 0],
  [59, 'movimientos_inventario', 0], [46, 'notas_credito', 0], [43, 'notas_credito', 0], [47, 'nota_credito_detalle', 0], [40, 'productos', 0],
  [34, 'despachos', 0], [13, 'marketing_cambios', 0], [45, 'audiovisual', 0], [53, 'mensajes', 0], [50, 'actividades', 0], [51, 'proyectos', 0],
  [49, 'monedas_movimientos', 0], [14, 'catalogos_generados', 0], [48, 'proveedores', 0], [20, 'imp_items', 0], [21, 'imp_codigos_reservados', 0],
  [22, 'imp_ordenes_st', 0], [23, 'imp_recepciones', 0], [28, 'imp_expedientes', 0], [29, 'imp_unidades', 0], [17, 'material_solicitudes', 0],
  [9, 'promo_campanas', 0], [64, 'rutas', 0], [63, 'viaticos', 0], [4, 'th_tipos_permiso', 0], [11, 'documentos_tecnicos', 0], [71, 'aliados', 0],
  [25, 'categorias', 0], [66, 'empleados', 0],
]
const res = []
for (const [n, t, col] of MAP) {
  const h = hoja(n)
  const formas = (v) => { const x = v == null ? '' : String(v).trim(); const f = [x]; if (/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(x)) { const n = Number(x); if (isFinite(n)) { f.push(String(n)); f.push(String(n).padStart(10, '0')); f.push(String(n).padStart(13, '0')) } } return f }
  const ids = h.filas.map((f) => formas(f[col])).filter((f) => f[0])
  const set = new Map((cod[t] || []).map((x) => [String(x.c ?? '').trim(), x.b]))
  const falta = ids.filter((f) => !f.some((x) => set.has(x))).map((f) => f[0])
  const borrados = ids.filter((f) => f.some((x) => set.get(x) === true))
  res.push({ n, hoja: h.hoja, tabla: t, filas: ids.length, faltan: falta.length, borradosEnQa: borrados.length, ej: falta.slice(0, 6) })
}
for (const r of res) console.log(String(r.faltan).padStart(5), 'faltan de', String(r.filas).padStart(5), '|', r.hoja, '→', r.tabla, r.borradosEnQa ? '| borrados en qa: ' + r.borradosEnQa : '', r.faltan ? '| ej: ' + r.ej.join(', ') : '')
fs.writeFileSync(S + '/x3_diff.json', JSON.stringify(res))
