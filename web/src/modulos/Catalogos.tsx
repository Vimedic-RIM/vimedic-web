import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Download, FileText, Monitor, Palette, Plus, Printer, Search, SlidersHorizontal, Smartphone, Undo2, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { imagen } from './inventarioUtil'
import { htmlCatalogo, type CfgH, type Tam, type Tema } from '../catalogoHtml'
import '../estilos/catalogos.css'

/* Editor de catálogos personalizados: ajustes a la izquierda, vista previa editable a la derecha.
   Digital = página web con botones y WhatsApp · Impreso = hojas A4 con códigos QR. */
const PREF = 'vm_catalogo_ed_v1'
const WEB = 'vimedic.com.ec'
const LEMA = 'Equipos médicos con respaldo técnico, garantía y entrega en todo el Ecuador.'
const TITULO = 'Catálogo de *equipos médicos*'
const EXTRA = 'Selección adicional'
const POR_PAGINA = 6

type Prod = { id: string; n: string; det: string; pvp: number; iva: boolean; foto: string; link: string }
type Seg = { nombre: string; productos: Prod[] }
type Asesor = { nombre: string; whatsapp: string }
type Fila = { codigo: string; nombre: string; descripcion: string | null; pvp: number | null; aplica_iva: boolean; imagen_url: string | null }

const pad = (n: number) => (n < 10 ? '0' : '') + n
const norm = (s: unknown) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const limpio = (s: unknown) => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s+/g, ' ').trim()
const cortaPalabras = (s: string, n: number) => { s = String(s || '').trim(); if (s.length <= n) return s; const c = s.slice(0, n), k = c.lastIndexOf(' '); return (k > n * 0.6 ? c.slice(0, k) : c).replace(/[\s,.;:–-]+$/, '') + '…' }
function waNum(t: string) { let s = String(t || '').replace(/\D/g, ''); if (!s) return ''; if (s.indexOf('593') === 0) return s; if (s.charAt(0) === '0') s = s.slice(1); return s.length === 9 ? '593' + s : s }
const waVer = (n: string) => (n.length === 12 && n.indexOf('593') === 0 ? '+593 ' + n.slice(3, 5) + ' ' + n.slice(5, 8) + ' ' + n.slice(8) : '+' + n)
const aProd = (p: Fila): Prod => ({ id: p.codigo, n: limpio(p.nombre), det: cortaPalabras(limpio(p.descripcion), 150), pvp: Number(p.pvp) || 0, iva: p.aplica_iva !== false, foto: p.imagen_url ?? '', link: `https://${WEB}/equipo/?id=${encodeURIComponent(p.codigo)}` })

type Prefs = { off: Record<string, boolean>; ex: Record<string, boolean>; orden: string[]; formato: 'digital' | 'impreso'; precios: boolean; contra: boolean; tema: Tema; tam: Tam; desc: boolean; codigo: boolean; fab: boolean; titulo: string }
const PREF0: Prefs = { off: {}, ex: {}, orden: [], formato: 'digital', precios: false, contra: true, tema: 'azul', tam: 'normal', desc: true, codigo: true, fab: true, titulo: TITULO }
function leerPrefs(): Prefs {
  try { const p = JSON.parse(localStorage.getItem(PREF) || 'null'); if (p && typeof p === 'object') return { ...PREF0, ...p } } catch { /* sin preferencias */ }
  return PREF0
}

