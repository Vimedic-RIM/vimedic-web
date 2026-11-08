import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BadgeCheck, Camera, Check, CheckCircle2, ClipboardList, Copy, ExternalLink, FileText, History, ListChecks, MapPin, MessageCircle, Navigation, Package, Pencil, PenLine, Phone, Radar, RefreshCw, Search, Send, Store, Truck, Upload, X, XCircle } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import '../estilos/logistica.css'

/* ============================ Tipos y constantes ============================ */
const TRANSPORTISTAS = ['Servientrega', 'Tramaco', 'Enetsa', 'Jhetro', 'Esmeraldeño', 'Terminal Terrestre', 'Laar Courier', 'Urbano', 'Otro']
const MOTIVOS_NO = ['Cliente ausente', 'Dirección errada o incompleta', 'Cliente rechazó el pedido', 'No se pudo ingresar (permiso / seguridad)', 'Producto dañado en tránsito', 'Otro']
const TIPOS_INCIDENCIA = ['Daño en tránsito', 'Pérdida', 'Retraso del transportista', 'Dirección incorrecta', 'Otro']
const VENTANAS = ['Mañana (8:00-12:00)', 'Tarde (13:00-17:00)', 'Todo el día']
const PUBLICO = 'https://vimedic.com.ec'
type Evento = { fecha: string; por: string; nota: string; publico: boolean; clave?: string }
type Incidencia = { id: string; tipo: string; detalle: string; foto: string; fecha: string; por: string; resuelta: boolean; resolucion?: string; resueltaPor?: string }
type Prod = { key: string; id: string; nombre: string; cantidad: number; series?: string[] }
type Prueba = { nombre?: string; cedula?: string; firma?: string; fotos?: string[]; lat?: number | null; lng?: number | null; nota?: string; fecha?: string; por?: string; confirmacion?: string }
type Entrega = {
  id: string; codigo: string; despacho: string; operacion: string; envioN: number; fecha: string; empresa: string; cliente: string; identificacion: string; telefono: string; email: string; asesor: string; asesorId: string | null; factura: string
  tipoEntrega: string; modalidad: string; transportista: string; entrega: Record<string, string>; productos: Prod[]; confirmacion: Record<string, string>; estado: string; chofer: string; fechaProgramada: string; ventana: string; guiaNumero: string; guiaUrl: string
  costoFlete: number; eta: string; eventos: Evento[]; prueba: Prueba; incidencias: Incidencia[]; constanciaUrl: string; fechaEntrega: string; postventaFecha: string; postventaCodigo: string; token: string; actualizado: string
}
const COLS = 'id,codigo,despacho_id,operacion_codigo,envio_numero,fecha,empresa,cliente_texto,identificacion,telefono,email,asesor_id,factura_texto,tipo_entrega,modalidad,transportista,chofer,estado,fecha_programada,ventana,guia_numero,guia_url,costo_flete,eta,constancia_url,fecha_entrega,postventa_fecha,postventa_codigo,token_seguimiento,entrega,productos,confirmacion,eventos,prueba,incidencias,updated_at,asesor:empleados!entregas_asesor_id_fkey(nombre)'
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const obj = <T,>(v: unknown): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : ({} as T))
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const slug = (v: string) => norm(v).replace(/[^a-z0-9]/g, '')
const dfecha = (iso: string) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-EC', { weekday: 'short', day: '2-digit', month: 'short' }) }
const dhora = (iso: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) }
const ymd = (iso: string) => { if (!iso) return ''; if (iso.length === 10) return iso; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const hoyYmd = () => ymd(new Date().toISOString())
const esHoy = (iso: string) => !!iso && ymd(iso) === hoyYmd()
const waNum = (t: string) => { const d = String(t || '').replace(/\D/g, ''); if (d.startsWith('593')) return d; if (d.startsWith('0')) return '593' + d.slice(1); return d.length === 9 ? '593' + d : d }
const mapear = (x: any): Entrega => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: x.id, codigo: x.codigo ?? '', despacho: x.despacho_id ?? '', operacion: x.operacion_codigo ?? '', envioN: x.envio_numero ?? 1, fecha: x.fecha, empresa: x.empresa ?? '', cliente: x.cliente_texto ?? '', identificacion: x.identificacion ?? '', telefono: x.telefono ?? '', email: x.email ?? '',
  asesor: x.asesor?.nombre ?? '', asesorId: x.asesor_id ?? null, factura: x.factura_texto ?? '', tipoEntrega: x.tipo_entrega ?? '', modalidad: x.modalidad ?? '', transportista: x.transportista ?? '', entrega: obj(x.entrega), productos: arr<Prod>(x.productos), confirmacion: obj(x.confirmacion),
  estado: x.estado ?? 'Por confirmar', chofer: x.chofer ?? '', fechaProgramada: x.fecha_programada ?? '', ventana: x.ventana ?? '', guiaNumero: x.guia_numero ?? '', guiaUrl: x.guia_url ?? '', costoFlete: Number(x.costo_flete) || 0, eta: x.eta ?? '', eventos: arr<Evento>(x.eventos),
  prueba: obj<Prueba>(x.prueba), incidencias: arr<Incidencia>(x.incidencias), constanciaUrl: x.constancia_url ?? '', fechaEntrega: x.fecha_entrega ?? '', postventaFecha: x.postventa_fecha ?? '', postventaCodigo: x.postventa_codigo ?? '', token: x.token_seguimiento ?? '', actualizado: x.updated_at ?? '',
})
const TABS: [string, string][] = [['confirmar', 'Por confirmar'], ['programadas', 'Programadas'], ['camino', 'En camino'], ['mias', 'Mis entregas'], ['entregadas', 'Entregadas'], ['incidencias', 'Con incidencia']]
const ETIQ: Record<string, string> = { entrega: 'Tipo', transporte: 'Transporte', fechaEntrega: 'Fecha pedida', ciudad: 'Ciudad', direccionEnvio: 'Dirección', direccionEntregaLocal: 'Dirección', quienRecibe: 'Recibe', telefonoEntregaLocal: 'Teléfono', nombreDestinatario: 'Destinatario', cedulaDestinatario: 'Cédula',
  telefonoDestinatario: 'Teléfono', emailDestinatario: 'Email', urlGoogleMaps: 'Ubicación', empaqueCaja: 'Empaque', empaqueArmado: 'Armado', empaqueStretch: 'Stretch', nombreRemitente: 'Remitente', cedulaRemitente: 'C.I. remitente', telefonoRemitente: 'Tel. remitente',
  pago: 'Pago', tipoPago: 'Forma de pago', plazoCredito: 'Crédito', observacionPago: 'Obs. de pago' }
