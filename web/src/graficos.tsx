import { useEffect, useRef } from 'react'
import { Chart, registerables, type ChartConfiguration } from 'chart.js'

Chart.register(...registerables)
Chart.defaults.font.family = 'Inter'; Chart.defaults.font.size = 10; Chart.defaults.color = '#64748b'
Chart.defaults.plugins.legend.labels.boxWidth = 10; Chart.defaults.plugins.tooltip.padding = 10; Chart.defaults.plugins.tooltip.backgroundColor = '#0b2545'

/* Utilidades compartidas por los tableros (Dashboard Ejecutivo, etc.) */
export const money = (v: number) => Number(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const money0 = (v: number) => Number(v || 0).toLocaleString('es-EC', { maximumFractionDigits: 0 })
export const normalize = (v: unknown) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const EC_OFFSET = 5 * 3600000
export const ecKey = (iso: string | null | undefined) => { const t = Date.parse(iso ?? ''); return isFinite(t) ? new Date(t - EC_OFFSET).toISOString().slice(0, 10) : '' }
export const hoyKey = () => ecKey(new Date().toISOString())
export const keyAdd = (key: string, days: number) => { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
export const keyDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
export const keyLabel = (key: string, opt: Intl.DateTimeFormatOptions) => new Date(key + 'T12:00:00Z').toLocaleDateString('es-EC', { timeZone: 'UTC', ...opt })
export const monthKeys = (toKey: string, n: number) => { const out: string[] = []; let y = +toKey.slice(0, 4), mo = +toKey.slice(5, 7); for (let i = 0; i < n; i++) { out.unshift(y + '-' + String(mo).padStart(2, '0')); mo--; if (mo < 1) { mo = 12; y-- } } return out }
export const monthLabel = (k: string) => new Date(k + '-15T12:00:00Z').toLocaleDateString('es-EC', { month: 'short', year: '2-digit', timeZone: 'UTC' })
export const CANAL_COLOR: Record<string, string> = { 'Publicidad pagada': '#7c3aed', 'Digital orgánico': '#17a9ba', Comercial: '#c98a1f', Otro: '#055c9d', 'Sin medio': '#94a3b8' }
export const PALETA = ['#055c9d', '#17a9ba', '#7c3aed', '#04896f', '#c98a1f', '#e1306c', '#0b2545', '#64748b']
export function canal(m: string | null | undefined) {
  const s = normalize(m)
  if (!s.trim()) return 'Sin medio'
  if (/anuncio|ads\b|cpc|pagad|pauta/.test(s)) return 'Publicidad pagada'
  if (/web|redes|publicacion|historia|estado|catalogo|whatsapp|pagina|maps|chat|facebook|instagram|tiktok|google|messenger|correo|email/.test(s)) return 'Digital orgánico'
  if (/referid|visita|prospecc|feria|evento|reactiv|seguimiento|telefon|llamada|local|distribuidor/.test(s)) return 'Comercial'
  return 'Otro'
}
export const esMk = (c: string) => c === 'Publicidad pagada' || c === 'Digital orgánico'
export const cleanMedio = (m: string | null | undefined) => String(m || '').trim() || 'Sin medio'
export const corto = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
export const sumBy = <T,>(list: T[], keyFn: (x: T) => string, valFn?: (x: T) => number) => { const o: Record<string, number> = {}; list.forEach((x) => { const k = keyFn(x); o[k] = (o[k] || 0) + (valFn ? valFn(x) : 1) }); return o }
export const topEntries = (obj: Record<string, number>, n: number): [string, number][] => { const e = Object.entries(obj).sort((a, b) => b[1] - a[1]); if (e.length <= n) return e; const rest = e.slice(n - 1).reduce((s, x) => s + x[1], 0); return [...e.slice(0, n - 1), ['Otros', rest]] }
export const baseOpts = (extra: Record<string, unknown> = {}) => ({ responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, ...extra })
export const usdTick = { callback: (v: string | number) => '$' + money0(Number(v)) }

export function Grafico({ config }: { config: ChartConfiguration | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current || !config) return
    const c = new Chart(ref.current, config)
    return () => c.destroy()
  }, [config])
  return <canvas ref={ref} />
}
