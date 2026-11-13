import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Camera, Check, ChevronDown, ChevronUp, History, ImagePlus, PackageCheck, PackageOpen, Paperclip, RefreshCw, ScanLine, Search, Trash2, Truck, Wrench, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { imagenWebp, subirCatalogo } from './audiovisualMedios'
import '../estilos/recepcion.css'

/* Recepción de importaciones (RecepcionImportacion.gs): Importación → Marketing → Bodega ⇄ Servicio Técnico → Inventario.
   La misma pantalla sirve a las cuatro áreas; la base hace las cuentas y los movimientos (rec_*). */
type Area = 'bodega' | 'st' | 'marketing' | 'importacion'
type Linea = {
  codigo: string; itemId: string; modelo: string; descripcion: string; marca: string; esperada: number; codigoReservado: string; categoria: string; obs: string; imagen: string
  producto: string; productoNombre: string; recibida: number; porRecibir: number; pendiente: number; aprobada: number; enST: number; devuelta: number; noReparable: number; faltante: number
  sinSerie: boolean | null; resuelta: boolean; impNombre: string; impEtapa: string; impEta: string; series: string[]; seriesDevueltas: string[]
}
type Orden = {
  id: string; fecha: string; codigo: string; itemId: string; producto: string; productoNombre: string; imagen: string; modelo: string; cantidad: number; defecto: string; tipoDano: string; detalle: string
  estado: string; tecnico: string; diagnostico: string; trabajo: string; reparadas: number; noReparables: number; devolucion: string | null; dias: number; series: string[]
  evidencias: { serie: string; fotos: string[]; obs?: string }[]; evidenciasST: string[]; adjunto: { url: string; nombre: string } | null
}
type Imp = { codigo: string; nombre: string; etapa: string; eta: string; proveedor: string; enviado: unknown; cerrada: boolean; autorizada: boolean; lineas: number; sinIdentificar: number
  esperada: number; recibida: number; porRecibir: number; pendiente: number; aprobada: number; enST: number; devuelta: number; noReparable: number }
type Op = { id: string; fecha: string; codigo: string; itemId: string; producto: string; tipo: string; c: Record<string, number>; orden: string; origen: string; destino: string; por: string; obs: string; movs: string }
type Bandeja = { area: Area; usuario: string; aprueba: boolean; puedeEliminar: boolean; puedeEditar: boolean; importaciones: Imp[]; lineas: Linea[]; ordenes: Orden[]; historial: Op[]; categorias: string[] }
type Foto = { id: string; ruta: string; vista: string; estado: 'subiendo' | 'ok' | 'error' }
type Fila = { serie: string; estado: '' | 'ok' | 'def'; fotos: Foto[]; obs: string; tipo: string; fija?: boolean }

const TIPOS_DANO = ['Golpe / rayón', 'No funciona', 'Accesorios incompletos', 'Embalaje dañado', 'Otro']
const nuevoOp = () => 'op-' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
const dfecha = (s?: string | null) => (s ? new Date(s).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const serieNorm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 80)
const nombreLinea = (l: { productoNombre?: string; modelo: string; descripcion: string }) => l.productoNombre || l.modelo || l.descripcion || 'Producto'
const textoError = (e: unknown) => (e as { message?: string })?.message || String(e)

/** Sube una foto (WebP liviana) al espacio privado de la recepción y devuelve su ruta. */
async function subirFoto(file: File, carpeta: string): Promise<string> {
  const blob = await imagenWebp(file, 1600)
  const ruta = `rec/${carpeta.replace(/[^\w-]/g, '_')}/${Date.now()}-${crypto.randomUUID().slice(0, 6)}.webp`
  const { error } = await supabase.storage.from('importaciones').upload(ruta, blob, { contentType: 'image/webp' })
  if (error) throw new Error(error.message)
  return ruta
}
function useUrl(ruta: string) {
  const [url, setUrl] = useState(/^https?:|^blob:/i.test(ruta) ? ruta : '')
  useEffect(() => {
    if (!ruta || /^https?:|^blob:/i.test(ruta)) { setUrl(ruta); return }
    let vivo = true
    supabase.storage.from('importaciones').createSignedUrl(ruta, 3600).then(({ data }) => { if (vivo && data) setUrl(data.signedUrl) })
    return () => { vivo = false }
  }, [ruta])
  return url
}
function Miniatura({ ruta, quitar }: { ruta: string; quitar?: () => void }) {
  const url = useUrl(ruta)
  return <span className="rc-mini">{url ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="Evidencia" loading="lazy" /></a> : <span className="rc-spin" />}{quitar && <button type="button" aria-label="Quitar foto" onClick={quitar}><X /></button>}</span>
}

/* ---------- Escáner de código de barras (cámara del celular) ---------- */
declare global { interface Window { Html5Qrcode?: new (id: string) => { start: (c: unknown, o: unknown, ok: (t: string) => void, err: () => void) => Promise<unknown>; stop: () => Promise<unknown>; clear: () => void } } }
function Escaner({ cerrar, leido }: { cerrar: () => void; leido: (t: string) => void }) {
  useEffect(() => {
    let esc: InstanceType<NonNullable<Window['Html5Qrcode']>> | null = null, activo = true
    const cargar = () => window.Html5Qrcode ? Promise.resolve() : new Promise<void>((ok, fail) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = () => ok(); s.onerror = () => fail(new Error('No se pudo abrir el escáner.')); document.head.appendChild(s) })
    cargar().then(() => {
      if (!activo) return
      esc = new window.Html5Qrcode!('rcScan')
      return esc.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w: number, h: number) => ({ width: Math.min(300, w * 0.9), height: Math.min(160, h * 0.6) }) }, (t) => { try { navigator.vibrate?.(80) } catch { /* nada */ } leido(t) }, () => undefined)
    }).catch((e) => { alert(textoError(e) + ' Escribe la serie o usa un lector de código de barras.'); cerrar() })
    return () => { activo = false; if (esc) { const e = esc; e.stop().catch(() => undefined).then(() => { try { e.clear() } catch { /* nada */ } }) } }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <Ventana titulo="Escanear número de serie" cerrar={cerrar}><div id="rcScan" className="rc-scan" /><p className="rc-nota">Apunta al código de barras de la etiqueta del equipo.</p></Ventana>
}

