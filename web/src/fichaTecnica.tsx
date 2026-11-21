import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import qrcode from 'qrcode-generator'
import { supabase } from './supabase'
import { imagen } from './modulos/inventarioUtil'
import { LOGO_COLOR, LOGO_RATIO } from './catalogoAssets'

/* Ficha técnica por producto — diseño C3 «Columna lateral» (A4 vertical, 794 × 1123 px).
   Se construye en HTML (se ve al instante y se actualiza al editar); el PDF sale de estas mismas hojas.
   Si las especificaciones no caben, siguen en otra hoja con el mismo encabezado, sin achicar la letra.
   Lo que falta se oculta: nunca salen corchetes ni textos de ejemplo. Nunca costo, stock, proveedor ni importación
   (la consulta ficha_tecnica solo entrega lo publicable). Marca y contacto: VIMEDIC. */

export type FilaEspec = { grupo: string; etiqueta: string; valor: string; unidad: string; destacado: boolean }
export type FichaRaw = {
  producto: { id: string; codigo: string; nombre: string; categoria: string; imagen: string; publico: boolean }
  fotos: string[]; video: string | null
  ficha: { modelo: string; descripcion: string; caracteristicas: string[]; accesorios: string[]; ia_generada_en: string | null; ia_notas: string } | null
  especificaciones: FilaEspec[]
  respaldo: { descripcion: string; caracteristicas: string; especificaciones: string; accesorios: string; destacados: string }
  certificaciones: string
  contacto: { web: string; telefono: string; correo: string }
}
export type DatosFicha = {
  codigo: string; nombre: string; categoria: string; modelo: string; descripcion: string
  foto: string; fotos: string[]; indicadores: FilaEspec[]; caracteristicas: string[]; especificaciones: FilaEspec[]
  accesorios: string[]; certificaciones: string[]; qr: { url: string; video: boolean } | null
  contacto: { web: string; telefono: string; correo: string }
}

const C = { marino: '#1d2344', celeste: '#36a9e1', claro: '#eaf4fb', texto: '#2c3554', gris: '#4b5574', gris2: '#3d4766', alterna: '#f5f7fb', linea: '#e1e7ef' }
const ANCHO = 794, ALTO = 1123, LATERAL = 270, PAD_ARRIBA = 30, PAD_ABAJO = 24, PAD_LADO = 36
const ANCHO_DER = ANCHO - LATERAL - PAD_LADO * 2 // 452: columna principal de la hoja 1
const ANCHO_CONT = ANCHO - PAD_LADO * 2 // 722: hojas de continuación
const ALTO_UTIL = ALTO - PAD_ARRIBA - PAD_ABAJO
const RESERVA = 26 // nota «Continúa en la hoja…»
const SG = "'Space Grotesk', sans-serif"

export const sinEmoji = (t: unknown) => String(t ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s+/g, ' ').trim()
const lineas = (t: unknown) => String(t ?? '').split(/\r?\n/).map(sinEmoji).filter(Boolean)

/** Especificaciones del texto de la web («Etiqueta: valor» por línea) → filas (grupo Generales). */
export function especsDeTexto(texto: string, destacados = ''): FilaEspec[] {
  const dest = new Set(String(destacados || '').split('|').map((x) => x.trim().toLowerCase()).filter(Boolean))
  return lineas(texto).map((l) => { const i = l.indexOf(':'); return i > 0 ? { grupo: 'Generales', etiqueta: l.slice(0, i).trim(), valor: l.slice(i + 1).trim(), unidad: '', destacado: dest.has(l.slice(0, i).trim().toLowerCase()) } : null })
    .filter((x): x is FilaEspec => !!x && !!x.etiqueta && !!x.valor)
}

