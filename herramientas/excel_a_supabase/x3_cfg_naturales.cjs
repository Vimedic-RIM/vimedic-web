// Tablas sin código propio: se comparan por su clave natural y se insertan solo las filas que faltan.
const L = require('./x3_lib.cjs'), fs = require('fs')
const { sqlTabla } = require('./x3_sql.cjs')
const nat = JSON.parse(fs.readFileSync(L.S + '/x3_nat.json'))
const seg = (v) => { const t = Date.parse(v); return isNaN(t) ? String(v) : String(Math.floor((t + 500) / 1000)) }
const out = {}, informe = []

// Galería de productos (producto + archivo)
{
  const ya = new Set(nat.gal.map((g) => g.c + '|' + g.u))
  const nuevos = []
  for (const f of L.hoja(24).filas) {
    const cod = L.aTexto(f[0]), url = L.aTexto(f[3]); if (!cod || !url) continue
    if (ya.has(cod + '|' + url)) continue
    const pid = L.porCodigo('producto', cod); if (!pid) { informe.push('galería: producto ' + cod + ' no existe'); continue }
    const tipo = /video/i.test(String(f[2] ?? '')) ? 'video' : 'imagen'
    nuevos.push({ id: L.uuid(), producto_id: pid, orden: L.aNum(f[1]) ?? 0, tipo, archivo_url: url, descripcion: L.aTexto(f[4]), tipo_video: tipo === 'video' ? L.aTexto(f[6]) : null })
    ya.add(cod + '|' + url)
  }
  out.producto_galeria = nuevos
}
// Fichas técnicas (enlace)
{
  const ya = new Set(nat.fic.map((x) => x.u))
  const nuevos = []
  for (const f of L.hoja(12).filas) {
    const url = L.aTexto(f[4]); if (!url || ya.has(url)) continue
    const pid = L.porCodigo('producto', f[1]); if (!pid) { informe.push('ficha: producto ' + f[1] + ' no existe'); continue }
    nuevos.push({ id: L.uuid(), producto_id: pid, fecha: L.aTs(f[0]), version: Math.round(L.aNum(f[3]) ?? 1), url, drive_id: L.aTexto(f[5]), hash: L.aTexto(f[6]), generada_por: L.empleado(f[7]), anterior_url: L.aTexto(f[8]) })
    ya.add(url)
  }
  out.fichas_tecnicas = nuevos
}
// Bitácora (fecha + usuario + acción + registro)
{
  const k = (fecha, u, a, r) => seg(fecha) + '|' + String(u ?? '').toLowerCase().trim() + '|' + String(a ?? '').trim() + '|' + String(r ?? '').trim()
  const ya = new Set(nat.bit.map((b) => k(b.fecha, b.usuario_email, b.accion, b.registro)))
  const nuevos = []
  for (const f of L.hoja(8).filas) {
    const fecha = L.aTs(f[0]); if (!fecha) continue
    const key = k(fecha, f[1], L.aTexto(f[3]), L.aTexto(f[4])); if (ya.has(key)) continue
    nuevos.push({ fecha, empleado_id: L.empleado(f[1]), usuario_email: L.aTexto(f[1]), modulo: L.aTexto(f[2]), accion: L.aTexto(f[3]), registro: L.aTexto(f[4]), resultado: L.aTexto(f[5]), detalle: L.aTexto(f[6]), sesion: L.aTexto(f[7]), origen: 'hoja:' + (L.aTexto(f[8]) || 'app') })
    ya.add(key)
  }
  out.bitacora = nuevos
}
// Actividad del catálogo de asesores (fecha + enlace + acción)
{
  const k = (fecha, e, a) => seg(fecha) + '|' + String(e ?? '').trim() + '|' + String(a ?? '').trim()
  const ya = new Set(nat.cat.map((c) => k(c.fecha, c.enlace, c.accion)))
  const ej = nat.cat.find((c) => c.productos != null)
  const nuevos = []
  for (const f of L.hoja(26).filas) {
    const fecha = L.aTs(f[0]); if (!fecha) continue
    const key = k(fecha, L.aTexto(f[2]), L.aTexto(f[3])); if (ya.has(key)) continue
    const prod = L.aTexto(f[4])
    nuevos.push({ id: L.uuid(), fecha, asesor_id: L.empleado(f[1]), enlace: L.aTexto(f[2]), accion: L.aTexto(f[3]), productos: L.tipos['catalogo_actividad.productos'] === 'jsonb' ? (L.aJson(f[4], null) ?? (prod ? prod.split(/\s*,\s*/) : [])) : prod, detalle: L.aTexto(f[5]), origen: L.aTexto(f[6]) })
    ya.add(key)
  }
  out.catalogo_actividad = nuevos
  if (ej) informe.push('catálogo: ejemplo de productos en qa ' + JSON.stringify(ej.productos).slice(0, 80))
}
// Asignación de conversaciones (id de conversación)
{
  const ya = new Set(nat.asi.map((a) => String(a.conversacion_id)))
  const nuevos = []
  for (const f of L.hoja(44).filas) {
    const id = L.aTexto(f[0]); if (!id || ya.has(id)) continue
    nuevos.push({ id: L.uuid(), conversacion_id: id, asesor_id: L.empleado(f[1]), fecha_asignacion: L.aTs(f[2]), nombre_contacto: L.aTexto(f[3]), canal: L.aTexto(f[4]), asignado_por: L.aTexto(f[5]) })
    ya.add(id)
  }
  out.asignacion_conversaciones = nuevos
}
for (const [t, n] of Object.entries(out)) console.log(t, n.length, n.slice(0, 2).map((x) => JSON.stringify(x).slice(0, 160)).join(' || '))
console.log(informe.join('\n'))
let sql = 'begin;\n'
for (const [t, n] of Object.entries(out)) if (n.length) sql += sqlTabla(t, { nuevos: n, cambios: [] }) + '\n'
fs.writeFileSync(L.S + '/x3_nat_ensayo.sql', sql + "select (select count(*) from producto_galeria) gal, (select count(*) from fichas_tecnicas) fic, (select count(*) from bitacora) bit, (select count(*) from catalogo_actividad) cat, (select count(*) from asignacion_conversaciones) asi;\nrollback;\n")
fs.writeFileSync(L.S + '/x3_nat_aplicar.sql', sql + 'commit;\n')
fs.writeFileSync(L.S + '/x3_out_naturales.json', JSON.stringify({ out, informe }))
