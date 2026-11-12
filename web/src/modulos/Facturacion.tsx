import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, BadgeCheck, Boxes, Building2, Clock, CreditCard, Download, Eye, FileCheck2, FilePenLine, FilePlus2, FileUp, Folder, Gift, Hash, History, Inbox,
  Layers, Link2, List, Lock, Megaphone, Package, Plus, Printer, Receipt, ReceiptText, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Trash2, Truck, TriangleAlert, Upload, X,
} from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { imagen } from './Inventario'
import '../estilos/facturacion.css'

/* ============================ Tipos y utilidades ============================ */
type Pe = Record<string, string | undefined>
type Linea = { id?: string; codigo?: string; nombre: string; imagen?: string; precio: number; cantidad: number; descuento?: number; iva?: boolean; observacion?: string }
type Fila = {
  uuid: string; id: string; empresa: 'VIMEDIC' | 'FEMEDICS'; identificacion: string; estado: string; fechaGanado: string; creado: string; numeroFactura: string; medio: string; nota: string
  datosCompletos: boolean; facturaUrl: string; actaUrl: string; actaConformidadUrl: string; guiaEnvioUrl: string; guiaDespachoUrl: string; total: number; pe: Pe; cliente: string; email: string; telefono: string
  asesor: string; esEnvio: boolean; items?: Linea[]; historial?: { fecha: string; por: string; accion: string; detalle?: string }[]
  obsequioId: string | null; obsequioNombre: string; obsequioImagen: string
}
const COLS = 'id,codigo,empresa,identificacion,estado,fecha_ganado,created_at,numero_contifico,medio_captacion_venta,observacion,datos_completos,pdf_url,acta_garantia_url,acta_conformidad_url,guia_envio_url,guia_despacho_url,total,pago_entrega,obsequio_id,obsequio:obsequios(nombre,imagen_url),cliente:clientes(nombre,email,telefono),cotizacion:cotizaciones(nombre,email,telefono),asesor:empleados!asesor_id(nombre)'
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const PAGE_SIZE = 20