/** Datos de la ficha con sus respaldos: lo propio de la ficha; si falta, los textos actuales del producto. */
export function armarDatos(r: FichaRaw): DatosFicha {
  const f = r.ficha
  const especs = (r.especificaciones?.length ? r.especificaciones : especsDeTexto(r.respaldo.especificaciones, r.respaldo.destacados))
    .map((e) => ({ grupo: sinEmoji(e.grupo) || 'Generales', etiqueta: sinEmoji(e.etiqueta), valor: sinEmoji(e.valor), unidad: sinEmoji(e.unidad), destacado: !!e.destacado }))
    .filter((e) => e.etiqueta && e.valor)
  const marcados = especs.filter((e) => e.destacado).slice(0, 3)
  const caract = (f?.caracteristicas?.length ? f.caracteristicas.map(sinEmoji) : lineas(r.respaldo.caracteristicas)).filter(Boolean).slice(0, 6)
  const acces = (f?.accesorios?.length ? f.accesorios.map(sinEmoji) : lineas(r.respaldo.accesorios)).filter(Boolean)
  const video = String(r.video || '').trim()
  return {
    codigo: r.producto.codigo, nombre: sinEmoji(r.producto.nombre), categoria: sinEmoji(r.producto.categoria), modelo: sinEmoji(f?.modelo),
    descripcion: sinEmoji(f?.descripcion || r.respaldo.descripcion),
    foto: r.producto.imagen || r.fotos[0] || '', fotos: (r.producto.imagen ? r.fotos : r.fotos.slice(1)).slice(0, 3),
    indicadores: marcados.length ? marcados : especs.slice(0, 3), caracteristicas: caract, especificaciones: especs, accesorios: acces,
    certificaciones: String(r.certificaciones || '').split(/[,;·\n]/).map(sinEmoji).filter(Boolean),
    qr: /^https:\/\//.test(video) ? { url: video, video: true }
      : r.producto.publico && r.producto.codigo ? { url: 'https://vimedic.com.ec/catalogo/#/equipo/' + encodeURIComponent(r.producto.codigo), video: false } : null,
    contacto: r.contacto,
  }
}

export async function leerFicha(productoId: string): Promise<FichaRaw> {
  const { data, error } = await supabase.rpc('ficha_tecnica', { p_producto: productoId })
  if (error) throw new Error(error.message)
  return data as FichaRaw
}

/* ---------------- Piezas del diseño C3 ---------------- */
function Qr({ url, tam }: { url: string; tam: number }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, 'M'); q.addData(url); q.make()
    const n = q.getModuleCount(); let d = ''
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x},${y}h1v1h-1z`
    return { d, n }
  }, [url])
  return <svg width={tam} height={tam} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Código QR"><rect width={n} height={n} fill="#ffffff" /><path d={d} fill={C.marino} /></svg>
}
const Check = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
const Logo = ({ alto }: { alto: number }) => <img src={LOGO_COLOR} alt="VIMEDIC" style={{ height: alto, width: Math.round(alto * LOGO_RATIO), display: 'block' }} />
const Foto = ({ url, ancho, estilo }: { url: string; ancho: number; estilo: CSSProperties }) => (
  <div style={{ ...estilo, overflow: 'hidden', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img src={imagen(url, ancho)} crossOrigin="anonymous" alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
  </div>
)
const valorCon = (e: FilaEspec) => e.valor + (e.unidad ? ' ' + e.unidad : '')

type Item = { t: 'g'; grupo: string; cont?: boolean } | { t: 'f'; fila: FilaEspec; alt: boolean }
function armarItems(especs: FilaEspec[]): Item[] {
  const items: Item[] = []
  let grupo = '', n = 0
  for (const e of especs) {
    if (e.grupo !== grupo) { grupo = e.grupo; n = 0; items.push({ t: 'g', grupo }) }
    items.push({ t: 'f', fila: e, alt: n % 2 === 0 }); n++
  }
  return items
}
function ItemEspec({ it, colEtiqueta = 190 }: { it: Item; colEtiqueta?: number }) {
  if (it.t === 'g') return <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, padding: '12px 0 4px', textTransform: 'uppercase' }}>{it.grupo}{it.cont ? ' (continuación)' : ''}</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${colEtiqueta}px minmax(0, 1fr)`, padding: '5px 8px', background: it.alt ? C.alterna : undefined }}>
      <span style={{ color: C.gris, paddingRight: 8 }}>{it.fila.etiqueta}</span><span style={{ fontWeight: 600 }}>{valorCon(it.fila)}</span>
    </div>
  )
}
function CabeceraDerecha({ d }: { d: DatosFicha }) {
  return (
    <div style={{ display: 'flow-root' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `2px solid ${C.celeste}`, paddingBottom: 10 }}>
        <h2 style={{ margin: 0, fontFamily: SG, fontSize: 20, fontWeight: 700 }}>Ficha técnica</h2>
        {d.codigo && <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>CÓD. {d.codigo}</span>}
      </div>
      {d.descripcion && <p style={{ margin: '12px 0 6px', fontSize: 12, lineHeight: 1.55, color: C.texto }}>{d.descripcion}</p>}
    </div>
  )
}
function Pie({ d }: { d: DatosFicha }) {
  const contacto = [d.contacto.web, d.contacto.telefono].filter(Boolean).join(' · ')
  return (
    <div style={{ display: 'flow-root' }}>
      {d.accesorios.length > 0 && <div style={{ borderTop: `1px solid ${C.linea}`, paddingTop: 10, fontSize: 11.5, lineHeight: 1.6, color: C.texto }}><strong style={{ color: C.marino }}>Incluye:</strong> {d.accesorios.join(', ')}.</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 10, fontSize: 11, borderTop: d.accesorios.length ? undefined : `1px solid ${C.linea}`, paddingTop: d.accesorios.length ? 0 : 10 }}>
        <span style={{ fontWeight: 600 }}>{d.certificaciones.join(' · ')}</span>
        <span style={{ color: C.gris, textAlign: 'right' }}>{contacto ? contacto + ' · ' : ''}Imágenes referenciales</span>
      </div>
    </div>
  )
}
function CabeceraContinuacion({ d, hoja, total }: { d: DatosFicha; hoja: number; total: number }) {
  return (
    <div style={{ display: 'flow-root' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderBottom: `2px solid ${C.celeste}`, paddingBottom: 10 }}>
        <Logo alto={22} />
        <div style={{ flex: 1, minWidth: 0, fontFamily: SG, fontSize: 16, fontWeight: 700, lineHeight: 1.35, paddingBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nombre}</div>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, whiteSpace: 'nowrap' }}>{d.codigo ? 'CÓD. ' + d.codigo + ' · ' : ''}HOJA {hoja} DE {total}</span>
      </div>
    </div>
  )
}

