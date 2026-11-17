/* Plantillas de documentos: la marca (logo, colores, leyenda y pie) y el diseño de cada documento que genera la app.
   Cada documento es una lista de bloques que se arrastran para ordenarlos, se ocultan o se editan, con vista previa en vivo
   armada con el mismo código que genera el documento real (plantillas.ts, documentoMarca.ts). Guardar deja una versión en
   el historial; se puede volver a una anterior o al diseño original. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, Check, Eye, EyeOff, FileText, GripVertical, History, ImagePlus, LayoutTemplate, Lock, Minus, MoveVertical, Palette,
  Pencil, PenLine, Plus, RotateCcw, Save, Trash2, Type, Undo2, Upload, X,
} from 'lucide-react'
import type { Perfil } from '../supabase'
import { puede } from '../permisos'
import { conMarcaBorrador, MARCA_DEF, type MarcaDoc } from '../documentoMarca'
import {
  cargarPlantillas, clonar, conBorrador, DOC, DOCS, guardadaDe, guardarPlantilla, marcaGuardada, normalizar, plantillaDe, versionesDe,
  type Alinear, type Bloque, type Plantilla, type TipoBloque, type Version,
} from '../plantillas'
import { cuerpoProforma, type DatosDoc } from '../proforma'
import { htmlActa } from './documentosFacturacion'
import { htmlConstancia, htmlGuiaDespacho } from './documentosEntrega'
import '../estilos/comun.css'
import '../estilos/plantillas.css'

const GENERAL = 'general'
type Borrador = { tipo: 'marca'; m: MarcaDoc } | { tipo: 'doc'; p: Plantilla }

/* ---------------------------------------------------------------- Datos de ejemplo para la vista previa */
const hoy = () => new Date().toLocaleDateString('es-EC')
const ejemploProforma = (tipo: 'Cotización' | 'Venta'): DatosDoc => ({
  codigo: tipo === 'Venta' ? 'VEN-EJEMPLO' : 'COT-EJEMPLO', fecha: hoy(), tipo, empresa: 'VIMEDIC',
  cliente: { nombre: 'Hospital Metropolitano', identificacion: '1790012345001', email: 'compras@hospital.ec', telefono: '0991234567' },
  asesor: 'Ana Torres', nota: tipo === 'Venta' ? null : 'Precios válidos por 15 días.',
  pagoEntrega: tipo === 'Venta' ? { pago: 'Transferencia · Pagado', entrega: 'Envío', detalle: ['Quito · Av. Amazonas N34-120', 'Recibe: Dr. Pérez · 0987654321'] } : null,
  items: [
    { codigo: 'EQM101', nombre: 'Autoclave de vapor 18L clase B', categoria: 'Esterilización', descripcion: 'Ciclos automáticos, secado al vacío.', precio: 2400, cantidad: 1, descuento: 10, iva: true },
    { codigo: 'EQM205', nombre: 'Lámpara cialítica LED doble cúpula', categoria: 'Quirófano', precio: 1800, cantidad: 2, descuento: 0, iva: true },
  ],
})
const ejemploActa = () => ({
  numeroFactura: '001-001-000012345', fecha: new Date(),
  cliente: { nombre: 'Hospital Metropolitano', identificacion: '1790012345001', ciudad: 'Quito', direccion: 'Av. Mariana de Jesús', telefono: '0991234567', email: 'compras@hospital.ec' },
  equipos: [{ id: 'EQM101', nombre: 'Autoclave de vapor 18L clase B', cantidad: 2, series: ['SN-001', 'SN-002'], garantia: '1 año' }],
  garantiaTxt: '1 año', nMant: 2, observaciones: [], anexo: true,
})
const ejemploDespacho = () => htmlGuiaDespacho({
  numeroGuia: 'GD-2026-00001', fecha: hoy(), empresa: 'VIMEDIC', logo: null, qr: '',
  cliente: 'Hospital Metropolitano', identificacion: '1790012345001', factura: '001-001-000012345', asesor: 'Ana Torres',
  direccion: 'Av. Amazonas N34-120', ciudad: 'Quito', recibe: 'Dr. Pérez', telefono: '0987654321', nota: 'Entregar en recepción.', enlace: 'https://vimedic.com.ec/seguimiento/?c=ejemplo',
  lineas: [{ codigo: 'EQM101', nombre: 'Autoclave de vapor 18L clase B', cantidad: 2, observacion: 'Con accesorios' }],
})
const ejemploConstancia = () => htmlConstancia({
  codigo: 'ENT-EJEMPLO', fecha: hoy(), empresa: 'VIMEDIC', cliente: 'Hospital Metropolitano', factura: '001-001-000012345',
  direccion: 'Av. Amazonas N34-120, Quito', modalidad: 'Chofer propio', productos: [{ cantidad: 2, nombre: 'Autoclave de vapor 18L clase B', id: 'EQM101', series: ['SN-001', 'SN-002'] }],
  recibio: 'Dr. Pérez', cedula: '1712345678', fechaHora: new Date().toLocaleString('es-EC'), ubicacion: '', firma: '', nota: '', entregadoPor: 'Luis Chofer',
})
/** El documento de ejemplo armado con el borrador del editor (sin guardar). */
function armarPrevia(codigo: string, b: Borrador | null, zoom: number): string {
  const origen = window.location.origin + '/'
  const doc = (): string => {
    switch (codigo) {
      case GENERAL: case 'proforma': return cuerpoProforma(ejemploProforma('Cotización'), origen)
      case 'venta': return cuerpoProforma(ejemploProforma('Venta'), origen)
      case 'acta_entrega': case 'carta_garantia': case 'anexo_series': return htmlActa(ejemploActa())
      case 'guia_despacho': return ejemploDespacho()
      case 'constancia_entrega': return ejemploConstancia()
      default: return ''
    }
  }
  const html = !b ? doc() : b.tipo === 'marca' ? conMarcaBorrador(b.m, doc) : conBorrador(codigo, b.p, doc)
  // La hoja A4 se escala al ancho de la columna de la vista previa.
  const escala = `<style>html{zoom:${zoom}}</style>`
  if (/^<!doctype/i.test(html.trim())) return html.replace(/<head>/i, '<head>' + escala)
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">${escala}<style>body{margin:0;background:#e2e8f0;padding:14px}.hoja{width:210mm;max-width:100%;margin:0 auto;background:#fff;padding:12mm;box-sizing:border-box;box-shadow:0 2px 12px rgba(15,23,42,.15)}.pagebreak{border-top:2px dashed #cbd5e1;margin:22px -12mm;height:0}</style></head><body><div class="hoja">${html}</div></body></html>`
}