const Spin = () => <span className="spin" />
function Hoja({ cerrar, children }: { cerrar: () => void; children: React.ReactNode }) { return <div className="ovl" onClick={cerrar}><div className="sheet" onClick={(e) => e.stopPropagation()}>{children}</div></div> }
function Seg({ opciones, valor, cambia }: { opciones: string[]; valor: string; cambia: (v: string) => void }) { return <div className="seg">{opciones.map((x) => <button key={x} type="button" className={x === valor ? 'on' : ''} onClick={() => cambia(valor === x && x !== '' ? '' : x)}>{x}</button>)}</div> }
function reducir(file: File): Promise<Blob> {
  return new Promise((ok, ko) => { const u = URL.createObjectURL(file), img = new Image(); img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob((b) => (b ? ok(b) : ko(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.82) }; img.onerror = () => ko(new Error('No se pudo leer la foto.')); img.src = u })
}
function Foto({ ruta }: { ruta: string }) {
  const [url, setUrl] = useState(/^https?:/i.test(ruta) ? ruta : '')
  useEffect(() => { if (!/^https?:/i.test(ruta)) supabase.storage.from('entregas').createSignedUrl(ruta, 3600).then(({ data }) => { if (data) setUrl(data.signedUrl) }) }, [ruta])
  return url ? <a href={url} target="_blank" rel="noopener"><img src={url} alt="" /></a> : <Spin />
}
async function subir(ent: Entrega, f: File | Blob, nombre: string, tipo: string): Promise<string> {
  const ruta = `${ent.id}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${nombre.replace(/[^\w.-]/g, '').slice(0, 30)}`
  const { error } = await supabase.storage.from('entregas').upload(ruta, f, { contentType: tipo }); if (error) throw new Error(error.message); return ruta
}
function Firma({ lienzo, limpiar }: { lienzo: React.RefObject<HTMLCanvasElement>; limpiar: number }) {
  useEffect(() => {
    const c = lienzo.current; if (!c) return
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; c.width = r.width * dpr; c.height = r.height * dpr
    const ctx = c.getContext('2d')!; ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b2545'; c.dataset.firmado = ''
    let dib = false; const pos = (ev: PointerEvent) => { const b = c.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top] }
    c.onpointerdown = (ev) => { dib = true; c.setPointerCapture(ev.pointerId); const [x, y] = pos(ev); ctx.beginPath(); ctx.moveTo(x, y) }
    c.onpointermove = (ev) => { if (!dib) return; const [x, y] = pos(ev); ctx.lineTo(x, y); ctx.stroke(); c.dataset.firmado = '1' }
    c.onpointerup = c.onpointercancel = () => { dib = false }
  }, [lienzo, limpiar])
  return <canvas ref={lienzo} className="firma" />
}
const firmaPng = (c: HTMLCanvasElement | null) => { if (!c || !c.dataset.firmado) return ''; const k = Math.min(1, 420 / c.width), t = document.createElement('canvas'); t.width = Math.round(c.width * k); t.height = Math.round(c.height * k); const x = t.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height); x.drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/png') }