/** Columna lateral (celeste claro) de la hoja 1. */
function Lateral({ d }: { d: DatosFicha }) {
  return (
    <div style={{ width: LATERAL, flexShrink: 0, background: C.claro, padding: '30px 24px 24px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Logo alto={24} />
      {d.categoria && <div style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, background: C.celeste, color: '#0f1430', padding: '4px 10px', borderRadius: 999, textTransform: 'uppercase', lineHeight: 1.3 }}>{d.categoria}</div>}
      <h1 style={{ margin: 0, fontFamily: SG, fontSize: 30, lineHeight: 1.05, fontWeight: 700 }}>{d.nombre}</h1>
      {d.modelo && <div style={{ fontSize: 12.5, color: C.gris2, marginTop: -4 }}>Modelo {d.modelo}</div>}
      {d.foto && <Foto url={d.foto} ancho={600} estilo={{ height: 210, borderRadius: 16 }} />}
      {d.fotos.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {d.fotos.map((u, i) => <Foto key={i} url={u} ancho={200} estilo={{ height: 60, borderRadius: 10, border: '1px solid #c5d6e6' }} />)}
      </div>}
      {d.indicadores.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {d.indicadores.map((e, i) => (
          <div key={i} style={{ borderRadius: 12, background: i === 0 ? C.marino : '#ffffff', color: i === 0 ? '#ffffff' : C.marino, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 11, color: i === 0 ? '#c9d1e6' : C.gris }}>{e.etiqueta}</span>
            <span style={{ fontFamily: SG, fontSize: valorCon(e).length > 14 ? 14 : 19, fontWeight: 700, textAlign: 'right' }}>{valorCon(e)}</span>
          </div>))}
      </div>}
      {d.caracteristicas.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11.5 }}>
        {d.caracteristicas.map((c, i) => <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ color: C.marino, display: 'flex', marginTop: 2, flexShrink: 0 }}><Check /></span><span>{c}</span></div>)}
      </div>}
      <div style={{ flexGrow: 1 }} />
      {d.qr && <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: C.marino, color: '#ffffff', borderRadius: 14, padding: '10px 12px' }}>
        <div style={{ background: '#ffffff', borderRadius: 6, padding: 4, display: 'flex' }}><Qr url={d.qr.url} tam={56} /></div>
        <div style={{ fontSize: 11, lineHeight: 1.45, color: '#c9d1e6' }}>{d.qr.video
          ? <><strong style={{ color: '#ffffff' }}>Míralo funcionando</strong><br />Escanea para ver el video.</>
          : <><strong style={{ color: '#ffffff' }}>Ver más</strong><br />Escanea para ver el equipo en vimedic.com.ec.</>}</div>
      </div>}
    </div>
  )
}

