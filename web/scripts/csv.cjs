const fs = require('fs')

// Lector CSV (RFC 4180): comillas, comas y saltos de línea dentro de celdas.
function leerCsv(ruta) {
  const t = fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '')
  const filas = []
  let fila = [], c = '', q = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++ } else q = false } else c += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { fila.push(c); c = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++
      fila.push(c); c = ''
      if (fila.length > 1 || fila[0] !== '') filas.push(fila)
      fila = []
    } else c += ch
  }
  if (c !== '' || fila.length) { fila.push(c); filas.push(fila) }
  return filas
}

const num = (s) => {
  if (s == null) return null
  const v = String(s).trim().replace(/,/g, '')
  if (v === '' || !/^-?\d+(\.\d+)?$/.test(v)) return null
  return Number(v)
}
const fecha = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || '').trim())
  if (!m || m[3] === '1899') return null
  return `${m[3]}-${m[2]}-${m[1]}`
}
const si = (s) => /^(si|sí)$/i.test(String(s || '').trim())
const vacio = (s) => (String(s || '').trim() === '' ? null : String(s).trim())

module.exports = { leerCsv, num, fecha, si, vacio }