/* ============================ Pantalla principal ============================ */
export default function Logistica({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Entrega[] | null>(null)
  const [error, setError] = useState('')
  const [equipo, setEquipo] = useState<string[]>([])
  const [tab, setTab] = useState('confirmar')
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const yaPostventa = useRef(false)
  const editar = puede(perfil, 'logistica', 'editar')

  const cargar = useCallback(async () => {
    const limite = new Date(Date.now() - 45 * 86400000).toISOString()
    const { data, error } = await supabase.from('entregas').select(COLS).is('deleted_at', null).or(`estado.neq.Entregada,fecha_entrega.gte.${limite}`).order('fecha', { ascending: true }).limit(800)
    if (error) { setError(error.message); return }
    setError(''); setLista((data ?? []).map(mapear))
  }, [])
  useEffect(() => {
    ;(async () => { if (editar && !yaPostventa.current) { yaPostventa.current = true; await supabase.rpc('lg_activar_postventas') } cargar() })()
    supabase.rpc('lg_equipo').then(({ data }) => setEquipo(((data ?? []) as { nombre: string }[]).map((x) => x.nombre)))
  }, [cargar, editar])
  useEffect(() => { const c = supabase.channel('lg-entregas').on('postgres_changes', { event: '*', schema: 'public', table: 'entregas' }, () => cargar()).subscribe(); return () => { supabase.removeChannel(c) } }, [cargar])

  const L = lista ?? []
  const enTab = (e: Entrega, t: string) => t === 'confirmar' ? e.estado === 'Por confirmar' || e.estado === 'Por reprogramar' : t === 'programadas' ? e.estado === 'Programada' : t === 'camino' ? e.estado === 'En ruta' || e.estado === 'Con transportista'
    : t === 'mias' ? e.estado !== 'Entregada' && norm(e.chofer) === norm(perfil.nombre) : t === 'entregadas' ? e.estado === 'Entregada' : t === 'incidencias' ? e.incidencias.some((i) => !i.resuelta) : true
  useEffect(() => { if (lista && tab === 'confirmar' && !L.some((e) => enTab(e, 'confirmar')) && L.some((e) => enTab(e, 'mias'))) setTab('mias') }, [lista]) // eslint-disable-line react-hooks/exhaustive-deps
  const mes = new Date().toISOString().slice(0, 7)
  const entMes = L.filter((e) => e.estado === 'Entregada' && String(e.fechaEntrega).slice(0, 7) === mes)
  const conFecha = entMes.filter((e) => e.fechaProgramada)
  const aTiempo = (e: Entrega) => new Date(e.fechaEntrega) <= new Date(e.fechaProgramada + 'T23:59:59')
  const pctTiempo = conFecha.length ? Math.round(conFecha.filter(aTiempo).length / conFecha.length * 100) + '%' : '—'
  const kpis: [string, string | number][] = [['Para hoy', L.filter((e) => e.estado !== 'Entregada' && esHoy(e.fechaProgramada)).length], ['En camino', L.filter((e) => enTab(e, 'camino')).length], ['Entregadas este mes', entMes.length], ['A tiempo', pctTiempo]]
  const w = norm(q).trim().split(/\s+/).filter(Boolean)
  const vis = L.filter((e) => enTab(e, tab) && (!w.length || w.every((x) => norm([e.cliente, e.factura, e.entrega.ciudad, e.entrega.direccionEnvio, e.guiaNumero, e.codigo, e.productos.map((p) => p.nombre).join(' '), e.chofer, e.transportista].join(' ')).includes(x))))
    .sort((a, b) => tab === 'entregadas' ? b.fechaEntrega.localeCompare(a.fechaEntrega) : (a.fechaProgramada || a.fecha).localeCompare(b.fechaProgramada || b.fecha))

  return (
    <div className="vm-lg">
      <header className="hdr text-white">
        <div className="max-w-[1100px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Truck style={{ width: 20, height: 20 }} /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Logística</h1><p className="text-[11px] text-white/70">Entregas, seguimiento del cliente y postventa · {perfil.nombre}</p></div>
          <div className="ml-auto"><button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" title="Actualizar" onClick={cargar}><RefreshCw /></button></div>
        </div>
      </header>
      <main className="max-w-[1100px] mx-auto px-4 py-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{kpis.map(([t, n]) => <div key={t} className="kpi"><span>{t}</span><b>{n}</b></div>)}</div>
        <div className="tabs">{TABS.map(([k, t]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}<b>{L.filter((e) => enTab(e, k)).length}</b></button>)}</div>
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp !pl-9" placeholder="Buscar cliente, factura, ciudad, guía…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {error && <div className="col-span-full text-center py-14 text-red-600 font-semibold">{error}</div>}
          {!error && lista === null && <div className="col-span-full text-center py-14 text-slate-400"><Spin /> Cargando entregas…</div>}
          {lista && !vis.length && <div className="col-span-full text-center py-14 text-slate-400"><Truck className="mx-auto mb-2" style={{ width: 34, height: 34 }} /><p className="font-semibold text-slate-500">Nada en esta vista.</p><p className="text-xs mt-1">Las entregas llegan aquí cuando Bodega despacha.</p></div>}
          {vis.map((e) => {
            const hoy = e.estado !== 'Entregada' && esHoy(e.fechaProgramada), vencida = e.estado !== 'Entregada' && !!e.fechaProgramada && e.fechaProgramada < hoyYmd(), inc = e.incidencias.filter((i) => !i.resuelta).length
            const I = e.modalidad === 'Transportista' ? Package : e.modalidad === 'Retiro' ? Store : Truck
            return (
              <div key={e.id} className={'card' + (inc ? ' inc' : hoy ? ' hoy' : '')} onClick={() => setAbierto(e.id)}>
                <div className="flex items-center gap-1.5 flex-wrap mb-2"><span className={'pill s-' + slug(e.estado)}>{e.estado}</span>{e.empresa === 'FEMEDICS' && <span className="pill fm">Femedics</span>}{e.envioN > 1 && <span className="pill" style={{ background: '#f1f5f9', color: '#475569' }}>Envío {e.envioN}</span>}{inc > 0 && <span className="pill s-porreprogramar">Incidencia</span>}<span className="ml-auto text-[10px] text-slate-400 mono">{e.codigo}</span></div>
                <p className="font-bold text-[15px] text-slate-800">{e.cliente}</p><p className="text-xs text-slate-500">Factura {e.factura || '—'}{e.entrega.ciudad ? ' · ' + e.entrega.ciudad : ''}</p>
                <p className="text-xs text-slate-600 mt-1 line-clamp-2">{e.productos.map((p) => `${p.cantidad}× ${p.nombre}`).join(' · ').slice(0, 200)}</p>
                <div className="flex items-center gap-3 mt-3 text-[11.5px] text-slate-500 flex-wrap"><span className="flex items-center gap-1"><I style={{ width: 13, height: 13 }} />{e.modalidad === 'Transportista' ? e.transportista || 'Transportista' : e.modalidad === 'Retiro' ? 'Retiro' : e.chofer || 'Sin chofer'}</span>
                  {e.guiaNumero && <span className="mono">Guía {e.guiaNumero}</span>}
                  <span className={'ml-auto ' + (vencida ? 'text-red-600 font-bold' : hoy ? 'text-[var(--acc)] font-bold' : '')}>{e.estado === 'Entregada' ? 'Entregada ' + dfecha(e.fechaEntrega) : e.estado === 'Con transportista' && e.eta ? 'Llega ' + dfecha(e.eta) : e.fechaProgramada ? (hoy ? 'Hoy' : dfecha(e.fechaProgramada)) + (e.ventana ? ' · ' + e.ventana : '') : 'Sin fecha'}</span></div>
                {!e.confirmacion.confirmadoPor && e.estado === 'Por confirmar' && <p className="text-[11px] text-amber-700 font-semibold mt-2">Falta confirmar datos con el cliente</p>}
              </div>
            )
          })}
        </div>
      </main>
      {abierto && <Panel id={abierto} perfil={perfil} editar={editar} equipo={equipo} aviso={aviso} cerrar={() => { setAbierto(null); cargar() }} />}
    </div>
  )
}

/* ============================ Detalle ============================ */
type Hojas = 'mensajes' | 'confirmar' | 'guia' | 'entregar' | 'recibido' | 'noentregada' | 'incidencia' | { resolver: string } | null
function Panel({ id, perfil, editar, equipo, aviso, cerrar }: { id: string; perfil: Perfil; editar: boolean; equipo: string[]; aviso: (t: string) => void; cerrar: () => void }) {
  const [o, setO] = useState<Entrega | null>(null)
  const [hoja, setHoja] = useState<Hojas>(null)
  const cargar = useCallback(async () => { const { data, error } = await supabase.from('entregas').select(COLS).eq('id', id).single(); if (error || !data) { aviso(error?.message ?? 'No se encontró la entrega'); cerrar(); return null } const e = mapear(data); setO(e); return e }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = '' } }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !hoja) cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [hoja, cerrar])
  const err = (e: unknown) => aviso((e as Error).message)

  async function guardar(base: Entrega, campos: Record<string, unknown>, nota: string, publico: boolean, clave = '') {
    const ev: Evento[] = nota ? [...base.eventos, { fecha: new Date().toISOString(), por: perfil.nombre, nota: nota.slice(0, 600), publico, clave }].slice(-300) : base.eventos
    const { error } = await supabase.from('entregas').update({ ...campos, eventos: ev }).eq('id', base.id).eq('updated_at', base.actualizado)
    if (error) throw new Error(error.message)
    return cargar()
  }
  async function avisarAsesor(e: Entrega, tipo: string, detalle: string) {
    if (!e.asesorId) return
    await supabase.from('notificaciones').insert({ id: crypto.randomUUID(), para_id: e.asesorId, modulo: 'logistica', evento: 'novedad', tipo: 'alerta', texto: `Logística · ${tipo} — ${e.cliente} (${e.codigo})${detalle ? ': ' + detalle.slice(0, 200) : ''}`, entidad: 'entregas', entidad_id: e.id })
  }
  async function enRuta() {
    if (!o) return
    try { if (o.estado !== 'Programada') throw new Error('Primero confirma y programa la entrega.'); if (o.modalidad !== 'Chofer propio') throw new Error('"En ruta" es para entregas con chofer propio.')
      await guardar(o, { estado: 'En ruta', chofer: o.chofer || perfil.nombre }, 'Tu pedido va en camino con nuestro equipo de entregas.', true, 'camino'); aviso('En ruta. Avísale al cliente por WhatsApp.'); setTimeout(() => setHoja('mensajes'), 400) } catch (e) { err(e) }
  }
  async function descargarConstancia() {
    if (!o) return
    const p = o.prueba, e = o.entrega, marca = o.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC', esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const filas = o.productos.map((x) => `<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(x.cantidad)}</td><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(x.nombre)}<br><span style="color:#64748b;font-size:10px">${esc(x.id)}</span></td><td style="padding:6px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:10px">${(x.series || []).map(esc).join('<br>')}</td></tr>`).join('')
    const html = `<div style="font-family:Arial,sans-serif;color:#0b2545;font-size:12px;padding:8px"><div style="border-bottom:3px solid #055c9d;padding-bottom:8px;margin-bottom:14px"><b style="font-size:20px;color:#055c9d">${marca}</b><span style="float:right;font-size:11px;color:#64748b">Constancia de entrega · ${esc(o.codigo)}</span></div>` +
      `<p><b>Cliente:</b> ${esc(o.cliente)} &nbsp; <b>Factura:</b> ${esc(o.factura || '—')}</p><p><b>Dirección:</b> ${esc(e.direccionEnvio || e.direccionEntregaLocal || (o.modalidad === 'Retiro' ? 'Retiro en oficina' : '—'))}${e.ciudad ? ', ' + esc(e.ciudad) : ''}</p>` +
      `<p><b>Modalidad:</b> ${esc(o.modalidad)}${o.transportista ? ' · ' + esc(o.transportista) + ' guía ' + esc(o.guiaNumero) : ''}</p>` +
      `<table style="width:100%;border-collapse:collapse;margin:12px 0"><thead><tr style="background:#0b2545;color:#fff"><th style="padding:6px 6px 10px;text-align:left">Cant.</th><th style="padding:6px 6px 10px;text-align:left">Producto</th><th style="padding:6px 6px 10px;text-align:left">N° de serie</th></tr></thead><tbody>${filas}</tbody></table>` +
      `<p><b>Recibió:</b> ${esc(p.nombre || p.confirmacion || '—')}${p.cedula ? ' · C.I. ' + esc(p.cedula) : ''}</p><p><b>Fecha y hora:</b> ${esc(dhora(p.fecha || o.fechaEntrega))}${p.lat ? ` · Ubicación: ${Number(p.lat).toFixed(5)}, ${Number(p.lng).toFixed(5)}` : ''}</p>` +
      `${p.firma ? `<p><b>Firma:</b><br><img src="${esc(p.firma)}" style="height:90px;border-bottom:1px solid #94a3b8"></p>` : ''}${p.nota ? `<p><b>Observación:</b> ${esc(p.nota)}</p>` : ''}` +
      `<p style="margin-top:18px;font-size:10px;color:#64748b">Entregado por ${esc(p.por || '')}. El cliente declara recibir los productos detallados en buen estado.</p></div>`
    try {
      const html2pdf = (await import('html2pdf.js')).default
      const caja = document.createElement('div'); caja.style.cssText = 'position:fixed;left:-10000px;top:0;width:180mm;background:#fff'; caja.innerHTML = html; document.body.appendChild(caja)
      try { await html2pdf().set({ margin: [14, 14, 14, 14], filename: `Constancia_${o.codigo}.pdf`, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(caja).save() } finally { caja.remove() }
    } catch (e) { err(e) }
  }

  if (!o) return <div className="panel"><div className="text-center py-24 text-slate-400"><Spin /> Abriendo…</div></div>
  const e = o.entrega, c = o.confirmacion, cerrado = o.estado === 'Entregada'
  const dir = e.direccionEnvio || e.direccionEntregaLocal || ''
  const tel = c.recibeTelefono || e.telefonoDestinatario || e.telefonoEntregaLocal || o.telefono || ''
  const maps = e.urlGoogleMaps || (dir ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(dir + (e.ciudad ? ', ' + e.ciudad : '') + ', Ecuador') : '')
  const link = o.token ? `${PUBLICO}/seguimiento/?c=${o.token}` : ''
  const kv = (k: string, v: React.ReactNode) => (v ? <><dt>{k}</dt><dd>{v}</dd></> : null)
  const extras = Object.keys(e).filter((k) => e[k] && !ETIQ[k] && typeof e[k] !== 'object')
  const pr = o.prueba
  return (
    <div className="panel">
      <div className="hdr text-white sticky top-0 z-10"><div className="max-w-[900px] mx-auto px-4 py-3 flex items-center gap-3">
        <button className="btn btn-sm !bg-white/10 !border-white/20 !text-white" onClick={cerrar} title="Cerrar"><X /></button>
        <div className="min-w-0"><p className="font-display font-bold leading-tight truncate">{o.cliente}</p><p className="text-[11px] text-white/70 mono">{o.codigo} · Factura {o.factura || '—'}{o.envioN > 1 ? ' · Envío ' + o.envioN : ''}</p></div>
        <span className={'pill s-' + slug(o.estado) + ' ml-auto'}>{o.estado}</span></div></div>
      <div className="max-w-[900px] mx-auto px-4 py-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">{tel ? <><a className="btn" href={'tel:' + tel}><Phone />Llamar</a><button className="btn btn-wa" onClick={() => setHoja('mensajes')}><MessageCircle />WhatsApp</button></> : <><span /><span /></>}{maps ? <a className="btn" href={maps} target="_blank" rel="noopener"><MapPin />Mapa</a> : <span />}</div>
        <div className="sec" style={{ background: 'linear-gradient(135deg,#f0fdfa,#fff)' }}><h3><Radar />Seguimiento del cliente</h3><p className="text-xs text-slate-600 mb-2">El cliente ve el avance de su pedido en este enlace (la página pública del cliente se activa en una etapa posterior):</p>
          <div className="flex gap-2"><input className="inp mono text-xs" readOnly value={link} /><button className="btn btn-sm" title="Copiar" onClick={() => navigator.clipboard?.writeText(link).then(() => aviso('Enlace copiado'))}><Copy /></button><a className="btn btn-sm" href={link} target="_blank" rel="noopener" title="Ver"><ExternalLink /></a></div>
          <button className="btn btn-wa w-full mt-2" onClick={() => setHoja('mensajes')}><MessageCircle />Enviar mensaje listo por WhatsApp</button></div>
        <div className="sec"><h3><ClipboardList />Datos de entrega de la venta{o.empresa === 'FEMEDICS' && <span className="pill fm">Femedics</span>}</h3>
          <dl className="kv">{kv('Cliente', o.cliente + (o.identificacion ? ' · ' + o.identificacion : ''))}{kv('Teléfono cliente', o.telefono)}{kv('Email', o.email)}{kv('Asesor', o.asesor.split(' (')[0])}
            {Object.keys(ETIQ).filter((k) => e[k]).map((k) => <span key={k} style={{ display: 'contents' }}>{kv(ETIQ[k], k === 'urlGoogleMaps' ? <a className="text-[var(--acc)] font-semibold" href={e[k]} target="_blank" rel="noopener">Abrir</a> : e[k])}</span>)}
            {extras.map((k) => <span key={k} style={{ display: 'contents' }}>{kv(k, e[k])}</span>)}</dl></div>
        <div className="sec"><h3><Package />Productos de este envío</h3>{o.productos.map((p) => <div key={p.key} className="py-2 border-b border-slate-100 last:border-0"><p className="text-sm font-semibold">{p.cantidad}× {p.nombre}</p>{p.series?.length ? <p className="text-[11px] mono text-slate-500">Series: {p.series.join(', ')}</p> : null}</div>)}</div>
        <div className="sec"><h3><ListChecks />Confirmación con el cliente {c.confirmadoPor ? <span className="pill s-entregada">Confirmada</span> : <span className="pill s-porconfirmar">Pendiente</span>}</h3>
          {c.confirmadoPor ? <p className="text-[11px] text-slate-500 mb-2">Por {c.confirmadoPor} · {dhora(c.fechaConfirmacion)}</p> : <p className="text-xs text-slate-600 mb-2">Antes de salir, confirma estos datos con el cliente (llamada o WhatsApp).</p>}
          <dl className="kv">{kv('Ascensor', c.ascensor)}{kv('Piso', c.piso)}{kv('Acceso vehicular', c.accesoVehicular)}{kv('Parqueo', c.parqueo)}{kv('Horario', c.horario)}{kv('Recibe', [c.recibeNombre, c.recibeCedula, c.recibeTelefono].filter(Boolean).join(' · '))}{kv('Instalación', c.instalacion)}{kv('Permiso de ingreso', c.permisoIngreso)}{kv('Puertas / pasillos', c.puertaAdecuada)}{kv('Referencia', c.referencia)}{kv('Observaciones', c.observaciones)}
            {kv('Modalidad', o.modalidad + (o.chofer ? ' · ' + o.chofer : '') + (o.transportista ? ' · ' + o.transportista : ''))}{kv('Fecha', o.fechaProgramada ? dfecha(o.fechaProgramada) + (o.ventana ? ' · ' + o.ventana : '') : '')}{kv('Costo de flete', o.costoFlete ? '$' + o.costoFlete.toFixed(2) : '')}</dl>
          {!cerrado && editar && <button className={'btn w-full mt-3 ' + (c.confirmadoPor ? '' : 'btn-p')} onClick={() => setHoja('confirmar')}>{c.confirmadoPor ? <Pencil /> : <CheckCircle2 />}{c.confirmadoPor ? 'Editar confirmación / reprogramar' : 'Confirmar datos y programar'}</button>}</div>
        {(o.modalidad === 'Transportista' || o.guiaNumero) && (
          <div className="sec"><h3><FileText />Guía del transportista</h3>
            {o.guiaNumero ? <dl className="kv">{kv('Transportista', o.transportista)}{kv('Nº de guía', <span className="mono">{o.guiaNumero}</span>)}{kv('Llega aprox.', dfecha(o.eta))}{kv('Archivo', o.guiaUrl ? <GuiaLink ruta={o.guiaUrl} /> : '')}{kv('Postventa', o.postventaCodigo ? `Activada (${o.postventaCodigo})` : o.postventaFecha ? 'Se activa el ' + dfecha(o.postventaFecha) : '')}</dl> : <p className="text-xs text-slate-500">Aún no se sube la guía.</p>}
            {!cerrado && editar && <button className={'btn w-full mt-3 ' + (o.guiaNumero ? '' : 'btn-p')} onClick={() => setHoja('guia')}><Upload />{o.guiaNumero ? 'Cambiar guía' : 'Subir guía de envío'}</button>}</div>
        )}
        {cerrado && (
          <div className="sec" style={{ borderColor: '#9ae6c7' }}><h3 style={{ color: 'var(--teal)' }}><BadgeCheck />Entregado</h3>
            <dl className="kv">{kv('Fecha', dhora(o.fechaEntrega))}{kv('Recibió', [pr.nombre, pr.cedula].filter(Boolean).join(' · ') || pr.confirmacion)}{kv('Ubicación', pr.lat ? <a className="text-[var(--acc)] font-semibold" target="_blank" rel="noopener" href={`https://www.google.com/maps?q=${pr.lat},${pr.lng}`}>{Number(pr.lat).toFixed(5)}, {Number(pr.lng).toFixed(5)}</a> : '')}{kv('Nota', pr.nota)}
              {kv('Constancia', <button className="text-[var(--acc)] font-semibold" onClick={descargarConstancia}>Descargar PDF</button>)}{kv('Postventa', o.postventaCodigo ? `Gestión creada para el asesor (${o.postventaCodigo})` : o.postventaFecha ? 'Se activa el ' + dfecha(o.postventaFecha) : '')}</dl>
            {pr.firma && <img src={pr.firma} alt="Firma" className="mt-2 border-b border-slate-300" style={{ height: 80 }} />}
            {!!pr.fotos?.length && <div className="fotos mt-2">{pr.fotos.map((u) => <Foto key={u} ruta={u} />)}</div>}</div>
        )}
        <div className="sec"><h3><AlertTriangle />Incidencias</h3>
          {o.incidencias.length ? [...o.incidencias].reverse().map((x) => (
            <div key={x.id} className={'rounded-xl p-3 mb-2 ' + (x.resuelta ? 'bg-slate-50' : 'bg-red-50')}><div className="flex gap-2 items-center flex-wrap"><span className={'pill ' + (x.resuelta ? 's-entregada' : 's-porreprogramar')}>{x.resuelta ? 'Resuelta' : 'Abierta'}</span><b className="text-sm">{x.tipo}</b><span className="text-[11px] text-slate-400 ml-auto">{x.por} · {dhora(x.fecha)}</span></div>
              {x.detalle && <p className="text-sm mt-1">{x.detalle}</p>}{x.foto && <FotoLink ruta={x.foto} />}
              {x.resuelta ? x.resolucion && <p className="text-xs text-emerald-700 mt-1"><b>Solución:</b> {x.resolucion}</p> : editar && <button className="btn btn-sm mt-2" onClick={() => setHoja({ resolver: x.id })}><Check />Marcar resuelta</button>}</div>
          )) : <p className="text-xs text-slate-500 mb-2">Sin incidencias.</p>}
          {!cerrado && editar && <button className="btn btn-red" onClick={() => setHoja('incidencia')}><AlertTriangle />Reportar incidencia</button>}</div>
        <div className="sec"><h3><History />Línea de tiempo</h3>{[...o.eventos].reverse().map((ev, i) => <div key={i} className="ev"><span className="text-slate-400 shrink-0 w-28">{dhora(ev.fecha)}</span><span className="flex-1">{ev.nota} <span className="text-slate-400">— {ev.por}</span></span>{ev.publico && <span title="Lo ve el cliente" style={{ color: '#0f766e', fontSize: 11 }}>●</span>}</div>)}
          <p className="text-[10.5px] text-slate-400 mt-2">● Lo ve el cliente en su enlace de seguimiento.</p></div>
        {!cerrado && editar && (
          <div className="acciones"><div className="flex gap-2 flex-wrap">
            {o.estado === 'Programada' && o.modalidad === 'Chofer propio' && <button className="btn btn-p flex-1" onClick={enRuta}><Navigation />Salir a ruta</button>}
            {(o.estado === 'En ruta' || o.estado === 'Programada') && o.modalidad !== 'Transportista' && <button className="btn btn-ok flex-1" onClick={() => setHoja('entregar')}><PenLine />{o.modalidad === 'Retiro' ? 'Registrar retiro' : 'Registrar entrega'}</button>}
            {o.estado === 'Con transportista' && <button className="btn btn-ok flex-1" onClick={() => setHoja('recibido')}><BadgeCheck />Cliente confirmó que recibió</button>}
            {(o.estado === 'En ruta' || o.estado === 'Programada') && o.modalidad !== 'Transportista' && <button className="btn btn-red flex-1" onClick={() => setHoja('noentregada')}><XCircle />No se pudo entregar</button>}
          </div></div>
        )}
      </div>
      {hoja === 'mensajes' && <Mensajes o={o} link={link} cerrar={() => setHoja(null)} registrar={(t) => guardar(o, {}, 'Mensaje de WhatsApp enviado al cliente: ' + t.slice(0, 60) + '.', false).catch(() => undefined)} />}
      {hoja === 'confirmar' && <Confirmar o={o} equipo={equipo} cerrar={() => setHoja(null)} listo={async (conf) => {
        const fp = conf.fechaProgramada, cuando = dfecha(fp) + (conf.ventana ? ` (${conf.ventana})` : '')
        const nota = conf.modalidad === 'Retiro' ? `Retiro coordinado para el ${cuando}.` : conf.modalidad === 'Transportista' ? `Envío coordinado por ${conf.transportista || 'transportista'} para el ${cuando}.` : `Entrega coordinada para el ${cuando}.`
        const limpio: Record<string, string> = {}; ;['ascensor', 'piso', 'accesoVehicular', 'parqueo', 'horario', 'recibeNombre', 'recibeCedula', 'recibeTelefono', 'instalacion', 'permisoIngreso', 'puertaAdecuada', 'referencia', 'observaciones', 'contactoPor'].forEach((k) => { if (conf[k] != null) limpio[k] = String(conf[k]).slice(0, 400) })
        limpio.confirmadoPor = perfil.nombre; limpio.fechaConfirmacion = new Date().toISOString()
        try {
          const campos: Record<string, unknown> = { confirmacion: limpio, modalidad: conf.modalidad, fecha_programada: fp, ventana: conf.ventana.slice(0, 60) || null, chofer: conf.modalidad === 'Chofer propio' ? conf.chofer : null, transportista: conf.modalidad === 'Transportista' ? conf.transportista : null, costo_flete: conf.costoFlete !== '' ? Number(conf.costoFlete) || 0 : o.costoFlete || null }
          if (o.estado === 'Por confirmar' || o.estado === 'Por reprogramar') campos.estado = 'Programada'
          await guardar(o, campos, nota, true, 'coordinado'); setHoja(null); aviso('Entrega programada')
        } catch (e) { err(e) } }} />}
      {hoja === 'guia' && <GuiaHoja o={o} cerrar={() => setHoja(null)} listo={async (g) => {
        try { const eta = new Date(g.eta + 'T18:00:00'); const transp = g.transportista.slice(0, 80)
          await guardar(o, { estado: 'Con transportista', modalidad: 'Transportista', transportista: transp, guia_numero: g.numero, guia_url: g.url, costo_flete: g.costoFlete !== '' ? Number(g.costoFlete) || 0 : o.costoFlete || null, eta: eta.toISOString(), postventa_fecha: eta.toISOString() },
            `Tu pedido fue entregado a ${transp} con la guía Nº ${g.numero}. Llegada estimada: ${eta.toLocaleDateString('es-EC')}.`, true, 'camino'); setHoja(null); aviso('Guía guardada. Envíale el seguimiento al cliente.'); setTimeout(() => setHoja('mensajes'), 400)
        } catch (e) { err(e) } }} />}
      {hoja === 'entregar' && <EntregarHoja o={o} cerrar={() => setHoja(null)} listo={async (d) => { const { error } = await supabase.rpc('lg_entregar', { p_id: o.id, p: d }); if (error) throw new Error(error.message); setHoja(null); await cargar(); aviso('¡Entregado! Se registró la entrega y la postventa del asesor.') }} />}
      {hoja === 'recibido' && <RecibidoHoja cerrar={() => setHoja(null)} listo={async (d) => { try { const { error } = await supabase.rpc('lg_entregar', { p_id: o.id, p: d }); if (error) throw new Error(error.message); setHoja(null); await cargar(); aviso('Recepción confirmada') } catch (e) { err(e) } }} />}
      {hoja === 'noentregada' && <NoEntregadaHoja o={o} cerrar={() => setHoja(null)} listo={async (motivo, detalle, foto) => {
        try { const inc: Incidencia = { id: 'I' + Date.now().toString(36), tipo: 'No entregada: ' + motivo, detalle: detalle.slice(0, 800), foto, fecha: new Date().toISOString(), por: perfil.nombre, resuelta: true, resolucion: 'Se reprograma la entrega.' }
          await guardar(o, { estado: 'Por reprogramar', incidencias: [...o.incidencias, inc] }, `No se pudo completar la entrega (${motivo}). Te contactaremos para reprogramarla.`, true, 'reprogramar'); avisarAsesor(o, 'Entrega no realizada: ' + motivo, detalle); setHoja(null); aviso('Registrado. Coordina una nueva fecha.')
        } catch (e) { err(e) } }} />}
      {hoja === 'incidencia' && <IncidenciaHoja o={o} cerrar={() => setHoja(null)} listo={async (tipo, det, foto) => {
        try { const inc: Incidencia = { id: 'I' + Date.now().toString(36), tipo, detalle: det, foto, fecha: new Date().toISOString(), por: perfil.nombre, resuelta: false }
          await guardar(o, { incidencias: [...o.incidencias, inc] }, `Incidencia: ${tipo} — ${det}`, false); avisarAsesor(o, tipo, det); setHoja(null); aviso('Incidencia reportada al asesor') } catch (e) { err(e) } }} />}
      {hoja && typeof hoja === 'object' && <ResolverHoja cerrar={() => setHoja(null)} listo={async (txt) => {
        try { const id2 = hoja.resolver; let ok = false
          const incs = o.incidencias.map((x) => { if (x.id === id2 && !x.resuelta) { ok = true; return { ...x, resuelta: true, resolucion: txt.slice(0, 800), resueltaPor: perfil.nombre } } return x })
          if (!ok) throw new Error('La incidencia ya estaba resuelta o no existe.'); await guardar(o, { incidencias: incs }, 'Incidencia resuelta: ' + txt, false); setHoja(null) } catch (e) { err(e) } }} />}
    </div>
  )
}
function FotoLink({ ruta }: { ruta: string }) {
  const [url, setUrl] = useState(/^https?:/i.test(ruta) ? ruta : '')
  useEffect(() => { if (!/^https?:/i.test(ruta)) supabase.storage.from('entregas').createSignedUrl(ruta, 3600).then(({ data }) => { if (data) setUrl(data.signedUrl) }) }, [ruta])
  return url ? <a className="text-xs text-[var(--acc)] font-semibold" href={url} target="_blank" rel="noopener">Ver foto</a> : null
}
const GuiaLink = ({ ruta }: { ruta: string }) => { const [u, setU] = useState(/^https?:/i.test(ruta) ? ruta : ''); useEffect(() => { if (!/^https?:/i.test(ruta)) supabase.storage.from('entregas').createSignedUrl(ruta, 3600).then(({ data }) => { if (data) setU(data.signedUrl) }) }, [ruta]); return u ? <a className="text-[var(--acc)] font-semibold" href={u} target="_blank" rel="noopener">Ver guía</a> : null }

/* ============================ Hojas ============================ */
function Mensajes({ o, link, cerrar, registrar }: { o: Entrega; link: string; cerrar: () => void; registrar: (t: string) => void }) {
  const n = String(o.cliente || '').split(' ')[0], marca = o.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC', enc = link.replace('/seguimiento/', '/encuesta/')
  const f = o.fechaProgramada ? new Date(o.fechaProgramada + 'T12:00:00').toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
  const pl: [string, string][] = [
    ['Confirmar datos de entrega', `Hola ${n}, le saluda el equipo de logística de ${marca}. Su pedido (factura ${o.factura || ''}) está listo para entrega. Para coordinarla, ¿nos confirma por favor?\n• Dirección exacta y referencia\n• Persona que recibe (nombre y cédula)\n• Horario de recepción\n• ¿El lugar cuenta con ascensor? ¿En qué piso?\n• ¿Hay acceso o parqueo para el vehículo?\n• ¿Se requiere permiso o credencial para ingresar?\nPuede seguir su pedido aquí: ${link}`],
    ['Entrega programada', `Hola ${n}, su entrega de ${marca} quedó programada para el ${f}${o.ventana ? ` (${o.ventana})` : ''}. Siga su pedido en tiempo real: ${link}`],
    ['En camino', `Hola ${n}, ¡su pedido de ${marca} va en camino! Puede ver el avance aquí: ${link}`],
    ['Guía del transportista', `Hola ${n}, su pedido de ${marca} fue enviado por ${o.transportista || 'transportista'} con la guía Nº ${o.guiaNumero || ''}. Llegada estimada: ${o.eta ? new Date(o.eta).toLocaleDateString('es-EC', { day: 'numeric', month: 'long' }) : ''}. Detalles y guía aquí: ${link}`],
    ['Entregado', `Hola ${n}, confirmamos la entrega de su pedido de ${marca}. ¡Gracias por su confianza! Aquí está el detalle y su constancia: ${link}`],
    ['Reprogramar entrega', `Hola ${n}, no pudimos completar la entrega de su pedido de ${marca}. ¿Nos indica una nueva fecha y horario? Seguimiento: ${link}`],
    ['Encuesta de satisfacción', `Hola ${n}, en ${marca} queremos saber cómo le fue con su pedido. ¿Nos ayuda con esta breve encuesta? ${enc}`],
  ]
  const sug = ({ 'Por confirmar': 0, 'Por reprogramar': 5, Programada: 1, 'En ruta': 2, 'Con transportista': 3, Entregada: 4 } as Record<string, number>)[o.estado] ?? 0
  const [i, setI] = useState(sug)
  const [txt, setTxt] = useState(pl[sug][1])
  const [tel, setTel] = useState(o.confirmacion.recibeTelefono || o.telefono || o.entrega.telefonoDestinatario || o.entrega.telefonoEntregaLocal || '')
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-2">Mensaje por WhatsApp</h3>
      <label className="f">Plantilla<select className="inp" value={i} onChange={(e) => { setI(+e.target.value); setTxt(pl[+e.target.value][1]) }}>{pl.map((p, k) => <option key={k} value={k}>{p[0]}</option>)}</select></label>
      <label className="f mt-3">Teléfono<input className="inp" value={tel} onChange={(e) => setTel(e.target.value)} /></label>
      <label className="f mt-3">Mensaje (puedes editarlo)<textarea className="inp" rows={9} value={txt} onChange={(e) => setTxt(e.target.value)} /></label>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cerrar</button><button className="btn btn-wa flex-1" onClick={() => { const num = waNum(tel); if (!num) return; window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(txt), '_blank'); registrar(pl[i][0]); cerrar() }}><Send />Abrir WhatsApp</button></div></Hoja>
  )
}