// Altura de línea fija: sin ella, la captura del PDF baja el texto unos píxeles respecto de la pantalla.
const TEXTO_BASE: CSSProperties = { fontFamily: 'Inter, system-ui, sans-serif', color: C.marino, lineHeight: 1.4 }
const estiloHoja: CSSProperties = { ...TEXTO_BASE, width: ANCHO, height: ALTO, boxSizing: 'border-box', background: '#ffffff', overflow: 'hidden', position: 'relative' }
type Pagina = { items: Item[]; pie: boolean }

/** Reparte las especificaciones en hojas midiendo cada bloque (la letra nunca se achica). */
function paginar(items: Item[], alto: (clave: string) => number): Pagina[] {
  const paginas: Pagina[] = []
  let i = 0
  for (let n = 0; n < 30; n++) {
    const primera = n === 0, col = primera ? 'a' : 'b'
    let usado = primera ? alto('cab1') : alto('cabN')
    const pg: Item[] = []
    // Al seguir un grupo en otra hoja se repite su título.
    if (!primera && i < items.length && items[i].t === 'f') {
      let k = i; while (k > 0 && items[k].t !== 'g') k--
      const g = items[k] as { grupo: string }
      pg.push({ t: 'g', grupo: g.grupo, cont: true }); usado += alto(col + 'g')
    }
    // Se deja lugar para la nota «Continúa en la hoja…»; si la hoja termina con el pie, el pie ocupa ese lugar.
    const libre = ALTO_UTIL - RESERVA
    while (i < items.length) {
      const h = alto(col + i)
      if (usado + h > libre && pg.some((x) => x.t === 'f')) break
      pg.push(items[i]); usado += h; i++
    }
    // Un título de grupo nunca queda solo al final de la hoja.
    while (i < items.length && pg.length > 1 && pg[pg.length - 1].t === 'g') { pg.pop(); i--; }
    const pie = i >= items.length && usado + alto(primera ? 'pie1' : 'pieN') <= ALTO_UTIL
    paginas.push({ items: pg, pie })
    if (pie) break
    if (i >= items.length) { paginas.push({ items: [], pie: true }); break }
  }
  return paginas
}

