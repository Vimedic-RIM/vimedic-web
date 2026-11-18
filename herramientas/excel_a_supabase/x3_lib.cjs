// Biblioteca común del cargador: lectura de hojas, conversión por tipo de columna, referencias y comparación.
const fs = require('fs'), S = __dirname
const ref = JSON.parse(fs.readFileSync(S + '/x3_ref.json'))
const tipos = ref.tipos
const hoja = (n) => JSON.parse(fs.readFileSync(S + '/x3/' + n + '.json'))
const muestra = (x) => JSON.parse(fs.readFileSync(S + '/x3m/' + x + '.json'))
const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const formas = (v) => { const x = v == null ? '' : String(v).trim(); const f = [x]; if (/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(x)) { const k = Number(x); if (isFinite(k)) { f.push(String(k)); f.push(String(k).padStart(10, '0')); f.push(String(k).padStart(13, '0')) } } return f }

// ---- fechas: el Excel guarda la hora local de Ecuador (UTC-5)
const serialAIso = (s) => new Date(Math.round((s - 25569) * 864e5) + 5 * 36e5).toISOString()
const serialAFecha = (s) => new Date(Math.round((s - 25569) * 864e5)).toISOString().slice(0, 10)
function aTs(v) {
  if (v == null || v === '') return null
  if (typeof v === 'object' && 'f' in v) return serialAIso(v.f)
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], (+m[4] || 0) + 5, +m[5] || 0, +m[6] || 0)).toISOString()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T05:00:00Z').toISOString()
  const t = Date.parse(s); return isNaN(t) ? null : new Date(t).toISOString()
}
function aFecha(v) {
  if (v == null || v === '') return null
  if (typeof v === 'object' && 'f' in v) return serialAFecha(v.f)
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  if (/^\d+(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) return serialAFecha(+s)
  const t = Date.parse(s); return isNaN(t) ? null : new Date(t - 5 * 36e5).toISOString().slice(0, 10)
}
const aNum = (v) => { if (v == null || v === '') return null; if (typeof v === 'object' && 'f' in v) return v.f; const n = Number(String(v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : null }
const aBool = (v) => (v == null || v === '' ? false : typeof v === 'boolean' ? v : /^(si|sí|true|1|x|verdadero)$/i.test(String(v).trim()))
const aTexto = (v) => { if (v == null) return null; if (typeof v === 'object' && 'f' in v) return serialAIso(v.f); const s = String(v).trim(); if (!s || /^#(ERROR|N\/A|REF|VALUE|DIV\/0|NAME|NUM|NULL)/i.test(s)) return null; if (/^-?\d+\.\d+E[+-]?\d+$/i.test(s) && isFinite(Number(s))) return String(Number(s)); if (/^-?\d+\.0+$/.test(s)) return s.replace(/\.0+$/, ''); return s }
// JSON escrito a mano en la hoja con comillas sin escapar (p. ej. Monitor 12" Vimedic): se reparan las comillas internas.
function repararJson(s) {
  let out = '', dentro = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && dentro) { out += ch + (s[i + 1] ?? ''); i++; continue }
    if (ch === '"') {
      if (!dentro) { dentro = true; out += ch; continue }
      let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++
      if (j >= s.length || ',:}]'.includes(s[j])) { dentro = false; out += ch } else out += '\\"'
      continue
    }
    if (dentro && (ch === '\n' || ch === '\r' || ch === '\t')) { out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t'; continue }
    out += ch
  }
  return out
}
const aJson = (v, def) => { if (v == null || v === '') return def; if (typeof v === 'object' && !('f' in v)) return v; try { return JSON.parse(String(v)) } catch { try { return JSON.parse(repararJson(String(v))) } catch { return def } } }
function convertir(tabla, col, v) {
  const t = tipos[tabla + '.' + col] || 'text'
  if (t.startsWith('timestamp')) return aTs(v)
  if (t === 'date') return aFecha(v)
  if (t === 'numeric' || t === 'integer' || t === 'bigint' || t === 'double precision' || t === 'real' || t === 'smallint') { const n = aNum(v); return n == null ? null : t === 'integer' || t === 'bigint' || t === 'smallint' ? Math.round(n) : n }
  if (t === 'boolean') return aBool(v)
  if (t === 'jsonb' || t === 'json') return aJson(v, null)
  return aTexto(v)
}

// ---- referencias
const mapa = (lista, k = 'codigo') => { const m = new Map(); for (const x of lista || []) if (x[k] != null) m.set(String(x[k]).trim(), x.id); return m }
const REF = {
  cotizacion: mapa(ref.cotizaciones), lead: mapa(ref.leads), factura: mapa(ref.facturas), producto: mapa(ref.productos),
  ingreso: mapa(ref.ingresos), nota: mapa(ref.notas), mov: mapa(ref.movs),
}
const porCodigo = (tipo, v) => { for (const f of formas(v)) { const id = REF[tipo].get(f); if (id) return id } return null }
const empNombre = new Map(), empEmail = new Map(), empCod = new Map()
for (const e of ref.empleados) { empNombre.set(sinTildes(e.nombre), e.id); if (e.email) empEmail.set(e.email.toLowerCase(), e.id); if (e.codigo) empCod.set(e.codigo, e.id) }
function empleado(v) {
  if (v == null || v === '') return null
  const s = String(v).trim(); if (empCod.has(s)) return empCod.get(s)
  if (s.includes('@')) return empEmail.get(s.toLowerCase()) ?? null
  const n = sinTildes(s.replace(/\(.*?\)/g, '')).replace(/[.,;]+$/, '').trim()
  if (empNombre.has(n)) return empNombre.get(n)
  for (const [k, id] of empNombre) if (k.startsWith(n + ' ') || n.startsWith(k + ' ')) return id
  // nombre y primer apellido
  const p = n.split(' '); if (p.length >= 2) for (const [k, id] of empNombre) { const q = k.split(' '); if (q[0] === p[0] && q.includes(p[1])) return id }
  return null
}
const cliPorIdent = new Map(), cliPorCod = new Map()
for (const c of ref.clientes) { if (c.b) continue; if (c.ident) cliPorIdent.set(c.empresa + '|' + c.ident, c.id); if (c.codigo) cliPorCod.set(c.empresa + '|' + c.codigo, c.id) }
function cliente(empresa, ident, codigo) {
  for (const f of formas(ident)) { const id = cliPorIdent.get(empresa + '|' + f) || cliPorCod.get(empresa + '|' + f); if (id) return id }
  if (codigo) for (const f of formas(codigo)) { const id = cliPorCod.get(empresa + '|' + f); if (id) return id }
  return null
}
function registrarCliente(empresa, ident, codigo, id) { if (ident) cliPorIdent.set(empresa + '|' + ident, id); if (codigo) cliPorCod.set(empresa + '|' + codigo, id) }

// ---- comparación normalizada
function norm(tabla, col, v) {
  if (v == null || v === '') return null
  const t = tipos[tabla + '.' + col] || 'text'
  if (t.startsWith('timestamp')) { const ms = Date.parse(v); return isNaN(ms) ? String(v) : Math.floor((ms + 500) / 1000) }
  if (t === 'date') return String(v).slice(0, 10)
  if (col === 'identificacion' && /^\d{9}$|^\d{12}$/.test(String(v).trim())) return '0' + String(v).trim()
  if (['numeric', 'integer', 'bigint', 'double precision', 'real', 'smallint'].includes(t)) return Math.round(Number(v) * 100) / 100
  if (t === 'boolean') return !!v
  if (t === 'jsonb' || t === 'json') return estable(v)
  return String(v).trim()
}
function estable(v) { if (v == null) return null; if (Array.isArray(v)) return '[' + v.map(estable).join(',') + ']'; if (typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + estable(v[k])).join(',') + '}'; return JSON.stringify(v) }
const uuid = () => require('crypto').randomUUID()

module.exports = { ref, tipos, hoja, muestra, sinTildes, formas, aTs, aFecha, aNum, aBool, aTexto, aJson, convertir, porCodigo, empleado, cliente, registrarCliente, norm, estable, uuid, S }