function Confirmar({ o, equipo, cerrar, listo }: { o: Entrega; equipo: string[]; cerrar: () => void; listo: (c: Record<string, string>) => Promise<void> }) {
  const c = o.confirmacion, e = o.entrega
  const [f, setF] = useState<Record<string, string>>({ ascensor: c.ascensor ?? '', piso: c.piso ?? '', accesoVehicular: c.accesoVehicular ?? '', parqueo: c.parqueo ?? '', horario: c.horario ?? '', recibeNombre: c.recibeNombre || e.quienRecibe || e.nombreDestinatario || o.cliente || '', recibeCedula: c.recibeCedula || e.cedulaDestinatario || '',
    recibeTelefono: c.recibeTelefono || e.telefonoDestinatario || e.telefonoEntregaLocal || o.telefono || '', instalacion: c.instalacion ?? '', permisoIngreso: c.permisoIngreso ?? '', puertaAdecuada: c.puertaAdecuada ?? '', referencia: c.referencia ?? '', observaciones: c.observaciones ?? '', contactoPor: c.contactoPor ?? '',
    modalidad: o.modalidad || 'Chofer propio', chofer: o.chofer, transportista: o.transportista || e.transporte || TRANSPORTISTAS[0], fechaProgramada: ymd(o.fechaProgramada) || e.fechaEntrega || '', costoFlete: o.costoFlete ? String(o.costoFlete) : '', ventana: VENTANAS.includes(o.ventana) ? o.ventana : '' })
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string) => (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  const seg = (k: string, ops: string[]) => <Seg opciones={ops} valor={f[k]} cambia={(v) => setF((x) => ({ ...x, [k]: v }))} />
  async function ok() {
    if (!f.fechaProgramada) { setErr('Indica la fecha acordada.'); return }
    if (f.modalidad === 'Chofer propio' && !f.chofer) { setErr('Elige el chofer o responsable.'); return }
    setOcupado(true); try { await listo(f) } finally { setOcupado(false) }
  }
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-1">Confirmación con el cliente</h3><p className="text-xs text-slate-500 mb-3">Pregunta lo necesario antes de salir para que la entrega sea en un solo viaje.</p>
      <div className="space-y-3">
        <label className="f">¿Cuenta con ascensor?{seg('ascensor', ['Sí', 'No', 'Planta baja'])}</label>
        <label className="f">Piso / nivel<input className="inp" placeholder="Ej.: 3er piso, consultorio 305" value={f.piso} onChange={set('piso')} /></label>
        <label className="f">¿Acceso para el vehículo?{seg('accesoVehicular', ['Sí', 'No', 'Calle angosta'])}</label>
        <label className="f">Parqueo cercano{seg('parqueo', ['Sí', 'No', 'Pagado'])}</label>
        <label className="f">Horario de recepción<input className="inp" placeholder="Ej.: lunes a viernes 9:00 a 16:00" value={f.horario} onChange={set('horario')} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="f">Quién recibe<input className="inp" value={f.recibeNombre} onChange={set('recibeNombre')} /></label><label className="f">Cédula<input className="inp" value={f.recibeCedula} onChange={set('recibeCedula')} /></label></div>
        <label className="f">Teléfono de quien recibe<input className="inp" value={f.recibeTelefono} onChange={set('recibeTelefono')} /></label>
        <label className="f">¿Requiere instalación o capacitación?{seg('instalacion', ['No', 'Instalación', 'Capacitación', 'Ambas'])}</label>
        <label className="f">¿Permiso o credencial para ingresar? (hospital, edificio)<input className="inp" placeholder="Ej.: anunciarse en guardianía con cédula" value={f.permisoIngreso} onChange={set('permisoIngreso')} /></label>
        <label className="f">¿Puertas y pasillos aptos para el tamaño del equipo?{seg('puertaAdecuada', ['Sí', 'No', 'No sabe'])}</label>
        <label className="f">Referencia de la dirección<input className="inp" value={f.referencia} onChange={set('referencia')} /></label>
        <label className="f">Observaciones<textarea className="inp" rows={2} value={f.observaciones} onChange={set('observaciones')} /></label>
        <label className="f">Se confirmó por{seg('contactoPor', ['Llamada', 'WhatsApp', 'Correo'])}</label>
        <hr className="border-slate-100" /><p className="font-display font-bold text-[var(--navy)]">Programación</p>
        <label className="f">Modalidad<Seg opciones={['Chofer propio', 'Transportista', 'Retiro']} valor={f.modalidad} cambia={(v) => setF((x) => ({ ...x, modalidad: v || x.modalidad }))} /></label>
        {f.modalidad === 'Chofer propio' && <label className="f">Chofer / responsable<select className="inp" value={f.chofer} onChange={set('chofer')}><option value="">— Elegir —</option>{equipo.map((x) => <option key={x}>{x}</option>)}</select></label>}
        {f.modalidad === 'Transportista' && <label className="f">Transportista<select className="inp" value={f.transportista} onChange={set('transportista')}>{TRANSPORTISTAS.map((x) => <option key={x}>{x}</option>)}</select></label>}
        <div className="grid grid-cols-2 gap-2"><label className="f">Fecha acordada<input type="date" className="inp" value={f.fechaProgramada} onChange={set('fechaProgramada')} /></label><label className="f">Costo de flete ($)<input type="number" step="0.01" min="0" className="inp" value={f.costoFlete} onChange={set('costoFlete')} /></label></div>
        <label className="f">Ventana horaria{seg('ventana', VENTANAS)}</label>
        {err && <p className="text-[12px] text-red-600">{err}</p>}</div>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={ocupado} onClick={ok}>{ocupado ? <Spin /> : <><Check />Guardar y programar</>}</button></div></Hoja>
  )
}