/** Las hojas A4 de la ficha (HTML). data-hoja marca cada una para el PDF. */
export function HojasFicha({ d }: { d: DatosFicha }) {
  const items = useMemo(() => armarItems(d.especificaciones), [d.especificaciones])
  const medir = useRef<HTMLDivElement>(null)
  const [paginas, setPaginas] = useState<Pagina[] | null>(null)
  useLayoutEffect(() => {
    let vivo = true
    const calcular = () => {
      if (!vivo || !medir.current) return
      const altos = new Map<string, number>()
      medir.current.querySelectorAll<HTMLElement>('[data-m]').forEach((el) => altos.set(el.dataset.m!, el.getBoundingClientRect().height))
      setPaginas(paginar(items, (k) => altos.get(k) ?? 0))
    }
    calcular()
    // Con las fuentes ya cargadas las alturas son las definitivas.
    ;(document.fonts?.ready ?? Promise.resolve()).then(calcular)
    return () => { vivo = false }
  }, [d, items])
  const total = paginas?.length ?? 1
  return (
    <>
      {/* La medición va fuera de la vista reducida (zoom), para medir en tamaño real. */}
      {createPortal(<div ref={medir} aria-hidden style={{ ...TEXTO_BASE, position: 'fixed', left: -20000, top: 0, visibility: 'hidden' }}>
        <div data-m="cab1" style={{ width: ANCHO_DER }}><CabeceraDerecha d={d} /></div>
        <div data-m="cabN" style={{ width: ANCHO_CONT }}><CabeceraContinuacion d={d} hoja={2} total={2} /><div style={{ height: 6 }} /></div>
        <div data-m="pie1" style={{ width: ANCHO_DER, fontSize: 11.5 }}><div style={{ height: 12 }} /><Pie d={d} /></div>
        <div data-m="pieN" style={{ width: ANCHO_CONT, fontSize: 11.5 }}><div style={{ height: 12 }} /><Pie d={d} /></div>
        <div data-m="ag" style={{ width: ANCHO_DER, fontSize: 11.5 }}><ItemEspec it={{ t: 'g', grupo: 'X', cont: true }} /></div>
        <div data-m="bg" style={{ width: ANCHO_CONT, fontSize: 11.5 }}><ItemEspec it={{ t: 'g', grupo: 'X', cont: true }} /></div>
        {items.map((it, k) => <div key={'a' + k} data-m={'a' + k} style={{ width: ANCHO_DER, fontSize: 11.5 }}><ItemEspec it={it} /></div>)}
        {items.map((it, k) => <div key={'b' + k} data-m={'b' + k} style={{ width: ANCHO_CONT, fontSize: 11.5 }}><ItemEspec it={it} colEtiqueta={230} /></div>)}
      </div>, document.body)}
      {(paginas ?? [{ items, pie: true }]).map((pg, n) => n === 0 ? (
        <div key={n} data-hoja style={{ ...estiloHoja, display: 'flex' }}>
          <Lateral d={d} />
          <div style={{ flexGrow: 1, minWidth: 0, padding: `${PAD_ARRIBA}px ${PAD_LADO}px ${PAD_ABAJO}px`, display: 'flex', flexDirection: 'column' }}>
            <CabeceraDerecha d={d} />
            <div style={{ fontSize: 11.5 }}>{pg.items.map((it, k) => <ItemEspec key={k} it={it} />)}</div>
            <div style={{ flexGrow: 1 }} />
            {pg.pie && <div style={{ paddingTop: 12 }}><Pie d={d} /></div>}
            {!pg.pie && <div style={{ fontSize: 10.5, color: C.gris, textAlign: 'right', paddingTop: 8 }}>Continúa en la hoja 2 →</div>}
          </div>
        </div>
      ) : n < total - 1 && !pg.pie ? (
        <div key={n} data-hoja style={{ ...estiloHoja, padding: `${PAD_ARRIBA}px ${PAD_LADO}px ${PAD_ABAJO}px`, display: 'flex', flexDirection: 'column' }}>
          <CabeceraContinuacion d={d} hoja={n + 1} total={total} />
          <div style={{ height: 6 }} />
          <div style={{ fontSize: 11.5 }}>{pg.items.map((it, k) => <ItemEspec key={k} it={it} colEtiqueta={230} />)}</div>
          <div style={{ flexGrow: 1 }} />
          <div style={{ fontSize: 10.5, color: C.gris, textAlign: 'right', paddingTop: 8 }}>Continúa en la hoja {n + 2} →</div>
        </div>
      ) : (
        <div key={n} data-hoja style={{ ...estiloHoja, padding: `${PAD_ARRIBA}px ${PAD_LADO}px ${PAD_ABAJO}px`, display: 'flex', flexDirection: 'column' }}>
          <CabeceraContinuacion d={d} hoja={n + 1} total={total} />
          <div style={{ height: 6 }} />
          <div style={{ fontSize: 11.5 }}>{pg.items.map((it, k) => <ItemEspec key={k} it={it} colEtiqueta={230} />)}</div>
          <div style={{ flexGrow: 1 }} />
          {pg.pie && <div style={{ paddingTop: 12 }}><Pie d={d} /></div>}
        </div>
      ))}
    </>
  )
}

/** Nombre del archivo: Ficha-<Producto>-<código>.pdf */
export const nombreArchivoFicha = (d: DatosFicha) =>
  'Ficha-' + (d.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'Producto') + '-' + (d.codigo || 'sin-codigo') + '.pdf'