function Ventana({ titulo, cerrar, children, pie, ancho }: { titulo: React.ReactNode; cerrar: () => void; children: React.ReactNode; pie?: React.ReactNode; ancho?: number }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  return (
    <div className="rc-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="rc-ventana" role="dialog" aria-modal="true" style={ancho ? { maxWidth: ancho } : undefined}>
        <div className="rc-vh"><h3>{titulo}</h3><button type="button" className="rc-x" onClick={cerrar} aria-label="Cerrar"><X /></button></div>
        <div className="rc-vb">{children}</div>
        {pie && <div className="rc-vf">{pie}</div>}
      </div>
    </div>
  )
}

/* ============================ Pantalla ============================ */
export default function RecepcionImportaciones({ perfil, aviso, area }: { perfil: Perfil; aviso: (t: string) => void; area: Area }) {
  const [b, setB] = useState<Bandeja | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [hoja, setHoja] = useState<{ k: 'revisar' | 'devuelta'; l: Linea } | { k: 'st'; o: Orden } | { k: 'hist'; codigo: string; itemId: string; titulo: string } | { k: 'identificar'; l: Linea } | { k: 'cierre'; i: Imp } | { k: 'quitar'; i: Imp } | null>(null)
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({})
  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('rec_bandeja', { p_area: area })
    if (e) { setError(e.message); return }
    setError(''); setB(data as Bandeja)
  }, [area])
  useEffect(() => { cargar() }, [cargar])
  const hecho = async (t: string) => { setHoja(null); aviso(t); await cargar() }
  const w = q.trim().toLowerCase()
  const coincide = (l: Linea) => !w || [l.modelo, l.descripcion, l.productoNombre, l.producto, l.codigo, l.impNombre, ...(l.series ?? [])].join(' ').toLowerCase().includes(w)
  const editar = !!b?.puedeEditar

  if (error) return <div className="rc"><p className="rc-error">{error}</p></div>
  if (!b) return <div className="rc"><p className="rc-vacio"><span className="rc-spin" /> Cargando recepción…</p></div>
  const lineas = b.lineas.filter(coincide)
  const porImp = new Map<string, Linea[]>(); lineas.forEach((l) => porImp.set(l.codigo, [...(porImp.get(l.codigo) ?? []), l]))
  const imps = b.importaciones.filter((i) => i.enviado && !i.cerrada)
  const ordAb = b.ordenes.filter((o) => o.estado === 'Abierta' && (!w || [o.modelo, o.productoNombre, o.producto, o.codigo, o.defecto].join(' ').toLowerCase().includes(w)))
  const ordCe = b.ordenes.filter((o) => o.estado !== 'Abierta' && (!w || [o.modelo, o.productoNombre, o.producto, o.codigo].join(' ').toLowerCase().includes(w)))

  return (
    <div className="rc">
      <div className="rc-barra">
        <div className="rc-buscar"><Search /><input placeholder={area === 'st' ? 'Buscar orden, producto o importación…' : 'Buscar producto, serie o importación…'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button type="button" className="rc-btn" onClick={cargar} title="Actualizar"><RefreshCw />Actualizar</button>
      </div>

      {area === 'bodega' && <>
        {imps.length > 0 && <div className="rc-imps">{imps.map((i) => (
          <div key={i.codigo} className="rc-imp">
            <div className="rc-imp-t"><b>{i.nombre}</b><small>{i.codigo} · {i.etapa}{i.eta ? ' · llega ' + dfecha(i.eta) : ''}</small></div>
            <div className="rc-prog"><i style={{ width: (i.esperada ? Math.round(((i.aprobada + i.noReparable) / i.esperada) * 100) : 0) + '%' }} /></div>
            <small className="rc-sub">{i.aprobada} de {i.esperada} en inventario · {i.porRecibir} por recibir · {i.pendiente} por revisar{i.enST ? ' · ' + i.enST + ' en Servicio Técnico' : ''}{i.devuelta ? ' · ' + i.devuelta + ' devueltas' : ''}{i.sinIdentificar ? ' · ' + i.sinIdentificar + ' sin identificar por Marketing' : ''}</small>
            {editar && <div className="rc-acc">
              {i.etapa !== 'En bodega' && <button type="button" className="rc-btn rc-p" onClick={async () => { const { error: e } = await supabase.rpc('rec_llegada', { p_codigo: i.codigo }); if (e) aviso(e.message); else hecho('Llegada registrada') }}><Truck />Registrar llegada</button>}
              {b.puedeEliminar && i.recibida === 0 && <button type="button" className="rc-btn rc-rojo" onClick={() => setHoja({ k: 'quitar', i })}><Trash2 />Quitar</button>}
            </div>}
          </div>))}</div>}
        {!lineas.length && <p className="rc-vacio">No hay productos por recibir ni por revisar.</p>}
        {[...porImp.entries()].map(([cod, ls]) => (
          <section key={cod} className="rc-grupo">
            <h4>{ls[0].impNombre} <small>{cod}</small></h4>
            {ls.map((l) => (
              <article key={l.itemId} className="rc-linea">
                {l.imagen ? <img className="rc-foto" src={l.imagen} alt="" loading="lazy" /> : <span className="rc-foto rc-sinfoto"><PackageOpen /></span>}
                <div className="rc-info">
                  <b>{nombreLinea(l)}</b>
                  <small>{l.producto}{l.modelo && l.modelo !== l.producto ? ' · ' + l.modelo : ''}{l.marca ? ' · ' + l.marca : ''}</small>
                  <div className="rc-chips">
                    <span>Esperadas {l.esperada}</span>{l.porRecibir > 0 && <span className="am">Por recibir {l.porRecibir}</span>}{l.pendiente > 0 && <span className="az">Por revisar {l.pendiente}</span>}
                    {l.aprobada > 0 && <span className="ok">En inventario {l.aprobada}</span>}{l.enST > 0 && <span className="vi">En Serv. Técnico {l.enST}</span>}{l.devuelta > 0 && <span className="az">Devueltas {l.devuelta}</span>}{l.faltante > 0 && <span className="ro">Faltantes {l.faltante}</span>}
                  </div>
                </div>
                <div className="rc-acc">
                  {editar && (l.porRecibir > 0 || l.pendiente > 0) && <button type="button" className="rc-btn rc-p" onClick={() => setHoja({ k: 'revisar', l })}><PackageCheck />Revisar</button>}
                  {editar && l.devuelta > 0 && <button type="button" className="rc-btn rc-p" onClick={() => setHoja({ k: 'devuelta', l })}><Wrench />Revisar devueltas</button>}
                  <button type="button" className="rc-btn" onClick={() => setHoja({ k: 'hist', codigo: l.codigo, itemId: l.itemId, titulo: nombreLinea(l) })}><History />Historial</button>
                </div>
              </article>))}
          </section>))}
        {ordAb.length > 0 && <section className="rc-grupo"><h4>En Servicio Técnico <small>{ordAb.length} orden(es) abiertas</small></h4>
          {ordAb.map((o) => <div key={o.id} className="rc-orden"><b>{o.productoNombre || o.modelo}</b><small>{o.id} · {o.cantidad} u. · {o.tipoDano || 'Defecto'} · hace {o.dias} día(s)</small></div>)}</section>}
      </>}

      {area === 'st' && <>
        {!ordAb.length && <p className="rc-vacio">No hay equipos de importación esperando a Servicio Técnico.</p>}
        {ordAb.map((o) => <OrdenST key={o.id} o={o} editar={editar} resultado={() => setHoja({ k: 'st', o })} historial={() => setHoja({ k: 'hist', codigo: o.codigo, itemId: o.itemId, titulo: o.productoNombre || o.modelo })} />)}
        {b.lineas.filter((l) => l.noReparable > 0).length > 0 && <section className="rc-grupo"><h4>No reparables <small>decisión pendiente</small></h4>
          {b.lineas.filter((l) => l.noReparable > 0).map((l) => <div key={l.itemId} className="rc-orden"><b>{nombreLinea(l)}</b><small>{l.codigo} · {l.noReparable} u. no reparables</small></div>)}</section>}
        {ordCe.length > 0 && <section className="rc-grupo"><button type="button" className="rc-plegar" onClick={() => setAbiertas((x) => ({ ...x, cerradas: !x.cerradas }))}>{abiertas.cerradas ? <ChevronUp /> : <ChevronDown />}Órdenes cerradas ({ordCe.length})</button>
          {abiertas.cerradas && ordCe.slice(0, 60).map((o) => <OrdenST key={o.id} o={o} editar={false} resultado={() => undefined} historial={() => setHoja({ k: 'hist', codigo: o.codigo, itemId: o.itemId, titulo: o.productoNombre || o.modelo })} />)}</section>}
      </>}

      {area === 'marketing' && <>
        {!lineas.length && <p className="rc-vacio">No hay productos de importación por identificar.</p>}
        {[...porImp.entries()].map(([cod, ls]) => (
          <section key={cod} className="rc-grupo"><h4>{ls[0].impNombre} <small>{cod}</small></h4>
            {ls.map((l) => (
              <article key={l.itemId} className="rc-linea">
                {l.imagen ? <img className="rc-foto" src={l.imagen} alt="" loading="lazy" /> : <span className="rc-foto rc-sinfoto"><PackageOpen /></span>}
                <div className="rc-info"><b>{l.descripcion || l.modelo}</b><small>{[l.marca, l.modelo, l.categoria].filter(Boolean).join(' · ')}{l.codigoReservado ? ' · código reservado ' + l.codigoReservado : ''}</small>{l.obs && <small>{l.obs}</small>}<div className="rc-chips"><span>{l.esperada} u.</span></div></div>
                {editar && <div className="rc-acc"><button type="button" className="rc-btn rc-p" onClick={() => setHoja({ k: 'identificar', l })}><Check />Identificar</button></div>}
              </article>))}
          </section>))}
      </>}

      {area === 'importacion' && <>
        {!b.importaciones.length && <p className="rc-vacio">No hay importaciones.</p>}
        {b.importaciones.map((i) => {
          const ls = b.lineas.filter((l) => l.codigo === i.codigo && coincide(l)), ab = !!abiertas[i.codigo]
          return (
            <section key={i.codigo} className="rc-grupo">
              <div className="rc-imp">
                <div className="rc-imp-t"><b>{i.nombre}</b><small>{i.codigo} · {i.etapa}{i.cerrada ? (i.autorizada ? ' · cerrada con autorización' : ' · recepción completa') : ''}{i.proveedor ? ' · ' + i.proveedor : ''}</small></div>
                <div className="rc-prog"><i style={{ width: (i.esperada ? Math.round(((i.aprobada + i.noReparable) / i.esperada) * 100) : 0) + '%' }} /></div>
                <small className="rc-sub">{i.esperada} esperadas · {i.recibida} recibidas · {i.aprobada} en inventario · {i.porRecibir} por recibir · {i.pendiente} por revisar · {i.enST} en Servicio Técnico · {i.devuelta} devueltas · {i.noReparable} no reparables{i.sinIdentificar ? ' · ' + i.sinIdentificar + ' sin identificar' : ''}</small>
                <div className="rc-acc">
                  <button type="button" className="rc-btn" onClick={() => setAbiertas((x) => ({ ...x, [i.codigo]: !ab }))}>{ab ? <ChevronUp /> : <ChevronDown />}{ab ? 'Ocultar líneas' : 'Ver líneas'}</button>
                  {b.aprueba && !!i.enviado && !i.cerrada && <button type="button" className="rc-btn rc-rojo" onClick={() => setHoja({ k: 'cierre', i })}><AlertTriangle />Cierre autorizado</button>}
                </div>
              </div>
              {ab && <div className="rc-tabla"><table><thead><tr><th>Producto</th><th>Esp.</th><th>Rec.</th><th>Por recibir</th><th>Por revisar</th><th>Inventario</th><th>Serv. Téc.</th><th>Devueltas</th><th>No rep.</th><th /></tr></thead>
                <tbody>{ls.map((l) => <tr key={l.itemId} className={l.resuelta ? 'ok' : ''}><td><b>{nombreLinea(l)}</b><small>{l.producto || 'sin identificar'}</small></td><td>{l.esperada}</td><td>{l.recibida}</td><td>{l.porRecibir}</td><td>{l.pendiente}</td><td>{l.aprobada}</td><td>{l.enST}</td><td>{l.devuelta}</td><td>{l.noReparable}</td>
                  <td><button type="button" className="rc-btn" onClick={() => setHoja({ k: 'hist', codigo: l.codigo, itemId: l.itemId, titulo: nombreLinea(l) })} aria-label="Historial"><History /></button></td></tr>)}</tbody></table></div>}
            </section>)
        })}
        {b.historial.length > 0 && <section className="rc-grupo"><button type="button" className="rc-plegar" onClick={() => setAbiertas((x) => ({ ...x, hist: !x.hist }))}>{abiertas.hist ? <ChevronUp /> : <ChevronDown />}Últimas operaciones ({b.historial.length})</button>
          {abiertas.hist && <div className="rc-ops">{b.historial.slice(0, 120).map((o) => <OpFila key={o.id} o={o} />)}</div>}</section>}
      </>}

      {hoja?.k === 'revisar' && <Revisar l={hoja.l} devuelta={false} cerrar={() => setHoja(null)} listo={hecho} />}
      {hoja?.k === 'devuelta' && <Revisar l={hoja.l} devuelta cerrar={() => setHoja(null)} listo={hecho} />}
      {hoja?.k === 'st' && <ResultadoST o={hoja.o} perfil={perfil} cerrar={() => setHoja(null)} listo={hecho} />}
      {hoja?.k === 'hist' && <Historial codigo={hoja.codigo} itemId={hoja.itemId} titulo={hoja.titulo} cerrar={() => setHoja(null)} />}
      {hoja?.k === 'identificar' && <Identificar l={hoja.l} categorias={b.categorias} cerrar={() => setHoja(null)} listo={hecho} />}
      {hoja?.k === 'cierre' && <Motivo titulo={'Cierre autorizado · ' + hoja.i.codigo} ayuda="La recepción se cierra aunque queden cantidades pendientes. Queda registrado quién y por qué." boton="Cerrar recepción"
        cerrar={() => setHoja(null)} enviar={async (m) => { const { error: e } = await supabase.rpc('rec_cierre_autorizado', { p_codigo: hoja.i.codigo, p_motivo: m }); if (e) throw e; await hecho('Recepción cerrada con autorización') }} />}
      {hoja?.k === 'quitar' && <Motivo titulo={'Quitar ' + hoja.i.codigo} ayuda="La importación sale de Bodega, Servicio Técnico, Marketing e Importaciones. Queda en la papelera de Importaciones." boton="Quitar importación"
        cerrar={() => setHoja(null)} enviar={async (m) => { const { error: e } = await supabase.rpc('rec_eliminar_importacion', { p_codigo: hoja.i.codigo, p_motivo: m }); if (e) throw e; await hecho('Importación quitada') }} />}
    </div>
  )
}