function GuiaHoja({ o, cerrar, listo }: { o: Entrega; cerrar: () => void; listo: (g: { transportista: string; numero: string; eta: string; costoFlete: string; url: string }) => Promise<void> }) {
  const [f, setF] = useState({ transportista: o.transportista || o.entrega.transporte || TRANSPORTISTAS[0], numero: o.guiaNumero, eta: ymd(o.eta), costoFlete: o.costoFlete ? String(o.costoFlete) : '' })
  const [url, setUrl] = useState(o.guiaUrl)
  const [subiendo, setSubiendo] = useState(false)
  const [msg, setMsg] = useState(o.guiaUrl ? 'Guía actual cargada' : 'Sin archivo')
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (x: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((v) => ({ ...v, [k]: x.target.value }))
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Guía del transportista</h3>
      <label className="f">Transportista<select className="inp" value={f.transportista} onChange={set('transportista')}>{TRANSPORTISTAS.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label className="f mt-3">Número de guía *<input className="inp mono" value={f.numero} onChange={set('numero')} /></label>
      <div className="grid grid-cols-2 gap-2 mt-3"><label className="f">Llegada estimada *<input type="date" className="inp" value={f.eta} onChange={set('eta')} /></label><label className="f">Costo de flete ($)<input type="number" step="0.01" min="0" className="inp" value={f.costoFlete} onChange={set('costoFlete')} /></label></div>
      <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">Foto o PDF de la guía *</p><div className="text-xs text-slate-600">{subiendo ? <><Spin /> Subiendo…</> : msg}</div>
      <label className="btn btn-sm mt-2 cursor-pointer"><Upload />Tomar foto o elegir PDF<input type="file" accept="image/*,application/pdf" hidden onChange={async (ev) => { const fl = ev.target.files?.[0]; ev.target.value = ''; if (!fl) return; setSubiendo(true); try { const pdf = fl.type === 'application/pdf'; setUrl(await subir(o, pdf ? fl : await reducir(fl), fl.name, pdf ? 'application/pdf' : 'image/jpeg')); setMsg('✓ Archivo subido') } catch (e) { setMsg('Error: ' + (e as Error).message) } setSubiendo(false) }} /></label>
      <p className="text-[11px] text-slate-500 mt-3">El cliente verá la guía, el transportista y la fecha estimada. Cuando pase esa fecha se activa la postventa del asesor.</p>{err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" disabled={ocupado || subiendo} onClick={async () => {
        if (!f.numero.trim()) { setErr('Escribe el número de guía del transportista.'); return } if (!url) { setErr('Sube la foto o el PDF de la guía.'); return } if (!f.eta) { setErr('Indica la fecha estimada de llegada.'); return }
        setOcupado(true); await listo({ ...f, numero: f.numero.trim().slice(0, 60), url }); setOcupado(false) }}>{ocupado ? <Spin /> : <><Check />Guardar guía</>}</button></div></Hoja>
  )
}