/** PDF desde las hojas HTML (html2canvas ×2, JPEG 0,9). Cada hoja se copia sin escala fuera de la pantalla para capturarla. */
export async function pdfDeHojas(contenedor: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  await (document.fonts?.ready ?? Promise.resolve())
  const hojas = Array.from(contenedor.querySelectorAll<HTMLElement>('[data-hoja]'))
  if (!hojas.length) throw new Error('No hay hojas para exportar.')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  // Los estilos base de la app ponen las imágenes en bloque; html2canvas mide la línea base del texto con una imagen
  // en el documento principal y, así, dibuja el texto más abajo que en pantalla. Mientras se captura, las imágenes sin
  // estilo propio vuelven a ser «en línea» (las de la ficha traen su propio display).
  const arreglo = document.createElement('style')
  arreglo.textContent = 'img{display:inline-block}'
  document.head.appendChild(arreglo)
  try {
    for (const [i, h] of hojas.entries()) {
      const tmp = document.createElement('div')
      tmp.style.cssText = `position:fixed;left:-20000px;top:0;width:${ANCHO}px;height:${ALTO}px;z-index:-1`
      tmp.appendChild(h.cloneNode(true))
      document.body.appendChild(tmp)
      try {
        await Promise.all(Array.from(tmp.querySelectorAll('img')).map((im) => (im.complete ? Promise.resolve() : im.decode().catch(() => undefined))))
        const c = await html2canvas(tmp.firstElementChild as HTMLElement, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, width: ANCHO, height: ALTO, windowWidth: ANCHO })
        if (i) pdf.addPage()
        pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297)
      } finally { tmp.remove() }
    }
  } finally { arreglo.remove() }
  return pdf.output('blob') as Blob
}

/** Ventana con la ficha en HTML (hojas A4 a escala) y «Descargar PDF». Carga por producto o muestra los datos que le pasen. */
export function VentanaFicha({ productoId, datos, cerrar, extra }: { productoId?: string; datos?: DatosFicha | null; cerrar: () => void; extra?: (ctx: { hojas: () => HTMLElement | null; datos: DatosFicha }) => ReactNode }) {
  const [d, setD] = useState<DatosFicha | null>(datos ?? null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const caja = useRef<HTMLDivElement>(null), hojas = useRef<HTMLDivElement>(null)
  const [escala, setEscala] = useState(1)
  useEffect(() => { if (datos) setD(datos) }, [datos])
  useEffect(() => { if (!datos && productoId) leerFicha(productoId).then((r) => setD(armarDatos(r))).catch((e) => setError((e as Error).message)) }, [productoId, datos])
  useLayoutEffect(() => {
    const medir = () => { const w = caja.current?.clientWidth ?? ANCHO; setEscala(Math.min(1, (w - 32) / ANCHO)) }
    medir(); window.addEventListener('resize', medir); return () => window.removeEventListener('resize', medir)
  }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [cerrar])
  async function descargar() {
    if (!d || !hojas.current) return
    setOcupado(true)
    try {
      const blob = await pdfDeHojas(hojas.current)
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombreArchivoFicha(d); a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 30000)
    } catch (e) { setError('No se pudo crear el PDF: ' + (e as Error).message) }
    setOcupado(false)
  }
  const btn: CSSProperties = { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: '#1e293b' }
  return createPortal(
    <div role="dialog" aria-label="Ficha técnica" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,.6)', display: 'flex', flexDirection: 'column' }} onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div style={{ background: '#fff', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', boxShadow: '0 2px 10px rgba(0,0,0,.15)' }}>
        <b style={{ fontSize: 15, color: '#1e293b', flex: '1 1 200px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Ficha técnica{d ? ' · ' + d.nombre : ''}</b>
        {d && extra?.({ hojas: () => hojas.current, datos: d })}
        <button type="button" style={{ ...btn, background: '#055c9d', borderColor: '#055c9d', color: '#fff' }} onClick={descargar} disabled={!d || ocupado}>{ocupado ? 'Creando PDF…' : 'Descargar PDF'}</button>
        <button type="button" style={btn} onClick={cerrar} aria-label="Cerrar">Cerrar</button>
      </div>
      <div ref={caja} style={{ flex: 1, overflow: 'auto', background: '#e5e9f0', padding: '16px 0' }}>
        {error && <p style={{ margin: '0 auto 12px', maxWidth: 680, background: '#fdecea', color: '#a3341f', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{error}</p>}
        {!d && !error && <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>Cargando la ficha…</p>}
        {d && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {/* zoom reduce la hoja para la pantalla sin cambiar su diseño; el PDF se toma de una copia en tamaño real. */}
            <div ref={hojas} style={{ zoom: escala, width: ANCHO, display: 'flex', flexDirection: 'column', gap: 16 } as CSSProperties}>
              <HojasFicha d={d} />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