function OpFila({ o }: { o: Op }) {
  const c = o.c || {}
  const partes = [c.rec ? 'recibidas ' + c.rec : '', c.aprob ? 'aprobadas ' + c.aprob : '', c.st && c.st > 0 ? 'a Serv. Técnico ' + c.st : '', c.dev && c.dev > 0 ? 'devueltas ' + c.dev : '', c.noRep ? 'no reparables ' + c.noRep : '', c.falt ? 'faltantes ' + c.falt : ''].filter(Boolean)
  const T: Record<string, string> = { REVISION: 'Revisión de Bodega', REREVISION: 'Revisión tras Servicio Técnico', ST_RESULTADO: 'Resultado de Servicio Técnico', IDENTIFICACION: 'Identificación de Marketing' }
  return <div className="rc-op"><small>{dfecha(o.fecha)} · {o.por}</small><b>{T[o.tipo] ?? o.tipo}{o.codigo ? ' · ' + o.codigo : ''}{o.producto ? ' · ' + o.producto : ''}</b>{partes.length > 0 && <span>{partes.join(' · ')}</span>}{o.destino && <span>→ {o.destino}</span>}{o.obs && <span className="rc-gris">{o.obs}</span>}</div>
}

function OrdenST({ o, editar, resultado, historial }: { o: Orden; editar: boolean; resultado: () => void; historial: () => void }) {
  return (
    <article className="rc-linea">
      {o.imagen ? <img className="rc-foto" src={o.imagen} alt="" loading="lazy" /> : <span className="rc-foto rc-sinfoto"><Wrench /></span>}
      <div className="rc-info">
        <b>{o.productoNombre || o.modelo}</b>
        <small>{o.id} · {o.codigo} · {o.cantidad} u.{o.series?.length ? ' · series ' + o.series.join(', ') : ''}</small>
        <div className="rc-chips"><span className={o.estado === 'Abierta' ? 'vi' : 'ok'}>{o.estado === 'Abierta' ? 'Abierta · ' + o.dias + ' día(s)' : 'Cerrada ' + dfecha(o.devolucion)}</span>{o.tipoDano && <span className="ro">{o.tipoDano}</span>}</div>
        {o.detalle && <small>{o.detalle}</small>}
        {o.estado !== 'Abierta' && <small>{o.reparadas} reparada(s) · {o.noReparables} no reparable(s) · {o.tecnico}{o.diagnostico ? ' · ' + o.diagnostico : ''}</small>}
        {o.evidencias?.some((e) => e.fotos?.length) && <div className="rc-minis">{o.evidencias.flatMap((e) => e.fotos ?? []).slice(0, 8).map((f, i) => <Miniatura key={i} ruta={f} />)}</div>}
      </div>
      <div className="rc-acc">
        {editar && o.estado === 'Abierta' && <button type="button" className="rc-btn rc-p" onClick={resultado}><Check />Registrar resultado</button>}
        <button type="button" className="rc-btn" onClick={historial}><History />Historial</button>
      </div>
    </article>
  )
}