function EntregarHoja({ o, cerrar, listo }: { o: Entrega; cerrar: () => void; listo: (d: Record<string, unknown>) => Promise<void> }) {
  const c = o.confirmacion
  const [nom, setNom] = useState(c.recibeNombre ?? '')
  const [ced, setCed] = useState(c.recibeCedula ?? '')
  const [nota, setNota] = useState('')
  const [fotos, setFotos] = useState<string[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [gps, setGps] = useState<GeolocationCoordinates | null>(null)
  const [gpsTxt, setGpsTxt] = useState('Obteniendo ubicación…')
  const [limpiar, setLimpiar] = useState(0)
  const [ocupado, setOcupado] = useState(false)
  const [err, setErr] = useState('')
  const lienzo = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => { setGps(p.coords); setGpsTxt(`Ubicación registrada (±${Math.round(p.coords.accuracy)} m)`) }, () => setGpsTxt('Sin ubicación (permiso denegado). Se registra igual.'), { enableHighAccuracy: true, timeout: 10000 }); else setGpsTxt('Este equipo no comparte ubicación.') }, [])
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">{o.modalidad === 'Retiro' ? 'Registrar retiro' : 'Registrar entrega'}</h3>
      <div className="grid grid-cols-2 gap-2"><label className="f">Recibe (nombre) *<input className="inp" value={nom} onChange={(e) => setNom(e.target.value)} /></label><label className="f">Cédula<input className="inp" inputMode="numeric" value={ced} onChange={(e) => setCed(e.target.value)} /></label></div>
      <p className="text-xs font-semibold text-slate-500 mt-3 mb-1 flex items-center">Firma de quien recibe *<button type="button" className="ml-auto text-[var(--acc)] font-bold" onClick={() => setLimpiar((n) => n + 1)}>Borrar</button></p><Firma lienzo={lienzo} limpiar={limpiar} />
      <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">Fotos de la entrega *</p><div className="fotos">{fotos.map((u) => <Foto key={u} ruta={u} />)}{subiendo && <Spin />}</div>
      <label className="btn btn-sm mt-2 cursor-pointer"><Camera />Tomar foto<input type="file" accept="image/*" capture="environment" multiple hidden onChange={async (ev) => { const fs = [...(ev.target.files ?? [])]; ev.target.value = ''; setSubiendo(true); for (const fl of fs) { try { const r = await subir(o, await reducir(fl), fl.name, 'image/jpeg'); setFotos((a) => [...a, r]) } catch (e) { setErr((e as Error).message) } } setSubiendo(false) }} /></label>
      <label className="f mt-3">Nota (opcional)<input className="inp" placeholder="Ej.: se dejó en recepción, se capacitó al personal" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1"><MapPin style={{ width: 12, height: 12 }} />{gpsTxt}</p>{err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-ok flex-1" disabled={ocupado || subiendo} onClick={async () => {
        if (!nom.trim()) { setErr('Escribe quién recibe.'); return } if (!lienzo.current?.dataset.firmado) { setErr('Falta la firma.'); return } if (!fotos.length) { setErr('Toma al menos una foto.'); return }
        setOcupado(true); setErr(''); try { await listo({ nombre: nom, cedula: ced, firma: firmaPng(lienzo.current), fotos, lat: gps?.latitude ?? null, lng: gps?.longitude ?? null, precision: gps?.accuracy ?? null, nota }) } catch (e) { setErr((e as Error).message); setOcupado(false) }
      }}>{ocupado ? <Spin /> : <><BadgeCheck />Confirmar entrega</>}</button></div></Hoja>
  )
}
function RecibidoHoja({ cerrar, listo }: { cerrar: () => void; listo: (d: Record<string, unknown>) => Promise<void> }) {
  const [conf, setConf] = useState('Llamada')
  const [nom, setNom] = useState('')
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">¿El cliente recibió su pedido?</h3>
      <label className="f">¿Cómo se confirmó?<Seg opciones={['Llamada', 'WhatsApp', 'Rastreo del transportista']} valor={conf} cambia={(v) => setConf(v || conf)} /></label>
      <label className="f mt-3">Quién recibió (opcional)<input className="inp" value={nom} onChange={(e) => setNom(e.target.value)} /></label><label className="f mt-3">Nota<input className="inp" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-ok flex-1" disabled={ocupado} onClick={async () => { setOcupado(true); await listo({ nombre: nom, confirmacion: 'Confirmado por ' + conf, nota }); setOcupado(false) }}>{ocupado ? <Spin /> : 'Confirmar recepción'}</button></div></Hoja>
  )
}
function FotoOpcional({ o, ruta, set }: { o: Entrega; ruta: string; set: (r: string) => void }) {
  const [sub, setSub] = useState(false)
  return <><div className="fotos mt-2">{ruta && <Foto ruta={ruta} />}{sub && <Spin />}</div><label className="btn btn-sm mt-2 cursor-pointer"><Camera />Foto (opcional)<input type="file" accept="image/*" capture="environment" hidden onChange={async (ev) => { const fl = ev.target.files?.[0]; ev.target.value = ''; if (!fl) return; setSub(true); try { set(await subir(o, await reducir(fl), fl.name, 'image/jpeg')) } catch { /* sin foto */ } setSub(false) }} /></label></>
}
function NoEntregadaHoja({ o, cerrar, listo }: { o: Entrega; cerrar: () => void; listo: (m: string, d: string, f: string) => Promise<void> }) {
  const [m, setM] = useState(MOTIVOS_NO[0]); const [d, setD] = useState(''); const [foto, setFoto] = useState(''); const [ocupado, setOcupado] = useState(false)
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">No se pudo entregar</h3>
      <label className="f">Motivo<select className="inp" value={m} onChange={(e) => setM(e.target.value)}>{MOTIVOS_NO.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label className="f mt-3">Detalle<textarea className="inp" rows={3} value={d} onChange={(e) => setD(e.target.value)} /></label><FotoOpcional o={o} ruta={foto} set={setFoto} />
      <p className="text-[11px] text-slate-500 mt-2">Queda "Por reprogramar" y se avisa al asesor.</p>
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-red flex-1" disabled={ocupado} onClick={async () => { setOcupado(true); await listo(m, d, foto); setOcupado(false) }}>{ocupado ? <Spin /> : 'Registrar'}</button></div></Hoja>
  )
}
function IncidenciaHoja({ o, cerrar, listo }: { o: Entrega; cerrar: () => void; listo: (t: string, d: string, f: string) => Promise<void> }) {
  const [t, setT] = useState(TIPOS_INCIDENCIA[0]); const [d, setD] = useState(''); const [foto, setFoto] = useState(''); const [ocupado, setOcupado] = useState(false); const [err, setErr] = useState('')
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Reportar incidencia</h3>
      <label className="f">Tipo<select className="inp" value={t} onChange={(e) => setT(e.target.value)}>{TIPOS_INCIDENCIA.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label className="f mt-3">¿Qué pasó? *<textarea className="inp" rows={3} value={d} onChange={(e) => setD(e.target.value)} /></label><FotoOpcional o={o} ruta={foto} set={setFoto} />{err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-red flex-1" disabled={ocupado} onClick={async () => { if (!d.trim()) { setErr('Describe la incidencia.'); return } setOcupado(true); await listo(t, d.trim().slice(0, 1000), foto); setOcupado(false) }}>{ocupado ? <Spin /> : 'Reportar'}</button></div></Hoja>
  )
}
function ResolverHoja({ cerrar, listo }: { cerrar: () => void; listo: (t: string) => Promise<void> }) {
  const [t, setT] = useState(''); const [ocupado, setOcupado] = useState(false); const [err, setErr] = useState('')
  return (
    <Hoja cerrar={cerrar}><h3 className="font-display font-bold text-lg text-[var(--navy)] mb-3">Resolver incidencia</h3><label className="f">¿Cómo se resolvió? *<textarea className="inp" rows={3} value={t} onChange={(e) => setT(e.target.value)} /></label>{err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
      <div className="flex gap-2 mt-4"><button className="btn flex-1" onClick={cerrar}>Cancelar</button><button className="btn btn-ok flex-1" disabled={ocupado} onClick={async () => { if (!t.trim()) { setErr('Escribe la solución.'); return } setOcupado(true); await listo(t.trim()); setOcupado(false) }}>{ocupado ? <Spin /> : 'Marcar resuelta'}</button></div></Hoja>
  )
}
