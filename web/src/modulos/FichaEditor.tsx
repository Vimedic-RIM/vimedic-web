import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowDown, ArrowUp, Eye, Plus, Save, Sparkles, Star, X } from 'lucide-react'
import { supabase } from '../supabase'
import { armarDatos, especsDeTexto, leerFicha, pdfDeHojas, sinEmoji, VentanaFicha, type FichaRaw, type FilaEspec } from '../fichaTecnica'

/* Marketing › Biblioteca › producto › Ficha técnica (diseño C3).
   Datos propios de la ficha (modelo, descripción corta, características, «Incluye») y especificaciones en filas
   (grupo, etiqueta, valor, unidad, orden, ★ destacado). «✨ Generar con IA» propone todo a partir de los documentos
   técnicos (o de los datos de la app); nada se guarda hasta «Guardar ficha». La vista previa es la ficha en HTML. */

type Form = { modelo: string; descripcion: string; caracteristicas: string; accesorios: string; especs: FilaEspec[] }
const vacio: Form = { modelo: '', descripcion: '', caracteristicas: '', accesorios: '', especs: [] }
const MAX_DEST = 3

async function iaFicha(id: string): Promise<{ ficha: { modelo: string; descripcion: string; caracteristicas: string[]; accesorios: string[]; especificaciones: FilaEspec[] }; notas: string; leidos: string[]; omitidos: string[] }> {
  const { data, error } = await supabase.functions.invoke('marketing-integraciones', { body: { accion: 'ia_completar', id, modo: 'ficha' } })
  if (error) {
    let m = error.message
    try { const j = await (error as unknown as { context?: Response }).context?.json?.(); if (j?.error) m = j.error } catch { /* sin detalle */ }
    throw new Error(m)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export function FichaEditor({ productoId, puedeEditar, aviso, guardarVersion }: {
  productoId: string; puedeEditar: boolean; aviso: (t: string) => void; guardarVersion?: (pdf: Blob) => Promise<void>
}) {
  const [raw, setRaw] = useState<FichaRaw | null>(null)
  const [error, setError] = useState('')
  const [f, setF] = useState<Form>(vacio)
  const [sucio, setSucio] = useState(false)
  const [deIA, setDeIA] = useState(false)
  const [notas, setNotas] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [ver, setVer] = useState(false)
  const [abierto, setAbierto] = useState(false)

  const cargar = useCallback(() => {
    leerFicha(productoId).then((r) => {
      setRaw(r); setError('')
      setF({ modelo: r.ficha?.modelo ?? '', descripcion: r.ficha?.descripcion ?? '', caracteristicas: (r.ficha?.caracteristicas ?? []).join('\n'),
        accesorios: (r.ficha?.accesorios ?? []).join('\n'), especs: r.especificaciones ?? [] })
      setSucio(false); setDeIA(false); setNotas(r.ficha?.ia_notas ?? '')
    }).catch((e) => setError((e as Error).message))
  }, [productoId])
  useEffect(() => { cargar() }, [cargar])

  const cambiar = (p: Partial<Form>) => { setF((x) => ({ ...x, ...p })); setSucio(true) }
  const fila = (i: number, p: Partial<FilaEspec>) => cambiar({ especs: f.especs.map((e, k) => (k === i ? { ...e, ...p } : e)) })
  const mover = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= f.especs.length) return; const c = f.especs.slice(); [c[i], c[j]] = [c[j], c[i]]; cambiar({ especs: c }) }
  const destacar = (i: number) => {
    const on = f.especs[i].destacado
    if (!on && f.especs.filter((e) => e.destacado).length >= MAX_DEST) { aviso('Elige máximo 3 datos destacados.'); return }
    fila(i, { destacado: !on })
  }
  const grupos = useMemo(() => [...new Set(f.especs.map((e) => e.grupo).filter(Boolean))], [f.especs])
  const lineas = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean)

  // La ficha tal como se ve con lo que hay en pantalla (sin guardar todavía).
  const datos = useMemo(() => raw ? armarDatos({
    ...raw,
    ficha: { modelo: f.modelo, descripcion: f.descripcion, caracteristicas: lineas(f.caracteristicas), accesorios: lineas(f.accesorios), ia_generada_en: null, ia_notas: '' },
    especificaciones: f.especs,
  }) : null, [raw, f])

  async function generarIA() {
    if (sucio && !confirm('La IA reemplaza lo que hay en pantalla (sin guardar). ¿Seguir?')) return
    setOcupado('ia'); setAbierto(true)
    try {
      const r = await iaFicha(productoId)
      setF({ modelo: r.ficha.modelo, descripcion: r.ficha.descripcion, caracteristicas: r.ficha.caracteristicas.join('\n'), accesorios: r.ficha.accesorios.join('\n'), especs: r.ficha.especificaciones })
      setSucio(true); setDeIA(true)
      setNotas([r.notas, r.leidos.length ? 'Leyó: ' + r.leidos.join('; ') + '.' : 'Sin documentos técnicos: usó los datos de la app.', r.omitidos.length ? 'No pudo leer: ' + r.omitidos.join('; ') + '.' : ''].filter(Boolean).join(' '))
      aviso('La IA preparó la ficha: revísala y pulsa «Guardar ficha».')
    } catch (e) { aviso('IA: ' + (e as Error).message) }
    setOcupado('')
  }
  async function guardar() {
    setOcupado('guardar')
    const { error: e } = await supabase.rpc('ficha_guardar', {
      p_producto: productoId,
      p_ficha: { modelo: f.modelo, descripcion: f.descripcion, caracteristicas: lineas(f.caracteristicas), accesorios: lineas(f.accesorios), ia: deIA, ia_notas: deIA ? notas : undefined },
      p_especs: f.especs.map((x) => ({ grupo: x.grupo, etiqueta: x.etiqueta, valor: x.valor, unidad: x.unidad, destacado: x.destacado })),
    })
    setOcupado('')
    if (e) { aviso('No se pudo guardar la ficha: ' + e.message); return }
    aviso('Ficha técnica guardada.'); cargar()
  }
  function pasarDeLaWeb() {
    if (!raw) return
    const filas = especsDeTexto(raw.respaldo.especificaciones, raw.respaldo.destacados)
    if (!filas.length) { aviso('El producto no tiene especificaciones en la web.'); return }
    cambiar({ especs: filas }); setAbierto(true)
  }

  const inp: CSSProperties = { width: '100%', minWidth: 0, border: '1px solid #e2e8f0', borderRadius: 8, padding: '5px 8px', fontSize: 12, background: '#fff' }
  const iconoBtn: CSSProperties = { width: 26, height: 26, display: 'grid', placeItems: 'center', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', color: '#475569' }
  const etq: CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b' }
  if (error) return <p className="text-[11px] text-red-600">{error}</p>
  if (!raw) return <p className="text-[11px] text-slate-400">Cargando la ficha…</p>
  const nDest = f.especs.filter((e) => e.destacado).length
  const usaWeb = !f.especs.length && !!raw.respaldo.especificaciones.trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
      <div className="flex gap-2 flex-wrap items-center">
        <button type="button" className="btn btn-primary !py-1.5" onClick={() => setVer(true)}><Eye className="w-3.5 h-3.5" />Vista previa / Descargar</button>
        {puedeEditar && <button type="button" className="btn !py-1.5" onClick={generarIA} disabled={!!ocupado}><Sparkles className={'w-3.5 h-3.5' + (ocupado === 'ia' ? ' animate-spin' : '')} />{ocupado === 'ia' ? 'La IA está leyendo…' : 'Generar con IA'}</button>}
        {puedeEditar && <button type="button" className="btn !py-1.5" onClick={() => setAbierto(!abierto)}>{abierto ? 'Ocultar datos' : 'Editar datos de la ficha'}</button>}
        {puedeEditar && sucio && <button type="button" className="btn btn-primary !py-1.5" onClick={guardar} disabled={!!ocupado}><Save className="w-3.5 h-3.5" />{ocupado === 'guardar' ? 'Guardando…' : 'Guardar ficha'}</button>}
      </div>
      <p className="text-[11px] text-slate-500">
        {f.especs.length ? `${f.especs.length} especificaciones en ${grupos.length} grupo${grupos.length === 1 ? '' : 's'} · ${nDest} destacada${nDest === 1 ? '' : 's'}` : usaWeb ? 'Usa las especificaciones de la web (texto). Con «Generar con IA» quedan ordenadas en grupos y con su unidad.' : 'Sin especificaciones todavía.'}
        {raw.ficha?.ia_generada_en ? ' · IA: ' + new Date(raw.ficha.ia_generada_en).toLocaleDateString('es-EC') : ''}
        {sucio ? ' · Cambios sin guardar.' : ''}
      </p>
      {notas && <p className="text-[11px] rounded-lg px-3 py-2" style={{ background: '#fff7e6', color: '#92400e' }}>{notas}</p>}

      {abierto && puedeEditar && (
        <div className="space-y-2.5 pt-1">
          <div className="grid sm:grid-cols-2 gap-2">
            <label style={etq}>Modelo (del documento técnico)<input style={{ ...inp, marginTop: 4 }} value={f.modelo} onChange={(e) => cambiar({ modelo: e.target.value })} placeholder="Ej. SC-18B" /></label>
            <label style={etq}>Descripción corta <span style={{ fontWeight: 400, color: f.descripcion.length > 260 ? '#dc2626' : '#94a3b8' }}>{f.descripcion.length}/260</span>
              <textarea style={{ ...inp, marginTop: 4, resize: 'vertical' }} rows={3} value={f.descripcion} onChange={(e) => cambiar({ descripcion: e.target.value })} placeholder="Vacía = la descripción de la web" /></label>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <label style={etq}>Características (una por línea, máx. 6) <span style={{ fontWeight: 400, color: lineas(f.caracteristicas).length > 6 ? '#dc2626' : '#94a3b8' }}>{lineas(f.caracteristicas).length}/6</span>
              <textarea style={{ ...inp, marginTop: 4, resize: 'vertical' }} rows={4} value={f.caracteristicas} onChange={(e) => cambiar({ caracteristicas: e.target.value })} placeholder="Vacías = las de la web" /></label>
            <label style={etq}>Incluye (uno por línea)
              <textarea style={{ ...inp, marginTop: 4, resize: 'vertical' }} rows={4} value={f.accesorios} onChange={(e) => cambiar({ accesorios: e.target.value })} placeholder="Ej. Bandejas ×3" /></label>
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <b className="text-[11.5px] text-slate-700">Especificaciones</b>
              <span className="text-[10.5px] text-slate-400">★ = indicador grande de la ficha (máx. 3; sin elegir, las 3 primeras)</span>
              {usaWeb && <button type="button" className="btn !py-1" style={{ marginLeft: 'auto' }} onClick={pasarDeLaWeb}>Pasar las de la web a filas</button>}
            </div>
            <datalist id={'grupos-' + productoId}>{['Generales', 'Eléctricas', 'Físicas', 'Ambientales', ...grupos].filter((g, i, a) => a.indexOf(g) === i).map((g) => <option key={g} value={g} />)}</datalist>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {f.especs.map((e, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px,.8fr) minmax(90px,1.3fr) minmax(80px,1.2fr) 58px auto', gap: 4, alignItems: 'center' }}>
                  <input style={inp} list={'grupos-' + productoId} value={e.grupo} onChange={(ev) => fila(i, { grupo: ev.target.value })} aria-label="Grupo" placeholder="Grupo" />
                  <input style={inp} value={e.etiqueta} onChange={(ev) => fila(i, { etiqueta: ev.target.value })} aria-label="Etiqueta" placeholder="Etiqueta" />
                  <input style={inp} value={e.valor} onChange={(ev) => fila(i, { valor: ev.target.value })} aria-label="Valor" placeholder="Valor" />
                  <input style={inp} value={e.unidad} onChange={(ev) => fila(i, { unidad: ev.target.value })} aria-label="Unidad" placeholder="Unidad" />
                  <div style={{ display: 'flex', gap: 3 }}>
                    <button type="button" style={{ ...iconoBtn, color: e.destacado ? '#c98a1f' : '#cbd5e1', borderColor: e.destacado ? '#f6d48b' : '#e2e8f0' }} onClick={() => destacar(i)} aria-label="Destacado" title="Indicador destacado"><Star className="w-3.5 h-3.5" fill={e.destacado ? '#f2b84b' : 'none'} /></button>
                    <button type="button" style={iconoBtn} onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir"><ArrowUp className="w-3 h-3" /></button>
                    <button type="button" style={iconoBtn} onClick={() => mover(i, 1)} disabled={i === f.especs.length - 1} aria-label="Bajar"><ArrowDown className="w-3 h-3" /></button>
                    <button type="button" style={{ ...iconoBtn, color: '#dc2626' }} onClick={() => cambiar({ especs: f.especs.filter((_, k) => k !== i) })} aria-label="Quitar"><X className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn !py-1 mt-1.5" onClick={() => cambiar({ especs: [...f.especs, { grupo: f.especs[f.especs.length - 1]?.grupo || 'Generales', etiqueta: '', valor: '', unidad: '', destacado: false }] })}><Plus className="w-3.5 h-3.5" />Agregar fila</button>
          </div>
          {sucio && <div className="flex justify-end"><button type="button" className="btn btn-primary !py-1.5" onClick={guardar} disabled={!!ocupado}><Save className="w-3.5 h-3.5" />{ocupado === 'guardar' ? 'Guardando…' : 'Guardar ficha'}</button></div>}
        </div>
      )}

      {ver && datos && <VentanaFicha datos={datos} cerrar={() => setVer(false)}
        extra={guardarVersion ? ({ hojas }) => (
          <button type="button" disabled={ocupado === 'drive'} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#1e293b' }}
            title={sucio ? 'Guarda primero la ficha para que la versión quede igual a lo guardado' : 'Sube el PDF a Drive y queda como la ficha del producto'}
            onClick={async () => {
              const h = hojas(); if (!h) return
              setOcupado('drive')
              try { await guardarVersion(await pdfDeHojas(h)) } catch (e) { aviso('No se pudo guardar la versión: ' + (e as Error).message) }
              setOcupado('')
            }}>{ocupado === 'drive' ? 'Guardando en Drive…' : 'Guardar versión en Drive'}</button>
        ) : undefined} />}
    </div>
  )
}