/* ---------- Fotos: subir con la cámara o desde archivos ---------- */
function useFotos(carpeta: string) {
  const subir = useCallback(async (files: File[], poner: (f: (x: Foto[]) => Foto[]) => void) => {
    for (const f of files.slice(0, 12)) {
      const id = crypto.randomUUID(), vista = URL.createObjectURL(f)
      poner((x) => [...x, { id, ruta: '', vista, estado: 'subiendo' }])
      try { const ruta = await subirFoto(f, carpeta); poner((x) => x.map((y) => (y.id === id ? { ...y, ruta, estado: 'ok' } : y))) }
      catch { poner((x) => x.map((y) => (y.id === id ? { ...y, estado: 'error' } : y))) }
    }
  }, [carpeta])
  return subir
}
function BotonFoto({ subir, texto = 'Foto' }: { subir: (f: File[]) => void; texto?: string }) {
  return <label className="rc-btn"><Camera />{texto}<input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) subir(f) }} /></label>
}
function ListaFotos({ fotos, quitar }: { fotos: Foto[]; quitar: (id: string) => void }) {
  if (!fotos.length) return null
  return <div className="rc-minis">{fotos.map((f) => <span key={f.id} className={'rc-mini' + (f.estado === 'error' ? ' err' : '')}><img src={f.vista} alt="Evidencia" />{f.estado === 'subiendo' && <span className="rc-spin" />}<button type="button" aria-label="Quitar foto" onClick={() => quitar(f.id)}><X /></button></span>)}</div>
}

