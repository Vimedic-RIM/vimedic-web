// Vuelca todas las hojas del Excel a JSON: { hoja, encabezados, filas: [[...]] } en <salida>/<n>.json + indice.json
// Uso: JSZIP=... node x3_volcar.cjs <xlsx> <salida>
const JSZip = require(process.env.JSZIP)
const fs = require('fs'), path = require('path')
const [, , archivo, salida] = process.argv
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&')
const colNum = (ref) => { const l = ref.match(/^[A-Z]+/)[0]; let n = 0; for (const ch of l) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
;(async () => {
  fs.mkdirSync(salida, { recursive: true })
  const zip = await JSZip.loadAsync(fs.readFileSync(archivo))
  const wb = await zip.file('xl/workbook.xml').async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string')
  const hojas = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ nombre: dec(m[1]), rid: m[2] }))
  const ss = zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml').async('string') : ''
  const comp = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
  // Formatos de fecha (para saber qué números son fechas)
  const st = zip.file('xl/styles.xml') ? await zip.file('xl/styles.xml').async('string') : ''
  const numFmts = Object.fromEntries([...st.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [m[1], dec(m[2])]))
  const cellXfs = (st.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || ''
  const xfs = [...cellXfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map((m) => m[1])
  const esFecha = xfs.map((id) => { const n = +id; if ((n >= 14 && n <= 22) || (n >= 45 && n <= 47)) return true; const f = numFmts[id] || ''; return /[dmyhs]/i.test(f.replace(/\[[^\]]*\]|"[^"]*"/g, '')) && !/^[#0.,% ]+$/.test(f) })
  const indice = []
  for (const [k, h] of hojas.entries()) {
    const target = rels.match(new RegExp('Id="' + h.rid + '"[^>]*Target="([^"]+)"'))?.[1] || rels.match(new RegExp('Target="([^"]+)"[^>]*Id="' + h.rid + '"'))?.[1]
    const xml = await zip.file('xl/' + target.replace(/^\/?xl\//, '')).async('string')
    const filas = []
    for (const r of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      const fila = []
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = (c[2].match(/t="([^"]+)"/) || [])[1], sIdx = (c[2].match(/s="(\d+)"/) || [])[1]; const cuerpo = c[3] || ''
        let v = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        if (t === 's' && v != null) v = comp[+v]
        else if (t === 'inlineStr') v = dec([...cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''))
        else if (t === 'b' && v != null) v = v === '1'
        else if (t === 'e') v = v != null ? dec(v) : null
        else if (v != null) { v = dec(v); if (t !== 'str' && sIdx != null && esFecha[+sIdx] && /^-?\d+(\.\d+)?$/.test(v)) v = { f: +v } }
        fila[colNum(c[1])] = v
      }
      filas.push(fila)
    }
    const enc = (filas[0] || []).map((x) => (x == null ? '' : String(x).trim()))
    const datos = filas.slice(1).filter((f) => f.some((x) => x != null && String(x).trim() !== '' && !(typeof x === 'object')) || f.some((x) => x && typeof x === 'object'))
    fs.writeFileSync(path.join(salida, k + '.json'), JSON.stringify({ hoja: h.nombre, encabezados: enc, filas: datos }))
    indice.push({ n: k, hoja: h.nombre, filas: datos.length, encabezados: enc.filter(Boolean).length, primera: enc[0] })
  }
  fs.writeFileSync(path.join(salida, 'indice.json'), JSON.stringify(indice, null, 1))
  for (const x of indice) console.log(String(x.n).padStart(2), String(x.filas).padStart(6), x.hoja, '| 1ª col:', x.primera)
})()
