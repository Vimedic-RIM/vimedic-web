/* Ofertas › Términos: los términos y condiciones de las ofertas. Los GENERALES valen para todas; cada CAMPAÑA puede
   tener los suyos, que se suman a los generales. El asesor no los edita: en la cotización solo elige mostrarlos u
   ocultarlos, y la proforma los imprime en «Términos y condiciones de la promoción» (modulos/ofertasTerminos.ts). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, FileText, Megaphone, RotateCcw, ScrollText } from 'lucide-react'
import { supabase } from '../supabase'
import { CAMPOS_DEF, camposDe, combinar, puntosTerminos, type CamposTerminos } from './ofertasTerminos'

type Campana = { id: string; nombre: string; inicio: string | null; fin: string | null; estado: string }
type Fila = { campana_id: string | null; campos: Partial<CamposTerminos>; activo: boolean }
const fCorta = (iso: string | null) => (iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export function TerminosOfertas({ puedeEditar, aviso }: { puedeEditar: boolean; aviso: (t: string) => void }) {
  const [campanas, setCampanas] = useState<Campana[] | null>(null)
  const [filas, setFilas] = useState<Fila[]>([])
  const [sel, setSel] = useState<string>('')   // '' = generales
  const [campos, setCampos] = useState<CamposTerminos>(CAMPOS_DEF)
  const [activo, setActivo] = useState(true)
  const [sucio, setSucio] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    const [c, t] = await Promise.all([
      supabase.from('promo_campanas').select('id,nombre,inicio,fin,estado').is('deleted_at', null).order('fin', { ascending: false, nullsFirst: false }).limit(80),
      supabase.from('ofertas_terminos').select('campana_id,campos,activo').is('deleted_at', null),
    ])
    if (c.error || t.error) { setError((c.error || t.error)!.message); return }
    setCampanas((c.data as Campana[]) ?? []); setFilas((t.data as Fila[]) ?? []); setError('')
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const fila = (id: string) => filas.find((f) => (f.campana_id ?? '') === id)
  const general = camposDe(fila('')?.campos)
  // Al cambiar de campaña (o al cargar), el formulario muestra lo guardado.
  useEffect(() => {
    const f = fila(sel)
    setCampos(f ? camposDe(f.campos) : sel ? { ...CAMPOS_DEF, vigencia: general.vigencia, stockLimitado: general.stockLimitado, noAcumulable: general.noAcumulable } : CAMPOS_DEF)
    setActivo(f ? f.activo : sel ? false : true); setSucio(false)
  }, [sel, filas]) // eslint-disable-line react-hooks/exhaustive-deps

  const camp = campanas?.find((c) => c.id === sel) ?? null
  const finEjemplo = camp?.fin ?? new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)
  const vista = useMemo(() => puntosTerminos(sel ? combinar(general, activo ? campos : null) : campos, finEjemplo), [sel, general, campos, activo, finEjemplo])
  const set = <K extends keyof CamposTerminos>(k: K, v: CamposTerminos[K]) => { setCampos((c) => ({ ...c, [k]: v })); setSucio(true) }

  function elegir(id: string) {
    if (id === sel) return
    if (sucio && !confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return
    setSel(id)
  }
  async function guardar() {
    setGuardando(true)
    const { error: e } = await supabase.rpc('ofertas_terminos_guardar', { p_campana: sel || null, p_campos: campos, p_activo: sel ? activo : true })
    setGuardando(false)
    if (e) { aviso('No se pudo guardar: ' + e.message); return }
    aviso(sel ? 'Términos de la campaña guardados.' : 'Términos generales guardados.') ; setSucio(false); cargar()
  }

  if (error) return <div className="aviso" style={{ background: '#fdecea', color: '#a3341f', padding: 12, borderRadius: 12 }}>{error}</div>
  if (!campanas) return <p style={{ fontSize: 12, color: '#94a3b8', padding: 16 }}>Cargando términos…</p>
  const des = !puedeEditar
  const texto = (k: 'formasPago' | 'entrega' | 'garantia' | 'reserva' | 'exclusiones', t: string, ph: string) => (
    <label style={{ display: 'block', marginTop: 10 }}><span className="lbl">{t}</span><input className="inp" disabled={des || (!!sel && !activo)} value={campos[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></label>
  )
  const chk = (k: 'vigencia' | 'stockLimitado' | 'noAcumulable', t: string) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginTop: 8, color: '#334155' }}>
      <input type="checkbox" disabled={des || (!!sel && !activo)} checked={campos[k]} onChange={(e) => set(k, e.target.checked)} style={{ marginTop: 3 }} />{t}
    </label>
  )
  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0,260px) minmax(0,1fr) minmax(0,1fr)', gap: 14, alignItems: 'start' }} className="ofter">
      <style>{'@media(max-width:1100px){.vm-of .ofter{grid-template-columns:minmax(0,1fr) !important}}'}</style>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button type="button" onClick={() => elegir('')} style={estiloItem(sel === '')}>
          <ScrollText style={{ width: 16, height: 16, color: '#c2410c', flexShrink: 0 }} />
          <span><b style={{ display: 'block', fontSize: 13 }}>Términos generales</b><small style={{ color: '#64748b', fontSize: 11 }}>Valen para todas las ofertas</small></span>
        </button>
        <p className="lbl" style={{ margin: '8px 0 0' }}>Campañas</p>
        {!campanas.length && <p style={{ fontSize: 12, color: '#94a3b8' }}>Todavía no hay campañas.</p>}
        {campanas.map((c) => {
          const f = fila(c.id)
          return (
            <button key={c.id} type="button" onClick={() => elegir(c.id)} style={estiloItem(sel === c.id)}>
              <Megaphone style={{ width: 16, height: 16, color: '#64748b', flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}><b style={{ display: 'block', fontSize: 12.5 }}>{c.nombre}</b>
                <small style={{ color: '#64748b', fontSize: 10.5 }}>{[c.estado, c.fin ? 'hasta ' + fCorta(c.fin) : ''].filter(Boolean).join(' · ')}</small>
                {f?.activo && <span className="pill" style={{ background: '#fff7ed', color: '#c2410c', marginTop: 4 }}>Términos propios</span>}</span>
            </button>
          )
        })}
      </nav>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16 }}>
        <h3 className="font-display" style={{ fontSize: 16, fontWeight: 700, color: '#0b2545', margin: 0 }}>{sel ? camp?.nombre : 'Términos generales de las ofertas'}</h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 10px' }}>{sel ? 'Se suman a los términos generales en las proformas con productos de esta campaña. Los campos vacíos toman el texto general.' : 'Salen en toda proforma que tenga productos en oferta (si el asesor no los oculta).'}</p>
        {des && <p style={{ fontSize: 12, fontWeight: 700, color: '#b45309', background: '#fff7ed', borderRadius: 10, padding: '8px 10px' }}>Solo puedes ver los términos. Para cambiarlos necesitas «editar» en Ofertas.</p>}
        {sel && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700, color: '#0b2545', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 12px' }}>
            <input type="checkbox" disabled={des} checked={activo} onChange={(e) => { setActivo(e.target.checked); setSucio(true) }} />Esta campaña tiene términos propios
          </label>
        )}
        {chk('vigencia', 'Indicar la vigencia: «Precios promocionales válidos hasta el [fin de la oferta] o hasta agotar stock»')}
        {chk('stockLimitado', 'Unidades limitadas, sujetas a disponibilidad de stock')}
        {chk('noAcumulable', 'No acumulable con otras promociones ni descuentos')}
        <label style={{ display: 'block', marginTop: 10 }}><span className="lbl">IVA en los precios de la promoción</span>
          <select className="inp" disabled={des || (!!sel && !activo)} value={campos.iva} onChange={(e) => set('iva', e.target.value as CamposTerminos['iva'])}>
            <option value="">No indicar</option><option value="incluido">Los precios incluyen IVA</option><option value="mas_iva">Los precios no incluyen IVA</option>
          </select></label>
        {texto('formasPago', 'Formas de pago', 'Ej. Contado, transferencia o tarjeta de crédito (diferido con interés)')}
        {texto('entrega', 'Entrega', 'Ej. Inmediata en Quito; provincias 48 a 72 horas')}
        {texto('garantia', 'Garantía', 'Ej. 1 año por defectos de fábrica')}
        {texto('reserva', 'Reserva o separación', 'Ej. Con el 50% de anticipo, por 5 días')}
        {texto('exclusiones', 'No aplica para', 'Ej. Ventas a crédito directo o licitaciones')}
        <label style={{ display: 'block', marginTop: 10 }}><span className="lbl">Condiciones adicionales (una por línea)</span>
          <textarea className="inp" rows={5} disabled={des || (!!sel && !activo)} value={campos.adicionales} onChange={(e) => set('adicionales', e.target.value)} placeholder={'Ej. Imágenes referenciales.\nPrecio sujeto a cambio sin previo aviso fuera del período de la promoción.'} /></label>
        {!des && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {sucio && <span style={{ fontSize: 12, fontWeight: 800, color: '#b45309' }}>Cambios sin guardar</span>}
            <span style={{ flex: 1 }} />
            {sucio && <button type="button" className="btn" onClick={() => { const f = fila(sel); setCampos(f ? camposDe(f.campos) : CAMPOS_DEF); setActivo(f ? f.activo : !sel); setSucio(false) }}><RotateCcw style={{ width: 15, height: 15 }} />Descartar</button>}
            <button type="button" className="btn btn-p" disabled={guardando || !sucio} onClick={guardar}><Check style={{ width: 15, height: 15 }} />{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        )}
      </div>

      <aside style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, position: 'sticky', top: 10 }}>
        <p style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 800, color: '#64748b', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '.04em' }}><FileText style={{ width: 14, height: 14 }} />Así sale en la proforma</p>
        <div style={{ border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc', padding: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#055c9d', textTransform: 'uppercase', margin: '0 0 6px' }}>Términos y condiciones de la promoción</p>
          <strong style={{ fontSize: 11.5, color: '#055c9d' }}>{sel ? camp?.nombre : 'Ofertas y liquidación'}</strong>
          {vista.length ? <ul style={{ margin: '4px 0 0 16px', padding: 0, listStyle: 'disc', fontSize: 11, color: '#475569', lineHeight: 1.55 }}>{vista.map((p, i) => <li key={i}>{p}</li>)}</ul>
            : <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '6px 0 0' }}>Sin términos: la proforma no muestra esta sección.</p>}
        </div>
        <p style={{ fontSize: 11, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>La fecha de vigencia es la de cada oferta. Al guardar una cotización se guarda una copia de estos términos: si después los cambias, las proformas ya hechas no cambian. En la cotización el asesor solo elige mostrarlos u ocultarlos.</p>
      </aside>
    </section>
  )
}
const estiloItem = (on: boolean): React.CSSProperties => ({
  display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', border: '1px solid ' + (on ? '#c2410c' : '#e2e8f0'), background: on ? '#fff7ed' : '#fff',
  borderRadius: 12, padding: '10px 11px', cursor: 'pointer', font: 'inherit', color: '#0b2545', boxShadow: on ? '0 0 0 3px rgba(194,65,12,.12)' : 'none',
})
