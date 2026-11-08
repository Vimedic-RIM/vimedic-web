// Uso: node scope-css.cjs entrada.css salida.css .clase-raiz
// Prefija cada selector con la clase raíz para que el CSS de un módulo no afecte a los demás.
// Quita las reglas globales (:root, *, html, body, scrollbars).
const fs = require('fs')
const [, , entrada, salida, raiz] = process.argv
let css = fs.readFileSync(entrada, 'utf8').replace(/<\/?style[^>]*>/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

function bloques(texto) {
  const out = []
  let i = 0
  while (i < texto.length) {
    const a = texto.indexOf('{', i)
    if (a < 0) break
    const cabecera = texto.slice(i, a).trim()
    let nivel = 1, j = a + 1
    while (j < texto.length && nivel > 0) { if (texto[j] === '{') nivel++; else if (texto[j] === '}') nivel--; j++ }
    out.push({ cabecera, cuerpo: texto.slice(a + 1, j - 1) })
    i = j
  }
  return out
}
const GLOBAL = /^(:root|\*|html|body$|::-webkit|\*,)/
function prefijar(sel) {
  return sel.split(',').map((s) => s.trim()).filter(Boolean).filter((s) => !GLOBAL.test(s)).map((s) => (s.startsWith('body ') ? raiz + ' ' + s.slice(5) : raiz + ' ' + s)).join(', ')
}
function procesar(texto) {
  return bloques(texto).map(({ cabecera, cuerpo }) => {
    if (/^@(keyframes|font-face)/.test(cabecera)) return `${cabecera}{${cuerpo}}`
    if (/^@(media|supports)/.test(cabecera)) return `${cabecera}{${procesar(cuerpo)}}`
    const p = prefijar(cabecera)
    return p ? `${p}{${cuerpo}}` : ''
  }).filter(Boolean).join('\n')
}
fs.writeFileSync(salida, procesar(css))
console.log('ok', fs.statSync(salida).size, 'bytes')