/* ---------------------------------------------------------------- Imágenes (logo y bloques de imagen) */
/** Pasa una imagen (PNG, JPG o SVG) a PNG/JPEG liviano para guardarla dentro de la plantilla. */
function imagenADataUrl(file: File, anchoMax: number, png: boolean): Promise<string> {
  return new Promise((ok, ko) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) { ko(new Error('Usa una imagen PNG, JPG, WEBP o SVG.')); return }
    if (file.size > 5 * 1024 * 1024) { ko(new Error('La imagen supera los 5 MB.')); return }
    const r = new FileReader()
    r.onerror = () => ko(new Error('No se pudo leer la imagen.'))
    r.onload = () => {
      const img = new Image()
      img.onerror = () => ko(new Error('No se pudo abrir la imagen.'))
      img.onload = () => {
        const w0 = img.naturalWidth || 1000, h0 = img.naturalHeight || 300
        const w = Math.min(anchoMax, w0 * (file.type === 'image/svg+xml' ? 4 : 1)), h = Math.round((h0 / w0) * w)
        const c = document.createElement('canvas'); c.width = Math.round(w); c.height = h
        const g = c.getContext('2d'); if (!g) { ko(new Error('El navegador no pudo procesar la imagen.')); return }
        if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height) }
        g.drawImage(img, 0, 0, c.width, c.height)
        const url = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86)
        if (url.length > 900000) { ko(new Error('La imagen queda muy pesada: usa una más pequeña.')); return }
        ok(url)
      }
      img.src = String(r.result)
    }
    r.readAsDataURL(file)
  })
}