const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const iniciales = (t: string) => { const p = String(t || '').trim().split(/\s+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase() }
const tiene = (v: unknown) => { if (v == null) return false; const s = String(v).trim(); return !!s && s !== '—' && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined' }
const fechaTs = (r: Fila) => (r.creado ? new Date(r.creado).getTime() : r.fechaGanado ? new Date(r.fechaGanado + 'T00:00:00').getTime() : 0)
function fechaCorta(ts: number, fb = '') {
  if (!ts) return fb || '—'
  const d = new Date(ts)
  return `${('0' + d.getDate()).slice(-2)} ${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)} · ${('0' + d.getHours()).slice(-2)}:${('0' + d.getMinutes()).slice(-2)}`
}
function calc(l: Linea) {
  const cantidad = Math.abs(Number(l.cantidad) || 0), precio = Number(l.precio) || 0, descuentoPct = Number(l.descuento) || 0
  const bruto = cantidad * precio, descuentoUsd = bruto * (descuentoPct / 100), base = bruto - descuentoUsd
  const conIva = l.iva !== false, ivaUsd = conIva ? base * 0.15 : 0
  return { cantidad, precio, descuentoPct, bruto, descuentoUsd, base, ivaUsd, total: base + ivaUsd, conIva }
}
const totalFila = (r: Fila) => (r.total ? r.total : r.items ? Math.round(r.items.reduce((t, l) => t + calc(l).total, 0) * 100) / 100 : 0)
function mapear(x: Record<string, any>): Fila { // eslint-disable-line @typescript-eslint/no-explicit-any
  const pe = (x.pago_entrega ?? {}) as Pe
  const cli = x.cliente ?? x.cotizacion ?? {}
  return {
    uuid: x.id, id: x.codigo ?? x.id, empresa: x.empresa, identificacion: x.identificacion ?? '', estado: x.estado ?? '', fechaGanado: x.fecha_ganado ?? '', creado: x.created_at ?? '',
    numeroFactura: x.numero_contifico ?? '', medio: x.medio_captacion_venta ?? '', nota: x.observacion ?? '', datosCompletos: x.datos_completos !== false, facturaUrl: x.pdf_url ?? '',
    actaUrl: x.acta_garantia_url ?? '', actaConformidadUrl: x.acta_conformidad_url ?? '', guiaEnvioUrl: x.guia_envio_url ?? '', guiaDespachoUrl: x.guia_despacho_url ?? '', total: Number(x.total) || 0, pe,
    cliente: cli.nombre ?? (x.cotizacion?.nombre ?? ''), email: cli.email ?? '', telefono: cli.telefono ?? '', asesor: x.asesor?.nombre ?? '', esEnvio: pe.entrega === 'Envío',
    obsequioId: x.obsequio_id ?? null, obsequioNombre: x.obsequio?.nombre ?? '', obsequioImagen: x.obsequio?.imagen_url ?? '',
  }
}
type Filtros = { asesor: string; medio: string; desde: string; hasta: string; chips: Record<string, boolean>; agrupar: string }
const FILTROS0: Filtros = { asesor: '', medio: '', desde: '', hasta: '', chips: {}, agrupar: '' }
const NOMBRES_CHIP: Record<string, string> = { sinPdf: 'Sin factura PDF', sinActa: 'Sin acta', guia: 'Guía pendiente', incompleto: 'Datos incompletos' }
const norm = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/* ============================ Pantalla principal ============================ */
export default function Facturacion({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [filtro, setFiltro] = useState<'Pendiente' | 'ALL'>('Pendiente')
  const [cola, setCola] = useState<Fila[] | null>(null)
  const [error, setError] = useState('')
  const [buscar, setBuscar] = useState('')
  const [f, setF] = useState<Filtros>(FILTROS0)
  const [panelFiltros, setPanelFiltros] = useState(false)
  const [orden, setOrden] = useState<{ k: string; d: number; tocado?: boolean }>({ k: 'fecha', d: -1 })
  const [limite, setLimite] = useState(PAGE_SIZE)
  const centinela = useRef<HTMLDivElement>(null)
  const [selId, setSelId] = useState<string | null>(null)
  const [stats, setStats] = useState({ facturados: 0, pendientes: 0, guias: 0, actas: 0, notas: 0 })
  const [statsListas, setStatsListas] = useState(false)
  const [detalle, setDetalle] = useState<Fila | null>(null)
  const [factura, setFactura] = useState<Fila | null>(null)
  const [cargando, setCargando] = useState(false)
  const [notasCredito, setNotasCredito] = useState<Fila | null>(null)
  const [guiaEnvio, setGuiaEnvio] = useState<Fila | null>(null)
  const [guiaDespacho, setGuiaDespacho] = useState<Fila | null>(null)
  const [acta, setActa] = useState<Fila | null>(null)
  const [obsequioModal, setObsequioModal] = useState<Fila | null>(null)
  const filtrosRef = useRef<HTMLDivElement>(null)
  const peticion = useRef(0)
  const esPc = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  const puedeEditar = puede(perfil, 'facturacion', 'editar')

  const cargar = useCallback(async (modo: 'Pendiente' | 'ALL') => {
    const n = ++peticion.current
    setCargando(true)
    let q = supabase.from('facturas').select(COLS).is('deleted_at', null)
    if (modo === 'Pendiente') q = q.eq('estado', 'Pendiente')
    const { data, error } = await q.order('created_at', { ascending: false }).limit(1000)
    if (n !== peticion.current) return
    setCargando(false)
    if (error) { setError('Error cargando Facturación: ' + error.message); return }
    setError(''); setCola(((data ?? []) as Record<string, any>[]).map(mapear)) // eslint-disable-line @typescript-eslint/no-explicit-any
  }, [])
  const cargarStats = useCallback(async () => {
    const cuenta = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0)
    const base = () => supabase.from('facturas').select('id', { count: 'exact', head: true }).is('deleted_at', null)
    const [facturados, pendientes, guias, actas, notas] = await Promise.all([
      cuenta(base().eq('estado', 'Facturado')), cuenta(base().eq('estado', 'Pendiente')),
      cuenta(base().eq('estado', 'Facturado').is('guia_despacho_url', null)), cuenta(base().eq('estado', 'Facturado').is('acta_garantia_url', null)),
      cuenta(supabase.from('notas_credito').select('id', { count: 'exact', head: true }).is('deleted_at', null)),
    ])
    setStats({ facturados, pendientes, guias, actas, notas })
    setStatsListas(true)
  }, [])
  useEffect(() => { setCola(null); cargar(filtro) }, [filtro, cargar])
  useEffect(() => { cargarStats() }, [cargarStats])
  // Si no hay nada pendiente por facturar, se abre directo la pestaña "Todos" en vez de dejar la vista vacía.
  useEffect(() => { if (statsListas && stats.pendientes === 0 && filtro === 'Pendiente') setFiltro('ALL') }, [statsListas, stats.pendientes, filtro])
  useEffect(() => {
    const canal = supabase.channel('facturas-cola').on('postgres_changes', { event: '*', schema: 'public', table: 'facturas' }, () => { cargar(filtro); cargarStats() }).subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [filtro, cargar, cargarStats])
  useEffect(() => {
    const cerrar = (e: MouseEvent) => { if (filtrosRef.current && !filtrosRef.current.contains(e.target as Node)) setPanelFiltros(false) }
    document.addEventListener('click', cerrar); return () => document.removeEventListener('click', cerrar)
  }, [])

  const asesores = useMemo(() => [...new Set((cola ?? []).map((r) => r.asesor).filter(Boolean))].sort(), [cola])
  const medios = useMemo(() => [...new Set((cola ?? []).map((r) => r.medio).filter(Boolean))].sort(), [cola])

  const visibles = useMemo(() => {
    const d = f.desde ? new Date(f.desde + 'T00:00:00').getTime() : 0, h = f.hasta ? new Date(f.hasta + 'T23:59:59').getTime() : 0
    const palabras = norm(buscar).split(/\s+/).filter(Boolean)
    const out = (cola ?? []).filter((r) => {
      if (f.asesor && r.asesor !== f.asesor) return false
      if (f.medio && r.medio !== f.medio) return false
      const ts = fechaTs(r)
      if (d && ts < d) return false
      if (h && ts > h) return false
      if (f.chips.sinPdf && r.facturaUrl) return false
      if (f.chips.sinActa && (r.actaUrl || r.estado !== 'Facturado')) return false
      if (f.chips.guia && r.guiaDespachoUrl) return false
      if (f.chips.incompleto && r.datosCompletos) return false
      if (palabras.length) { const c = norm([r.id, r.cliente, r.asesor, r.identificacion, r.numeroFactura, r.email, r.telefono, r.empresa].join(' ')); if (!palabras.every((p) => c.includes(p))) return false }
      return true
    })
    const { k, d: dir } = orden
    out.sort((a, b) => {
      let va: string | number, vb: string | number
      if (k === 'fecha') { va = fechaTs(a); vb = fechaTs(b) } else if (k === 'monto') { va = totalFila(a); vb = totalFila(b) }
      else if (k === 'cliente') { va = a.cliente.toLowerCase(); vb = b.cliente.toLowerCase() } else if (k === 'asesor') { va = a.asesor.toLowerCase(); vb = b.asesor.toLowerCase() }
      else if (k === 'factura') { va = a.numeroFactura; vb = b.numeroFactura } else { va = a.estado; vb = b.estado }
      return va < vb ? -dir : va > vb ? dir : 0
    })
    return out
  }, [cola, f, buscar, orden])

  useEffect(() => { if (visibles.length && (selId == null || !visibles.some((x) => x.uuid === selId))) setSelId(visibles[0].uuid); if (!visibles.length) setSelId(null) }, [visibles, selId])
  const sel = visibles.find((x) => x.uuid === selId) ?? null
  const claveGrupo = (r: Fila) => {
    if (f.agrupar === 'asesor') return r.asesor || 'Sin asesor'
    if (f.agrupar === 'medio') return r.medio || 'Sin medio'
    if (f.agrupar === 'estado') return r.estado || '—'
    if (f.agrupar === 'cliente') return r.cliente || 'Sin nombre'
    if (f.agrupar === 'mes') { const ts = fechaTs(r); if (!ts) return 'Sin fecha'; const dd = new Date(ts); return MESES[dd.getMonth()] + ' ' + dd.getFullYear() }
    return ''
  }
  const pagina_ = visibles.slice(0, limite)

  /* Productos de la fila seleccionada (se piden al seleccionar, como el original) */
  const [items, setItems] = useState<Record<string, Fila>>({})
  const cargarItems = useCallback((r: Fila) => {
    if (items[r.uuid]) return
    supabase.from('facturas').select('items,historial').eq('id', r.uuid).single().then(({ data }) => {
      const d = (data ?? {}) as { items?: Linea[]; historial?: Fila['historial'] }
      setItems((m) => ({ ...m, [r.uuid]: { ...r, items: d.items ?? [], historial: d.historial ?? [] } }))
    })
  }, [items])
  useEffect(() => { if (sel) cargarItems(sel) }, [sel, cargarItems])
  const conItems = (r: Fila | null) => (r ? items[r.uuid] ?? r : null)

  // Imágenes de respaldo: si la línea no trae imagen propia (facturas antiguas migradas), se busca
  // por código en productos — así cualquier listado de productos de Facturación muestra foto.
  const [imgPorCodigo, setImgPorCodigo] = useState<Record<string, string>>({})
  useEffect(() => {
    const todas = [conItems(sel), conItems(detalle)].filter(Boolean) as Fila[]
    const faltan = [...new Set(todas.flatMap((f) => (f.items ?? []).filter((l) => !l.imagen && l.codigo && !imgPorCodigo[l.codigo!]).map((l) => l.codigo as string)))]
    if (!faltan.length) return
    supabase.from('productos').select('codigo,imagen_url').in('codigo', faltan).then(({ data }) => {
      const m: Record<string, string> = {}
      for (const p of (data as { codigo: string; imagen_url: string | null }[]) ?? []) if (p.imagen_url) m[p.codigo] = p.imagen_url
      if (Object.keys(m).length) setImgPorCodigo((x) => ({ ...x, ...m }))
    })
  }, [sel, detalle, items]) // eslint-disable-line react-hooks/exhaustive-deps

  function accion(qa: string, r: Fila) {
    if (qa === 'detalle') { setDetalle(conItems(r)); return }
    if (qa === 'factura') { if (!r.datosCompletos) return; setFactura(conItems(r)); return }
    const abrir = (u: string) => window.open(u, '_blank', 'noopener')
    const abrirDelBucket = (ruta: string) => {
      if (/^https?:\/\//i.test(ruta)) return abrir(ruta)
      supabase.storage.from('despachos').createSignedUrl(ruta, 3600).then(({ data, error }) => {
        if (error) { aviso('No se pudo abrir la guía: ' + error.message); return }
        if (!data) return
        if (!ruta.endsWith('.html')) return abrir(data.signedUrl)
        /* Supabase a veces sirve el .html con un content-type que el navegador
           no renderiza (se ve el código fuente en vez de la página). Se vuelve
           a empaquetar como blob con el tipo correcto antes de abrirlo. */
        fetch(data.signedUrl).then((res) => res.blob()).then((b) => abrir(URL.createObjectURL(new Blob([b], { type: 'text/html;charset=utf-8' }))))
          .catch(() => abrir(data.signedUrl))
      })
    }
    if (qa === 'verFactura' && r.facturaUrl) return abrir(r.facturaUrl)
    if (qa === 'verActa' && r.actaUrl) return abrirDelBucket(r.actaUrl)
    if (qa === 'verGuiaEnvio' && r.guiaEnvioUrl) return abrirDelBucket(r.guiaEnvioUrl)
    if (qa === 'verGuiaDespacho' && r.guiaDespachoUrl) return abrirDelBucket(r.guiaDespachoUrl)
    if (qa === 'conformidad' && r.actaConformidadUrl) return abrir(r.actaConformidadUrl)
    if (qa === 'guiaEnvio') { setGuiaEnvio(r); return }
    if (qa === 'guiaDespacho') { setGuiaDespacho(r); return }
    if (qa === 'acta') { setActa(r); return }
    if (qa === 'obsequio') { setObsequioModal(r); return }
    if (qa === 'nc') { setNotasCredito(r); return }
  }

  function exportarCsv() {
    const esc = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const filas = [['ID', 'Fecha', 'Cliente', 'Identificación', 'Asesor', 'Factura', 'Monto', 'Estado'].map(esc).join(','),
      ...visibles.map((r) => [r.id, fechaCorta(fechaTs(r), r.fechaGanado), r.cliente, r.identificacion, r.asesor, r.numeroFactura, totalFila(r).toFixed(2), r.estado].map(esc).join(','))]
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + filas.join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = 'facturacion_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click()
  }
  const nFiltros = (f.asesor ? 1 : 0) + (f.medio ? 1 : 0) + (f.desde ? 1 : 0) + (f.hasta ? 1 : 0) + Object.values(f.chips).filter(Boolean).length + (f.agrupar ? 1 : 0)
  const th = (k: string, t: string, cls = '') => (
    <button key={k} type="button" data-sort={k} className={(orden.k === k ? 'on ' : '') + cls} onClick={() => setOrden((o) => (o.k === k ? { ...o, d: -o.d, tocado: true } : { k, d: k === 'fecha' || k === 'monto' ? -1 : 1, tocado: true }))}>
      {t}{orden.k === k && (orden.d < 0 ? <ArrowDown /> : <ArrowUp />)}
    </button>
  )
  const kpi = (Icon: typeof Receipt, c: string, b: string, val: number, lab: string, onClick?: () => void) => (
    <div className="fx-kpi" style={{ ['--kc' as string]: c, ['--kb' as string]: b, cursor: onClick ? 'pointer' : undefined }} role={onClick ? 'button' : undefined} onClick={onClick}>
      <span className="ic"><Icon /></span><div className="min-w-0"><b>{val}</b><small>{lab}</small></div>
    </div>
  )
  const irChip = (k: string) => { setFiltro('ALL'); setF((x) => ({ ...x, chips: { ...x.chips, [k]: !x.chips[k] } })); setLimite(PAGE_SIZE) }

  const fila = (r: Fila) => {
    const ts = fechaTs(r), monto = totalFila(r)
    const alerta = !r.datosCompletos || (r.estado === 'Facturado' && (!r.guiaDespachoUrl || !r.obsequioId)), esFm = r.empresa === 'FEMEDICS'
    let acc: React.ReactNode
    if (r.estado === 'Pendiente') acc = !r.datosCompletos
      ? <span className="text-[10px] font-bold text-red-600" title="Faltan datos de pago/entrega"><TriangleAlert className="w-4 h-4" /></span>
      : <button type="button" className="fx-act-btn" data-qa="factura" onClick={(e) => { e.stopPropagation(); accion('factura', r) }}><Upload /><span className="fx-act-lbl">Facturar</span></button>
    else if (r.facturaUrl) acc = <button type="button" className="fx-act-btn ghost" data-qa="verFactura" onClick={(e) => { e.stopPropagation(); accion('verFactura', r) }}><Eye /><span className="fx-act-lbl">Ver</span></button>
    else acc = <button type="button" className="fx-act-btn ghost" data-qa="detalle" onClick={(e) => { e.stopPropagation(); accion('detalle', r) }}><List /><span className="fx-act-lbl">Detalle</span></button>
    return (
      <div key={r.uuid} className={'fx-tr' + (selId === r.uuid ? ' is-sel' : '') + (esFm ? ' fx-fm' : '')} title={esFm ? 'Factura solicitada por FEMEDICS' : undefined}
        onClick={() => { if (esPc) setSelId(r.uuid); else setDetalle(conItems(r)) }}>
        <span className="fx-av fx-sm">{iniciales(r.cliente)}</span>
        <div className="fx-lg flex-col leading-tight"><b className="text-[11.5px] text-slate-700">{fechaCorta(ts, r.fechaGanado)}</b><small className="text-[9.5px] font-mono-spec text-slate-400 truncate">{r.id}</small></div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-800 truncate flex items-center gap-1.5">{alerta && <span className="fx-alert-dot" title="Requiere atención" />}{esFm && <span className="fx-emp">FEMEDICS</span>}<span className="truncate">{r.cliente || 'Sin nombre'}</span></p>
          <p className="fx-lg text-[10px] text-slate-400 truncate">{r.identificacion || '—'}{r.medio ? ' · ' + r.medio : ''}</p>
          <p className="fx-sm text-[10px] text-slate-400 truncate">{fechaCorta(ts, r.fechaGanado)} · {r.asesor || 'Sin asesor'}{monto ? <> · <b className="text-slate-600">{money(monto)}</b></> : null}</p>
        </div>
        <div className="fx-lg fx-xl min-w-0"><span className="block truncate text-[11px] font-semibold text-slate-600">{r.asesor || '—'}</span></div>
        <div className="fx-lg fx-xl min-w-0"><span className={'block truncate text-[11px] font-mono-spec ' + (r.numeroFactura ? 'text-slate-700 font-semibold' : 'text-slate-300')}>{r.numeroFactura || '—'}</span></div>
        <div className="fx-lg"><b className="text-xs" style={{ color: 'var(--primary)' }}>{monto ? money(monto) : <span className="text-slate-300">—</span>}</b></div>
        <div className="fx-lg fx-xl fx-docs">
          <span className={'fx-doc ' + (r.facturaUrl ? 'ok' : '')} title="Factura PDF"><Receipt /></span>
          <span className={'fx-doc ' + (r.actaUrl ? 'ok' : '')} title="Acta de garantía"><FileCheck2 /></span>
          <span className={'fx-doc ' + (r.guiaDespachoUrl ? 'ok' : 'warn')} title="Guía de despacho"><Boxes /></span>
          <span className={'fx-doc ' + (r.guiaEnvioUrl ? 'ok' : '')} title="Guía de envío (etiqueta)"><Truck /></span>
          <span className={'fx-doc ' + (r.obsequioId ? 'ok' : r.estado === 'Facturado' ? 'warn' : '')} title="Obsequio de evangelización"><Gift /></span>
        </div>
        <div className="flex justify-end lg:justify-start"><span className={'fx-st ' + (r.estado === 'Facturado' ? 'f' : 'p')}>{r.estado || '—'}</span></div>
        <div className="fx-lg justify-end">{acc}</div>
      </div>
    )
  }

  const cuerpoLista = () => {
    if (error) return <div className="text-center text-xs text-red-600 py-14">{error}</div>
    if (cola === null) return <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400"><span className="inline-block w-5 h-5 rounded-full border-2 border-slate-300 border-t-[color:var(--primary)] animate-spin" /><p className="text-xs font-semibold">Cargando Facturación...</p></div>
    if (!visibles.length) return <div className="text-center text-slate-400 text-xs py-14"><Inbox className="w-8 h-8 mx-auto mb-2 text-slate-300" />No hay registros que coincidan.</div>
    if (!f.agrupar) return pagina_.map(fila)
    const grupos: Record<string, { n: number; m: number }> = {}, ord: string[] = []
    visibles.forEach((r) => { const g = claveGrupo(r); if (!grupos[g]) { grupos[g] = { n: 0, m: 0 }; ord.push(g) } grupos[g].n++; grupos[g].m += totalFila(r) })
    const por: Record<string, Fila[]> = {}; pagina_.forEach((r) => { (por[claveGrupo(r)] = por[claveGrupo(r)] || []).push(r) })
    if (f.agrupar !== 'mes') ord.sort((a, b) => grupos[b].m - grupos[a].m)
    return ord.filter((g) => por[g]).map((g) => (
      <div key={g}><div className="fx-grp"><Folder className="w-3.5 h-3.5" />{g} <small>{grupos[g].n} registro{grupos[g].n === 1 ? '' : 's'}</small><b>{money(grupos[g].m)}</b></div>{por[g].map(fila)}</div>
    ))
  }

  // Scroll infinito: al acercarse al final de la lista ya cargada, se revela más.
  useEffect(() => {
    const el = centinela.current
    if (!el) return
    const obs = new IntersectionObserver((entradas) => { if (entradas[0]?.isIntersecting) setLimite((l) => l + PAGE_SIZE) }, { rootMargin: '600px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [visibles.length])

  return (
    <div className="vm-fact">
      <header className="sticky top-0 z-30" style={{ background: 'linear-gradient(135deg, var(--navy), var(--primary))' }}>
        <div className="fx-head vm-head-pad px-3 sm:px-5 py-2 min-h-14 flex items-center gap-2 flex-wrap lg:flex-nowrap">
          <div className="min-w-0 flex-1 lg:flex-none lg:max-w-[250px] order-1 flex flex-col justify-center min-h-10">
            <h1 className="font-display font-bold text-white text-[15px] sm:text-base leading-tight truncate">Facturación Vimedic</h1>
            <p className="text-[11px] text-white/60 truncate leading-tight">{perfil.nombre.split(' ')[0]} · Ventas, facturas, actas y guías</p>
          </div>
          <div className="order-3 lg:order-2 w-full lg:w-auto flex items-center gap-2 pb-1 lg:pb-0">
            <div className="relative flex-1 lg:flex-none">
              <input type="text" value={buscar} onChange={(e) => { setBuscar(e.target.value); setLimite(PAGE_SIZE) }} placeholder="Buscar cliente, RUC, asesor, factura..." autoComplete="off"
                className="w-full lg:w-64 xl:w-80 pl-8 pr-3 py-2 rounded-lg bg-white/10 text-white placeholder:text-white/55 text-xs focus:outline-none focus:ring-2 focus:ring-white/40" />
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60" />
            </div>
            <div className="relative shrink-0" ref={filtrosRef}>
              <button type="button" className="relative w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" title="Filtros y agrupación" onClick={(e) => { e.stopPropagation(); setPanelFiltros((v) => !v) }}>
                <SlidersHorizontal className="w-4 h-4" />
                {nFiltros > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-amber-400 text-[9px] font-bold text-slate-900 flex items-center justify-center">{nFiltros}</span>}
              </button>
              {panelFiltros && (
                <div className="absolute left-0 top-full mt-2 z-[90] w-[320px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-2xl border border-slate-100 p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-800">Filtros y agrupación</p><button type="button" className="text-[11px] font-bold" style={{ color: 'var(--primary)' }} onClick={() => { setF(FILTROS0); setLimite(PAGE_SIZE) }}>Limpiar</button></div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="fx-lab">Asesor<select className="fx-in" value={f.asesor} onChange={(e) => { setF({ ...f, asesor: e.target.value }); setLimite(PAGE_SIZE) }}><option value="">Todos</option>{asesores.map((a) => <option key={a}>{a}</option>)}</select></label>
                    <label className="fx-lab">Medio<select className="fx-in" value={f.medio} onChange={(e) => { setF({ ...f, medio: e.target.value }); setLimite(PAGE_SIZE) }}><option value="">Todos</option>{medios.map((a) => <option key={a}>{a}</option>)}</select></label>
                    <label className="fx-lab">Desde<input type="date" className="fx-in" value={f.desde} onChange={(e) => { setF({ ...f, desde: e.target.value }); setLimite(PAGE_SIZE) }} /></label>
                    <label className="fx-lab">Hasta<input type="date" className="fx-in" value={f.hasta} onChange={(e) => { setF({ ...f, hasta: e.target.value }); setLimite(PAGE_SIZE) }} /></label>
                  </div>
                  <div><p className="fx-lab mb-1.5">Mostrar solo</p>
                    <div className="flex flex-wrap gap-1.5">{Object.entries(NOMBRES_CHIP).map(([k, t]) => <button key={k} type="button" className={'fx-chip' + (f.chips[k] ? ' active' : '')} onClick={() => { setF({ ...f, chips: { ...f.chips, [k]: !f.chips[k] } }); setLimite(PAGE_SIZE) }}>{t}</button>)}</div></div>
                  <label className="fx-lab">Agrupar por
                    <select className="fx-in" value={f.agrupar} onChange={(e) => { setF({ ...f, agrupar: e.target.value }); setLimite(PAGE_SIZE) }}>
                      <option value="">Sin agrupar</option><option value="asesor">Asesor</option><option value="mes">Mes</option><option value="medio">Medio de captación</option><option value="estado">Estado</option><option value="cliente">Cliente</option>
                    </select></label>
                </div>
              )}
            </div>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-white/75 bg-white/10 rounded-lg px-2.5 py-2" title="Registros en la vista"><b className="text-white">{visibles.length}</b> {visibles.length === 1 ? 'registro' : 'registros'}</span>
          </div>
          <div className="order-2 lg:order-3 flex items-center gap-1 shrink-0 lg:ml-auto">
            <button type="button" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" title="Exportar vista a CSV" onClick={exportarCsv}><Download className="w-4 h-4" /></button>
            <button type="button" className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" title="Actualizar" onClick={() => { cargar(filtro); cargarStats() }}><RefreshCw className={'w-4 h-4 ' + (cargando ? 'animate-spin' : '')} /></button>
          </div>
        </div>
      </header>

      <main className="w-full px-3 sm:px-5 py-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="fx-seg">
            <button className={'tab' + (filtro === 'Pendiente' ? ' active' : '')} type="button" onClick={() => { setFiltro('Pendiente'); setLimite(PAGE_SIZE); setBuscar('') }}><Clock />Pendientes<span className="fx-n">{stats.pendientes}</span></button>
            <button className={'tab' + (filtro === 'ALL' ? ' active' : '')} type="button" onClick={() => { setFiltro('ALL'); setLimite(PAGE_SIZE); setBuscar('') }}><Layers />Todos<span className="fx-n">{stats.pendientes + stats.facturados}</span></button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {f.asesor && <span className="fx-pill-f">Asesor: {f.asesor}<button type="button" aria-label="Quitar" onClick={() => setF({ ...f, asesor: '' })}>×</button></span>}
            {f.medio && <span className="fx-pill-f">Medio: {f.medio}<button type="button" aria-label="Quitar" onClick={() => setF({ ...f, medio: '' })}>×</button></span>}
            {f.desde && <span className="fx-pill-f">Desde {f.desde}<button type="button" aria-label="Quitar" onClick={() => setF({ ...f, desde: '' })}>×</button></span>}
            {f.hasta && <span className="fx-pill-f">Hasta {f.hasta}<button type="button" aria-label="Quitar" onClick={() => setF({ ...f, hasta: '' })}>×</button></span>}
            {Object.keys(f.chips).filter((k) => f.chips[k]).map((k) => <span key={k} className="fx-pill-f">{NOMBRES_CHIP[k]}<button type="button" aria-label="Quitar" onClick={() => setF({ ...f, chips: { ...f.chips, [k]: false } })}>×</button></span>)}
            {f.agrupar && <span className="fx-pill-f">Agrupado por {f.agrupar}<button type="button" aria-label="Quitar" onClick={() => setF({ ...f, agrupar: '' })}>×</button></span>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3">
          {kpi(Receipt, '#055c9d', '#eaf3fb', stats.facturados, 'Facturas totales', () => { setFiltro('ALL'); setLimite(PAGE_SIZE) })}
          {kpi(Clock, '#c98a1f', '#fff5e6', stats.pendientes, 'Pendientes por facturar', () => { setFiltro('Pendiente'); setLimite(PAGE_SIZE) })}
          {kpi(Boxes, '#c0392b', '#fdecea', stats.guias, 'Guías pendientes', () => irChip('guia'))}
          {kpi(FileCheck2, '#04896f', '#e7f6f2', stats.actas, 'Actas pendientes', () => irChip('sinActa'))}
          {kpi(ReceiptText, '#7c3aed', '#f3eefe', stats.notas, 'Notas de crédito')}
        </div>

        <div className="fx-split">
          <div className="fx-tbl min-w-0" id="fx-lista">
            <div className="fx-th">
              {th('fecha', 'Fecha')}{th('cliente', 'Cliente')}{th('asesor', 'Asesor', 'fx-xl')}{th('factura', 'Factura', 'fx-xl')}{th('monto', 'Monto')}
              <span className="fx-xl text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Docs</span>{th('estado', 'Estado')}
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 text-right"><span className="fx-act-lbl">Acción</span></span>
            </div>
            <div>{cuerpoLista()}</div>
            {visibles.length > 0 && (
              <div className="fx-pager">
                <span className="fx-pg-info">{Math.min(visibles.length, limite)} de {visibles.length}</span>
              </div>
            )}
            {visibles.length > limite && <div ref={centinela} className="py-6 text-center text-[11px] text-slate-400">Cargando más facturas…</div>}
          </div>
          <aside className="fx-side">{PanelLateral(conItems(sel), accion, imgPorCodigo)}</aside>
        </div>
      </main>

      {detalle && <Detalle r={conItems(detalle) ?? detalle} perfil={perfil} puedeEditar={puedeEditar} cerrar={() => setDetalle(null)} accion={accion} imgPorCodigo={imgPorCodigo}
        facturar={(r) => { setDetalle(null); setFactura(conItems(r)) }} aviso={aviso} recargar={() => { cargar(filtro); cargarStats(); setItems({}) }} />}
      {factura && <ModalFactura r={factura} perfil={perfil} cerrar={() => setFactura(null)} aviso={aviso} guardado={() => { setFactura(null); aviso('Factura registrada.'); cargar(filtro); cargarStats(); setItems({}) }} />}
      {notasCredito && <ModalNotasCredito r={notasCredito} cerrar={() => setNotasCredito(null)} aviso={aviso} />}
      {guiaEnvio && <ModalGuiaEnvio r={guiaEnvio} cerrar={() => setGuiaEnvio(null)} guardado={() => { setGuiaEnvio(null); aviso('Guía de envío generada.'); cargar(filtro); cargarStats(); setItems({}) }} />}
      {guiaDespacho && <ModalGuiaDespacho r={conItems(guiaDespacho) ?? guiaDespacho} cerrar={() => setGuiaDespacho(null)} aviso={aviso} guardado={() => { setGuiaDespacho(null); cargar(filtro); cargarStats(); setItems({}) }} />}
      {acta && <ModalActaGarantia r={conItems(acta) ?? acta} cerrar={() => setActa(null)} aviso={aviso} guardado={() => { setActa(null); cargar(filtro); cargarStats(); setItems({}) }} />}
      {obsequioModal && <ModalObsequio r={conItems(obsequioModal) ?? obsequioModal} cerrar={() => setObsequioModal(null)} aviso={aviso} guardado={() => { setObsequioModal(null); cargar(filtro); setItems({}) }} />}
    </div>
  )
}

/* ============================ Panel lateral ============================ */
function PanelLateral(r: Fila | null, accion: (qa: string, r: Fila) => void, imgPorCodigo: Record<string, string>) {
  if (!r) return <div className="p-10 text-center text-xs text-slate-400">Selecciona un registro para ver su resumen.</div>
  const monto = totalFila(r)
  const act = (qa: string, Icono: typeof Receipt, color: string, label: string, off?: boolean) => (
    <button key={qa + label} type="button" className={'fx-act' + (off ? ' off' : '')} onClick={() => accion(qa, r)}><span className="ic" style={{ ['--c' as string]: color }}><Icono /></span>{label}</button>
  )
  const acts = [act('detalle', FilePenLine, '#0b2545', 'Facturar')]
  acts.push(r.estado === 'Pendiente' ? act('factura', Upload, '#055c9d', 'Subir factura', !r.datosCompletos) : act('verFactura', Receipt, '#055c9d', 'Ver factura', !r.facturaUrl))
  if (r.estado === 'Facturado' || r.actaUrl) {
    acts.push(r.actaUrl ? act('verActa', FileCheck2, '#04896f', 'Ver acta .pdf') : act('acta', FilePlus2, '#04896f', 'Generar acta'))
  }
  if (r.estado === 'Facturado' || r.guiaDespachoUrl) {
    acts.push(r.guiaDespachoUrl ? act('verGuiaDespacho', Boxes, '#c98a1f', 'Ver guía despacho') : act('guiaDespacho', Boxes, '#c0392b', 'Generar guía despacho'))
  }
  if (r.esEnvio || r.guiaEnvioUrl) {
    acts.push(r.guiaEnvioUrl ? act('verGuiaEnvio', Truck, '#c98a1f', 'Ver etiqueta envío') : act('guiaEnvio', Truck, '#64748b', 'Generar etiqueta envío'))
  }
  if (r.actaConformidadUrl) acts.push(act('conformidad', BadgeCheck, '#17a9ba', 'Conformidad'))
  if (r.estado === 'Facturado' || r.obsequioId) acts.push(act('obsequio', Gift, '#ec4899', r.obsequioId ? 'Cambiar obsequio' : 'Elegir obsequio'))
  if (r.numeroFactura) acts.push(act('nc', ReceiptText, '#7c3aed', 'Notas crédito'))
  const lineas = r.items
  let sSub = 0, sDesc = 0, sIva = 0, sTot = 0, uds = 0
  lineas?.forEach((l) => { const c = calc(l); sSub += c.bruto; sDesc += c.descuentoUsd; sIva += c.ivaUsd; sTot += c.total; uds += c.cantidad })
  return (
    <>
      <div className="fx-side-head">
        <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-mono-spec text-white/70 truncate">{r.id}</span><span className={'fx-st ' + (r.estado === 'Facturado' ? 'f' : 'p')}>{r.estado}</span></div>
        <h3 className="font-display font-bold text-lg leading-snug mt-1.5">{r.cliente || 'Sin nombre'}</h3>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {r.empresa === 'FEMEDICS' && <span className="fx-hchip" style={{ background: '#0cc4cf', color: '#fff', fontWeight: 800 }}><Building2 />Solicita: FEMEDICS</span>}
          {tiene(r.medio) && <span className="fx-hchip"><Megaphone />{r.medio}</span>}
          {tiene(r.numeroFactura) && <span className="fx-hchip"><Hash />Factura {r.numeroFactura}</span>}
        </div>
        <div className="flex items-end justify-between gap-2 mt-2.5"><p className="text-[11px] text-white/70">{r.asesor || 'Sin asesor'} · {fechaCorta(fechaTs(r), r.fechaGanado)}</p>{monto ? <p className="font-display font-bold text-xl">{money(monto)}</p> : null}</div>
      </div>
      <div className="fx-acts">{acts}</div>
      <div className="px-4 pb-4 space-y-3">
        {!r.datosCompletos && <div className="flex items-start gap-2 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"><TriangleAlert className="w-4 h-4 shrink-0" /><span>Faltan datos de pago/entrega. Debe regularizarse desde el CRM antes de facturar.</span></div>}
        {r.estado === 'Facturado' && !r.guiaDespachoUrl && <div className="flex items-start gap-2 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"><Boxes className="w-4 h-4 shrink-0" /><span>Falta generar la guía de despacho (obligatoria).</span></div>}
        {r.nota && <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" style={{ whiteSpace: 'pre-line' }}><b>Nota interna:</b> {r.nota}</div>}
        <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2">
          <div className="flex items-center justify-between mb-0.5"><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Productos de la venta</p>{lineas?.length ? <span className="text-[10px] font-bold text-slate-400">{lineas.length} ítem{lineas.length === 1 ? '' : 's'}</span> : null}</div>
          {!lineas && <p className="text-[11px] text-slate-400 py-3 text-center flex items-center justify-center gap-2"><span className="inline-block w-4 h-4 rounded-full border-2 border-slate-300 border-t-[color:var(--primary)] animate-spin" />Buscando productos…</p>}
          {lineas && !lineas.length && <p className="text-[11px] text-slate-400 py-3 text-center">Esta venta no tiene productos registrados.</p>}
          {lineas?.map((l, k) => {
            const c = calc(l)
            return (
              <div key={k} className="flex items-center gap-2.5 py-2.5 border-b border-slate-100 last:border-0">
                {(() => { const img = l.imagen || (l.codigo ? imgPorCodigo[l.codigo] : undefined); return img
                  ? <img loading="lazy" src={imagen(img, 120)} onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} className="w-11 h-11 rounded-xl object-cover bg-slate-50 border border-slate-100 shrink-0" alt="" />
                  : <span className="w-11 h-11 rounded-xl bg-slate-100 text-slate-300 flex items-center justify-center shrink-0"><Package className="w-5 h-5" /></span> })()}
                <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-slate-800 leading-snug line-clamp-2">{l.nombre}</p>
                  {l.observacion && <p className="mt-1 text-[10.5px] rounded-lg px-2 py-0.5 inline-block" style={{ background: '#fffaf0', border: '1px solid #f2dfb9', color: '#7b5a1e' }}>{l.observacion}</p>}
                  <p className="text-[10px] text-slate-400 mt-0.5">{l.codigo || ''} · {c.cantidad} × {money(c.precio)}{c.descuentoPct ? <> · <span style={{ color: 'var(--amber)' }}>−{c.descuentoPct}%</span></> : null} · {c.conIva ? 'IVA 15%' : 'IVA 0%'}</p></div>
                <b className="text-[12px] text-slate-800 shrink-0">{money(c.base)}</b>
              </div>
            )
          })}
          {lineas && lineas.length > 0 && (
            <div className="mt-2 rounded-xl p-3 space-y-1" style={{ background: 'linear-gradient(180deg,#f7fbfe,#eef6fb)', border: '1px solid #dcebf5' }}>
              <div className="flex justify-between text-[11px] text-slate-500"><span>Subtotal ({uds} u.)</span><span>{money(sSub)}</span></div>
              {sDesc > 0 && <div className="flex justify-between text-[11px]" style={{ color: 'var(--amber)' }}><span>Descuento</span><span>−{money(sDesc)}</span></div>}
              {sDesc > 0 && <div className="flex justify-between text-[11px] text-slate-500"><span>Base imponible</span><span>{money(sSub - sDesc)}</span></div>}
              <div className="flex justify-between text-[11px] text-slate-500"><span>IVA 15%</span><span>{money(sIva)}</span></div>
              <div className="flex justify-between items-end pt-1.5 mt-1 border-t border-slate-200"><span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Total</span><span className="font-display font-bold text-xl" style={{ color: 'var(--teal)' }}>{money(sTot)}</span></div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/* ============================ Detalle de venta ============================ */
function Detalle({ r, perfil, puedeEditar, cerrar, accion, facturar, aviso, recargar, imgPorCodigo }: {
  r: Fila; perfil: Perfil; puedeEditar: boolean; cerrar: () => void; accion: (qa: string, r: Fila) => void; facturar: (r: Fila) => void; aviso: (t: string) => void; recargar: () => void; imgPorCodigo: Record<string, string>
}) {
  const [full, setFull] = useState<Fila>(r)
  useEffect(() => {
    if (r.items) return
    supabase.from('facturas').select('items,historial').eq('id', r.uuid).single().then(({ data }) => { const d = (data ?? {}) as { items?: Linea[]; historial?: Fila['historial'] }; setFull({ ...r, items: d.items ?? [], historial: d.historial ?? [] }) })
  }, [r])
  const pe = full.pe
  const lineas = full.items
  let sSub = 0, sDesc = 0, sIva = 0, sTot = 0
  lineas?.forEach((l) => { const c = calc(l); sSub += c.bruto; sDesc += c.descuentoUsd; sIva += c.ivaUsd; sTot += c.total })
  const monto = totalFila(full) || sTot
  const fila = (label: string, v?: string | null, url?: string, wide?: boolean) => tiene(v) ? <div key={label} className={wide ? 'w' : undefined}><small>{label}</small><p>{url ? <a href={url} target="_blank" rel="noopener">{v}</a> : v}</p></div> : null
  const tarjeta = (icono: string, bg: string, titulo: string, filas: React.ReactNode[]) => { const v = filas.filter(Boolean); return v.length ? <section className="pm-info"><p className="t"><span className="ic" style={{ background: bg }}>{icono}</span>{titulo}</p><div className="pm-rows">{v}</div></section> : null }
  const chips: React.ReactNode[] = []
  if (full.empresa === 'FEMEDICS') chips.push(<span key="fm" className="pm-chip" style={{ background: '#0cc4cf', color: '#fff', borderColor: '#0cc4cf' }}>Solicita: FEMEDICS</span>)
  chips.push(<span key="es" className={'pm-chip ' + (full.estado === 'Facturado' ? 'ok' : 'warn')}>{full.estado || '—'}</span>)
  if (tiene(full.numeroFactura)) chips.push(<span key="nf" className="pm-chip"><Hash />Factura {full.numeroFactura}</span>)
  if (tiene(full.medio)) chips.push(<span key="me" className="pm-chip"><Megaphone />{full.medio}</span>)
  if (tiene(pe.entrega)) chips.push(<span key="en" className="pm-chip"><Truck />{pe.entrega}{pe.ciudad ? ' · ' + pe.ciudad : ''}</span>)
  if (tiene(pe.pago)) chips.push(<span key="pa" className="pm-chip"><CreditCard />{pe.pago}</span>)
  if (!full.datosCompletos) chips.push(<span key="dc" className="pm-chip" style={{ background: '#fdecea', color: '#c0392b', borderColor: '#f5c6c0' }}>Faltan datos de pago/entrega</span>)

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4 overlay" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal-panel bg-[#f6f9fc] sm:rounded-3xl shadow-2xl w-full h-full sm:h-[94vh] sm:max-w-[1300px] flex flex-col overflow-hidden">
        <div className="pm-head shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" /><span>Detalle de venta</span></p>
              <h3 className="font-display font-bold text-xl leading-tight mt-1 truncate">{full.cliente || 'Sin nombre'}</h3>
              <p className="text-[11px] text-white/75 truncate mt-0.5">{[full.id, full.identificacion, full.asesor, fechaCorta(fechaTs(full), full.fechaGanado)].filter(tiene).join(' · ')}</p>
            </div>
            <div className="flex items-start gap-3 shrink-0">
              <div className="text-right"><p className="text-[9px] font-bold uppercase tracking-wider text-white/60">Total</p><p className="font-display font-bold text-2xl leading-tight">{monto ? money(monto) : ''}</p></div>
              <button type="button" onClick={cerrar} className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">{chips}</div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="lg:overflow-y-auto p-4 sm:p-5 space-y-4 min-w-0">
            {tiene(full.nota) && <div className="pm-note"><b>⚠️ Nota importante · bodega y logística</b>{full.nota}</div>}
            <section className="pm-card">
              <div className="flex items-center justify-between gap-2 mb-2"><p className="pm-h"><Package />Productos</p><span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-500">{lineas ? lineas.length : 0} producto{lineas?.length === 1 ? '' : 's'}</span></div>
              {!lineas && <div className="text-center text-slate-400 text-xs py-10">Cargando productos…</div>}
              {lineas && !lineas.length && <div className="text-center text-slate-400 text-xs py-10">Sin líneas de producto.</div>}
              {lineas?.map((l, k) => {
                const c = calc(l)
                return (
                  <div key={k} className="pm-prod">
                    {(() => { const img = l.imagen || (l.codigo ? imgPorCodigo[l.codigo] : undefined); return img
                      ? <img loading="lazy" src={imagen(img, 120)} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                      : <span className="ph"><Package className="w-5 h-5" /></span> })()}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-bold text-slate-800 leading-snug"><span className="font-mono-spec text-[10.5px] text-slate-400 mr-1.5">{l.codigo || 'Sin ID'}</span>{l.nombre}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2"><span>{money(c.precio)} c/u</span>{c.descuentoPct ? <span style={{ color: 'var(--amber)' }}>−{String(Math.round(c.descuentoPct * 100) / 100).replace('.', ',')}%</span> : null}<span>{c.conIva ? 'IVA 15%' : 'IVA 0%'}</span></p>
                      {l.observacion && <p className="mt-1 text-[10.5px] rounded-lg px-2 py-1 inline-block" style={{ background: '#fffaf0', border: '1px solid #f2dfb9', color: '#7b5a1e' }}>{l.observacion}</p>}
                    </div>
                    <span className="pm-qty" style={{ background: '#fff5e6', color: '#b7791f' }}>−{c.cantidad}</span>
                    <b className="text-[13px] text-slate-800 w-24 text-right shrink-0">{money(c.total)}</b>
                  </div>
                )
              })}
              {lineas && lineas.length > 0 && (
                <div className="pm-totals"><div><span>Subtotal</span><b>{money(sSub)}</b></div><div><span>Descuento</span><b style={{ color: 'var(--amber)' }}>{sDesc ? '−' : ''}{money(sDesc)}</b></div><div><span>IVA</span><b>{money(sIva)}</b></div><div className="tot"><span>Total</span><b>{money(sTot)}</b></div></div>
              )}
            </section>
            <div className="min-w-0"><div className="pm-grid">
              {tarjeta('👤', '#eaf3fb', 'Cliente', [fila('Cédula / RUC', full.identificacion), fila('Teléfono', full.telefono), fila('Correo', full.email, undefined, true), fila('Medio de captación', full.medio)])}
              {tarjeta('💳', '#e7f6f2', 'Pago', [fila('Forma de pago', pe.pago), fila('Tipo de pago', pe.tipoPago), fila('Plazo de crédito', pe.plazoCredito), fila('Observación', pe.observacionPago, undefined, true)])}
              {tarjeta('🚚', '#fff5e6', 'Entrega', [fila('Tipo de entrega', pe.entrega), fila('Fecha de entrega', pe.fechaEntrega), fila('Ciudad', pe.ciudad), fila('Transporte', pe.transporte), fila('Dirección de envío', pe.direccionEnvio, undefined, true), fila('Dirección local', pe.direccionEntregaLocal, undefined, true),
                fila('Destinatario', pe.nombreDestinatario), fila('Cédula destinatario', pe.cedulaDestinatario), fila('Teléfono destinatario', pe.telefonoDestinatario), fila('Email destinatario', pe.emailDestinatario), fila('Quién recibe', pe.quienRecibe), fila('Teléfono entrega', pe.telefonoEntregaLocal),
                tiene(pe.urlGoogleMaps) ? fila('Google Maps', 'Abrir ubicación', pe.urlGoogleMaps) : null])}
              {tarjeta('📦', '#f3edff', 'Empaque y garantía', [fila('Empaque caja', pe.empaqueCaja), fila('Empaque armado', pe.empaqueArmado), fila('Empaque stretch', pe.empaqueStretch), fila('Carta de garantía', pe.cartaGarantia), fila('Remitente', pe.nombreRemitente), fila('Cédula remitente', pe.cedulaRemitente), fila('Teléfono remitente', pe.telefonoRemitente)])}
            </div></div>
          </div>
          <aside className="bg-white border-t lg:border-t-0 lg:border-l border-slate-200 lg:overflow-y-auto">
            <div className="p-4 space-y-3">
              <p className="font-display font-bold text-sm text-slate-800">Documentos</p>
              <div className="pm-doc">
                <p className="pm-doc-h"><span className="ic" style={{ ['--c' as string]: '#055c9d' }}><Receipt /></span>Factura</p>
                {full.estado === 'Facturado'
                  ? <div className="space-y-2"><p className="text-[11px] text-slate-600">Nº <b className="font-mono-spec">{full.numeroFactura || '—'}</b></p>{full.facturaUrl && <button type="button" className="pm-btn ok w-full" onClick={() => accion('verFactura', full)}>Ver factura .pdf</button>}</div>
                  : puedeEditar && full.datosCompletos
                    ? <button type="button" className="w-full text-white text-xs font-bold py-2.5 rounded-xl" style={{ background: 'linear-gradient(135deg,var(--primary),var(--cyan))' }} onClick={() => facturar(full)}>Registrar factura</button>
                    : <p className="text-[11px] text-slate-400">{full.datosCompletos ? 'Sin permiso para facturar.' : 'Faltan datos de pago/entrega: regularízalos desde el CRM.'}</p>}
              </div>
              {(full.estado === 'Facturado' || full.actaUrl) && (
                <div className="pm-doc"><p className="pm-doc-h"><span className="ic" style={{ ['--c' as string]: '#04896f' }}><FileCheck2 /></span>Acta de entrega / garantía</p>
                  {full.actaUrl ? <button type="button" className="pm-btn ok w-full" onClick={() => accion('verActa', full)}>Ver acta .pdf</button> : <button type="button" className="pm-btn solid w-full" style={{ background: '#04896f' }} onClick={() => accion('acta', full)}>Generar acta</button>}</div>
              )}
              <div className="pm-doc">
                <p className="pm-doc-h"><span className="ic" style={{ ['--c' as string]: '#ec4899' }}><Gift /></span>Obsequio de evangelización <span className="text-red-600">*</span></p>
                {full.obsequioId ? (
                  <div className="flex items-center gap-2">
                    {full.obsequioImagen ? <img src={imagen(full.obsequioImagen, 80)} className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0" alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0"><Gift className="w-4 h-4 text-slate-300" /></span>}
                    <span className="text-[11.5px] font-semibold text-slate-700 flex-1 truncate">{full.obsequioNombre}</span>
                    {puedeEditar && <button type="button" className="pm-btn !h-9 !px-2.5 shrink-0" onClick={() => accion('obsequio', full)}>Cambiar</button>}
                  </div>
                ) : puedeEditar ? (
                  <button type="button" className="pm-btn solid w-full" style={{ background: '#ec4899' }} onClick={() => accion('obsequio', full)}>Elegir obsequio</button>
                ) : <p className="text-[11px] text-slate-400">Sin obsequio asignado.</p>}
              </div>
              {(full.estado === 'Facturado' || full.guiaDespachoUrl) && (
                <div className="pm-doc"><p className="pm-doc-h"><span className="ic" style={{ ['--c' as string]: '#c0392b' }}><Boxes /></span>Guía de despacho <span className="text-red-600">*</span></p>
                  {full.guiaDespachoUrl ? <button type="button" className="pm-btn warn w-full" onClick={() => accion('verGuiaDespacho', full)}>Ver guía</button> : <button type="button" className="pm-btn solid w-full" style={{ background: '#c0392b' }} onClick={() => accion('guiaDespacho', full)}>Generar guía de despacho</button>}</div>
              )}
              {(full.esEnvio || full.guiaEnvioUrl) && (
                <div className="pm-doc"><p className="pm-doc-h"><span className="ic" style={{ ['--c' as string]: '#64748b' }}><Truck /></span>Guía de envío (etiqueta)</p>
                  {full.guiaEnvioUrl ? <button type="button" className="pm-btn warn w-full" onClick={() => accion('verGuiaEnvio', full)}>Ver etiqueta</button> : <button type="button" className="pm-btn solid w-full" style={{ background: '#64748b' }} onClick={() => accion('guiaEnvio', full)}>Generar etiqueta de envío</button>}</div>
              )}
              {tiene(full.numeroFactura) && (
                <div className="pm-doc"><p className="pm-doc-h"><span className="ic" style={{ ['--c' as string]: '#7c3aed' }}><ReceiptText /></span>Notas de crédito</p>
                  <button type="button" className="pm-btn w-full" style={{ borderColor: '#ddd0fb', background: '#f6f2ff', color: '#6d28d9' }} onClick={() => accion('nc', full)}>Notas de crédito / recepciones</button></div>
              )}
              <div className="pm-doc"><p className="pm-doc-h"><span className="ic" style={{ ['--c' as string]: '#475569' }}><History /></span>Historial de cambios</p>
                <div className="fx-hist">
                  {!full.historial && <p className="text-[11px] text-slate-400">Cargando historial…</p>}
                  {full.historial && !full.historial.length && <p className="text-[11px] text-slate-400">Sin cambios registrados.</p>}
                  {[...(full.historial ?? [])].reverse().slice(0, 60).map((x, k) => <div key={k} className="fx-hist-i"><small>{fechaCorta(Date.parse(x.fecha))} · {x.por || '—'}</small><b>{x.accion}</b>{x.detalle && <span>{x.detalle}</span>}</div>)}
                </div></div>
            </div>
          </aside>
        </div>
      </div>
      <span hidden>{perfil.id}{aviso.length}{recargar.length}</span>
    </div>
  )
}

/* ============================ Subir factura ============================ */
function ModalFactura({ r, perfil, cerrar, guardado, aviso }: { r: Fila; perfil: Perfil; cerrar: () => void; guardado: () => void; aviso: (t: string) => void }) {
  const [numero, setNumero] = useState(r.numeroFactura)
  const [enlace, setEnlace] = useState(r.facturaUrl)
  const [msg, setMsg] = useState('')
  const [guardando, setGuardando] = useState(false)
  const lineas = r.items
  const monto = totalFila(r)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])

  async function guardar() {
    setMsg('')
    const n = numero.trim()
    if (!/^\d{3}-\d{3}-\d{6,9}$/.test(n)) { setMsg('Escribe el número de factura como aparece en Contífico (001-001-000012345).'); return }
    if (enlace.trim() && !/^https?:\/\//i.test(enlace.trim())) { setMsg('El enlace debe empezar con https://'); return }
    setGuardando(true)
    const { data: act } = await supabase.from('facturas').select('historial').eq('id', r.uuid).single()
    const historial = [...(((act as { historial?: unknown[] } | null)?.historial ?? []) as unknown[]), { fecha: new Date().toISOString(), por: perfil.nombre, accion: 'Factura registrada', detalle: 'Nº ' + n }]
    const { error } = await supabase.from('facturas').update({
      estado: 'Facturado', numero_contifico: n, pdf_url: enlace.trim() || null, fecha_facturacion: new Date().toISOString().slice(0, 10), facturado_por: perfil.id, historial,
    }).eq('id', r.uuid)
    setGuardando(false)
    if (error) { setMsg(/duplicate|unique/i.test(error.message) ? 'Ese número de factura ya está registrado.' : error.message); return }
    guardado()
  }
  void aviso
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4 overlay" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal-panel bg-[#f6f9fc] sm:rounded-3xl shadow-2xl w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5"><Receipt className="w-3.5 h-3.5" />Subir factura · Contífico</span>
            <button type="button" onClick={cerrar} className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <h3 className="font-display font-bold text-lg leading-snug mt-1.5">{r.cliente || 'Venta'}</h3>
          <div className="flex items-end justify-between gap-2 mt-1"><p className="text-[11px] text-white/70">{[r.id, r.asesor, fechaCorta(fechaTs(r), r.fechaGanado)].filter(Boolean).join(' · ')}</p><p className="font-display font-bold text-xl">{monto ? money(monto) : ''}</p></div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          <div className="bg-white border border-slate-200 rounded-2xl px-3 py-1">
            {lineas?.length
              ? <><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-2 pb-1">Productos a facturar</p>{lineas.map((l, k) => { const c = calc(l); return (
                <div key={k}><div className="flex items-center justify-between gap-2 py-1.5 border-t border-slate-100 text-[11.5px]"><span className="min-w-0 truncate"><b className="text-slate-700">{c.cantidad}×</b> {l.nombre}</span><b className="text-slate-700 shrink-0">{money(c.total)}</b></div>
                  {l.observacion && <p className="-mt-0.5 mb-1 text-[10.5px] rounded-lg px-2 py-0.5 inline-block" style={{ background: '#fffaf0', border: '1px solid #f2dfb9', color: '#7b5a1e' }}>{l.observacion}</p>}</div>) })}</>
              : <p className="text-[11px] text-slate-400 py-2.5">Los productos se revisan en el detalle completo.</p>}
          </div>
          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: 'var(--primary)' }}>1</span><div className="flex-1"><b>Número de factura</b><small>Tal como aparece en Contífico</small></div></div>
            <div className="relative"><Hash className="fi-ico" /><input type="text" autoComplete="off" value={numero} onChange={(e) => setNumero(e.target.value.replace(/[^\d-]/g, ''))} placeholder="001-001-000012345" className="fi-in pl-9 font-mono-spec" /></div>
          </div>
          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: 'var(--primary)' }}>2</span><div className="flex-1"><b>PDF de la factura</b><small>Sube el archivo o pega su enlace</small></div></div>
            <label className="fi-drop" style={{ opacity: 0.6, cursor: 'not-allowed' }}><span className="fi-drop-ic"><FileUp /></span><span className="text-center"><b className="block text-[12.5px] text-slate-700">Elegir PDF</b><small className="text-[10.5px] text-slate-400">Disponible al conectar el almacenamiento de archivos</small></span></label>
            <div className="fi-or">o pega el enlace</div>
            <div className="relative"><Link2 className="fi-ico" /><input type="url" inputMode="url" autoComplete="off" value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="https://drive.google.com/file/d/…" className="fi-in pl-9" /></div>
          </div>
          {msg && <p className="fi-err">{msg}</p>}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white p-4 flex items-center gap-2">
          <button type="button" onClick={cerrar} className="h-11 px-4 rounded-2xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando} className="flex-1 h-11 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: 'linear-gradient(135deg,var(--primary),var(--cyan))', boxShadow: '0 10px 20px -14px rgba(5,92,157,.9)' }}>{guardando ? 'Guardando…' : 'Guardar factura'}</button>
        </div>
      </div>
    </div>
  )
}

/* ============================ Notas de crédito ============================ */
type NcLinea = {
  movimiento_id: string; producto_codigo: string; nombre: string; cantidad: number; precio: number; descuento: number; aplica_iva: boolean
  base: number; iva: number; acreditado: number; vigente: number; base_vigente: number; iva_vigente: number; estado_nc: string | null
}
type NcNota = { id: string; codigo: string; numero: string; fecha: string; datos: { motivo: string; pdf_url: string; total: number }; creado_por: string | null }
type NcDevPendiente = { id: string; nombre: string; producto_codigo: string; cantidad: number; recibido: number; estado_nc: string | null }

function ModalNotasCredito({ r, cerrar, aviso }: { r: Fila; cerrar: () => void; aviso: (t: string) => void }) {
  const [lineas, setLineas] = useState<NcLinea[] | null>(null)
  const [resumen, setResumen] = useState<{ notas: NcNota[]; devoluciones_pendientes: NcDevPendiente[] } | null>(null)
  const [sel, setSel] = useState<Record<string, { on: boolean; tipo: 'CANTIDAD' | 'PRECIO'; cantidad: string; monto: string }>>({})
  const [numero, setNumero] = useState(''); const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [motivo, setMotivo] = useState(''); const [pdfUrl, setPdfUrl] = useState('')
  const [msg, setMsg] = useState(''); const [guardando, setGuardando] = useState(false)
  const [recepcion, setRecepcion] = useState<{ id: string; cantidad: string; destino: string; fecha: string; observacion: string } | null>(null)
  const [recGuardando, setRecGuardando] = useState(false)

  const cargar = useCallback(() => {
    Promise.all([
      supabase.rpc('nc_lineas_factura', { p_factura: r.uuid }),
      supabase.rpc('nc_resumen_factura', { p_factura: r.uuid }),
    ]).then(([a, b]) => {
      setLineas((a.data as NcLinea[] | null) ?? [])
      setResumen((b.data as { notas: NcNota[]; devoluciones_pendientes: NcDevPendiente[] } | null) ?? { notas: [], devoluciones_pendientes: [] })
    })
  }, [r.uuid])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])

  function marcar(l: NcLinea, on: boolean) {
    setSel((s) => ({ ...s, [l.movimiento_id]: on ? { on: true, tipo: 'CANTIDAD', cantidad: String(l.vigente), monto: (l.base_vigente + l.iva_vigente).toFixed(2) } : { ...s[l.movimiento_id], on: false } }))
  }
  function cambiar(id: string, cambios: Partial<{ tipo: 'CANTIDAD' | 'PRECIO'; cantidad: string; monto: string }>) {
    setSel((s) => ({ ...s, [id]: { ...s[id], ...cambios } }))
  }

  async function guardar() {
    setMsg('')
    if (!numero.trim() || !motivo.trim()) { setMsg('Indica número y motivo de la nota.'); return }
    if (!/^https:\/\//i.test(pdfUrl.trim())) { setMsg('El enlace al PDF de la nota debe empezar con https://'); return }
    const elegidas = Object.entries(sel).filter(([, v]) => v.on)
    if (!elegidas.length) { setMsg('Marca al menos un producto a acreditar.'); return }
    const p_lineas = elegidas.map(([movimiento_id, v]) => {
      const l = lineas!.find((x) => x.movimiento_id === movimiento_id)!
      const monto = Math.max(0, Number(v.monto) || 0)
      const aplicaIva = l.aplica_iva
      const base = aplicaIva ? Math.round((monto / 1.15) * 100) / 100 : monto
      const iva = Math.round((monto - base) * 100) / 100
      return { movimiento_id, tipo: v.tipo, cantidad: v.tipo === 'CANTIDAD' ? Number(v.cantidad) || 0 : 0, base, iva }
    })
    setGuardando(true)
    const { error } = await supabase.rpc('nc_registrar', { p_factura: r.uuid, p_numero: numero.trim(), p_fecha: fecha, p_motivo: motivo.trim(), p_pdf_url: pdfUrl.trim(), p_lineas })
    setGuardando(false)
    if (error) { setMsg(error.message); return }
    aviso('Nota de crédito ' + numero.trim() + ' registrada.')
    setNumero(''); setMotivo(''); setPdfUrl(''); setSel({}); cargar()
  }

  async function guardarRecepcion() {
    if (!recepcion) return
    if (!recepcion.observacion.trim()) { aviso('Indica una observación de la recepción.'); return }
    setRecGuardando(true)
    const { error } = await supabase.rpc('nc_registrar_recepcion', {
      p_devolucion_id: recepcion.id, p_cantidad: Number(recepcion.cantidad) || 0, p_destino: recepcion.destino, p_fecha: recepcion.fecha, p_observacion: recepcion.observacion.trim(),
    })
    setRecGuardando(false)
    if (error) { aviso(error.message); return }
    aviso('Recepción registrada.'); setRecepcion(null); cargar()
  }

  const totalSel = Object.entries(sel).filter(([, v]) => v.on).reduce((t, [, v]) => t + (Number(v.monto) || 0), 0)

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4 overlay" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal-panel bg-[#f6f9fc] sm:rounded-3xl shadow-2xl w-full h-full sm:h-auto sm:max-w-2xl sm:max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5"><ReceiptText className="w-3.5 h-3.5" />Notas de crédito</span>
            <button type="button" onClick={cerrar} className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <h3 className="font-display font-bold text-lg leading-snug mt-1.5">{r.cliente || 'Venta'}</h3>
          <p className="text-[11px] text-white/70 mt-1">{[r.id, r.numeroFactura].filter(Boolean).join(' · ')}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {resumen && resumen.notas.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Notas ya aplicadas</p>
              {resumen.notas.map((n) => (
                <div key={n.id} className="flex items-center justify-between gap-2 py-1 text-[11.5px] border-t border-slate-100 first:border-0">
                  <span className="min-w-0 truncate"><b className="text-slate-700">{n.numero}</b> · {fechaCorta(new Date(n.fecha).getTime())}{n.creado_por ? ' · ' + n.creado_por : ''}</span>
                  <a href={n.datos.pdf_url} target="_blank" rel="noopener" className="text-[var(--primary)] font-semibold shrink-0">{money(n.datos.total)} · ver</a>
                </div>
              ))}
            </div>
          )}

          {resumen && resumen.devoluciones_pendientes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3">
              <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1.5">Devoluciones pendientes de recepción</p>
              {resumen.devoluciones_pendientes.map((d) => {
                const pendiente = d.cantidad - d.recibido
                return (
                  <div key={d.id} className="py-1.5 border-t border-amber-200 first:border-0">
                    <div className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="min-w-0 truncate"><b className="text-slate-700">{pendiente}</b> de {d.cantidad} u. · {d.nombre}</span>
                      {recepcion?.id !== d.id && <button type="button" onClick={() => setRecepcion({ id: d.id, cantidad: String(pendiente), destino: 'DISPONIBLE', fecha: new Date().toISOString().slice(0, 10), observacion: '' })} className="text-[10.5px] font-bold px-2 py-1 rounded-lg border bg-white" style={{ borderColor: '#f1dfbf', color: '#a86d10' }}>Registrar recepción</button>}
                    </div>
                    {recepcion?.id === d.id && (
                      <div className="mt-2 bg-white rounded-xl border border-amber-200 p-2.5 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block"><span className="block text-[9.5px] font-bold text-slate-400 uppercase">Cantidad recibida</span>
                            <input type="number" min="0.001" max={pendiente} step="0.001" value={recepcion.cantidad} onChange={(e) => setRecepcion({ ...recepcion, cantidad: e.target.value })} className="fi-in" /></label>
                          <label className="block"><span className="block text-[9.5px] font-bold text-slate-400 uppercase">Fecha</span>
                            <input type="date" value={recepcion.fecha} onChange={(e) => setRecepcion({ ...recepcion, fecha: e.target.value })} className="fi-in" /></label>
                        </div>
                        <label className="block"><span className="block text-[9.5px] font-bold text-slate-400 uppercase">Destino</span>
                          <select value={recepcion.destino} onChange={(e) => setRecepcion({ ...recepcion, destino: e.target.value })} className="fi-in bg-white">
                            <option value="DISPONIBLE">Recibido y apto para venta</option>
                            <option value="NO_DISPONIBLE">Recibido dañado / no disponible</option>
                            <option value="NO_ENTREGADO">Nunca entregado: restituir salida</option>
                          </select></label>
                        <label className="block"><span className="block text-[9.5px] font-bold text-slate-400 uppercase">Observación / evidencia</span>
                          <textarea rows={2} value={recepcion.observacion} onChange={(e) => setRecepcion({ ...recepcion, observacion: e.target.value })} className="fi-in" /></label>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setRecepcion(null)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-slate-200">Cancelar</button>
                          <button type="button" onClick={guardarRecepcion} disabled={recGuardando} className="flex-1 text-[11px] font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-60" style={{ background: '#c98a1f' }}>{recGuardando ? 'Guardando…' : 'Confirmar recepción'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Qué se acredita</p>
            {lineas === null && <p className="text-[11px] text-slate-400 py-2">Cargando productos…</p>}
            {lineas?.length === 0 && <p className="text-[11px] text-slate-400 py-2">Esta factura no tiene salidas de inventario registradas.</p>}
            {lineas?.filter((l) => l.vigente > 0 || l.base_vigente > 0).map((l) => {
              const s = sel[l.movimiento_id]
              return (
                <div key={l.movimiento_id} className="py-2 border-t border-slate-100 first:border-0">
                  <label className="flex items-center gap-2 text-[11.5px]">
                    <input type="checkbox" checked={!!s?.on} onChange={(e) => marcar(l, e.target.checked)} className="w-4 h-4" />
                    <span className="min-w-0 truncate flex-1"><b className="text-slate-700">{l.nombre}</b> <span className="text-slate-400">({l.producto_codigo})</span></span>
                    <span className="text-slate-500 shrink-0">vigente {money(l.base_vigente + l.iva_vigente)}</span>
                  </label>
                  {s?.on && (
                    <div className="mt-2 pl-6 grid grid-cols-2 gap-2">
                      <label className="block"><span className="block text-[9.5px] font-bold text-slate-400 uppercase">Tipo de ajuste</span>
                        <select value={s.tipo} onChange={(e) => cambiar(l.movimiento_id, { tipo: e.target.value as 'CANTIDAD' | 'PRECIO', cantidad: e.target.value === 'PRECIO' ? '0' : s.cantidad })} className="fi-in bg-white">
                          <option value="CANTIDAD">Devuelve unidades</option>
                          <option value="PRECIO">Solo ajuste de precio</option>
                        </select></label>
                      {s.tipo === 'CANTIDAD' && <label className="block"><span className="block text-[9.5px] font-bold text-slate-400 uppercase">Cantidad (máx. {l.vigente})</span>
                        <input type="number" min="0.001" max={l.vigente} step="0.001" value={s.cantidad} onChange={(e) => cambiar(l.movimiento_id, { cantidad: e.target.value })} className="fi-in" /></label>}
                      <label className="block col-span-2"><span className="block text-[9.5px] font-bold text-slate-400 uppercase">Monto a acreditar (con IVA, máx. {money(l.base_vigente + l.iva_vigente)})</span>
                        <input type="number" min="0.01" max={l.base_vigente + l.iva_vigente} step="0.01" value={s.monto} onChange={(e) => cambiar(l.movimiento_id, { monto: e.target.value })} className="fi-in" /></label>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: '#7c3aed' }}>1</span><div className="flex-1"><b>Datos de la nota</b><small>Tal como se emitió en Contífico</small></div></div>
            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="N° de la nota" className="fi-in" />
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="fi-in" />
            </div>
            <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la nota de crédito" className="fi-in mt-2" />
            <input type="url" value={pdfUrl} onChange={(e) => setPdfUrl(e.target.value)} placeholder="https://… enlace al PDF de la nota" className="fi-in mt-2" />
          </div>
          {msg && <p className="fi-err">{msg}</p>}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white p-4 flex items-center gap-2">
          <div className="text-[11px] text-slate-500 flex-1">{totalSel > 0 && <>Total a acreditar: <b className="text-slate-700">{money(totalSel)}</b></>}</div>
          <button type="button" onClick={cerrar} className="h-11 px-4 rounded-2xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Cerrar</button>
          <button type="button" onClick={guardar} disabled={guardando} className="h-11 px-5 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: '#7c3aed' }}>{guardando ? 'Guardando…' : 'Aplicar nota'}</button>
        </div>
      </div>
    </div>
  )
}

/* ============================ Guía de envío (etiqueta remitente/destinatario) ============================ */
function ModalGuiaEnvio({ r, cerrar, guardado }: { r: Fila; cerrar: () => void; guardado: () => void }) {
  const [d, setD] = useState({
    nombreRemitente: 'Importaciones Médicas Richard', cedulaRemitente: '',
    nombreDestinatario: r.pe.nombreDestinatario || r.cliente || '', cedulaDestinatario: r.pe.cedulaDestinatario || r.identificacion || '',
    telefonoDestinatario: r.pe.telefonoDestinatario || r.telefono || '', direccionEnvio: r.pe.direccionEnvio || '',
    emailDestinatario: r.pe.emailDestinatario || r.email || '', ciudad: r.pe.ciudad || '',
  })
  const [msg, setMsg] = useState(''); const [guardando, setGuardando] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  const set = (k: keyof typeof d, v: string) => setD((a) => ({ ...a, [k]: v }))

  async function guardar() {
    setMsg('')
    const faltan = ([['nombreRemitente', 'remitente'], ['nombreDestinatario', 'destinatario'], ['telefonoDestinatario', 'teléfono del destinatario'], ['direccionEnvio', 'dirección'], ['ciudad', 'ciudad']] as const)
      .filter(([k]) => !d[k].trim()).map(([, et]) => et)
    if (faltan.length) { setMsg('Completa: ' + faltan.join(', ') + '.'); return }
    setGuardando(true)
    try {
      const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const NAVY = '#0b2545'
      const dato = (et: string, v: string) => (v ? `<p style="margin:0 0 4px"><b style="color:${NAVY}">${et ? et + ': ' : ''}</b>${esc(v)}</p>` : '')
      const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía de envío ${esc(r.id)}</title>
        <style>@page{size:A4;margin:14mm}html{background:#e2e8f0}body{font-family:Arial,sans-serif;color:#1e293b;font-size:13px;margin:0 auto;padding:14mm;width:210mm;min-height:297mm;box-sizing:border-box;background:#fff;box-shadow:0 0 0 1px #cbd5e1}.vm-aviso{background:#fffbeb;border:1px dashed #d4a017;color:#92610b;font-size:11px;padding:6px 10px;border-radius:8px;margin-bottom:12px}@media print{html{background:#fff}body{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.vm-aviso{display:none}}[contenteditable]:focus{outline:1px dashed #94a3b8}</style></head>
        <body contenteditable="true">
        <p class="vm-aviso">✏️ Puedes corregir cualquier dato haciendo clic aquí mismo antes de imprimir o guardar como PDF.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>
          <td><b style="font-size:26px;color:${NAVY}">VIMEDIC</b></td>
          <td style="text-align:right"><span style="display:inline-block;border:2.5px solid ${NAVY};color:${NAVY};font-size:16px;font-weight:bold;letter-spacing:2px;padding:5px 14px;border-radius:8px">GUÍA DE ENVÍO</span></td>
        </tr></table>
        <p style="text-align:center;background:#fef2f2;color:#b91c1c;font-weight:800;letter-spacing:2px;padding:6px;border-radius:8px;margin:0 0 10px">FRÁGIL · EQUIPO MÉDICO · NO COLOCAR PESO ENCIMA</p>
        <div style="border:3px solid ${NAVY};border-radius:10px;padding:14px;margin-bottom:10px;text-align:center">
          <p style="margin:0;font-size:28px;font-weight:800;color:${NAVY};letter-spacing:1px">${esc(d.ciudad.toUpperCase())}</p>
        </div>
        <div style="border:2px solid ${NAVY};border-radius:10px;margin-bottom:10px">
          <div style="color:${NAVY};font-weight:bold;letter-spacing:3px;font-size:12px;padding:6px 16px;border-bottom:2px solid ${NAVY}">DESTINATARIO</div>
          <div style="padding:12px 16px">${dato('', d.nombreDestinatario)}${dato('C.I./RUC', d.cedulaDestinatario)}${dato('CEL', d.telefonoDestinatario)}${dato('DIRECCIÓN', d.direccionEnvio)}${dato('EMAIL', d.emailDestinatario)}</div>
        </div>
        <div style="border:2px solid ${NAVY};border-radius:10px">
          <div style="color:${NAVY};font-weight:bold;letter-spacing:3px;font-size:12px;padding:6px 16px;border-bottom:2px solid ${NAVY}">REMITENTE</div>
          <div style="padding:12px 16px">${dato('', d.nombreRemitente)}${dato('C.I./RUC', d.cedulaRemitente)}</div>
        </div>
        <p style="margin-top:14px;font-size:9px;color:#64748b;text-align:center">${esc(r.id)} · ${esc(new Date().toLocaleDateString('es-EC'))}</p>
        </body></html>`

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const ruta = 'guias/etiqueta-' + r.id + '-' + Date.now() + '.html'
      const { error: errSubir } = await supabase.storage.from('despachos').upload(ruta, blob, { contentType: 'text/html', upsert: true })
      if (errSubir) { setMsg('No se pudo guardar la etiqueta: ' + errSubir.message); setGuardando(false); return }
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
      const { error: errUpd } = await supabase.from('facturas').update({ guia_envio_url: ruta }).eq('id', r.uuid)
      if (errUpd) { setMsg('Se generó pero no se pudo guardar el enlace: ' + errUpd.message); setGuardando(false); return }
      guardado()
    } catch (e) {
      setMsg('No se pudo generar la etiqueta: ' + (e as Error).message)
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4 overlay" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal-panel bg-[#f6f9fc] sm:rounded-3xl shadow-2xl w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" />Guía de envío · etiqueta</span>
            <button type="button" onClick={cerrar} className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <h3 className="font-display font-bold text-lg leading-snug mt-1.5">{r.cliente || 'Venta'}</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: '#64748b' }}>1</span><div className="flex-1"><b>Remitente</b></div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" value={d.nombreRemitente} onChange={(e) => set('nombreRemitente', e.target.value)} placeholder="Nombre remitente *" className="fi-in" />
              <input type="text" value={d.cedulaRemitente} onChange={(e) => set('cedulaRemitente', e.target.value)} placeholder="C.I./RUC remitente" className="fi-in" />
            </div>
          </div>
          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: '#64748b' }}>2</span><div className="flex-1"><b>Destinatario</b></div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" value={d.nombreDestinatario} onChange={(e) => set('nombreDestinatario', e.target.value)} placeholder="Nombre destinatario *" className="fi-in" />
              <input type="text" value={d.cedulaDestinatario} onChange={(e) => set('cedulaDestinatario', e.target.value)} placeholder="C.I./RUC destinatario" className="fi-in" />
              <input type="text" value={d.telefonoDestinatario} onChange={(e) => set('telefonoDestinatario', e.target.value)} placeholder="Teléfono destinatario *" className="fi-in" />
              <input type="text" value={d.ciudad} onChange={(e) => set('ciudad', e.target.value)} placeholder="Ciudad *" className="fi-in" />
              <input type="text" value={d.direccionEnvio} onChange={(e) => set('direccionEnvio', e.target.value)} placeholder="Dirección de envío *" className="fi-in sm:col-span-2" />
              <input type="email" value={d.emailDestinatario} onChange={(e) => set('emailDestinatario', e.target.value)} placeholder="Email destinatario (opcional)" className="fi-in sm:col-span-2" />
            </div>
          </div>
          {msg && <p className="fi-err">{msg}</p>}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white p-4 flex items-center gap-2">
          <button type="button" onClick={cerrar} className="h-11 px-4 rounded-2xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando} className="flex-1 h-11 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: '#64748b' }}>{guardando ? 'Generando…' : 'Generar etiqueta'}</button>
        </div>
      </div>
    </div>
  )
}

/* Ventana flotante para generar la guía de despacho: los datos que vienen del sistema
   (número de guía, factura, cliente, QR, código/cantidad de los productos) se muestran
   bloqueados; solo los datos de entrega y la observación por línea son editables. */
function ModalGuiaDespacho({ r, cerrar, aviso, guardado }: { r: Fila; cerrar: () => void; aviso: (t: string) => void; guardado: () => void }) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [lineas, setLineas] = useState<Linea[]>(r.items ?? [])
  const [desp, setDesp] = useState<{ id: string; numero_guia: string; token_seguimiento: string } | null>(null)
  const [qrImg, setQrImg] = useState('')
  const [d, setD] = useState({
    direccionEntrega: r.pe.direccionEnvio || r.pe.direccionEntregaLocal || r.pe.urlGoogleMaps || '',
    ciudad: r.pe.ciudad || '',
    contacto: r.pe.nombreDestinatario || r.pe.quienRecibe || r.cliente || '',
    telefono: r.pe.telefonoDestinatario || r.pe.telefonoEntregaLocal || r.telefono || '',
    nota: r.nota || '',
  })
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])

  useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        const [{ data: fd }] = await Promise.all([
          supabase.from('facturas').select('items').eq('id', r.uuid).single(),
          supabase.rpc('bodega_crear_despacho', { p_factura: r.uuid }),
        ])
        if (!activo) return
        setLineas(((fd as { items?: Linea[] } | null)?.items ?? []) as Linea[])
        const { data: despRow, error: errDesp } = await supabase.from('despachos').select('id,numero_guia,token_seguimiento').eq('factura_id', r.uuid).is('deleted_at', null).maybeSingle()
        if (!activo) return
        if (errDesp || !despRow?.numero_guia || !despRow?.token_seguimiento) { setError(errDesp?.message ?? 'La factura todavía no está Facturada.'); setCargando(false); return }
        setDesp(despRow)
        const link = 'https://vimedic.com.ec/seguimiento/?c=' + despRow.token_seguimiento
        const qrcode = (await import('qrcode-generator')).default
        const q = qrcode(0, 'M'); q.addData(link); q.make()
        if (!activo) return
        setQrImg(q.createDataURL(6, 2))
      } catch (e) {
        if (activo) setError((e as Error).message)
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
  }, [r.uuid])

  const set = (k: keyof typeof d, v: string) => setD((a) => ({ ...a, [k]: v }))
  const setObs = (i: number, v: string) => setLineas((ls) => ls.map((l, idx) => (idx === i ? { ...l, observacion: v } : l)))

  async function generar() {
    if (!desp) return
    if (!d.direccionEntrega.trim()) { setError('Completa la dirección de entrega.'); return }
    setError(''); setGuardando(true)
    try {
      const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const marca = r.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC'
      const link = 'https://vimedic.com.ec/seguimiento/?c=' + desp.token_seguimiento
      const filas = lineas.map((it) => `<tr>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:10px">${esc(it.codigo)}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(it.nombre)}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:center">${esc(Math.abs(it.cantidad))}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;font-size:10.5px;color:#64748b">${esc(it.observacion || '')}</td>
        </tr>`).join('')
      const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Guía de despacho ${esc(desp.numero_guia)}</title>
        <style>@page{size:A4;margin:14mm}html{background:#e2e8f0}body{font-family:Arial,sans-serif;color:#0b2545;font-size:13px;margin:0 auto;padding:14mm;width:210mm;min-height:297mm;box-sizing:border-box;background:#fff;box-shadow:0 0 0 1px #cbd5e1}@media print{html{background:#fff}body{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}</style></head>
        <body>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #055c9d;padding-bottom:10px;margin-bottom:14px">
            <div><b style="font-size:22px;color:#055c9d">${marca}</b><br><span style="font-size:13px;font-weight:bold">GUÍA DE DESPACHO ${esc(desp.numero_guia)}</span></div>
            <img src="${qrImg}" width="110" height="110">
          </div>
          <p><b>Factura:</b> ${esc(r.numeroFactura || '—')} &nbsp; <b>Fecha:</b> ${esc(new Date().toLocaleDateString('es-EC'))}</p>
          <p><b>Cliente:</b> ${esc(r.cliente)} &nbsp; <b>C.I./RUC:</b> ${esc(r.identificacion)}</p>
          <p><b>Dirección de entrega:</b> ${esc(d.direccionEntrega)}${d.ciudad ? ', ' + esc(d.ciudad) : ''}</p>
          <p><b>Contacto que recibe:</b> ${esc(d.contacto)}${d.telefono ? ' · Tel: ' + esc(d.telefono) : ''}</p>
          <p><b>Asesor comercial:</b> ${esc(r.asesor)}</p>
          <table style="width:100%;border-collapse:collapse;margin:14px 0">
            <thead><tr style="background:#0b2545;color:#fff"><th style="padding:6px;text-align:left">Código</th><th style="padding:6px;text-align:left">Producto</th><th style="padding:6px;text-align:center">Cant.</th><th style="padding:6px;text-align:left">Observación</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
          ${d.nota ? `<p><b>Observaciones generales:</b> ${esc(d.nota)}</p>` : ''}
          <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:11px">
            <div style="width:30%;text-align:center;border-top:1px solid #94a3b8;padding-top:4px">Bodega (preparó)</div>
            <div style="width:30%;text-align:center;border-top:1px solid #94a3b8;padding-top:4px">Logística (retiró)</div>
            <div style="width:30%;text-align:center;border-top:1px solid #94a3b8;padding-top:4px">Cliente (recibió conforme)</div>
          </div>
          <p style="margin-top:18px;font-size:9px;color:#64748b;text-align:center">${esc(desp.numero_guia)} · Seguimiento: ${esc(link)}</p>
        </body></html>`

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const ruta = 'guias/' + desp.numero_guia + '.html'
      const { error: errSubir } = await supabase.storage.from('despachos').upload(ruta, blob, { contentType: 'text/html', upsert: true })
      if (errSubir) { setError('No se pudo guardar la guía: ' + errSubir.message); setGuardando(false); return }
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')

      const { error: errUpd } = await supabase.from('facturas').update({ guia_despacho_url: ruta }).eq('id', r.uuid)
      if (errUpd) { setError('Guía generada, pero no se pudo guardar el enlace: ' + errUpd.message); setGuardando(false); return }

      await supabase.rpc('registrar_bitacora', { p_modulo: 'facturacion', p_accion: 'generar_guia', p_factura: r.uuid, p_despacho: desp.id, p_comentario: 'Guía ' + desp.numero_guia + ' generada.' })
      aviso('Guía ' + desp.numero_guia + ' generada.')
      guardado()
    } catch (e) {
      setError('No se pudo generar la guía: ' + (e as Error).message)
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4 overlay" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal-panel bg-[#f6f9fc] sm:rounded-3xl shadow-2xl w-full h-full sm:h-auto sm:max-w-2xl sm:max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" />Guía de despacho</span>
            <button type="button" onClick={cerrar} className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <h3 className="font-display font-bold text-lg leading-snug mt-1.5">{r.cliente || 'Venta'}</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {cargando ? <div className="py-10 text-center text-xs text-slate-400">Preparando guía…</div> : error && !desp ? <p className="fi-err">{error}</p> : <>
            <div className="fi-sec">
              <div className="fi-sec-h">
                <span className="fi-num" style={{ background: '#94a3b8' }}><Lock className="w-3.5 h-3.5" /></span>
                <div className="flex-1"><b>Datos del sistema</b><small>Bloqueados, vienen de la factura</small></div>
                {qrImg && <img src={qrImg} width="52" height="52" className="rounded-lg border border-slate-200" alt="QR de seguimiento" />}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="fi-ro"><small>Número de guía</small><b>{desp?.numero_guia}</b></div>
                <div className="fi-ro"><small>Factura</small><b>{r.numeroFactura || '—'}</b></div>
                <div className="fi-ro"><small>Fecha</small><b>{new Date().toLocaleDateString('es-EC')}</b></div>
                <div className="fi-ro"><small>Cliente</small><b>{r.cliente}</b></div>
                <div className="fi-ro"><small>C.I./RUC</small><b>{r.identificacion || '—'}</b></div>
                <div className="fi-ro"><small>Asesor</small><b>{r.asesor || '—'}</b></div>
              </div>
            </div>
            <div className="fi-sec">
              <div className="fi-sec-h"><span className="fi-num" style={{ background: '#04896f' }}>1</span><div className="flex-1"><b>Datos de entrega</b><small>Puedes corregirlos antes de generar</small></div></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="text" value={d.direccionEntrega} onChange={(e) => set('direccionEntrega', e.target.value)} placeholder="Dirección de entrega *" className="fi-in sm:col-span-2" />
                <input type="text" value={d.ciudad} onChange={(e) => set('ciudad', e.target.value)} placeholder="Ciudad" className="fi-in" />
                <input type="text" value={d.contacto} onChange={(e) => set('contacto', e.target.value)} placeholder="Contacto que recibe" className="fi-in" />
                <input type="text" value={d.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="Teléfono" className="fi-in" />
                <textarea value={d.nota} onChange={(e) => set('nota', e.target.value)} placeholder="Observaciones generales (opcional)" className="fi-in sm:col-span-2" rows={2} />
              </div>
            </div>
            <div className="fi-sec">
              <div className="fi-sec-h"><span className="fi-num" style={{ background: '#04896f' }}>2</span><div className="flex-1"><b>Productos</b><small>Código y cantidad bloqueados · la observación es editable</small></div></div>
              <div className="space-y-2">
                {lineas.map((it, i) => (
                  <div key={it.id ?? i} className="fi-item">
                    <div className="flex items-center gap-2">
                      <span className="font-mono-spec text-[10px] text-slate-400 flex items-center gap-1"><Lock className="w-2.5 h-2.5" />{it.codigo}</span>
                      <span className="text-xs font-semibold text-slate-700 truncate flex-1">{it.nombre}</span>
                      <span className="text-xs font-bold text-slate-500">× {Math.abs(it.cantidad)}</span>
                    </div>
                    <input type="text" value={it.observacion || ''} onChange={(e) => setObs(i, e.target.value)} placeholder="Observación (opcional)" className="fi-in mt-2" />
                  </div>
                ))}
                {!lineas.length && <p className="text-xs text-slate-400 text-center py-2">Sin productos en la factura.</p>}
              </div>
            </div>
            {error && <p className="fi-err">{error}</p>}
          </>}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white p-4 flex items-center gap-2">
          <button type="button" onClick={cerrar} className="h-11 px-4 rounded-2xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="button" onClick={generar} disabled={guardando || cargando || !desp} className="flex-1 h-11 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: '#c0392b' }}><Printer className="w-4 h-4" />{guardando ? 'Generando…' : 'Generar guía'}</button>
        </div>
      </div>
    </div>
  )
}

/* ============================ Acta de entrega / garantía ============================ */
type EquipoActa = { key: string; codigo: string; nombre: string; cantidad: number; series: string[]; sinGarantia: boolean; extra: boolean }
const equipoDesdeLinea = (it: Linea, i: number): EquipoActa => {
  const cant = Math.max(1, Math.abs(it.cantidad) || 1)
  return { key: 'L' + i, codigo: it.codigo || '', nombre: it.nombre, cantidad: cant, series: Array(cant).fill(''), sinGarantia: false, extra: false }
}

function ModalActaGarantia({ r, cerrar, aviso, guardado }: { r: Fila; cerrar: () => void; aviso: (t: string) => void; guardado: () => void }) {
  const [equipos, setEquipos] = useState<EquipoActa[]>((r.items ?? []).map(equipoDesdeLinea))
  const [cliente, setCliente] = useState({
    nombre: r.cliente || '', ciudad: r.pe.ciudad || '', direccion: r.pe.direccionEnvio || r.pe.direccionEntregaLocal || '',
    telefono: r.pe.telefonoDestinatario || r.pe.telefonoEntregaLocal || r.telefono || '', email: r.email || '',
  })
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [garantiaCant, setGarantiaCant] = useState('1')
  const [garantiaUnidad, setGarantiaUnidad] = useState<'anios' | 'meses'>('anios')
  const [mantObs, setMantObs] = useState<string[]>([])
  const [anexo, setAnexo] = useState(false)
  const [anexoManual, setAnexoManual] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoCodigo, setNuevoCodigo] = useState('')
  const [nuevoCant, setNuevoCant] = useState('1')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])

  const meses = garantiaUnidad === 'anios' ? (Number(garantiaCant) || 0) * 12 : (Number(garantiaCant) || 0)
  const nMant = Math.min(20, Math.floor(meses / 6))
  useEffect(() => { setMantObs((prev) => Array.from({ length: nMant }, (_, i) => prev[i] || '')) }, [nMant])

  const { reg, tot } = equipos.reduce((a, e) => ({ reg: a.reg + e.series.filter((s) => s.trim()).length, tot: a.tot + e.cantidad }), { reg: 0, tot: 0 })
  useEffect(() => { if (!anexoManual) setAnexo(reg < tot) }, [reg, tot, anexoManual])
  const conGarantia = equipos.filter((e) => !e.sinGarantia).length
  const duracionTxt = meses > 0 ? (garantiaUnidad === 'anios' ? `${garantiaCant} año${Number(garantiaCant) === 1 ? '' : 's'}` : `${garantiaCant} mes${Number(garantiaCant) === 1 ? '' : 'es'}`) : ''

  function setSerie(key: string, idx: number, v: string) {
    setEquipos((es) => es.map((e) => (e.key === key ? { ...e, series: e.series.map((s, i) => (i === idx ? v : s)) } : e)))
  }
  function setSerieBulk(key: string, texto: string) {
    const partes = texto.split(/\r?\n|,|;/).map((x) => x.trim()).filter(Boolean)
    setEquipos((es) => es.map((e) => (e.key === key ? { ...e, series: Array.from({ length: e.cantidad }, (_, i) => partes[i] || '') } : e)))
  }
  function toggleSinGarantia(key: string) { setEquipos((es) => es.map((e) => (e.key === key ? { ...e, sinGarantia: !e.sinGarantia } : e))) }
  function quitarEquipo(key: string) { setEquipos((es) => es.filter((e) => e.key !== key)) }
  function agregarEquipo() {
    const nombre = nuevoNombre.trim()
    const cant = Math.max(1, Math.min(999, parseInt(nuevoCant, 10) || 1))
    if (!nombre) return
    if (equipos.filter((e) => e.extra).length >= 30) { aviso('Puedes añadir hasta 30 equipos adicionales al acta.'); return }
    setEquipos((es) => [...es, { key: 'X' + Date.now(), codigo: nuevoCodigo.trim(), nombre, cantidad: cant, series: Array(cant).fill(''), sinGarantia: false, extra: true }])
    setNuevoNombre(''); setNuevoCodigo(''); setNuevoCant('1')
  }

  async function generar() {
    setError('')
    if (!cliente.nombre.trim()) { setError('Indica el nombre del cliente.'); return }
    if (!equipos.length) { setError('Añade al menos un equipo al acta.'); return }
    const cantN = Number(garantiaCant)
    if (!Number.isFinite(cantN) || cantN < 0 || (garantiaUnidad === 'anios' && cantN > 10) || (garantiaUnidad === 'meses' && cantN > 120)) {
      setError('La garantía debe ser de 0 a 10 años (o de 0 a 120 meses).'); return
    }
    setGuardando(true)
    try {
      const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const marca = r.empresa === 'FEMEDICS' ? 'FEMEDICS' : 'VIMEDIC'
      const numeroActa = 'ACT-' + (r.numeroFactura || r.id).replace(/[^\w-]+/g, '')
      const filasEquipos = equipos.map((e) => {
        const seriesTxt = e.series.filter((s) => s.trim()).join(', ') || (e.cantidad > 1 ? '(ver anexo)' : '—')
        return `<tr>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-size:10px">${esc(e.codigo)}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(e.nombre)}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:center">${e.cantidad}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;font-size:10.5px">${esc(seriesTxt)}</td>
          <td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:center">${e.sinGarantia ? 'Sin garantía' : duracionTxt || '—'}</td>
        </tr>`
      }).join('')
      const anexoHtml = anexo ? `<div style="page-break-before:always">
          <h3 style="font-size:13px;color:#0b2545">Anexo de números de serie</h3>
          ${equipos.map((e) => `<p style="font-size:11px;margin:6px 0"><b>${esc(e.codigo)} · ${esc(e.nombre)}</b><br>${e.series.map((s, i) => `${i + 1}. ${esc(s) || '—'}`).join(' &nbsp; ')}</p>`).join('')}
        </div>` : ''
      const mantHtml = nMant > 0 ? `<h3 style="font-size:13px;color:#0b2545;margin-top:18px">Plan de mantenimiento preventivo</h3>
        <table style="width:100%;border-collapse:collapse;margin:8px 0">
          <thead><tr style="background:#0b2545;color:#fff"><th style="padding:6px;text-align:left">Mantenimiento</th><th style="padding:6px;text-align:left">Observación</th></tr></thead>
          <tbody>${mantObs.map((o, i) => `<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">Mantenimiento ${i + 1} (mes ${(i + 1) * 6})</td><td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(o)}</td></tr>`).join('')}</tbody>
        </table>` : ''
      const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Acta de entrega ${esc(numeroActa)}</title>
        <style>@page{size:A4;margin:14mm}html{background:#e2e8f0}body{font-family:Arial,sans-serif;color:#0b2545;font-size:13px;margin:0 auto;padding:14mm;width:210mm;min-height:297mm;box-sizing:border-box;background:#fff;box-shadow:0 0 0 1px #cbd5e1}@media print{html{background:#fff}body{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}</style></head>
        <body>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #055c9d;padding-bottom:10px;margin-bottom:14px">
            <div><b style="font-size:22px;color:#055c9d">${marca}</b><br><span style="font-size:13px;font-weight:bold">ACTA DE ENTREGA Y GARANTÍA</span></div>
            <div style="text-align:right;font-size:11px"><b>${esc(numeroActa)}</b><br>${esc(new Date(fecha + 'T00:00:00').toLocaleDateString('es-EC'))}</div>
          </div>
          <p><b>Factura:</b> ${esc(r.numeroFactura || '—')} &nbsp; <b>Asesor comercial:</b> ${esc(r.asesor)}</p>
          <p><b>Cliente:</b> ${esc(cliente.nombre)} &nbsp; <b>C.I./RUC:</b> ${esc(r.identificacion)}</p>
          <p><b>Ciudad:</b> ${esc(cliente.ciudad) || '—'} &nbsp; <b>Dirección:</b> ${esc(cliente.direccion) || '—'}</p>
          <p><b>Teléfono:</b> ${esc(cliente.telefono) || '—'} &nbsp; <b>Email:</b> ${esc(cliente.email) || '—'}</p>
          <table style="width:100%;border-collapse:collapse;margin:14px 0">
            <thead><tr style="background:#0b2545;color:#fff"><th style="padding:6px;text-align:left">Código</th><th style="padding:6px;text-align:left">Equipo</th><th style="padding:6px;text-align:center">Cant.</th><th style="padding:6px;text-align:left">N° de serie</th><th style="padding:6px;text-align:center">Garantía</th></tr></thead>
            <tbody>${filasEquipos}</tbody>
          </table>
          <p style="margin-top:10px">${duracionTxt ? `Se entrega <b>Carta de Garantía de ${esc(duracionTxt)}</b> para ${conGarantia} equipo(s), con firma electrónica de la empresa.` : 'Sin garantía: esta acta es de entera satisfacción.'} El cliente declara recibir los equipos arriba descritos a su entera satisfacción, en buen estado y funcionamiento.</p>
          ${mantHtml}
          <div style="display:flex;justify-content:space-between;margin-top:48px;font-size:11px">
            <div style="width:45%;text-align:center;border-top:1px solid #94a3b8;padding-top:4px">${esc(cliente.nombre)}<br>Cliente (recibí conforme)</div>
            <div style="width:45%;text-align:center;border-top:1px solid #94a3b8;padding-top:4px">${esc(marca)}<br>Firma electrónica de la empresa</div>
          </div>
          <p style="margin-top:18px;font-size:9px;color:#64748b;text-align:center">${esc(numeroActa)}</p>
          ${anexoHtml}
        </body></html>`

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const ruta = 'guias/' + numeroActa + '-' + Date.now() + '.html'
      const { error: errSubir } = await supabase.storage.from('despachos').upload(ruta, blob, { contentType: 'text/html', upsert: true })
      if (errSubir) { setError('No se pudo guardar el acta: ' + errSubir.message); setGuardando(false); return }
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')

      const acta_datos = { cliente, fecha, garantiaCant: cantN, garantiaUnidad, anexo, mantObs, equipos: equipos.map((e) => ({ codigo: e.codigo, nombre: e.nombre, cantidad: e.cantidad, series: e.series, sinGarantia: e.sinGarantia, extra: e.extra })) }
      const { error: errUpd } = await supabase.from('facturas').update({ acta_garantia_url: ruta, acta_datos }).eq('id', r.uuid)
      if (errUpd) { setError('Acta generada, pero no se pudo guardar el enlace: ' + errUpd.message); setGuardando(false); return }

      await supabase.rpc('registrar_bitacora', { p_modulo: 'facturacion', p_accion: 'generar_acta', p_factura: r.uuid, p_comentario: 'Acta ' + numeroActa + ' generada.' })
      aviso('Acta ' + numeroActa + ' generada.')
      guardado()
    } catch (e) {
      setError('No se pudo generar el acta: ' + (e as Error).message)
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4 overlay" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal-panel bg-[#f6f9fc] sm:rounded-3xl shadow-2xl w-full h-full sm:h-auto sm:max-w-2xl sm:max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />Acta de entrega / garantía</span>
            <button type="button" onClick={cerrar} className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <h3 className="font-display font-bold text-lg leading-snug mt-1.5">{r.cliente || 'Venta'}</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: '#94a3b8' }}><Lock className="w-3.5 h-3.5" /></span><div className="flex-1"><b>Datos del sistema</b><small>Bloqueados, vienen de la factura</small></div></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="fi-ro"><small>Factura</small><b>{r.numeroFactura || '—'}</b></div>
              <div className="fi-ro"><small>C.I./RUC</small><b>{r.identificacion || '—'}</b></div>
              <div className="fi-ro"><small>Asesor</small><b>{r.asesor || '—'}</b></div>
            </div>
          </div>

          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: '#04896f' }}>1</span><div className="flex-1"><b>Datos del cliente</b><small>Puedes corregirlos antes de generar</small></div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="text" value={cliente.nombre} onChange={(e) => setCliente((c) => ({ ...c, nombre: e.target.value }))} placeholder="Nombre del cliente *" className="fi-in sm:col-span-2" />
              <input type="text" value={cliente.ciudad} onChange={(e) => setCliente((c) => ({ ...c, ciudad: e.target.value }))} placeholder="Ciudad" className="fi-in" />
              <input type="text" value={cliente.telefono} onChange={(e) => setCliente((c) => ({ ...c, telefono: e.target.value }))} placeholder="Teléfono" className="fi-in" />
              <input type="text" value={cliente.direccion} onChange={(e) => setCliente((c) => ({ ...c, direccion: e.target.value }))} placeholder="Dirección" className="fi-in sm:col-span-2" />
              <input type="email" value={cliente.email} onChange={(e) => setCliente((c) => ({ ...c, email: e.target.value }))} placeholder="Email" className="fi-in sm:col-span-2" />
              <label className="fi-lab">Fecha del acta<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="fi-in" /></label>
            </div>
          </div>

          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: '#04896f' }}>2</span><div className="flex-1"><b>Garantía</b><small>{reg} / {tot} series registradas</small></div></div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min="0" max={garantiaUnidad === 'anios' ? 10 : 120} value={garantiaCant} onChange={(e) => setGarantiaCant(e.target.value)} className="fi-in" />
              <select value={garantiaUnidad} onChange={(e) => setGarantiaUnidad(e.target.value as 'anios' | 'meses')} className="fi-in"><option value="anios">Años</option><option value="meses">Meses</option></select>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">{duracionTxt ? `Se entrega Carta de Garantía de ${duracionTxt} para ${conGarantia} equipo(s), con firma electrónica de la empresa.` : 'Sin garantía: el acta queda solo de entera satisfacción.'}</p>
            {nMant > 0 && (
              <div className="mt-2 space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-600">Plan de mantenimiento ({nMant} visita{nMant === 1 ? '' : 's'})</p>
                {mantObs.map((o, i) => (
                  <input key={i} type="text" value={o} onChange={(e) => setMantObs((m) => m.map((x, idx) => (idx === i ? e.target.value : x)))} placeholder={`Mantenimiento ${i + 1} (mes ${(i + 1) * 6}) · observación opcional`} className="fi-in" />
                ))}
              </div>
            )}
          </div>

          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: '#04896f' }}>3</span><div className="flex-1"><b>Equipos y números de serie</b><small>Cantidad bloqueada · agrega las series que tengas</small></div></div>
            <div className="space-y-2">
              {equipos.map((e) => (
                <div key={e.key} className="fi-item">
                  <div className="flex items-center gap-2">
                    {e.codigo && <span className="font-mono-spec text-[10px] text-slate-400 flex items-center gap-1"><Lock className="w-2.5 h-2.5" />{e.codigo}</span>}
                    <span className="text-xs font-semibold text-slate-700 truncate flex-1">{e.nombre}</span>
                    <span className="text-xs font-bold text-slate-500">× {e.cantidad}</span>
                    {e.extra && <button type="button" onClick={() => quitarEquipo(e.key)} className="w-6 h-6 rounded-lg text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0" title="Quitar"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                  <label className="flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-500 mt-1.5"><input type="checkbox" checked={e.sinGarantia} onChange={() => toggleSinGarantia(e.key)} className="w-3.5 h-3.5" /> Sin garantía</label>
                  {e.cantidad <= 12
                    ? <div className="grid gap-1.5 mt-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))' }}>
                        {e.series.map((s, i) => <input key={i} type="text" value={s} onChange={(ev) => setSerie(e.key, i, ev.target.value)} placeholder={`Serie ${i + 1}`} className={'fi-in !mt-0' + (s.trim() ? ' lk-ok' : '')} />)}
                      </div>
                    : <textarea value={e.series.join('\n')} onChange={(ev) => setSerieBulk(e.key, ev.target.value)} placeholder={`Una serie por línea (${e.cantidad} unidades)`} rows={4} className="fi-in mt-1.5" />}
                </div>
              ))}
              {!equipos.length && <p className="text-xs text-slate-400 text-center py-2">Sin equipos en la factura.</p>}
            </div>
            <div className="mt-2 grid grid-cols-[1fr_90px_70px_auto] gap-1.5 items-center">
              <input type="text" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Añadir otro equipo…" className="fi-in !mt-0" />
              <input type="text" value={nuevoCodigo} onChange={(e) => setNuevoCodigo(e.target.value)} placeholder="Código" className="fi-in !mt-0" />
              <input type="number" min="1" max="999" value={nuevoCant} onChange={(e) => setNuevoCant(e.target.value)} className="fi-in !mt-0" />
              <button type="button" onClick={agregarEquipo} className="h-[34px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center gap-1 text-[11px] font-bold shrink-0"><Plus className="w-3.5 h-3.5" />Añadir</button>
            </div>
            <label className="flex items-center gap-1.5 text-[10.5px] font-semibold text-slate-500 mt-2">
              <input type="checkbox" checked={anexo} onChange={(e) => { setAnexo(e.target.checked); setAnexoManual(true) }} className="w-3.5 h-3.5" /> Incluir anexo de números de serie
            </label>
          </div>
          {error && <p className="fi-err">{error}</p>}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white p-4 flex items-center gap-2">
          <button type="button" onClick={cerrar} className="h-11 px-4 rounded-2xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button type="button" onClick={generar} disabled={guardando} className="flex-1 h-11 rounded-2xl text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: '#04896f' }}><Printer className="w-4 h-4" />{guardando ? 'Generando…' : 'Generar acta'}</button>
        </div>
      </div>
    </div>
  )
}

