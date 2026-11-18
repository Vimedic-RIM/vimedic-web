// Genera el SQL de una tabla: inserta las filas nuevas y actualiza solo las columnas que cambiaron.
const fs = require('fs')
const lit = (o) => { const j = JSON.stringify(o); if (j.includes('$x3$')) throw new Error('marca en datos'); return '$x3$' + j + '$x3$' }
function sqlTabla(tabla, r) {
  const out = []
  if (r.nuevos.length) {
    const cols = [...new Set(r.nuevos.flatMap((x) => Object.keys(x)))]
    const filas = r.nuevos.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)))
    for (let i = 0; i < filas.length; i += 200) out.push(`insert into public.${tabla} (${cols.join(', ')}) select ${cols.join(', ')} from jsonb_populate_recordset(null::public.${tabla}, ${lit(filas.slice(i, i + 200))}::jsonb);`)
  }
  for (const c of r.cambios) {
    const cols = Object.keys(c.cambios)
    out.push(`update public.${tabla} t set (${cols.join(', ')}) = (select ${cols.map((k) => 'x.' + k).join(', ')} from jsonb_populate_record(null::public.${tabla}, ${lit(c.cambios)}::jsonb) x) where t.id = '${c.id}';`)
  }
  return out.join('\n')
}
module.exports = { sqlTabla }