/* ---------------------------------------------------------------- Bloques */
const ICONO: Record<TipoBloque, { i: typeof Type; c: string; t: string }> = {
  seccion: { i: Lock, c: '#055c9d', t: 'Parte del sistema' }, texto: { i: Type, c: '#7c3aed', t: 'Texto' }, imagen: { i: ImagePlus, c: '#0e7490', t: 'Imagen' },
  linea: { i: Minus, c: '#64748b', t: 'Línea' }, espacio: { i: MoveVertical, c: '#64748b', t: 'Espacio' }, firma: { i: PenLine, c: '#b45309', t: 'Firma' },
}
const nuevoBloque = (tipo: TipoBloque): Bloque => {
  const id = crypto.randomUUID()
  if (tipo === 'texto') return { id, tipo, visible: true, titulo: '', texto: 'Escribe aquí. Usa **negrita** y variables como {cliente}.' }
  if (tipo === 'imagen') return { id, tipo, visible: true, url: '', ancho: 40, alinear: 'centro' }
  if (tipo === 'espacio') return { id, tipo, visible: true, alto: 24 }
  if (tipo === 'firma') return { id, tipo, visible: true, titulo: '', texto: '', nombre: 'Nombre', cargo: 'Cargo', alinear: 'centro' }
  return { id, tipo, visible: true }
}