/* ---------- Bodega: revisar (por partes) y revisar lo devuelto ---------- */
function Revisar({ l, devuelta, cerrar, listo }: { l: Linea; devuelta: boolean; cerrar: () => void; listo: (t: string) => Promise<void> }) {
  const op = useRef(nuevoOp())
  const subirF = useFotos(l.codigo + '-' + l.itemId)
  const [rec, setRec] = useState(devuelta ? 0 : l.porRecibir)
  const [falt, setFalt] = useState(0)
  const [sinSerie, setSinSerie] = useState(!!l.sinSerie)
  const [aSS, setASS] = useState(0)
  const [dSS, setDSS] = useState(0)
  const [lote, setLote] = useState<Foto[]>([])
  const [tipo, setTipo] = useState(TIPOS_DANO[1])
  const [defecto, setDefecto] = useState('')
  const [obs, setObs] = useState('')
  const [filas, setFilas] = useState<Fila[]>([])
  const [scan, setScan] = useState<number | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  const total = devuelta ? l.devuelta : l.pendiente + Math.max(0, Math.min(rec, l.porRecibir))
  // Las filas siguen al total; las series que registró el proveedor (o las devueltas por Servicio Técnico) quedan sugeridas
  useEffect(() => {
    setFilas((x) => {
      const fijas = devuelta ? l.seriesDevueltas : []
      const r = x.slice(0, total)
      while (r.length < total) { const k = r.length; r.push({ serie: fijas[k] ?? '', estado: '', fotos: [], obs: '', tipo: TIPOS_DANO[1], fija: !!fijas[k] }) }
      return r
    })
  }, [total, devuelta, l.seriesDevueltas])
  const poner = (i: number, c: Partial<Fila>) => setFilas((x) => x.map((f, k) => (k === i ? { ...f, ...c } : f)))
  const fotosFila = (i: number) => (fn: (x: Foto[]) => Foto[]) => setFilas((x) => x.map((f, k) => (k === i ? { ...f, fotos: fn(f.fotos) } : f)))
  const completa = (f: Fila) => !!f.estado && !!serieNorm(f.serie) && f.fotos.some((x) => x.estado === 'ok') && (f.estado !== 'def' || !!f.obs.trim())
  const listas = filas.filter(completa)
  const a = sinSerie ? aSS : listas.filter((f) => f.estado === 'ok').length
  const def = sinSerie ? dSS : listas.filter((f) => f.estado === 'def').length
  const subiendo = lote.some((f) => f.estado === 'subiendo') || filas.some((f) => f.fotos.some((x) => x.estado === 'subiendo'))
  const sugeridas = useMemo(() => (devuelta ? l.seriesDevueltas : l.series) ?? [], [devuelta, l])

  async function guardar() {
    setErr('')
    if (subiendo) { setErr('Espera a que terminen de subir las fotos.'); return }
    if (!sinSerie) {
      const vistas = new Set<string>()
      for (const f of listas) { const s = serieNorm(f.serie); if (vistas.has(s)) { setErr('La serie ' + s + ' está repetida.'); return } vistas.add(s) }
    }
    if (a + def > total) { setErr('Clasificas ' + (a + def) + ' unidades y solo hay ' + total + ' por revisar.'); return }
    if (!devuelta && rec === 0 && a === 0 && def === 0 && falt === 0) { setErr('Indica cuántas recibiste o completa al menos un equipo (serie, foto y Bien o Defecto).'); return }
    if (devuelta && a === 0 && def === 0) { setErr('Completa al menos un equipo (serie, foto y Bien o Defecto).'); return }
    if (sinSerie && a + def > 0 && !lote.some((f) => f.estado === 'ok')) { setErr('Sube al menos una foto de evidencia de la revisión.'); return }
    const defs = listas.filter((f) => f.estado === 'def')
    const tipoDano = sinSerie ? tipo : (defs[0]?.tipo || tipo)
    const textoDef = sinSerie ? defecto : defs.map((f) => serieNorm(f.serie) + (f.tipo !== tipoDano ? ' (' + f.tipo + ')' : '') + ': ' + f.obs.trim()).join(' | ')
    if (def > 0 && !textoDef.trim()) { setErr(devuelta ? 'Describe el defecto que persiste.' : 'Describe el defecto encontrado.'); return }
    const d: Record<string, unknown> = { opId: op.current, aprobadas: a, defectos: def, tipoDano, defecto: textoDef, obs, sinSerie,
      fotos: lote.filter((f) => f.estado === 'ok').map((f) => f.ruta),
      unidades: sinSerie ? [] : listas.map((f) => ({ serie: serieNorm(f.serie), estado: f.estado, fotos: f.fotos.filter((x) => x.estado === 'ok').map((x) => x.ruta), obs: f.obs.trim(), tipo: f.estado === 'def' ? f.tipo : '' })) }
    if (!devuelta) { d.recibidas = rec; d.faltantes = falt }
    setOcupado(true)
    const { data, error } = await supabase.rpc(devuelta ? 'rec_revisar_devuelta' : 'rec_revisar', { p_codigo: l.codigo, p_item: l.itemId, d })
    setOcupado(false)
    if (error) { setErr(error.message); return }
    const r = data as { orden?: string | null; repetida?: boolean }
    const pend = total - a - def
    await listo(r?.repetida ? 'Esta revisión ya se había guardado.' : 'Revisión guardada: ' + a + ' al inventario' + (def ? ', ' + def + ' a Servicio Técnico' + (r?.orden ? ' (' + r.orden + ')' : '') : '') + (pend > 0 && !sinSerie ? ', ' + pend + ' quedan por revisar' : '') + '.')
  }

  return (
    <Ventana titulo={(devuelta ? 'Revisar lo devuelto · ' : 'Revisar · ') + nombreLinea(l)} cerrar={cerrar} ancho={720}
      pie={<><button type="button" className="rc-btn" onClick={cerrar}>Cancelar</button><button type="button" className="rc-btn rc-p rc-grande" disabled={ocupado || subiendo} onClick={guardar}>{ocupado ? 'Guardando…' : subiendo ? 'Subiendo fotos…' : `Guardar ${a + def} equipo(s)`}</button></>}>
      <p className="rc-nota">{l.producto} · {l.codigo}{devuelta ? ` · ${l.devuelta} devuelta(s) por Servicio Técnico` : ` · esperadas ${l.esperada} · por recibir ${l.porRecibir} · por revisar ${l.pendiente}`}</p>
      {!devuelta && <div className="rc-fila3">
        <label className="rc-f">Recibidas ahora<input type="number" min={0} max={l.porRecibir} className="rc-in" value={rec} onChange={(e) => setRec(Math.max(0, Math.min(l.porRecibir, Math.floor(Number(e.target.value) || 0))))} /></label>
        <label className="rc-f">Faltantes<input type="number" min={0} max={Math.max(0, l.porRecibir - rec)} className="rc-in" value={falt} onChange={(e) => setFalt(Math.max(0, Math.min(l.porRecibir - rec, Math.floor(Number(e.target.value) || 0))))} /></label>
        <div className="rc-f">Por revisar<b className="rc-num">{total}</b></div>
      </div>}
      <label className="rc-check"><input type="checkbox" checked={sinSerie} onChange={(e) => setSinSerie(e.target.checked)} />Este producto no tiene número de serie (fotos del lote)</label>
      {sinSerie ? <div className="rc-sec">
        <div className="rc-fila3">
          <label className="rc-f">Aprobadas<input type="number" min={0} className="rc-in" value={aSS} onChange={(e) => setASS(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></label>
          <label className="rc-f">Con defecto<input type="number" min={0} className="rc-in" value={dSS} onChange={(e) => setDSS(Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></label>
          <div className="rc-f">Quedan por revisar<b className="rc-num">{Math.max(0, total - aSS - dSS)}</b></div>
        </div>
        {dSS > 0 && <div className="rc-fila2"><label className="rc-f">Tipo de daño<select className="rc-in" value={tipo} onChange={(e) => setTipo(e.target.value)}>{TIPOS_DANO.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="rc-f">{devuelta ? 'Qué defecto persiste' : 'Qué defecto tiene'}<input className="rc-in" value={defecto} onChange={(e) => setDefecto(e.target.value)} /></label></div>}
        <div className="rc-fotos"><BotonFoto texto="Fotos del lote" subir={(f) => subirF(f, setLote)} /><ListaFotos fotos={lote} quitar={(id) => setLote((x) => x.filter((y) => y.id !== id))} /></div>
      </div> : <div className="rc-sec">
        <p className="rc-nota">Completa cada equipo: serie, foto y <b>Bien</b> o <b>Defecto</b>. Se guardan solo los completos; los demás quedan por revisar para después.</p>
        <datalist id={'rc-series-' + l.itemId}>{sugeridas.map((s) => <option key={s} value={s} />)}</datalist>
        {filas.map((f, i) => (
          <div key={i} className={'rc-eq' + (completa(f) ? ' listo' : '') + (f.estado === 'def' ? ' def' : '')}>
            <span className="rc-eq-n">{i + 1}</span>
            <div className="rc-eq-c">
              <div className="rc-eq-l">
                <input className="rc-in rc-serie" placeholder="Número de serie" list={'rc-series-' + l.itemId} value={f.serie} readOnly={f.fija} onChange={(e) => poner(i, { serie: e.target.value })} onBlur={(e) => poner(i, { serie: serieNorm(e.target.value) })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const sig = (e.currentTarget.closest('.rc-sec')?.querySelectorAll('input.rc-serie') ?? [])[i + 1] as HTMLInputElement | undefined; sig?.focus() } }} />
                {!f.fija && <button type="button" className="rc-btn" aria-label="Escanear serie" onClick={() => setScan(i)}><ScanLine /></button>}
                <BotonFoto subir={(x) => subirF(x, fotosFila(i))} />
                <div className="rc-seg"><button type="button" className={f.estado === 'ok' ? 'on ok' : ''} onClick={() => poner(i, { estado: 'ok' })}>Bien</button><button type="button" className={f.estado === 'def' ? 'on def' : ''} onClick={() => poner(i, { estado: 'def' })}>Defecto</button></div>
              </div>
              <ListaFotos fotos={f.fotos} quitar={(id) => fotosFila(i)((x) => x.filter((y) => y.id !== id))} />
              {f.estado === 'def' && <div className="rc-fila2"><select className="rc-in" value={f.tipo} onChange={(e) => poner(i, { tipo: e.target.value })} aria-label="Tipo de daño">{TIPOS_DANO.map((t) => <option key={t}>{t}</option>)}</select>
                <input className={'rc-in' + (f.obs.trim() ? '' : ' falta')} placeholder="Observación (obligatoria)" value={f.obs} onChange={(e) => poner(i, { obs: e.target.value })} /></div>}
            </div>
          </div>))}
        {!filas.length && <p className="rc-nota">No hay equipos por revisar todavía: indica cuántos recibiste.</p>}
      </div>}
      <label className="rc-f">Observación general (opcional)<textarea className="rc-in" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
      <p className="rc-resumen">Se guardan: <b>{a}</b> al inventario · <b>{def}</b> a Servicio Técnico{!devuelta && <> · <b>{Math.max(0, total - a - def)}</b> quedan por revisar{falt ? <> · <b>{falt}</b> faltantes</> : null}</>}</p>
      {err && <p className="rc-error">{err}</p>}
      {scan !== null && <Escaner cerrar={() => setScan(null)} leido={(t) => { poner(scan, { serie: serieNorm(t) }); setScan(null) }} />}
    </Ventana>
  )
}

/* ---------- Servicio Técnico: resultado ---------- */
function ResultadoST({ o, perfil, cerrar, listo }: { o: Orden; perfil: Perfil; cerrar: () => void; listo: (t: string) => Promise<void> }) {
  const op = useRef(nuevoOp())
  const subirF = useFotos('st-' + o.id)
  const [ok, setOk] = useState(o.cantidad)
  const [f, setF] = useState({ tecnico: perfil.nombre, diagnostico: '', trabajo: '', repuestos: '', pruebas: '', recomendaciones: '' })
  const [fotos, setFotos] = useState<Foto[]>([])
  const [adj, setAdj] = useState<{ url: string; nombre: string } | null>(null)
  const [subiendoAdj, setSubiendoAdj] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  const nr = o.cantidad - ok
  async function guardar() {
    setErr('')
    if (fotos.some((x) => x.estado === 'subiendo') || subiendoAdj) { setErr('Espera a que terminen de subir los archivos.'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('rec_resultado_st', { p_orden: o.id, d: { opId: op.current, reparadas: ok, noReparables: nr, ...f, fotos: fotos.filter((x) => x.estado === 'ok').map((x) => x.ruta), adjunto: adj } })
    setOcupado(false)
    if (error) { setErr(error.message); return }
    await listo('Resultado guardado: ' + ok + ' vuelven a Bodega' + (nr ? ', ' + nr + ' no reparable(s)' : '') + '.')
  }
  const campo = (k: keyof typeof f, t: string, filas = 2) => <label className="rc-f">{t}<textarea className="rc-in" rows={filas} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  return (
    <Ventana titulo={'Resultado · ' + (o.productoNombre || o.modelo)} cerrar={cerrar} ancho={640}
      pie={<><button type="button" className="rc-btn" onClick={cerrar}>Cancelar</button><button type="button" className="rc-btn rc-p rc-grande" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar resultado'}</button></>}>
      <p className="rc-nota">{o.id} · {o.cantidad} unidad(es) · {o.defecto}</p>
      {o.evidencias?.length > 0 && <div className="rc-minis">{o.evidencias.flatMap((e) => e.fotos ?? []).map((x, i) => <Miniatura key={i} ruta={x} />)}</div>}
      <div className="rc-fila3">
        <label className="rc-f">Reparadas (vuelven a Bodega)<input type="number" min={0} max={o.cantidad} className="rc-in" value={ok} onChange={(e) => setOk(Math.max(0, Math.min(o.cantidad, Math.floor(Number(e.target.value) || 0))))} /></label>
        <div className="rc-f">No reparables<b className="rc-num">{nr}</b></div>
        <label className="rc-f">Técnico<input className="rc-in" value={f.tecnico} onChange={(e) => setF({ ...f, tecnico: e.target.value })} /></label>
      </div>
      {campo('diagnostico', 'Diagnóstico')}{campo('trabajo', ok ? 'Trabajo realizado' : 'Trabajo realizado (opcional)')}
      <div className="rc-fila2">{campo('repuestos', 'Repuestos usados', 1)}{campo('pruebas', 'Pruebas', 1)}</div>
      {campo('recomendaciones', 'Recomendaciones', 1)}
      <div className="rc-fotos"><BotonFoto texto="Fotos del trabajo" subir={(x) => subirF(x, setFotos)} /><ListaFotos fotos={fotos} quitar={(id) => setFotos((x) => x.filter((y) => y.id !== id))} />
        <label className="rc-btn"><Paperclip />{subiendoAdj ? 'Subiendo…' : adj ? adj.nombre : 'Adjuntar informe (PDF)'}<input type="file" accept="application/pdf,image/*" hidden onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
          if (file.size > 20 * 1048576) { setErr('El archivo supera 20 MB.'); return }
          setSubiendoAdj(true)
          const ruta = `st/${o.id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, '_').slice(0, 60)}`
          const { error } = await supabase.storage.from('importaciones').upload(ruta, file, { contentType: file.type || 'application/octet-stream' })
          setSubiendoAdj(false)
          if (error) setErr(error.message); else setAdj({ url: ruta, nombre: file.name.slice(0, 120) })
        }} /></label></div>
      {err && <p className="rc-error">{err}</p>}
    </Ventana>
  )
}

/* ---------- Historial de una línea ---------- */
function Historial({ codigo, itemId, titulo, cerrar }: { codigo: string; itemId: string; titulo: string; cerrar: () => void }) {
  const [h, setH] = useState<{ equipos: { serie: string; estado: string; fotos: string[]; fecha: string; por: string; defecto: string }[]; operaciones: Op[]; ordenes: Orden[] } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { supabase.rpc('rec_historial_linea', { p_codigo: codigo, p_item: itemId }).then(({ data, error }) => { if (error) setErr(error.message); else setH(data as never) }) }, [codigo, itemId])
  return (
    <Ventana titulo={'Historial · ' + titulo} cerrar={cerrar} ancho={680}>
      {err && <p className="rc-error">{err}</p>}
      {!h && !err && <p className="rc-vacio"><span className="rc-spin" /> Cargando…</p>}
      {h && <>
        <h4 className="rc-h">Equipos ({h.equipos.length})</h4>
        {!h.equipos.length && <p className="rc-nota">Sin equipos con serie registrados.</p>}
        {h.equipos.map((e) => <div key={e.serie} className="rc-op"><b className="rc-mono">{e.serie}</b><span>{e.estado}{e.por ? ' · revisó ' + e.por : ''}{e.fecha ? ' · ' + dfecha(e.fecha) : ''}</span>{e.defecto && <span className="rc-gris">{e.defecto}</span>}{e.fotos.length > 0 && <div className="rc-minis">{e.fotos.slice(0, 6).map((f, i) => <Miniatura key={i} ruta={f} />)}</div>}</div>)}
        <h4 className="rc-h">Órdenes de Servicio Técnico ({h.ordenes.length})</h4>
        {h.ordenes.map((o) => <div key={o.id} className="rc-op"><b>{o.id} · {o.estado}</b><span>{o.cantidad} u. · {o.defecto}</span>{o.estado !== 'Abierta' && <span>{o.reparadas} reparada(s) · {o.noReparables} no reparable(s) · {o.tecnico} · {o.diagnostico}</span>}{o.adjunto?.url && <AdjuntoLink a={o.adjunto} />}</div>)}
        <h4 className="rc-h">Operaciones ({h.operaciones.length})</h4>
        {h.operaciones.map((o) => <OpFila key={o.id} o={o} />)}
      </>}
    </Ventana>
  )
}
function AdjuntoLink({ a }: { a: { url: string; nombre: string } }) { const url = useUrl(a.url); return url ? <a className="rc-link" href={url} target="_blank" rel="noopener noreferrer"><Paperclip />{a.nombre}</a> : null }

/* ---------- Marketing: identificar el producto ---------- */
function Identificar({ l, categorias, cerrar, listo }: { l: Linea; categorias: string[]; cerrar: () => void; listo: (t: string) => Promise<void> }) {
  const [modo, setModo] = useState<'existente' | 'nuevo'>(l.codigoReservado ? 'nuevo' : 'existente')
  const [busca, setBusca] = useState(l.modelo || l.descripcion)
  const [res, setRes] = useState<{ codigo: string; nombre: string; imagen_url: string | null }[]>([])
  const [sel, setSel] = useState('')
  const [f, setF] = useState({ codigo: l.codigoReservado, nombre: '', categoria: categorias.find((c) => c.toLowerCase() === l.categoria.toLowerCase()) ?? '', marca: l.marca, imagen: l.imagen })
  const [codInt, setCodInt] = useState(l.modelo && l.modelo !== l.descripcion && l.modelo.length <= 60 ? l.modelo : '')
  const [editCod, setEditCod] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (modo !== 'existente') return
    const t = setTimeout(async () => {
      const w = busca.trim(); if (w.length < 2) { setRes([]); return }
      const { data } = await supabase.from('productos').select('codigo,nombre,imagen_url').is('deleted_at', null).or(`codigo.ilike.%${w.replace(/[%,()]/g, ' ')}%,nombre.ilike.%${w.replace(/[%,()]/g, ' ')}%,codigo_unico.ilike.%${w.replace(/[%,()]/g, ' ')}%`)
        .order('en_vista_publica', { ascending: false }).order('nombre').limit(20)
      setRes((data as never) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [busca, modo])
  async function guardar() {
    setErr('')
    if (modo === 'existente' && !sel) { setErr('Elige un producto existente de la lista.'); return }
    setOcupado(true)
    const d = modo === 'existente' ? { modo, producto: sel, codInterno: codInt, codInternoEditado: editCod } : { modo, ...f, codInterno: codInt, codInternoEditado: editCod }
    const { data, error } = await supabase.rpc('rec_identificar', { p_codigo: l.codigo, p_item: l.itemId, d })
    setOcupado(false)
    if (error) { setErr(error.message); return }
    await listo('Producto identificado: ' + (data as { producto: string }).producto)
  }
  return (
    <Ventana titulo={'Identificar · ' + (l.descripcion || l.modelo)} cerrar={cerrar} ancho={620}
      pie={<><button type="button" className="rc-btn" onClick={cerrar}>Cancelar</button><button type="button" className="rc-btn rc-p rc-grande" disabled={ocupado || subiendo} onClick={guardar}>{ocupado ? 'Guardando…' : modo === 'existente' ? 'Vincular producto' : 'Crear producto'}</button></>}>
      <p className="rc-nota">{[l.marca, l.modelo, l.categoria].filter(Boolean).join(' · ')} · {l.esperada} u. · {l.codigo}</p>
      <div className="rc-seg rc-seg-g"><button type="button" className={modo === 'existente' ? 'on' : ''} onClick={() => setModo('existente')}>Producto existente</button><button type="button" className={modo === 'nuevo' ? 'on' : ''} onClick={() => setModo('nuevo')}>Producto nuevo</button></div>
      {modo === 'existente' ? <>
        <div className="rc-buscar"><Search /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código, nombre o código interno" /></div>
        <div className="rc-res">{res.map((p) => <button key={p.codigo} type="button" className={'rc-resp' + (sel === p.codigo ? ' on' : '')} onClick={() => setSel(p.codigo)}>{p.imagen_url ? <img src={p.imagen_url} alt="" /> : <PackageOpen />}<span><b>{p.nombre}</b><small>{p.codigo}</small></span></button>)}
          {busca.trim().length >= 2 && !res.length && <p className="rc-nota">Sin resultados. Si es un producto nuevo, elige "Producto nuevo".</p>}</div>
      </> : <>
        <div className="rc-fila2">
          <label className="rc-f">Código<span className="rc-in-g"><input className="rc-in" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value.toUpperCase() })} placeholder="EQM-140" />
            <button type="button" className="rc-btn" disabled={!f.categoria} title="Sugerir el siguiente código de la categoría" onClick={async () => { const { data, error } = await supabase.rpc('rec_sugerir_codigo', { p_categoria: f.categoria }); if (error) setErr(error.message); else if (data) setF((x) => ({ ...x, codigo: String(data) })); else setErr('No hay un código para sugerir en esa categoría.') }}>Sugerir</button></span></label>
          <label className="rc-f">Categoría<select className="rc-in" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}><option value="">Elige…</option>{categorias.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        {l.codigoReservado && <p className="rc-nota">Importación reservó el código {l.codigoReservado}. Si usas otro, se libera.</p>}
        <label className="rc-f">Nombre comercial<input className="rc-in" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej. Monitor de signos vitales 12 pulgadas" /></label>
        <div className="rc-fila2"><label className="rc-f">Marca<input className="rc-in" value={f.marca} onChange={(e) => setF({ ...f, marca: e.target.value })} /></label>
          <div className="rc-f">Foto del producto<span className="rc-in-g">{f.imagen && <img className="rc-foto chica" src={f.imagen} alt="" />}<label className="rc-btn"><ImagePlus />{subiendo ? 'Subiendo…' : f.imagen ? 'Cambiar' : 'Subir'}<input type="file" accept="image/*" hidden onChange={async (e) => {
            const file = e.target.files?.[0]; e.target.value = ''; if (!file) return
            setSubiendo(true); try { const url = await subirCatalogo(await imagenWebp(file), 'productos/' + (f.codigo || 'nuevo'), 'webp', 'image/webp'); setF((x) => ({ ...x, imagen: url })) } catch (er) { setErr(textoError(er)) } setSubiendo(false)
          }} /></label></span></div></div>
      </>}
      <label className="rc-f">Código interno (CÓDIGO ÚNICO){!editCod && codInt && <small className="rc-gris"> — viene del modelo de Importación</small>}
        <input className="rc-in" value={codInt} onChange={(e) => { setCodInt(e.target.value.toUpperCase()); setEditCod(true) }} placeholder="Opcional" /></label>
      {err && <p className="rc-error">{err}</p>}
    </Ventana>
  )
}

/* ---------- Motivo (cierre autorizado / quitar) ---------- */
function Motivo({ titulo, ayuda, boton, cerrar, enviar }: { titulo: string; ayuda: string; boton: string; cerrar: () => void; enviar: (m: string) => Promise<void> }) {
  const [m, setM] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  return (
    <Ventana titulo={titulo} cerrar={cerrar} ancho={480} pie={<><button type="button" className="rc-btn" onClick={cerrar}>Cancelar</button><button type="button" className="rc-btn rc-rojo rc-grande" disabled={ocupado} onClick={async () => {
      if (!m.trim()) { setErr('Escribe el motivo.'); return } setOcupado(true); setErr('')
      try { await enviar(m.trim()) } catch (e) { setErr(textoError(e)); setOcupado(false) } }}>{ocupado ? 'Guardando…' : boton}</button></>}>
      <p className="rc-nota">{ayuda}</p>
      <label className="rc-f">Motivo<textarea className="rc-in" rows={3} value={m} onChange={(e) => setM(e.target.value)} /></label>
      {err && <p className="rc-error">{err}</p>}
    </Ventana>
  )
}