/* ============================ Obsequio de evangelización ============================ */
type Obsequio = { id: string; nombre: string; imagen_url: string | null }
function ModalObsequio({ r, cerrar, aviso, guardado }: { r: Fila; cerrar: () => void; aviso: (t: string) => void; guardado: () => void }) {
  const [lista, setLista] = useState<Obsequio[] | null>(null)
  const [yaEntregados, setYaEntregados] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState<string | null>(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoImagen, setNuevoImagen] = useState('')
  const [creando, setCreando] = useState(false)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])

  const cargar = useCallback(() => {
    supabase.from('obsequios').select('id,nombre,imagen_url').eq('activo', true).order('nombre').then(({ data }) => setLista((data as Obsequio[]) ?? []))
    if (r.identificacion) {
      supabase.from('facturas').select('obsequio_id').eq('identificacion', r.identificacion).neq('id', r.uuid).not('obsequio_id', 'is', null).is('deleted_at', null)
        .then(({ data }) => setYaEntregados(new Set(((data as { obsequio_id: string }[]) ?? []).map((x) => x.obsequio_id))))
    }
  }, [r.identificacion, r.uuid])
  useEffect(() => { cargar() }, [cargar])

  async function elegir(id: string) {
    setGuardando(id)
    const { error } = await supabase.from('facturas').update({ obsequio_id: id }).eq('id', r.uuid)
    setGuardando(null)
    if (error) { aviso('No se pudo asignar: ' + error.message); return }
    guardado()
  }

  async function crear() {
    const nombre = nuevoNombre.trim()
    if (!nombre) return
    setCreando(true)
    const { data, error } = await supabase.from('obsequios').insert({ id: crypto.randomUUID(), nombre, imagen_url: nuevoImagen.trim() || null }).select('id').single()
    if (error) { aviso('No se pudo agregar: ' + error.message); setCreando(false); return }
    setNuevoNombre(''); setNuevoImagen(''); cargar()
    if (data) await elegir((data as { id: string }).id)
    setCreando(false)
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4 overlay" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal-panel bg-[#f6f9fc] sm:rounded-3xl shadow-2xl w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[88vh] flex flex-col overflow-hidden">
        <div className="shrink-0 px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1.5"><Gift className="w-3.5 h-3.5" />Obsequio de evangelización</span>
            <button type="button" onClick={cerrar} className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <h3 className="font-display font-bold text-lg leading-snug mt-1.5">{r.cliente || 'Venta'}</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
          {lista === null && <p className="text-xs text-slate-400 text-center py-6">Cargando…</p>}
          {lista && !lista.length && <p className="text-xs text-slate-400 text-center py-6">Todavía no hay obsequios en el catálogo. Agrega el primero abajo.</p>}
          {lista && lista.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {lista.map((o) => {
                const repetido = yaEntregados.has(o.id), actual = r.obsequioId === o.id
                return (
                  <button type="button" key={o.id} disabled={guardando === o.id} onClick={() => elegir(o.id)}
                    className={'rounded-xl border p-2 text-left relative' + (actual ? ' border-emerald-400' : ' border-slate-200 bg-white hover:border-slate-300')}
                    style={actual ? { background: '#ecfdf5' } : undefined}>
                    <div className="aspect-square rounded-lg bg-slate-100 overflow-hidden mb-1.5 flex items-center justify-center">
                      {o.imagen_url ? <img src={imagen(o.imagen_url, 200)} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <Gift className="w-5 h-5 text-slate-300" />}
                    </div>
                    <p className="text-[11px] font-semibold text-slate-700 leading-snug line-clamp-2">{o.nombre}</p>
                    {repetido && <span className="absolute top-1 right-1 text-[8.5px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>Ya entregado</span>}
                    {actual && <span className="absolute top-1 left-1 text-[8.5px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">Actual</span>}
                  </button>
                )
              })}
            </div>
          )}
          <div className="fi-sec">
            <div className="fi-sec-h"><span className="fi-num" style={{ background: '#ec4899' }}><Plus className="w-3.5 h-3.5" /></span><div className="flex-1"><b>Agregar obsequio nuevo</b><small>Si el regalo no está en la lista</small></div></div>
            <div className="grid grid-cols-1 gap-2">
              <input type="text" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nombre del obsequio *" className="fi-in" />
              <input type="url" value={nuevoImagen} onChange={(e) => setNuevoImagen(e.target.value)} placeholder="Enlace de la foto (opcional)" className="fi-in" />
              <button type="button" onClick={crear} disabled={creando || !nuevoNombre.trim()} className="pm-btn solid h-10 rounded-xl text-xs font-bold disabled:opacity-60" style={{ background: '#ec4899' }}>{creando ? 'Agregando…' : 'Agregar y asignar'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
