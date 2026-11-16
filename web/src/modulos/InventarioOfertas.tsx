/* Inventario › Ofertas vigentes (Issue #39): elegir categorías y productos y descargar el PDF para el cliente. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BadgePercent, Check, ChevronDown, Download, FileDown, Images, List, Package, Search, Share2, Square, SquareCheck, SquareMinus, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { imagen } from './inventarioUtil'
import { agruparOfertas, cargarOfertasInv, dineroUsd, fechaCorta, normalizar, preciosOferta, textoVigencia, type OfertaInv } from './ofertasInv'
import { generarPdfOfertas, type OpcionesPdf } from './ofertasPdf'

type Empresa = 'VIMEDIC' | 'FEMEDICS'
const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }
const hoyYmd = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

export default function OfertasVigentes({ perfil, femedics, ambas, cerrar }: { perfil: Perfil; femedics: boolean; ambas: boolean; cerrar: () => void }) {
  const [lista, setLista] = useState<OfertaInv[] | null>(null)
  const [error, setError] = useState('')
  const [proximas, setProximas] = useState(false)
  const [sinStock, setSinStock] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [cerradas, setCerradas] = useState<Set<string>>(new Set())
  const [hoja, setHoja] = useState(false)
  // Femedics solo con su empresa, salvo que tenga acceso a las dos.
  const soloFemedics = perfil.empresa === 'FEMEDICS' && !ambas
  const [empresa, setEmpresa] = useState<Empresa>(soloFemedics || femedics ? 'FEMEDICS' : 'VIMEDIC')
  const listaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    setLista(null); setError('')
    cargarOfertasInv(proximas).then((l) => { if (vivo) setLista(l) }).catch((e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [proximas])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (hoja) setHoja(false); else cerrar() } }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [hoja, cerrar])

  const base = useMemo(() => (lista ?? []).filter((o) => sinStock || o.stock > 0), [lista, sinStock])
  const visibles = useMemo(() => {
    const w = normalizar(q).split(/\s+/).filter(Boolean)
    return w.length ? base.filter((o) => { const t = normalizar(`${o.codigo} ${o.nombre} ${o.marca} ${o.categoria} ${o.campana}`); return w.every((x) => t.includes(x)) }) : base
  }, [base, q])
  const grupos = useMemo(() => agruparOfertas(visibles), [visibles])
  const elegidos = useMemo(() => base.filter((o) => sel.has(o.productoId)), [base, sel])
  const nCats = useMemo(() => new Set(elegidos.map((o) => o.categoria)).size, [elegidos])
  const ocultosSinStock = (lista ?? []).length - (lista ?? []).filter((o) => o.stock > 0).length

  const alternar = useCallback((id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  const alternarGrupo = (items: OfertaInv[]) => setSel((s) => {
    const n = new Set(s), todos = items.every((o) => n.has(o.productoId))
    items.forEach((o) => (todos ? n.delete(o.productoId) : n.add(o.productoId)))
    return n
  })
  const estadoGrupo = (items: OfertaInv[]) => { const m = items.filter((o) => sel.has(o.productoId)).length; return { m, Ic: m === 0 ? Square : m === items.length ? SquareCheck : SquareMinus } }
  const irA = (i: number) => document.getElementById('io-g-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="io-ovl" role="dialog" aria-modal="true" aria-label="Ofertas vigentes">
      <div className="io">
        <header className="io-head">
          <span className="io-ico"><BadgePercent /></span>
          <div className="io-tit">
            <h2>Ofertas vigentes</h2>
            <p>{lista ? `${base.length} producto${base.length === 1 ? '' : 's'} en oferta · ${agruparOfertas(base).length} categorías${textoVigencia(base) ? ' · ' + textoVigencia(base).toLowerCase() : ''}` : 'Cargando…'}</p>
          </div>
          <button type="button" className="io-x" onClick={cerrar} aria-label="Cerrar ofertas"><X /></button>
        </header>

        <div className="io-bar">
          <label className="io-buscar">
            <Search />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto, código, marca o categoría" aria-label="Buscar en las ofertas" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Borrar búsqueda"><X /></button>}
          </label>
          <div className="io-chips">
            <button type="button" className={'io-chip' + (proximas ? ' on' : '')} onClick={() => setProximas((v) => !v)} aria-pressed={proximas}>{proximas && <Check />}Incluir próximas</button>
            <button type="button" className={'io-chip' + (sinStock ? ' on' : '')} onClick={() => setSinStock((v) => !v)} aria-pressed={sinStock} title={ocultosSinStock ? `${ocultosSinStock} sin stock` : undefined}>{sinStock && <Check />}Incluir sin stock{ocultosSinStock ? ` (${ocultosSinStock})` : ''}</button>
          </div>
        </div>

        <div className="io-cuerpo">
          {grupos.length > 1 && (
            <aside className="io-lado" aria-label="Categorías">
              <p className="io-lado-t">Categorías</p>
              {grupos.map((g, i) => {
                const { m, Ic } = estadoGrupo(g.items)
                return (
                  <div key={g.categoria} className={'io-lado-f' + (m ? ' on' : '')}>
                    <button type="button" className="ck" onClick={() => alternarGrupo(g.items)} aria-label={'Marcar toda la categoría ' + g.categoria}><Ic /></button>
                    <button type="button" className="nm" onClick={() => irA(i)} title="Ir a la categoría">{g.categoria}</button>
                    <small>{m ? `${m}/` : ''}{g.items.length}</small>
                  </div>
                )
              })}
            </aside>
          )}

          <div className="io-lista" ref={listaRef}>
            {error && <p className="io-error">No se pudieron cargar las ofertas: {error}</p>}
            {!error && lista === null && <p className="io-vacio"><span className="io-spin" />Cargando ofertas…</p>}
            {!error && lista !== null && !grupos.length && (
              <p className="io-vacio">{q ? 'Ninguna oferta coincide con la búsqueda.' : base.length ? '' : 'No hay ofertas vigentes en este momento. Cuando se aprueben en Promociones u Ofertas aparecerán aquí.'}</p>
            )}
            {grupos.map((g, i) => {
              const { m, Ic } = estadoGrupo(g.items), cerrada = cerradas.has(g.categoria)
              return (
                <section key={g.categoria} id={'io-g-' + i} className="io-grupo">
                  <div className="io-grupo-h">
                    <button type="button" className="io-grupo-ck" onClick={() => alternarGrupo(g.items)} aria-label={'Marcar toda la categoría ' + g.categoria}><Ic /></button>
                    <button type="button" className="io-grupo-nm" aria-expanded={!cerrada} onClick={() => setCerradas((s) => { const n = new Set(s); if (n.has(g.categoria)) n.delete(g.categoria); else n.add(g.categoria); return n })}>
                      <b>{g.categoria}</b><small>{m ? `${m} de ${g.items.length} marcados` : `${g.items.length} producto${g.items.length === 1 ? '' : 's'}`}</small>
                      <ChevronDown className={cerrada ? 'gir' : ''} />
                    </button>
                  </div>
                  {!cerrada && (
                    <div className="io-items">
                      {g.items.map((o) => <Item key={o.productoId} o={o} on={sel.has(o.productoId)} alternar={alternar} femedics={empresa === 'FEMEDICS'} />)}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>

        <footer className="io-pie">
          <div className="io-cuenta">
            <b>{elegidos.length}</b> producto{elegidos.length === 1 ? '' : 's'} · {nCats} categoría{nCats === 1 ? '' : 's'}
            <small>{elegidos.length ? 'Listos para el PDF' : 'Marca categorías completas o productos uno por uno'}</small>
          </div>
          <div className="io-acc">
            <button type="button" className="io-b" disabled={!visibles.length} onClick={() => setSel((s) => new Set([...s, ...visibles.map((o) => o.productoId)]))}>{q ? 'Marcar resultados' : 'Marcar todo'}</button>
            <button type="button" className="io-b" disabled={!sel.size} onClick={() => setSel(new Set())}>Limpiar</button>
            <button type="button" className="io-b io-b-p" disabled={!elegidos.length} onClick={() => setHoja(true)}><FileDown />Generar PDF</button>
          </div>
        </footer>

        {hoja && <HojaPdf elegidos={elegidos} perfil={perfil} empresa={empresa} setEmpresa={setEmpresa} soloFemedics={soloFemedics} cerrar={() => setHoja(false)} />}
      </div>
    </div>
  )
}

function Item({ o, on, alternar, femedics }: { o: OfertaInv; on: boolean; alternar: (id: string) => void; femedics: boolean }) {
  const { antes, ahora, ahorro } = preciosOferta(o, { femedics })
  return (
    <button type="button" className={'io-item' + (on ? ' on' : '')} onClick={() => alternar(o.productoId)} aria-pressed={on}>
      <span className="io-ck">{on ? <SquareCheck /> : <Square />}</span>
      <span className="io-foto">
        {o.img ? <img loading="lazy" decoding="async" src={imagen(o.img, 160)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <Package />}
        {ahorro > 0 && <em>-{ahorro}%</em>}
      </span>
      <span className="io-info">
        <b className="io-nom">{o.nombre}</b>
        <small className="io-cod">{o.codigo}{o.marca ? ' · ' + o.marca : ''}</small>
        <span className="io-precios"><s>{dineroUsd(antes)}</s><b>{dineroUsd(ahora)}</b><small>{o.iva ? '+ IVA' : 'IVA 0%'}</small></span>
        <span className="io-meta">
          {o.proxima && <span className="io-tag prox">Empieza el {fechaCorta(o.inicio).slice(0, 5)}</span>}
          {o.fin && <span>Hasta el {fechaCorta(o.fin)}</span>}
          <span className={o.stock > 0 ? 'st' : 'st0'}>{o.stock > 0 ? `${o.stock} en stock` : 'Sin stock'}</span>
          {!o.publico && <span className="io-tag priv" title="No está en el catálogo público de la web">No visible al público</span>}
        </span>
      </span>
    </button>
  )
}

function HojaPdf({ elegidos, perfil, empresa, setEmpresa, soloFemedics, cerrar }: {
  elegidos: OfertaInv[]; perfil: Perfil; empresa: Empresa; setEmpresa: (e: Empresa) => void; soloFemedics: boolean; cerrar: () => void
}) {
  const [formato, setFormato] = useState<OpcionesPdf['formato']>(() => (leer('vm_of_pdf_formato') === 'lista' ? 'lista' : 'fotos'))
  const [conIva, setConIva] = useState(() => leer('vm_of_pdf_iva') !== 'no')
  const [interna, setInterna] = useState(false)
  const [titulo, setTitulo] = useState('Ofertas vigentes')
  const [nombre, setNombre] = useState(perfil.nombre || '')
  const [telefono, setTelefono] = useState(() => leer('vm_of_pdf_tel') ?? '')
  const [prog, setProg] = useState('')
  const [gen, setGen] = useState(false)
  const [res, setRes] = useState<{ url: string; archivo: File; paginas: number; sinFoto: number } | null>(null)

  // El teléfono de la ficha del empleado, si no escribió otro antes.
  useEffect(() => {
    if (leer('vm_of_pdf_tel')) return
    supabase.from('empleados').select('telefono').eq('id', perfil.id).maybeSingle().then(({ data }) => {
      const t = String((data as { telefono?: string | null } | null)?.telefono ?? '').trim()
      if (t) setTelefono((v) => v || t)
    })
  }, [perfil.id])
  // Si cambia algo, el PDF anterior ya no sirve. El archivo temporal se libera al cambiar o al cerrar.
  const urlRef = useRef('')
  const soltarUrl = () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = '' }
  useEffect(() => { soltarUrl(); setRes(null) }, [formato, conIva, interna, titulo, nombre, telefono, empresa, elegidos])
  useEffect(() => soltarUrl, [])

  async function generar() {
    setGen(true); setProg('Preparando…')
    guardar('vm_of_pdf_formato', formato); guardar('vm_of_pdf_iva', conIva ? 'si' : 'no'); if (telefono.trim()) guardar('vm_of_pdf_tel', telefono.trim())
    try {
      const r = await generarPdfOfertas(elegidos, { formato, empresa, conIva, interna, titulo, nombre: nombre.trim(), telefono: telefono.trim() }, setProg)
      const archivo = new File([r.blob], `${empresa}-Ofertas${interna ? '-INTERNO' : ''}-${hoyYmd()}.pdf`, { type: 'application/pdf' })
      soltarUrl(); urlRef.current = URL.createObjectURL(r.blob)
      setRes({ url: urlRef.current, archivo, paginas: r.paginas, sinFoto: r.sinFoto })
      setProg('')
    } catch (e) { setProg('No se pudo generar el PDF: ' + (e as Error).message) }
    setGen(false)
  }
  const puedeCompartir = !!res && typeof navigator.canShare === 'function' && navigator.canShare({ files: [res.archivo] })
  async function compartir() {
    if (!res) return
    try { await navigator.share({ files: [res.archivo], title: titulo }) } catch { /* el usuario canceló */ }
  }

  return (
    <div className="io-hoja-ovl" onClick={() => !gen && cerrar()}>
      <div className="io-hoja" role="dialog" aria-modal="true" aria-label="Descargar PDF de ofertas" onClick={(e) => e.stopPropagation()}>
        <div className="io-hoja-h">
          <div><h3>Descargar PDF</h3><p>{elegidos.length} producto{elegidos.length === 1 ? '' : 's'} seleccionado{elegidos.length === 1 ? '' : 's'}</p></div>
          <button type="button" className="io-x" disabled={gen} onClick={cerrar} aria-label="Cerrar"><X /></button>
        </div>

        <p className="io-lbl">Formato</p>
        <div className="io-formatos">
          <button type="button" className={'io-fmt' + (formato === 'fotos' ? ' on' : '')} onClick={() => setFormato('fotos')} aria-pressed={formato === 'fotos'}>
            <Images /><b>Catálogo con fotos</b><small>6 por hoja, por categoría. Para enviar al cliente.</small>
          </button>
          <button type="button" className={'io-fmt' + (formato === 'lista' ? ' on' : '')} onClick={() => setFormato('lista')} aria-pressed={formato === 'lista'}>
            <List /><b>Lista compacta</b><small>Tabla sin fotos. Liviana para WhatsApp.</small>
          </button>
        </div>

        <div className="io-dos">
          <div>
            <p className="io-lbl">Empresa</p>
            <div className="io-seg">
              {!soloFemedics && <button type="button" className={empresa === 'VIMEDIC' ? 'on' : ''} onClick={() => setEmpresa('VIMEDIC')}>VIMEDIC</button>}
              <button type="button" className={empresa === 'FEMEDICS' ? 'on' : ''} onClick={() => setEmpresa('FEMEDICS')}>FEMEDICS</button>
            </div>
            {empresa === 'FEMEDICS' && <small className="io-nota">Precios Femedics: PVP + 11,11 % (también el de oferta).</small>}
          </div>
          <div>
            <p className="io-lbl">Precios</p>
            <div className="io-seg">
              <button type="button" className={conIva ? 'on' : ''} onClick={() => setConIva(true)}>Con IVA incluido</button>
              <button type="button" className={!conIva ? 'on' : ''} onClick={() => setConIva(false)}>Más IVA</button>
            </div>
          </div>
        </div>

        <label className="io-sw">
          <input type="checkbox" checked={interna} onChange={(e) => setInterna(e.target.checked)} />
          <span><b>Versión interna</b><small>Agrega el stock y la marca "No enviar al cliente".</small></span>
        </label>

        <div className="io-dos">
          <label className="io-campo"><span>Título del PDF</span><input value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} /></label>
          <label className="io-campo"><span>Atiende (pie de página)</span><input value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} /></label>
          <label className="io-campo"><span>WhatsApp (pie de página)</span><input value={telefono} maxLength={30} inputMode="tel" placeholder="Ej.: 099 123 4567" onChange={(e) => setTelefono(e.target.value)} /></label>
        </div>

        <p className="io-prog" role="status">{prog}{res && !prog ? `PDF listo: ${res.paginas} página${res.paginas === 1 ? '' : 's'}${res.sinFoto ? ` · ${res.sinFoto} producto${res.sinFoto === 1 ? '' : 's'} sin foto disponible` : ''}.` : ''}</p>

        <div className="io-hoja-acc">
          {res ? (
            <>
              <a className="io-b io-b-p" href={res.url} download={res.archivo.name}><Download />Descargar PDF</a>
              {puedeCompartir && <button type="button" className="io-b io-b-ok" onClick={compartir}><Share2 />Compartir</button>}
              <a className="io-b" href={res.url} target="_blank" rel="noopener noreferrer">Ver</a>
            </>
          ) : (
            <button type="button" className="io-b io-b-p" disabled={gen || !elegidos.length} onClick={generar}>{gen ? <span className="io-spin blanco" /> : <FileDown />}{gen ? 'Generando…' : 'Generar PDF'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
