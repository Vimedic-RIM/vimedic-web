// Tablas sin registros faltantes: ¿cambió algo en la app original? Mapeo deducido (≥95 %), sin vaciar datos.
const { deducidas, auto, procesar, L, fs } = require('./x3_motor.cjs')
const T = [
  ['notas_credito', [46, 43], ['nc1', 'nc2']], ['ingresos_proveedor', [58], ['ingresos']], ['audiovisual', [45], ['audiovisual']], ['actividades', [50], ['actividades']],
  ['proyectos', [51], ['proyectos']], ['monedas_movimientos', [49], ['monedas']], ['catalogos_generados', [14], ['catalogos']], ['proveedores', [48], ['proveedores']],
  ['imp_items', [20], ['imp_items']], ['imp_codigos_reservados', [21], ['imp_codigos']], ['imp_ordenes_st', [22], ['imp_ordenes']], ['imp_recepciones', [23], ['imp_recepciones']],
  ['imp_expedientes', [28], ['imp_exp']], ['material_solicitudes', [17], ['material']], ['promo_campanas', [9], ['promo']], ['mensajes', [53], ['mensajes']], ['aliados', [71], ['aliados']],
]
const res = {}
for (const [tabla, hojas, muestras] of T) {
  let base = []
  for (const n of hojas) { const d = deducidas(tabla, n, muestras); if (d.length > base.length) base = d }
  if (!base.length) { console.log(tabla, ': sin columnas deducidas'); continue }
  const r = procesar({ tabla, idCol: 0, muestras, hojas: hojas.map((n) => ({ n })), noVaciar: true, saltar: (f, x, prev) => !prev, cols: auto(tabla, base), actualizar: base.map(([c]) => c) })
  const cnt = {}; for (const c of r.cambios) for (const k of Object.keys(c.cambios)) cnt[k] = (cnt[k] || 0) + 1
  console.log(tabla.padEnd(24), 'cambios:', r.cambios.length, JSON.stringify(cnt))
  for (const c of r.cambios.slice(0, 4)) console.log('    ', c.codigo, JSON.stringify(c.antes).slice(0, 110), '→', JSON.stringify(c.cambios).slice(0, 110))
  res[tabla] = r
}
fs.writeFileSync(L.S + '/x3_out_resto.json', JSON.stringify(res))
