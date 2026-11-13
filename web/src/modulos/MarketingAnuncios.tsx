import { useCallback, useEffect, useState } from 'react'
import { BarChart3, RefreshCw } from 'lucide-react'
import { supabase } from '../supabase'
import { llamar } from './MarketingIntegraciones'

/* Anuncios: inversión y resultados de cada anuncio en las redes (Zernio Ads) cruzados con los leads y las
   ventas del CRM atribuidos a ese anuncio (mkAnuncios + mkEstadisticas_ del original). */

type Ad = { id: string; adId: string; nombre: string; campana: string; plataforma: string; estado: string; moneda: string; metricas: Record<string, number | null> }
type Grupo = { clave: string; adId: string | null; campana: string; medio: string; leads: number; ventas: number; baseVentas: number }
type Atribucion = { grupos: Grupo[]; leads: number; ventas: number; baseVentas: number; ventasSinFecha: number; criterio: string }
const PLAT: Record<string, [string, string]> = { facebook: ['F', '#1877f2'], instagram: ['I', '#e1306c'], tiktok: ['T', '#111827'], linkedin: ['in', '#0a66c2'], youtube: ['Y', '#ff0000'], google: ['G', '#34a853'], googleads: ['G', '#34a853'], meta: ['M', '#0866ff'] }
const money = (v: number) => Number(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const n0 = (v: unknown) => (v == null || v === '' ? '—' : Number(v).toLocaleString('es-EC'))
// Zernio guarda el anuncio como "ag:123…" en la atribución de algunos leads: se compara solo el número.
const soloId = (v: string | null | undefined) => String(v || '').replace(/^[a-z]+:/i, '')

export function InversionAnuncios({ desde, hasta }: { desde: string; hasta: string }) {
  const [ads, setAds] = useState<Ad[] | null>(null)
  const [pagina, setPagina] = useState(1)
  const [paginas, setPaginas] = useState(1)
  const [estado, setEstado] = useState('')
  const [error, setError] = useState('')
  const [atr, setAtr] = useState<Atribucion | null>(null)
  const [cargando, setCargando] = useState(false)

  const cargar = useCallback(async (mas = false) => {
    setCargando(true)
    const pag = mas ? pagina + 1 : 1
    const [r, a] = await Promise.all([
      llamar<{ ads: Ad[]; pagina: number; paginas: number; pendiente: boolean }>('zernio_anuncios', { desde, hasta, pagina: pag }).then((x) => ({ ok: x, error: '' })).catch((e) => ({ ok: null, error: (e as Error).message })),
      mas ? Promise.resolve(null) : supabase.rpc('mkt_atribucion', { p_desde: desde, p_hasta: hasta }),
    ])
    if (a) { if (a.error) setError(a.error.message); else setAtr(a.data as Atribucion) }
    if (r.ok) {
      setPagina(pag); setPaginas(r.ok.paginas || 1)
      setAds((ant) => { const m = new Map((mas ? ant ?? [] : []).map((x) => [x.id, x])); r.ok!.ads.forEach((x) => m.set(x.id, x)); return [...m.values()] })
      setEstado((r.ok.pendiente ? 'Zernio está completando el histórico: cifras parciales. ' : 'Conexión con Zernio Ads activa. ') + `Página ${pag} de ${r.ok.paginas || pag}.`)
    } else { setAds((x) => x ?? []); setEstado(r.error) }
    setCargando(false)
  }, [desde, hasta, pagina])
  useEffect(() => { cargar() }, [desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps

  const grupoDe = (a: Ad) => (atr?.grupos ?? []).find((g) => g.adId && a.adId && soloId(g.adId) === soloId(a.adId))
  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3 flex-wrap">
          <h3 className="font-display font-bold text-sm text-slate-800 flex items-center gap-2"><BarChart3 className="w-4 h-4" style={{ color: 'var(--violet)' }} />Inversión por anuncio</h3>
          <span className="text-[11px] text-slate-500">{estado}</span>
          <button type="button" className="btn ml-auto" onClick={() => cargar()} disabled={cargando}><RefreshCw className={cargando ? 'animate-spin' : ''} />Actualizar</button>
        </div>
        {!ads && <p className="p-6 text-center text-xs text-slate-400">Consultando Zernio Ads…</p>}
        {ads && !ads.length && <p className="p-6 text-center text-xs text-slate-400">{estado && !/activa/.test(estado) ? '' : 'No hay anuncios con datos en este período.'}</p>}
        {ads && ads.length > 0 && (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Anuncio</th><th>Estado</th><th className="num">Gasto</th><th className="num">Impresiones</th><th className="num">Clics</th><th className="num">Conv. red</th><th className="num">Leads CRM</th><th className="num">Ventas CRM</th><th className="num">Base ventas</th><th className="num">Costo / lead</th></tr></thead>
            <tbody>{ads.map((a) => {
              const g = grupoDe(a), m = a.metricas || {}, gasto = m.spend == null ? null : Number(m.spend), d = PLAT[a.plataforma.toLowerCase()] ?? [a.plataforma.slice(0, 1).toUpperCase() || '?', '#64748b']
              return (
                <tr key={a.id}>
                  <td><b className="text-slate-700">{a.nombre || '—'}</b><span className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5"><span className="pdot" style={{ background: d[1] }}>{d[0]}</span>{a.campana ? a.campana + ' · ' : ''}{a.adId || a.id}</span></td>
                  <td><span className="pill" style={{ background: '#f1f5f9', color: '#475569' }}>{a.estado || '—'}</span></td>
                  <td className="num">{gasto == null ? '—' : money(gasto) + ' ' + a.moneda}</td>
                  <td className="num">{n0(m.impressions)}</td><td className="num">{n0(m.clicks)}</td><td className="num">{n0(m.conversions)}</td>
                  <td className="num">{g ? g.leads : <span className="text-slate-300">—</span>}</td><td className="num">{g ? g.ventas : <span className="text-slate-300">—</span>}</td>
                  <td className="num">{g ? '$' + money(g.baseVentas) : <span className="text-slate-300">—</span>}</td>
                  <td className="num font-semibold">{gasto != null && g && g.leads ? money(gasto / g.leads) : '—'}</td>
                </tr>)
            })}</tbody></table></div>
        )}
        {ads && pagina < paginas && <div className="text-center p-3"><button type="button" className="btn" onClick={() => cargar(true)} disabled={cargando}>Cargar más anuncios</button></div>}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 pt-3"><h3 className="font-display font-bold text-sm text-slate-800">Atribución en el CRM por anuncio o campaña</h3>
          <p className="text-[11px] text-slate-500">{atr ? atr.criterio + (atr.ventasSinFecha ? ` ${atr.ventasSinFecha} ventas atribuidas sin fecha: excluidas del período.` : '') : ''}</p></div>
        {error && <p className="p-4 text-xs" style={{ color: '#b91c1c' }}>{error}</p>}
        {!error && !atr && <p className="p-6 text-center text-xs text-slate-400">Cargando…</p>}
        {atr && !atr.grupos.length && <p className="p-6 text-center text-sm text-slate-400">No hay registros publicitarios atribuibles en este período.</p>}
        {atr && atr.grupos.length > 0 && (
          <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Anuncio / campaña</th><th className="num">Leads</th><th className="num">Ventas</th><th className="num">Base comercial USD</th></tr></thead>
            <tbody>{atr.grupos.map((g) => <tr key={g.clave}><td><b className="text-slate-700">{g.adId || g.campana}</b><span className="block text-[10px] text-slate-400">{g.medio}</span></td>
              <td className="num">{g.leads}</td><td className="num">{g.ventas}</td><td className="num font-semibold">${money(g.baseVentas)}</td></tr>)}
              <tr><td><b>Total</b></td><td className="num"><b>{atr.leads}</b></td><td className="num"><b>{atr.ventas}</b></td><td className="num"><b>${money(atr.baseVentas)}</b></td></tr></tbody></table></div>
        )}
      </div>
    </>
  )
}
