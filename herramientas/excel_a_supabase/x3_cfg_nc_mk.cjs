const { deducidas, auto, procesar, informe, L, fs } = require('./x3_motor.cjs')
// Detalle de notas de crédito
const nc = procesar({
  tabla: 'nota_credito_detalle', idCol: 0, muestras: ['nc_detalle'], hojas: [{ n: 47 }],
  cols: { ...auto('nota_credito_detalle', deducidas('nota_credito_detalle', 47, ['nc_detalle'])),
    nota_credito_id: (f) => L.porCodigo('nota', f[1]), factura_id: (f) => L.porCodigo('factura', f[2]), movimiento_original_id: (f) => L.porCodigo('mov', f[3]), producto_id: (f) => L.porCodigo('producto', f[4]) },
  actualizar: [],
})
informe('nota_credito_detalle', nc)
for (const x of nc.nuevos) console.log(' NUEVO', x.codigo.slice(0, 30), 'nc', !!x.nota_credito_id, 'fac', !!x.factura_id, 'mov', !!x.movimiento_original_id, 'prod', !!x.producto_id, x.tipo, x.cantidad, x.total)
fs.writeFileSync(L.S + '/x3_out_nc.json', JSON.stringify(nc))
// Cambios de Marketing (revisión de la app original)
const T = 'marketing_cambios'
const mk = procesar({
  tabla: T, idCol: 0, muestras: ['mk_cambios'], hojas: [{ n: 13 }],
  cols: { ...auto(T, deducidas(T, 13, ['mk_cambios'], ['fecha_revision', 'fecha_devolucion', 'estado', 'comentario'])),
    estado: (f) => L.aTexto(f[9]), comentario: (f) => L.aTexto(f[15]),
    fecha_revision: (f) => L.aTs(f[14]) || (String(f[6] ?? '').trim() === 'Directo' ? L.aTs(f[1]) : null),
    fecha_devolucion: (f) => L.aTs(f[17]),
    horas_correccion: (f) => L.aNum(f[18]),
    autor_id: (f) => L.empleado(f[10]) || L.empleado(f[11]), revisado_por: (f) => L.empleado(f[13]), producto_id: (f) => L.porCodigo('producto', f[3]) },
  actualizar: ['estado', 'comentario', 'fecha_revision', 'revisado_por', 'correcciones', 'fecha_devolucion', 'horas_correccion'],
})
// Solo revisiones hechas en la app original sobre cambios que en pruebas siguen pendientes
mk.cambios = mk.cambios.filter((c) => (c.antes.estado ?? 'Pendiente') === 'Pendiente' || !('estado' in c.cambios) && false)
informe('marketing_cambios', mk)
for (const c of mk.cambios.slice(0, 20)) console.log(' ', c.codigo, JSON.stringify(c.antes).slice(0, 90), '→', JSON.stringify(c.cambios).slice(0, 120))
const est = {}; for (const x of mk.nuevos) est[x.estado] = (est[x.estado] || 0) + 1
console.log('nuevos por estado', JSON.stringify(est), 'sin producto', mk.nuevos.filter((x) => !x.producto_id).length, 'sin autor', mk.nuevos.filter((x) => !x.autor_id).length)
fs.writeFileSync(L.S + '/x3_out_mk.json', JSON.stringify(mk))
