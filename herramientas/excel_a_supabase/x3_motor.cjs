// Motor: aplica la configuración de una tabla a sus hojas, valida contra lo que ya está en pruebas y arma inserciones y cambios.
const L = require('./x3_lib.cjs')
const fs = require('fs')

const { aprender } = require('./x3_aprender.cjs')
/** Columnas que la hoja llena directo (≥95 % de coincidencia con lo cargado), menos las que se calculan a mano. */
function deducidas(tabla, n, muestras, excluir = [], colId = '0') {
  const SIS = ['id', 'created_at', 'updated_at', 'deleted_at', 'creado_por', 'motivo_eliminacion', 'codigo']
  return aprender(n, muestras, colId, true).filter((r) => r.ok >= 95 && r.i >= 0 && !SIS.includes(r.c) && !excluir.includes(r.c)).map((r) => [r.c, r.i])
}
function auto(tabla, pares) { const o = {}; for (const [c, i] of pares) o[c] = (f) => L.convertir(tabla, c, f[i]); return o }

/** cfg: { tabla, hojas:[{n, ctx}], idCol, muestras:[...], cols:{col:(f,ctx,prev)=>v}, actualizar:[cols], defaults:{} } */
function procesar(cfg) {
  const db = cfg.muestras.flatMap((m) => L.muestra(m))
  const kDb = cfg.claveDb || ((r) => String(r.codigo).trim()), kX = cfg.claveXls || ((c) => c)
  const porCod = new Map(db.map((r) => [kDb(r), r]))
  const val = {}, malos = {}, nuevos = [], cambios = [], vistos = new Set()
  for (const h of cfg.hojas) {
    const H = L.hoja(h.n)
    for (const f of H.filas) {
      const fx = L.formas(f[cfg.idCol]); if (!fx[0]) continue
      const prev = fx.map((x) => porCod.get(kX(x, h.ctx || {}))).find(Boolean)
      const codigo = prev ? prev.codigo : (cfg.codigo ? cfg.codigo(f, h.ctx) : L.aTexto(f[cfg.idCol]))
      const kv = kX(codigo, h.ctx || {}); if (vistos.has(kv)) continue; vistos.add(kv)
      if (cfg.saltar && cfg.saltar(f, h.ctx || {}, prev)) continue
      const fila = { codigo }
      for (const [c, fn] of Object.entries(cfg.cols)) fila[c] = fn(f, h.ctx || {}, prev)
      if (prev) {
        const cam = {}
        for (const c of Object.keys(cfg.cols)) {
          const a = L.norm(cfg.tabla, c, prev[c]), b = L.norm(cfg.tabla, c, fila[c])
          const igual = a === b || (a == null && (b === '[]' || b === '{}' || b === false)) || (b == null && (a === '[]' || a === '{}' || a === false))
          val[c] = val[c] || { ok: 0, n: 0 }; val[c].n++; if (igual) val[c].ok++
          else { (malos[c] = malos[c] || []).length < 3 && malos[c].push({ codigo, db: String(prev[c]).slice(0, 90), xls: String(typeof fila[c] === 'object' && fila[c] ? JSON.stringify(fila[c]) : fila[c]).slice(0, 90) }); if ((cfg.actualizar || []).includes(c) && !(cfg.noVaciar && (fila[c] == null || fila[c] === ''))) cam[c] = fila[c] }
        }
        if (Object.keys(cam).length) cambios.push({ id: prev.id, codigo, cambios: cam, antes: Object.fromEntries(Object.keys(cam).map((k) => [k, prev[k]])) })
      } else {
        nuevos.push({ id: L.uuid(), ...(cfg.defaults || {}), ...fila })
      }
    }
  }
  return { val, malos, nuevos, cambios }
}

function informe(nombre, r, verMalos = true) {
  console.log(`\n=== ${nombre}: ${r.nuevos.length} nuevos · ${r.cambios.length} con cambios`)
  for (const [c, v] of Object.entries(r.val)) {
    const p = Math.round((v.ok / v.n) * 1000) / 10
    console.log(`  ${c.padEnd(24)} ${String(p).padStart(5)}%` + (p < 100 && verMalos ? '  ej: ' + JSON.stringify(r.malos[c]?.[0] ?? '').slice(0, 260) : ''))
  }
}
module.exports = { deducidas, auto, procesar, informe, L, fs }