export default function Catalogos({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [base, setBase] = useState<Seg[] | null>(null)
  const [extras, setExtras] = useState<Prod[]>([])
  const [error, setError] = useState('')
  const [asesor, setAsesor] = useState<Asesor | null>(null)
  const [pf, setPf] = useState<Prefs>(leerPrefs)
  const [conCliente, setConCliente] = useState(false)
  const [cliente, setCliente] = useState('')
  const [lema, setLema] = useState(LEMA)
  const [tab, setTab] = useState<'contenido' | 'diseno'>('contenido')
  const [panel, setPanel] = useState(false)           // en pantallas chicas el panel es un cajón
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [qAdd, setQAdd] = useState('')
  const [resAdd, setResAdd] = useState<Fila[]>([])
  const [vista, setVista] = useState('')
  const [rev, setRev] = useState(0)
  const marco = useRef<HTMLIFrameElement>(null)
  const textos = useRef<Record<string, string>>({})
  const scrollY = useRef(0)
  const ultimoMsg = useRef(0)
  const sigPrev = useRef('')
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPf((p) => ({ ...p, [k]: v }))

  useEffect(() => { try { localStorage.setItem(PREF, JSON.stringify(pf)) } catch { /* sin almacenamiento */ } }, [pf])

  /* Lo que se hace dentro de la vista previa (quitar productos, escribir) se refleja aquí sin reconstruirla. */
  useEffect(() => {
    const f = (e: MessageEvent) => {
      const d = e.data as { vmc?: string; id?: string; k?: string; v?: string } | null
      if (!d || !d.vmc || e.source !== marco.current?.contentWindow) return
      if (d.vmc === 'texto' && d.k) {
        if (d.k === 'lema') textos.current.lema = d.v ?? ''
        else { const m = /^p:(.+):(n|det)$/.exec(d.k); if (m) textos.current['p:' + m[1] + ':' + m[2]] = d.v ?? '' }
        return
      }
      if (!d.id) return
      const id = d.id
      ultimoMsg.current = Date.now()
      if (d.vmc === 'quitar') setPf((p) => ({ ...p, ex: { ...p.ex, [id]: true } }))
      else if (d.vmc === 'volver') setPf((p) => { const ex = { ...p.ex }; delete ex[id]; return { ...p, ex } })
    }
    window.addEventListener('message', f)
    return () => window.removeEventListener('message', f)
  }, [])

  useEffect(() => {
    supabase.from('productos').select('codigo,nombre,descripcion,pvp,aplica_iva,imagen_url,orden,categoria:categorias(nombre)').eq('en_catalogo', true).is('deleted_at', null).order('orden', { ascending: true }).limit(3000)
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        const mapa = new Map<string, Prod[]>()
        ;((data ?? []) as unknown as (Fila & { categoria: { nombre: string } | null })[]).forEach((p) => {
          const seg = limpio(p.categoria?.nombre) || 'Otros equipos'
          const lista = mapa.get(seg) ?? []
          lista.push(aProd(p)); mapa.set(seg, lista)
        })
        setBase([...mapa.entries()].map(([nombre, productos]) => ({ nombre, productos })))
      })
    supabase.from('empleados').select('nombre,telefono').eq('id', perfil.id).single().then(({ data }) => {
      const d = data as { nombre: string; telefono: string | null } | null
      setAsesor(d ? { nombre: d.nombre, whatsapp: d.telefono ?? '' } : { nombre: perfil.nombre, whatsapp: '' })
    })
  }, [perfil.id, perfil.nombre])

  /* Buscar productos que no están en el catálogo público para añadirlos */
  useEffect(() => {
    const t = limpio(qAdd)
    if (t.length < 2) { setResAdd([]); return }
    let vivo = true
    const h = setTimeout(() => {
      let c = supabase.from('productos').select('codigo,nombre,descripcion,pvp,aplica_iva,imagen_url').is('deleted_at', null).or('estado.is.null,estado.not.ilike.inactivo')
      for (const w of t.split(/\s+/)) c = c.or(`nombre.ilike.%${w}%,codigo.ilike.%${w}%,codigo_unico.ilike.%${w}%,marca.ilike.%${w}%`)
      c.order('nombre').limit(8).then(({ data }) => { if (vivo) setResAdd((data as unknown as Fila[]) ?? []) })
    }, 250)
    return () => { vivo = false; clearTimeout(h) }
  }, [qAdd])

  const segs = useMemo<Seg[]>(() => {
    const todos = [...(base ?? []), ...(extras.length ? [{ nombre: EXTRA, productos: extras }] : [])]
    const pos = (n: string) => { const i = pf.orden.indexOf(n); return i < 0 ? 1e6 : i }
    return todos.map((s, i) => ({ s, i })).sort((a, b) => pos(a.s.nombre) - pos(b.s.nombre) || a.i - b.i).map((x) => x.s)
  }, [base, extras, pf.orden])
  const seleccion = useMemo(() => segs.filter((s) => !pf.off[s.nombre]).map((s) => ({ nombre: s.nombre, productos: s.productos.filter((p) => !pf.ex[p.id]) })).filter((s) => s.productos.length), [segs, pf.off, pf.ex])
  const nProd = seleccion.reduce((a, s) => a + s.productos.length, 0)
  const nPag = 1 + (pf.contra ? 1 : 0) + seleccion.reduce((a, s) => a + Math.ceil(s.productos.length / POR_PAGINA), 0)
  const faltaCliente = conCliente && !cliente.trim()
  const n = waNum(asesor?.whatsapp ?? '')
  const qn = norm(q).trim()
  const imp = pf.formato === 'impreso'

  /* La vista previa se arma sola cada vez que cambia algo (con una pequeña espera para no reconstruir en cada tecla). */
  const sigCfg = JSON.stringify([pf.off, pf.orden, pf.formato, pf.precios, pf.contra, pf.tema, pf.tam, pf.desc, pf.codigo, pf.fab, pf.titulo, lema, conCliente ? cliente : '', asesor, extras.length, rev])
  useEffect(() => {
    if (!base || !asesor) return
    const h = setTimeout(() => {
      // Si solo se quitó un producto desde la propia vista previa, ya está reflejado allí: no se reconstruye.
      if (sigCfg === sigPrev.current && Date.now() - ultimoMsg.current < 900) return
      sigPrev.current = sigCfg
      try { scrollY.current = marco.current?.contentWindow?.scrollY ?? 0 } catch { scrollY.current = 0 }
      const cfg: CfgH = {
        formato: pf.formato, precios: pf.precios, contra: pf.contra, cliente: conCliente ? cliente.trim() : '', asesor, web: WEB, lema, titulo: pf.titulo,
        tema: pf.tema, tam: pf.tam, desc: pf.desc, codigo: pf.codigo, fab: pf.fab, textos: { ...textos.current, lema: textos.current.lema ?? lema },
      }
      const lista = seleccion.map((s) => ({ nombre: s.nombre, productos: s.productos.map((p) => ({ ...p, foto: p.foto ? imagen(p.foto, 520) : '' })) }))
      setVista(htmlCatalogo(lista, cfg))
    }, 240)
    return () => clearTimeout(h)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, asesor, seleccion, sigCfg])

  const htmlLimpio = useCallback(() => {
    const doc = marco.current?.contentDocument
    if (!doc) return ''
    const c = doc.documentElement.cloneNode(true) as HTMLElement
    c.querySelectorAll('.ed, #vmc-edit').forEach((e) => e.remove())
    c.querySelectorAll('[contenteditable]').forEach((e) => { e.removeAttribute('contenteditable'); e.removeAttribute('spellcheck') })
    c.querySelector('body')?.classList.remove('edit')
    return '<!doctype html>' + c.outerHTML
  }, [])
  function nombreArchivo(ext: string) {
    return 'Catalogo_Vimedic_' + ((conCliente && cliente.trim()) || asesor?.nombre || 'Vimedic').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + new Date().toISOString().slice(0, 10) + ext
  }
  function registrar(tam: number) {
    supabase.from('catalogos_generados').insert({
      id: crypto.randomUUID(), codigo: 'CAT-' + crypto.randomUUID().slice(0, 6).toUpperCase(), asesor_id: perfil.id, cliente_texto: conCliente ? cliente.trim() || null : null, formato: imp ? 'Impreso' : 'Digital',
      precios: pf.precios ? 'Con precios' : 'Sin precios', contraportada: pf.contra, segmentos: seleccion.map((s) => s.nombre).join(', '), n_productos: nProd,
      productos: seleccion.flatMap((s) => s.productos.map((p) => p.id)).join(','), paginas: nPag, tamano_kb: Math.round((tam / 1024) * 10) / 10,
    }).then(() => undefined)
  }
  function descargarHtml() {
    if (faltaCliente) { aviso('Escribe el nombre del cliente o desmarca la opción.'); return }
    const h = htmlLimpio(); if (!h) return
    const blob = new Blob([h], { type: 'text/html;charset=utf-8' }), a = document.createElement('a'), nombre = nombreArchivo('.html')
    a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    registrar(blob.size); aviso('Catálogo descargado: ' + nombre)
  }
  function imprimir() {
    if (faltaCliente) { aviso('Escribe el nombre del cliente o desmarca la opción.'); return }
    const w = marco.current?.contentWindow; if (!w) return
    w.document.body.classList.remove('edit'); w.focus(); w.print(); w.document.body.classList.add('edit')
    registrar(0)
  }

  const mover = (nombre: string, d: number) => setPf((p) => {
    const nombres = segs.map((s) => s.nombre), i = nombres.indexOf(nombre), j = i + d
    if (i < 0 || j < 0 || j >= nombres.length) return p
    const l = nombres.slice(); l.splice(i, 1); l.splice(j, 0, nombre)
    return { ...p, orden: l }
  })
  const incluirSeg = (s: Seg, on: boolean) => setPf((p) => { const ex = { ...p.ex }; s.productos.forEach((x) => { if (on) delete ex[x.id]; else ex[x.id] = true }); return { ...p, ex } })
  const agregar = (f: Fila) => {
    const p = aProd(f)
    if ((base ?? []).some((s) => s.productos.some((x) => x.id === p.id)) || extras.some((x) => x.id === p.id)) { setPf((o) => { const ex = { ...o.ex }; delete ex[p.id]; return { ...o, ex } }); aviso('Ese producto ya está en el catálogo.'); return }
    setExtras((a) => [...a, p]); setPf((o) => ({ ...o, off: { ...o.off, [EXTRA]: false } })); setQAdd(''); setResAdd([]); aviso('Producto agregado a «' + EXTRA + '».')
  }

  const resumen = faltaCliente ? <span className="vce-warn">Escribe el nombre del cliente o desmarca la opción.</span>
    : nProd ? <><b>{nProd} producto{nProd === 1 ? '' : 's'}</b> · {seleccion.length} segmento{seleccion.length === 1 ? '' : 's'}{imp ? <> · ~{nPag} hojas A4</> : null}</>
    : <span className="vce-warn">No hay productos seleccionados.</span>

  return (
    <div className="vm-cat">
      <header className="vce-top vm-head-pad">
        <div className="vce-tit"><span className="vce-ic"><FileText /></span><div><h1>Catálogo personalizado</h1><p>{resumen}</p></div></div>
        <div className="vce-seg" role="group" aria-label="Formato">
          <button type="button" className={!imp ? 'on' : ''} onClick={() => set('formato', 'digital')} title="Para enviar por WhatsApp o correo, con botones y enlaces"><Smartphone />Digital</button>
          <button type="button" className={imp ? 'on' : ''} onClick={() => set('formato', 'impreso')} title="Hojas A4 con códigos QR en lugar de botones"><Printer />Impreso</button>
        </div>
        <label className="vce-chk" title="Mostrar el precio PVP en cada producto"><input type="checkbox" checked={pf.precios} onChange={(e) => set('precios', e.target.checked)} />Precios</label>
        <span className="vce-sp" />
        <button type="button" className="vce-b vce-solo-m" onClick={() => setPanel((v) => !v)}><SlidersHorizontal />Ajustes</button>
        <button type="button" className="vce-b" onClick={() => marco.current?.contentWindow?.postMessage({ vmc: 'deshacer' }, '*')} title="Devolver el último producto quitado"><Undo2 /><span>Deshacer</span></button>
        <button type="button" className={'vce-b' + (imp ? ' pri' : '')} onClick={imprimir} disabled={!nProd} title="Abre la impresión del navegador: elige «Guardar como PDF» o tu impresora"><Printer /><span>Imprimir / PDF</span></button>
        <button type="button" className={'vce-b' + (!imp ? ' pri' : '')} onClick={descargarHtml} disabled={!nProd} title="Un archivo .html que se abre en cualquier navegador"><Download /><span>Descargar HTML</span></button>
      </header>

      <div className="vce-body">
        <aside className={'vce-side' + (panel ? ' abierto' : '')}>
          <div className="vce-tabs">
            <button type="button" className={tab === 'contenido' ? 'on' : ''} onClick={() => setTab('contenido')}><FileText />Contenido</button>
            <button type="button" className={tab === 'diseno' ? 'on' : ''} onClick={() => setTab('diseno')}><Palette />Diseño</button>
            <button type="button" className="vce-cerrar vce-solo-m" onClick={() => setPanel(false)} aria-label="Cerrar ajustes"><X /></button>
          </div>

          {error && <div className="vce-err">{error}</div>}
          {!error && base === null && <div className="vce-nota">Cargando productos…</div>}

          {base && tab === 'contenido' && (
            <div className="vce-sc">
              <div className="vce-h"><b>Segmentos</b><span>
                <button type="button" className="vce-lnk" onClick={() => set('off', {})}>Todos</button>
                <button type="button" className="vce-lnk" onClick={() => set('off', Object.fromEntries(segs.map((s) => [s.nombre, true])))}>Ninguno</button></span></div>
              <label className="vce-bus"><Search /><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar productos por nombre o código" /></label>
              <div className="vce-lista">
                {segs.map((s, i) => {
                  const on = !pf.off[s.nombre]
                  const inc = s.productos.filter((p) => !pf.ex[p.id]).length
                  const ps = s.productos.filter((p) => !qn || norm(p.n + ' ' + p.id).includes(qn))
                  if (qn && !ps.length) return null
                  const abierto = !!qn || !!abiertos[s.nombre]
                  return (
                    <div key={s.nombre} className={'vce-sg' + (on ? ' on' : '')}>
                      <div className="vce-sh">
                        <input type="checkbox" checked={on} onChange={() => set('off', { ...pf.off, [s.nombre]: on })} aria-label={'Incluir ' + s.nombre} />
                        <button type="button" className="vce-sn" onClick={() => setAbiertos((a) => ({ ...a, [s.nombre]: !a[s.nombre] }))}>
                          {abierto ? <ChevronDown /> : <ChevronRight />}<span className="vce-num">{pad(i + 1)}</span><span className="vce-nom">{s.nombre}</span><span className="vce-cnt">{inc}/{s.productos.length}</span>
                        </button>
                        <span className="vce-mv"><button type="button" onClick={() => mover(s.nombre, -1)} disabled={i === 0} aria-label="Subir"><ChevronUp /></button><button type="button" onClick={() => mover(s.nombre, 1)} disabled={i === segs.length - 1} aria-label="Bajar"><ChevronDown /></button></span>
                      </div>
                      {abierto && (
                        <div className="vce-ps">
                          <div className="vce-pa"><button type="button" className="vce-lnk" onClick={() => incluirSeg(s, true)}>Incluir todos</button><button type="button" className="vce-lnk" onClick={() => incluirSeg(s, false)}>Quitar todos</button></div>
                          {ps.map((p) => {
                            const si = !pf.ex[p.id]
                            return (
                              <label key={p.id} className={'vce-p' + (si ? '' : ' off')}>
                                <input type="checkbox" checked={si} onChange={() => setPf((o) => { const ex = { ...o.ex }; if (si) ex[p.id] = true; else delete ex[p.id]; return { ...o, ex } })} />
                                <span className="vce-th">{p.foto ? <img alt="" loading="lazy" src={imagen(p.foto, 80)} onError={(e) => e.currentTarget.remove()} /> : null}</span>
                                <span className="vce-pn">{p.n}<small>Cód. {p.id}</small></span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
                {!segs.length && <div className="vce-nota">No hay productos públicos todavía.</div>}
              </div>

              <div className="vce-h" style={{ marginTop: 14 }}><b>Agregar otro producto</b></div>
              <label className="vce-bus"><Plus /><input type="text" value={qAdd} onChange={(e) => setQAdd(e.target.value)} placeholder="Busca en todo el inventario…" /></label>
              {resAdd.map((f) => (
                <button key={f.codigo} type="button" className="vce-add" onClick={() => agregar(f)}>
                  <span className="vce-th">{f.imagen_url ? <img alt="" loading="lazy" src={imagen(f.imagen_url, 80)} onError={(e) => e.currentTarget.remove()} /> : null}</span>
                  <span className="vce-pn">{f.nombre}<small>Cód. {f.codigo}</small></span><Plus />
                </button>
              ))}
              {qAdd.trim().length >= 2 && !resAdd.length && <div className="vce-nota">Sin resultados.</div>}
            </div>
          )}

          {base && tab === 'diseno' && (
            <div className="vce-sc">
              <div className="vce-h"><b>Portada</b></div>
              <label className="vce-f">Título<input type="text" maxLength={90} value={pf.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder={TITULO} /><small>Lo que va entre *asteriscos* sale resaltado.</small></label>
              <label className="vce-f">Frase<textarea rows={2} maxLength={160} value={lema} onChange={(e) => { setLema(e.target.value); textos.current.lema = e.target.value }} /></label>
              <label className="vce-o"><input type="checkbox" checked={conCliente} onChange={(e) => setConCliente(e.target.checked)} />Incluir nombre del cliente</label>
              {conCliente && <input type="text" className={'vce-in' + (faltaCliente ? ' falta' : '')} maxLength={80} placeholder="Nombre del cliente o institución" autoComplete="off" value={cliente} onChange={(e) => setCliente(e.target.value)} />}

              <div className="vce-h" style={{ marginTop: 14 }}><b>Colores</b></div>
              <div className="vce-temas">
                {([['azul', 'Azul Vimedic', '#1d2344', '#36a9e1'], ['verde', 'Verde clínico', '#0f3d3e', '#2dd4a3'], ['grafito', 'Grafito', '#1f2937', '#f59e0b']] as const).map(([k, t, a, b]) => (
                  <button key={k} type="button" className={pf.tema === k ? 'on' : ''} onClick={() => set('tema', k)} title={t}><i style={{ background: `linear-gradient(135deg,${a} 55%,${b} 55%)` }} />{t}</button>
                ))}
              </div>

              <div className="vce-h" style={{ marginTop: 14 }}><b>Tarjetas</b></div>
              <div className="vce-seg sm" role="group" aria-label="Tamaño">
                {([['compacto', 'Compactas'], ['normal', 'Normales'], ['amplio', 'Amplias']] as const).map(([k, t]) => <button key={k} type="button" className={pf.tam === k ? 'on' : ''} onClick={() => set('tam', k)}>{t}</button>)}
              </div>
              <label className="vce-o"><input type="checkbox" checked={pf.codigo} onChange={(e) => set('codigo', e.target.checked)} />Mostrar código del producto</label>
              <label className="vce-o"><input type="checkbox" checked={pf.desc} onChange={(e) => set('desc', e.target.checked)} />Mostrar descripción corta</label>

              <div className="vce-h" style={{ marginTop: 14 }}><b>Páginas y contacto</b></div>
              <label className="vce-o"><input type="checkbox" checked={pf.contra} onChange={(e) => set('contra', e.target.checked)} />Cierre · sala de exhibición</label>
              <label className={'vce-o' + (imp ? ' dis' : '')}><input type="checkbox" checked={pf.fab && !imp} disabled={imp} onChange={(e) => set('fab', e.target.checked)} />Botón flotante de WhatsApp{imp ? ' (solo digital)' : ''}</label>
              <div className={'vce-as ' + (n ? 'ok' : 'no')}><Monitor />
                <div><b>{asesor?.nombre ?? perfil.nombre}</b>{n ? waVer(n) + ' · desde tu ficha en Empleados' : 'Tu ficha en Empleados no tiene celular: el catálogo saldrá sin WhatsApp.'}</div></div>

              <button type="button" className="vce-b" style={{ marginTop: 12 }} onClick={() => { textos.current = {}; setLema(LEMA); setRev((r) => r + 1); aviso('Textos restablecidos.') }}>Restablecer textos editados</button>
            </div>
          )}
        </aside>
        {panel && <div className="vce-velo" onClick={() => setPanel(false)} />}

        <section className="vce-prev">
          <div className="vce-ayuda"><b>Edición en vivo:</b> toca la <span className="vce-x">×</span> de un producto para quitarlo · haz clic en un nombre, descripción o la frase de portada para corregir el texto.{imp ? ' Formato impreso: hojas A4 con QR.' : ''}</div>
          {vista
            ? <iframe ref={marco} className="vce-f-marco" title="Vista previa del catálogo" srcDoc={vista} onLoad={() => { try { marco.current?.contentWindow?.scrollTo(0, scrollY.current) } catch { /* sin acceso */ } }} />
            : <div className="vce-carga">{error ? '' : 'Preparando la vista previa…'}</div>}
        </section>
      </div>
    </div>
  )
}
