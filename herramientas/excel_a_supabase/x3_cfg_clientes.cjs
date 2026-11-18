const { deducidas, auto, procesar, informe, L, fs } = require('./x3_motor.cjs')
const T = 'clientes'
const MAN = ['empresa', 'asesor_id', 'responsable_id', 'fecha_registro', 'institucion', 'telefono2', 'cumpleanos', 'descuento_fijo', 'estado_acceso', 'atribucion', 'datos_venta', 'provincia', 'identificacion']
const base = deducidas(T, 55, ['clientes'], MAN)
const DV = L.hoja(39), dvPor = new Map(DV.filas.map((f) => [String(f[0]).trim(), f]))
const tel = (v) => { const s = L.aTexto(v); return s && /^9\d{8}$/.test(s) ? '0' + s : s }
const repetidos = new Set(); { const vis = new Set(); for (const n of [55, 38]) for (const f of L.hoja(n).filas) { const k = n + '|' + String(f[0]).trim(); if (vis.has(k)) repetidos.add(String(f[0]).trim()); vis.add(k) } }
const TIPOS = /^(PVP|DIS|VIP|DIS:?\s*\d+%?|CLIENTE FINAL|DISTRIBUIDOR|INSTITUCI|)$/i
const r = procesar({
  claveDb: (r) => r.empresa + '|' + String(r.codigo).trim(), claveXls: (c, x) => x.empresa + '|' + c, noVaciar: true,
  saltar: (f, x, prev) => prev && (repetidos.has(String(f[0]).trim()) || /^CF-/.test(String(f[0])) || (f[8] && !/^https?:/i.test(String(f[8]))) || !TIPOS.test(String(f[14] ?? '').trim())),
  tabla: T, idCol: 0, muestras: ['clientes', 'clientes_fm'], hojas: [{ n: 55, ctx: { empresa: 'VIMEDIC' } }, { n: 38, ctx: { empresa: 'FEMEDICS' } }],
  cols: {
    ...auto(T, base),
    empresa: (f, c) => c.empresa,
    telefono: (f) => tel(f[4]),
    tipo_cliente: (f) => { const v = L.aTexto(f[14]); return v ? v.toUpperCase() : v },
    identificacion: (f) => L.aTexto(f[0]),
    asesor_id: (f) => L.empleado(f[15]), responsable_id: (f) => L.empleado(f[16]),
    fecha_registro: (f) => L.convertir(T, 'fecha_registro', f[17]), institucion: (f) => L.aTexto(f[2]), telefono2: (f) => tel(f[5]),
    cumpleanos: (f) => L.convertir(T, 'cumpleanos', f[12]), descuento_fijo: (f) => L.aTexto(f[46]), estado_acceso: (f) => L.aTexto(f[22]),
  },
  actualizar: [...base.map(([c]) => c), 'asesor_id', 'responsable_id', 'institucion', 'telefono2', 'descuento_fijo'],
})
informe('clientes', r)
console.log('repetidos en la hoja:', repetidos.size)
for (const x of r.cambios.slice(0, 40)) console.log(x.codigo, JSON.stringify(x.antes).slice(0, 110), '→', JSON.stringify(x.cambios).slice(0, 110))
fs.writeFileSync(L.S + '/x3_out_clientes.json', JSON.stringify(r))
