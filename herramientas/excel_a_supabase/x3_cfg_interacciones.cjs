const { deducidas, auto, procesar, informe, L, fs } = require('./x3_motor.cjs')
const T = 'interacciones'
const base = deducidas(T, 69, ['interacciones'])
// Nombres de usuario que la carga anterior ya resolvió (alias, apodos): se reutilizan
const aprendido = new Map(); for (const x of L.muestra('interacciones')) if (x.usuario_texto && x.empleado_id) aprendido.set(L.sinTildes(x.usuario_texto), x.empleado_id)
const emp = (v) => L.empleado(v) || (v ? aprendido.get(L.sinTildes(v)) ?? null : null)
const r = procesar({
  tabla: T, idCol: 0, muestras: ['interacciones'], hojas: [{ n: 69 }],
  cols: {
    ...auto(T, base),
    cotizacion_id: (f) => L.porCodigo('cotizacion', f[1]),
    lead_id: (f) => L.porCodigo('lead', f[1]),
    empleado_id: (f) => emp(f[6]),
  },
  actualizar: [],
})
informe('interacciones', r)
console.log('nuevas sin empleado:', [...new Set(r.nuevos.filter((n) => !n.empleado_id).map((n) => n.usuario_texto))].join(', '))
const sinRef = r.nuevos.filter((n) => !n.cotizacion_id && !n.lead_id)
console.log('nuevas sin referencia:', sinRef.length, sinRef.slice(0, 8).map((n) => n.ref_tipo + ':' + n.ref_codigo).join(' '))
fs.writeFileSync(L.S + '/x3_out_interacciones.json', JSON.stringify(r))