export default function Plantillas({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const puedeEditar = puede(perfil, 'plantillas', 'editar')
  const [sel, setSel] = useState<string>(GENERAL)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [sucio, setSucio] = useState(false)
  const [listo, setListo] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [arrastra, setArrastra] = useState<number | null>(null)
  const [encima, setEncima] = useState<number | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [historial, setHistorial] = useState<Version[] | null>(null)
  const [previa, setPrevia] = useState('')
  const marco = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.6)
  useEffect(() => {
    const el = marco.current; if (!el) return
    const ro = new ResizeObserver(() => setZoom(Math.max(0.3, Math.min(1, (el.clientWidth - 34) / 822))))
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const ultimoTexto = useRef<{ id: string; el: HTMLTextAreaElement } | null>(null)

  const desdeGuardado = useCallback((codigo: string): Borrador => (codigo === GENERAL ? { tipo: 'marca', m: marcaGuardada() } : { tipo: 'doc', p: clonar(plantillaDe(codigo)) }), [])
  useEffect(() => { cargarPlantillas(true).then(() => { setBorrador(desdeGuardado(GENERAL)); setListo(true) }) }, [desdeGuardado])

  // Vista previa: se vuelve a armar un momento después de cada cambio (no en cada tecla).
  useEffect(() => {
    if (!listo) return
    const h = setTimeout(() => { try { setPrevia(armarPrevia(sel, borrador, zoom)) } catch (e) { setPrevia('<p style="font-family:sans-serif;padding:20px;color:#c0392b">No se pudo armar la vista previa: ' + String((e as Error).message) + '</p>') } }, 250)
    return () => clearTimeout(h)
  }, [sel, borrador, listo, zoom])

  useEffect(() => {
    const k = (e: BeforeUnloadEvent) => { if (sucio) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', k); return () => window.removeEventListener('beforeunload', k)
  }, [sucio])

  function elegir(codigo: string) {
    if (codigo === sel) return
    if (sucio && !confirm('Tienes cambios sin guardar en esta plantilla. ¿Descartarlos?')) return
    setSel(codigo); setBorrador(desdeGuardado(codigo)); setSucio(false); setAbierto(null); setHistorial(null); setNota('')
  }
  const cambiarDoc = (f: (p: Plantilla) => Plantilla) => { setBorrador((b) => (b && b.tipo === 'doc' ? { tipo: 'doc', p: f(b.p) } : b)); setSucio(true) }
  const cambiarMarca = (c: Partial<MarcaDoc>) => { setBorrador((b) => (b && b.tipo === 'marca' ? { tipo: 'marca', m: { ...b.m, ...c } } : b)); setSucio(true) }
  const cambiarBloque = (id: string, c: Partial<Bloque>) => cambiarDoc((p) => ({ ...p, bloques: p.bloques.map((x) => (x.id === id ? { ...x, ...c } : x)) }))
  const mover = (desde: number, hasta: number) => cambiarDoc((p) => {
    if (hasta < 0 || hasta >= p.bloques.length || desde === hasta) return p
    const l = [...p.bloques]; const [x] = l.splice(desde, 1); l.splice(hasta, 0, x); return { ...p, bloques: l }
  })
  const quitar = (b: Bloque) => { if (confirm('¿Quitar este bloque de la plantilla?')) cambiarDoc((p) => ({ ...p, bloques: p.bloques.filter((x) => x.id !== b.id) })) }
  const agregar = (tipo: TipoBloque) => { const nb = nuevoBloque(tipo); cambiarDoc((p) => ({ ...p, bloques: [...p.bloques, nb] })); setAbierto(nb.id) }
  function insertarVariable(v: string) {
    const t = ultimoTexto.current
    if (!t) { aviso('Primero haz clic dentro del texto donde quieres poner el dato.'); return }
    const el = t.el, ini = el.selectionStart ?? el.value.length, fin = el.selectionEnd ?? ini
    const nuevo = el.value.slice(0, ini) + '{' + v + '}' + el.value.slice(fin)
    cambiarBloque(t.id, { texto: nuevo })
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = ini + v.length + 2 })
  }

  async function guardar() {
    if (!borrador || !puedeEditar) return
    setGuardando(true)
    try {
      const nombre = sel === GENERAL ? 'Marca y pie' : DOC(sel)?.nombre ?? sel
      const contenido = borrador.tipo === 'marca' ? borrador.m : borrador.p
      const v = await guardarPlantilla(sel, nombre, contenido, nota)
      setSucio(false); setNota(''); if (historial) setHistorial(await versionesDe(sel))
      aviso(`Plantilla guardada (versión ${v}). Los próximos documentos ya salen así.`)
    } catch (e) { aviso('No se pudo guardar: ' + (e as Error).message) }
    setGuardando(false)
  }
  function descartar() { if (sucio && !confirm('¿Descartar los cambios sin guardar?')) return; setBorrador(desdeGuardado(sel)); setSucio(false) }
  function original() {
    if (!confirm('¿Volver al diseño original de este documento? Podrás revisarlo antes de guardar.')) return
    const def = DOC(sel)
    setBorrador(sel === GENERAL ? { tipo: 'marca', m: { ...MARCA_DEF } } : { tipo: 'doc', p: clonar(def!.base) }); setSucio(true); setAbierto(null)
  }
  async function verHistorial() {
    if (historial) { setHistorial(null); return }
    try { setHistorial(await versionesDe(sel)) } catch (e) { aviso('No se pudo leer el historial: ' + (e as Error).message) }
  }
  function usarVersion(v: Version) {
    if (sucio && !confirm('Tienes cambios sin guardar. ¿Reemplazarlos por la versión ' + v.version + '?')) return
    const c = v.contenido as Partial<MarcaDoc> & Partial<Plantilla>
    setBorrador(sel === GENERAL ? { tipo: 'marca', m: { ...MARCA_DEF, ...c } } : { tipo: 'doc', p: normalizar(DOC(sel)!, clonar(c)) })
    setSucio(true); setAbierto(null)
    aviso('Versión ' + v.version + ' cargada. Revísala y pulsa «Guardar» para usarla.')
  }

  const def = sel === GENERAL ? null : DOC(sel)
  const modificada = (codigo: string) => guardadaDe(codigo) != null
  const deshabilitado = !puedeEditar

  return (
    <div className="vm-ui vm-pla">
      <div className="pla-hdr"><h1>Plantillas de documentos</h1><p>Logo, colores y diseño de los documentos que genera la app. Los cambios se aplican a los documentos nuevos.</p></div>
      <div className="pla-cuerpo">
        {/* Lista de documentos */}
        <nav className="pla-lista" aria-label="Documentos">
          <button type="button" className={'pla-doc' + (sel === GENERAL ? ' on' : '')} onClick={() => elegir(GENERAL)}>
            <Palette /><span><b>Marca y pie</b><small>Logo, colores, leyenda y pie de todos los documentos.</small>{modificada(GENERAL) && <span className="mod">Personalizada</span>}</span>
          </button>
          {DOCS.map((d) => (
            <button key={d.codigo} type="button" className={'pla-doc' + (sel === d.codigo ? ' on' : '')} onClick={() => elegir(d.codigo)}>
              <FileText /><span><b>{d.nombre}</b><small>{d.desc}</small>{modificada(d.codigo) && <span className="mod">Personalizada</span>}</span>
            </button>
          ))}
        </nav>

        {/* Editor */}
        <section className="pla-panel">
          {!listo || !borrador ? <p className="sub">Cargando plantillas…</p> : (
            <>
              <h2>{sel === GENERAL ? 'Marca y pie' : def?.nombre}</h2>
              <p className="sub">{sel === GENERAL ? 'Se aplica a la proforma, el comprobante de venta, el acta y la garantía, las guías, la constancia, el informe técnico, la ficha técnica y las listas de ofertas.' : def?.desc}</p>
              {deshabilitado && <p className="solo-ver">Solo puedes ver las plantillas. Para cambiarlas necesitas el permiso «editar» de Plantillas de documentos.</p>}

              {borrador.tipo === 'marca' ? (
                <EditorMarca m={borrador.m} cambiar={cambiarMarca} aviso={aviso} deshabilitado={deshabilitado} />
              ) : (
                <>
                  <div className="fila2">
                    <label><span className="lab">Título (línea 1)</span><input className="inp" disabled={deshabilitado} value={borrador.p.titulo} onChange={(e) => cambiarDoc((p) => ({ ...p, titulo: e.target.value }))} /></label>
                    <label><span className="lab">Título (línea 2, opcional)</span><input className="inp" disabled={deshabilitado} value={borrador.p.titulo2 ?? ''} onChange={(e) => cambiarDoc((p) => ({ ...p, titulo2: e.target.value }))} /></label>
                  </div>
                  {def?.conLugar && <label><span className="lab">Lugar (va antes de la fecha)</span><input className="inp" disabled={deshabilitado} value={borrador.p.lugar ?? ''} onChange={(e) => cambiarDoc((p) => ({ ...p, lugar: e.target.value }))} placeholder="Quito" /></label>}

                  <span className="lab" style={{ marginTop: 14 }}>Bloques del documento · arrástralos para cambiar el orden</span>
                  <div className="bloques">
                    {borrador.p.bloques.map((x, i) => {
                      const I = ICONO[x.tipo]
                      const etiqueta = x.tipo === 'seccion' ? (def?.secciones[x.clave ?? ''] ?? x.clave) : x.tipo === 'texto' ? (x.titulo || (x.texto ?? '').replace(/\s+/g, ' ').slice(0, 70) || 'Texto') : x.tipo === 'firma' ? (x.nombre || 'Firma') : I.t
                      const detalle = x.tipo === 'seccion' ? 'La llena la app con los datos' + (x.titulo ? ' · título: ' + x.titulo : '') : x.tipo === 'texto' && x.titulo ? (x.texto ?? '').replace(/\s+/g, ' ').slice(0, 80) : x.tipo === 'imagen' ? (x.url ? `Ancho ${x.ancho ?? 40}%` : 'Sin imagen todavía') : x.tipo === 'espacio' ? `${x.alto ?? 24} px` : x.tipo === 'firma' ? (x.cargo || '') : I.t
                      return (
                        <div key={x.id} className={'bq' + (x.visible ? '' : ' oculto') + (arrastra === i ? ' arrastrando' : '') + (encima === i && arrastra !== null && arrastra !== i ? ' encima' : '')}
                          draggable={!deshabilitado} onDragStart={(e) => { setArrastra(i); e.dataTransfer.effectAllowed = 'move' }}
                          onDragOver={(e) => { if (arrastra === null) return; e.preventDefault(); setEncima(i) }}
                          onDragLeave={() => setEncima((v) => (v === i ? null : v))}
                          onDrop={(e) => { e.preventDefault(); if (arrastra !== null) mover(arrastra, i); setArrastra(null); setEncima(null) }}
                          onDragEnd={() => { setArrastra(null); setEncima(null) }}>
                          <div className="bq-cab">
                            <span className="bq-asa" title="Arrastra para mover"><GripVertical /></span>
                            <span className="bq-ico" style={{ background: I.c + '1A', color: I.c }}><I.i /></span>
                            <div className="bq-txt"><b>{etiqueta}</b><small>{detalle}</small></div>
                            <button type="button" className="ib" title="Subir" disabled={deshabilitado || i === 0} onClick={() => mover(i, i - 1)}><ArrowUp /></button>
                            <button type="button" className="ib" title="Bajar" disabled={deshabilitado || i === borrador.p.bloques.length - 1} onClick={() => mover(i, i + 1)}><ArrowDown /></button>
                            <button type="button" className="ib" title={x.visible ? 'Ocultar' : 'Mostrar'} disabled={deshabilitado} onClick={() => cambiarBloque(x.id, { visible: !x.visible })}>{x.visible ? <Eye /> : <EyeOff />}</button>
                            {x.tipo !== 'linea' && <button type="button" className="ib" title="Editar" onClick={() => setAbierto(abierto === x.id ? null : x.id)}>{abierto === x.id ? <X /> : <Pencil />}</button>}
                            {x.tipo !== 'seccion' && <button type="button" className="ib rojo" title="Quitar" disabled={deshabilitado} onClick={() => quitar(x)}><Trash2 /></button>}
                          </div>
                          {abierto === x.id && (
                            <div className="bq-ed">
                              <EditorBloque b={x} cambiar={(c) => cambiarBloque(x.id, c)} variables={def?.variables ?? {}} deshabilitado={deshabilitado}
                                alEnfocar={(el) => { ultimoTexto.current = { id: x.id, el } }} insertar={insertarVariable} aviso={aviso} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {!deshabilitado && (
                    <div className="agregar">
                      <span>Agregar:</span>
                      <button type="button" className="btn" onClick={() => agregar('texto')}><Type />Texto</button>
                      <button type="button" className="btn" onClick={() => agregar('imagen')}><ImagePlus />Imagen</button>
                      <button type="button" className="btn" onClick={() => agregar('firma')}><PenLine />Firma</button>
                      <button type="button" className="btn" onClick={() => agregar('linea')}><Minus />Línea</button>
                      <button type="button" className="btn" onClick={() => agregar('espacio')}><MoveVertical />Espacio</button>
                    </div>
                  )}
                  <p className="nota-ayuda">Las partes con candado las llena la app (cliente, productos, totales, firmas…): puedes moverlas, ocultarlas o ponerles un título. En los textos usa <b>**negrita**</b> y los datos de cada documento entre llaves, por ejemplo <b>{'{cliente}'}</b>.</p>
                </>
              )}

              <div className="barra">
                {sucio && <span className="aviso-sucio">Cambios sin guardar</span>}
                {!deshabilitado && <input className="inp" style={{ maxWidth: 220 }} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota del cambio (opcional)" />}
                <span className="esp" />
                <button type="button" className="btn" onClick={verHistorial}><History />{historial ? 'Ocultar historial' : 'Historial'}</button>
                {!deshabilitado && <button type="button" className="btn" onClick={original} title="Volver al diseño con el que venía la app"><RotateCcw />Diseño original</button>}
                {!deshabilitado && <button type="button" className="btn" onClick={descartar} disabled={!sucio}><Undo2 />Descartar</button>}
                {!deshabilitado && <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando || !sucio}><Save />{guardando ? 'Guardando…' : 'Guardar'}</button>}
              </div>
              {historial && (
                <div className="hist">
                  {!historial.length && <div className="hist-f"><span className="d">Todavía no hay versiones guardadas: se usa el diseño original.</span></div>}
                  {historial.map((v) => (
                    <div key={v.id} className="hist-f">
                      <span className="v">v{v.version}</span>
                      <span className="d">{new Date(v.created_at).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })} · {v.autor?.nombre ?? '—'}{v.nota && <small>{v.nota}</small>}</span>
                      {!deshabilitado && <button type="button" className="btn" onClick={() => usarVersion(v)}><Check />Usar</button>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Vista previa */}
        <aside className="pla-previa">
          <div className="previa-cab"><span><b>Vista previa</b><br /><small>Con datos de ejemplo · así sale el documento</small></span><LayoutTemplate className="w-5 h-5" style={{ color: '#94a3b8' }} /></div>
          <div className="previa-marco" ref={marco}><iframe title="Vista previa del documento" srcDoc={previa} sandbox="" /></div>
        </aside>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Editores */
function EditorMarca({ m, cambiar, aviso, deshabilitado }: { m: MarcaDoc; cambiar: (c: Partial<MarcaDoc>) => void; aviso: (t: string) => void; deshabilitado: boolean }) {
  const subir = async (f: File | undefined) => {
    if (!f) return
    try { cambiar({ logo: await imagenADataUrl(f, 1200, true) }); aviso('Logo cargado. Revisa la vista previa y pulsa «Guardar».') } catch (e) { aviso((e as Error).message) }
  }
  return (
    <>
      <span className="lab">Logo</span>
      <div className="logo-caja">
        <img src={m.logo || '/logo-documento.png'} alt="Logo de los documentos" />
        <span style={{ fontSize: 11.5, color: '#64748b', flex: 1, minWidth: 160 }}>{m.logo ? 'Logo personalizado.' : 'Logo oficial de VIMEDIC.'} PNG, JPG o SVG; se guarda en buena calidad para imprimir.</span>
        {!deshabilitado && <label className="btn"><Upload />Subir logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { subir(e.target.files?.[0]); e.currentTarget.value = '' }} /></label>}
        {!deshabilitado && m.logo && <button type="button" className="btn" onClick={() => cambiar({ logo: '' })}><RotateCcw />Logo oficial</button>}
      </div>
      <span className="lab">Colores</span>
      <div className="colores">
        <label><input type="color" disabled={deshabilitado} value={m.color} onChange={(e) => cambiar({ color: e.target.value })} />Principal (títulos, líneas y tablas)</label>
        <label><input type="color" disabled={deshabilitado} value={m.acento} onChange={(e) => cambiar({ acento: e.target.value })} />Etiqueta del número</label>
      </div>
      <label><span className="lab">Leyenda junto al título</span><input className="inp" disabled={deshabilitado} value={m.leyenda} onChange={(e) => cambiar({ leyenda: e.target.value })} /></label>
      <label className="check"><input type="checkbox" disabled={deshabilitado} checked={m.mostrarLeyenda} onChange={(e) => cambiar({ mostrarLeyenda: e.target.checked })} />Mostrar la leyenda debajo del título</label>
      <label><span className="lab">Pie de página</span><input className="inp" disabled={deshabilitado} value={m.pie} onChange={(e) => cambiar({ pie: e.target.value })} placeholder="Vacío = sin pie" /></label>
      <p className="nota-ayuda">Los documentos de FEMEDICS conservan su nombre y su leyenda de distribuidor autorizado.</p>
    </>
  )
}

function EditorBloque({ b, cambiar, variables, deshabilitado, alEnfocar, insertar, aviso }: {
  b: Bloque; cambiar: (c: Partial<Bloque>) => void; variables: Record<string, string>; deshabilitado: boolean
  alEnfocar: (el: HTMLTextAreaElement) => void; insertar: (v: string) => void; aviso: (t: string) => void
}) {
  const alinear = (
    <label><span className="lab">Alineación</span>
      <select className="inp" disabled={deshabilitado} value={b.alinear ?? (b.tipo === 'texto' ? 'izquierda' : 'centro')} onChange={(e) => cambiar({ alinear: e.target.value as Alinear })}>
        <option value="izquierda">Izquierda</option><option value="centro">Centro</option><option value="derecha">Derecha</option>
      </select></label>
  )
  const chips = Object.keys(variables).length > 0 && (
    <><span className="lab">Datos del documento (clic para insertar donde está el cursor)</span>
      <div className="chips">{Object.entries(variables).map(([k, t]) => <button key={k} type="button" className="chip" title={t} disabled={deshabilitado} onClick={() => insertar(k)}>{'{' + k + '}'}</button>)}</div></>
  )
  if (b.tipo === 'seccion') return (
    <label><span className="lab">Título encima (opcional)</span><input className="inp" disabled={deshabilitado} value={b.titulo ?? ''} onChange={(e) => cambiar({ titulo: e.target.value })} placeholder="Sin título" /></label>
  )
  if (b.tipo === 'texto') return (
    <>
      <label><span className="lab">Título (opcional)</span><input className="inp" disabled={deshabilitado} value={b.titulo ?? ''} onChange={(e) => cambiar({ titulo: e.target.value })} placeholder="Ej. Cláusulas" /></label>
      <label><span className="lab">Texto</span><textarea className="inp" rows={7} disabled={deshabilitado} value={b.texto ?? ''} onFocus={(e) => alEnfocar(e.currentTarget)} onSelect={(e) => alEnfocar(e.currentTarget)} onChange={(e) => cambiar({ texto: e.target.value })} /></label>
      {chips}
      <div className="fila2">
        {alinear}
        <label><span className="lab">Tamaño de letra</span>
          <select className="inp" disabled={deshabilitado} value={b.tamano ?? 0} onChange={(e) => cambiar({ tamano: Number(e.target.value) || undefined })}>
            <option value={0}>Normal</option>{[9, 10, 11, 12, 13, 14, 16].map((n) => <option key={n} value={n}>{n} px</option>)}
          </select></label>
      </div>
    </>
  )
  if (b.tipo === 'imagen') return (
    <>
      <div className="logo-caja" style={{ marginTop: 8 }}>
        {b.url ? <img src={b.url} alt="" /> : <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Sin imagen</span>}
        {!deshabilitado && <label className="btn"><Upload />Subir imagen<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.currentTarget.value = ''
          if (!f) return
          try { cambiar({ url: await imagenADataUrl(f, 1400, f.type === 'image/png' || f.type === 'image/svg+xml') }) } catch (er) { aviso((er as Error).message) }
        }} /></label>}
      </div>
      <div className="fila2">
        <label><span className="lab">Ancho ({b.ancho ?? 40}% de la hoja)</span><input type="range" min={5} max={100} step={5} disabled={deshabilitado} value={b.ancho ?? 40} onChange={(e) => cambiar({ ancho: Number(e.target.value) })} style={{ width: '100%' }} /></label>
        {alinear}
      </div>
    </>
  )
  if (b.tipo === 'espacio') return (
    <label><span className="lab">Alto ({b.alto ?? 24} px)</span><input type="range" min={4} max={200} step={4} disabled={deshabilitado} value={b.alto ?? 24} onChange={(e) => cambiar({ alto: Number(e.target.value) })} style={{ width: '100%' }} /></label>
  )
  if (b.tipo === 'firma') return (
    <>
      <div className="fila2">
        <label><span className="lab">Nombre</span><input className="inp" disabled={deshabilitado} value={b.nombre ?? ''} onChange={(e) => cambiar({ nombre: e.target.value })} /></label>
        <label><span className="lab">Cargo</span><input className="inp" disabled={deshabilitado} value={b.cargo ?? ''} onChange={(e) => cambiar({ cargo: e.target.value })} /></label>
      </div>
      <div className="fila2">
        <label><span className="lab">Texto encima (opcional)</span><input className="inp" disabled={deshabilitado} value={b.titulo ?? ''} onChange={(e) => cambiar({ titulo: e.target.value })} placeholder="Ej. Atentamente" /></label>
        <label><span className="lab">Recuadro para la firma (opcional)</span><input className="inp" disabled={deshabilitado} value={b.texto ?? ''} onChange={(e) => cambiar({ texto: e.target.value })} placeholder="Vacío = solo línea" /></label>
      </div>
      {alinear}
    </>
  )
  return null
}
