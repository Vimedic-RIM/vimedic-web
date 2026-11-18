// Deduce qué columna de la hoja llena cada columna de la tabla, comparando filas que ya están en pruebas.
// Uso: node x3_aprender.cjs <n hoja> <archivo muestra (x3m/<x>.json)> [col id]
const fs = require('fs'), S = __dirname
function aprender(n, muestra, colId = '0', silencio = false) {
const h = JSON.parse(fs.readFileSync(S + '/x3/' + n + '.json'))
const db = [].concat(...[].concat(muestra).map((m) => JSON.parse(fs.readFileSync(S + '/x3m/' + m + '.json'))))
const formas = (v) => { const x = v == null ? '' : String(v).trim(); const f = [x]; if (/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(x)) { const k = Number(x); if (isFinite(k)) { f.push(String(k)); f.push(String(k).padStart(10, '0')); f.push(String(k).padStart(13, '0')) } } return f }
const porCod = new Map(db.map((r) => [String(r.codigo).trim(), r]))
const pares = []
for (const f of h.filas) { const fx = formas(f[+colId]); const r = fx.map((x) => porCod.get(x)).find(Boolean); if (r) pares.push([f, r]) }
// Normalizaciones para comparar
const serialAMs = (s) => Math.round((s - 25569) * 864e5)  // hora local de Ecuador escrita como UTC
const variantes = (v) => {
  if (v == null) return ['']
  if (typeof v === 'object' && 'f' in v) { const ms = serialAMs(v.f); const d = new Date(ms).toISOString(); return ['T' + Math.round((ms + 5 * 36e5) / 6e4), 'D' + d.slice(0, 10), 'N' + v.f] }
  const s = String(v).trim()
  const out = ['S' + s.toLowerCase()]
  if (/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(s)) out.push('N' + Math.round(Number(s) * 100) / 100)
  if (/^(si|sí|true|1|x)$/i.test(s)) out.push('Btrue'); if (/^(no|false|0)$/i.test(s) || s === '') out.push('Bfalse')
  const t = Date.parse(s); if (/\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(t)) { out.push('T' + Math.round(t / 6e4)); out.push('D' + s.slice(0, 10)) }
  return out
}
const varDb = (v) => {
  if (v == null) return ['', 'Bfalse']
  if (typeof v === 'boolean') return ['B' + v]
  if (typeof v === 'number') return ['N' + Math.round(v * 100) / 100, 'S' + String(v).toLowerCase()]
  if (typeof v === 'object') return ['J' + JSON.stringify(v)]
  const s = String(v).trim(), out = ['S' + s.toLowerCase()]
  if (/^-?\d+(\.\d+)?$/.test(s)) out.push('N' + Math.round(Number(s) * 100) / 100)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { out.push('T' + Math.round(Date.parse(s) / 6e4)); out.push('D' + s.slice(0, 10)) } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.push('D' + s)
  return out
}
const cols = Object.keys(db[0] || {})
const res = []
for (const c of cols) {
  let mejor = { i: -1, ok: 0 }
  const vacios = pares.filter(([, r]) => r[c] == null || r[c] === '').length
  for (let i = 0; i < h.encabezados.length; i++) {
    if (!h.encabezados[i]) continue
    let ok = 0, comp = 0
    for (const [f, r] of pares) {
      if (r[c] == null || r[c] === '') continue
      comp++
      const a = new Set(variantes(f[i])); if (varDb(r[c]).some((x) => a.has(x))) ok++
    }
    if (comp && ok / comp > mejor.ok) mejor = { i, ok: ok / comp }
  }
  res.push({ c, i: mejor.i, enc: h.encabezados[mejor.i] ?? '', ok: Math.round(mejor.ok * 100), llenas: pares.length - vacios })
}
if (!silencio) { console.log('pares', pares.length, 'de', h.filas.length); for (const r of res) console.log(r.c.padEnd(26), String(r.ok).padStart(3) + '%', r.i >= 0 ? r.i + ':' + r.enc : '—', '· con dato', r.llenas) }
return res
}
module.exports = { aprender }
if (require.main === module) aprender(process.argv[2], process.argv[3], process.argv[4] || '0')
