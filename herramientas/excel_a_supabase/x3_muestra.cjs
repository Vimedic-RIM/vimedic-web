// Arma el SQL para traer de pruebas las filas (todas las columnas menos «busqueda») cuyos códigos están en la hoja.
// Uso: node x3_muestra.cjs <n hoja> <tabla> <col id> <max> > salida.sql
const fs = require('fs'), S = __dirname
const [, , n, tabla, col, max] = process.argv
const h = JSON.parse(fs.readFileSync(S + '/x3/' + n + '.json'))
const formas = (v) => { const x = v == null ? '' : String(v).trim(); const f = [x]; if (/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(x)) { const k = Number(x); if (isFinite(k)) { f.push(String(k)); f.push(String(k).padStart(10, '0')); f.push(String(k).padStart(13, '0')) } } return f }
const cods = [...new Set(h.filas.flatMap((f) => formas(f[+col])).filter(Boolean))]
const lista = (+max > 0 ? cods.slice(-(+max) * 4) : cods).map((c) => "'" + c.replace(/'/g, "''") + "'").join(',')
console.log(`select json_agg(to_jsonb(t) - 'busqueda') j from public.${tabla} t where codigo in (${lista});`)
