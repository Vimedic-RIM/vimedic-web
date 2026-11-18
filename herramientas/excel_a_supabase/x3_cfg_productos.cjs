const { procesar, informe, L, fs } = require('./x3_motor.cjs')
const T = 'productos'
const n = (i) => (f) => L.aNum(f[i])
const t = (i) => (f) => L.aTexto(f[i])
const SIEMPRE = ['stock', 'stock_fisico', 'pvp', 'precio_dis', 'estado', 'stock_no_disponible_nc', 'stock_por_reparar']
const SI_VACIO = ['nombre', 'descripcion', 'ficha_tecnica_url', 'imagen_url', 'drive_carpeta_url', 'marca', 'codigo_unico', 'referencia_proveedor', 'caracteristicas', 'especificaciones', 'accesorios', 'certificaciones', 'reservaciones']
const r = procesar({
  tabla: T, idCol: 0, muestras: ['productos'], hojas: [{ n: 40 }], noVaciar: true,
  cols: {
    stock: n(7), stock_fisico: n(17), pvp: n(8), precio_dis: n(9), estado: t(11), stock_no_disponible_nc: n(16), stock_por_reparar: n(23),
    nombre: t(1), descripcion: t(3), ficha_tecnica_url: t(4), imagen_url: t(5), drive_carpeta_url: t(6), marca: t(19), codigo_unico: t(18), referencia_proveedor: t(22),
    caracteristicas: t(26), especificaciones: t(27), accesorios: t(28), certificaciones: t(29), reservaciones: t(12),
  },
  actualizar: [...SIEMPRE, ...SI_VACIO],
})
// Textos y enlaces: solo si en pruebas están vacíos
const vacio = (v) => v == null || String(v).trim() === ''
const omitidos = {}
for (const c of r.cambios) for (const k of SI_VACIO) if (k in c.cambios && !vacio(c.antes[k])) { omitidos[k] = (omitidos[k] || 0) + 1; delete c.cambios[k]; delete c.antes[k] }
r.cambios = r.cambios.filter((c) => Object.keys(c.cambios).length)
// Observaciones de stock (reservaciones): las lleva Bodega en la app original → se sincronizan, incluso vacías
{
  const db = new Map(L.muestra('productos').map((x) => [x.codigo, x]))
  const porCod = new Map(r.cambios.map((c) => [c.codigo, c]))
  for (const f of L.hoja(40).filas) {
    const p = db.get(String(f[0]).trim()); if (!p) continue
    const a = (p.reservaciones || '').trim(), b = L.aTexto(f[12]) || ''
    if (a === b) continue
    const fa = Date.parse(a), fb = Date.parse(b); if (!isNaN(fa) && !isNaN(fb) && Math.abs(fa - fb) < 864e5) continue
    let c = porCod.get(p.codigo); if (!c) { c = { id: p.id, codigo: p.codigo, cambios: {}, antes: {} }; r.cambios.push(c); porCod.set(p.codigo, c) }
    c.cambios.reservaciones = b || null; c.antes.reservaciones = p.reservaciones
  }
}
informe('productos', r, false)
console.log('textos distintos que NO se pisan (editados en qa o con otro formato):', JSON.stringify(omitidos))
const cnt = {}; for (const c of r.cambios) for (const k of Object.keys(c.cambios)) cnt[k] = (cnt[k] || 0) + 1
console.log('cambios por columna:', JSON.stringify(cnt), '· productos:', r.cambios.length)
for (const c of r.cambios.filter((c) => 'stock' in c.cambios).slice(0, 60)) process.stdout.write(c.codigo + ' ' + c.antes.stock + '→' + c.cambios.stock + ' · ')
console.log()
for (const c of r.cambios.filter((c) => 'pvp' in c.cambios || 'estado' in c.cambios || 'precio_dis' in c.cambios).slice(0, 20)) console.log(' ', c.codigo, JSON.stringify(c.antes), '→', JSON.stringify(c.cambios))
fs.writeFileSync(L.S + '/x3_out_productos.json', JSON.stringify(r))
