const { deducidas, auto, procesar, informe, L, fs } = require('./x3_motor.cjs')
const T = 'movimientos_inventario'
const base = deducidas(T, 59, ['movimientos'], ['aplica_iva'])
const ivaDe = (v) => { const s = String(v ?? '').trim(); return s ? !/^(SIN IVA|NO|false|0)$/i.test(s) : null }
const r = procesar({
  tabla: T, idCol: 0, muestras: ['movimientos'], hojas: [{ n: 59 }],
  cols: {
    ...auto(T, base),
    aplica_iva: (f) => ivaDe(f[9]),
    producto_id: (f) => L.porCodigo('producto', f[4]),
    factura_id: (f) => L.porCodigo('factura', f[1]),
    ingreso_id: (f) => L.porCodigo('ingreso', f[1]),
    nota_credito_id: (f) => L.porCodigo('nota', f[23]),
    recepcion_nc_id: (f) => L.porCodigo('nota', f[25]),
    movimiento_original_id: (f) => L.porCodigo('mov', f[24]),
    responsable_id: (f) => L.empleado(f[10]),
  },
  actualizar: [],
})
informe('movimientos', r)
for (const n of r.nuevos) console.log(' NUEVO', n.codigo, n.tipo, n.producto_codigo, n.cantidad, n.operacion_codigo, 'fac', !!n.factura_id, 'ing', !!n.ingreso_id, 'prod', !!n.producto_id, n.fecha)
fs.writeFileSync(L.S + '/x3_out_movimientos.json', JSON.stringify(r))
