import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Mail, MapPin, MessageCircle, Phone, RefreshCw, Search, Trash2, UserPlus, Users, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import { ConfirmarEliminar } from './CrmClientes'
import '../estilos/clientes.css'

/* ============================ Utilidades ============================ */
type Fila = { id: string; identificacion: string; nombre: string; institucion: string; ciudad: string; telefono: string; email: string; asesor: string; registro: string; cotizaciones: number; facturas: number; comprado: number; ultima: string }
type Kpis = { clientes: number; con_compras: number; facturado: number; inactivos: number; solo_cotizaron: number; sin_gestiones: number }
type Emp = { id: string; nombre: string }
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ent = (n: number) => (Number(n) || 0).toLocaleString('es-EC')
const dfecha = (t: string | null | undefined) => { if (!t) return '—'; const d = new Date(t); return isNaN(d.getTime()) ? String(t) : d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) }
const iniciales = (n: string) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase() || '?'
const limpiar = (t: string) => t.replace(/[,()%*\\"']/g, ' ').trim()
const PAGINA = 60
const FILTROS: [string, string, keyof Kpis][] = [['todos', 'Todos', 'clientes'], ['compras', 'Con compras', 'con_compras'], ['cotizan', 'Solo cotizaron', 'solo_cotizaron'], ['inactivos', 'Sin actividad 6 meses', 'inactivos'], ['nuevos', 'Sin gestiones', 'sin_gestiones']]
const CAMPOS: { k: string; col: string; t: string; tipo?: 'tel' | 'correo' | 'fecha' | 'id' | 'sel-tipo' | 'sel-asesor' | 'sel-responsable' | 'lectura' }[] = [
  { k: 'nombre', col: 'nombre', t: 'Nombre completo' }, { k: 'identificacion', col: 'identificacion', t: 'Cédula / RUC', tipo: 'id' }, { k: 'institucion', col: 'institucion', t: 'Institución / Empresa' },
  { k: 'telefono', col: 'telefono', t: 'Teléfono', tipo: 'tel' }, { k: 'telefono2', col: 'telefono2', t: 'Teléfono 2', tipo: 'tel' }, { k: 'email', col: 'email', t: 'Correo', tipo: 'correo' },
  { k: 'ciudad', col: 'ciudad', t: 'Ciudad' }, { k: 'provincia', col: 'provincia', t: 'Provincia' }, { k: 'direccion', col: 'direccion', t: 'Dirección' }, { k: 'urlMaps', col: 'url_maps', t: 'URL Google Maps' },
  { k: 'personaContacto', col: 'persona_contacto', t: 'Persona de contacto' }, { k: 'cargoContacto', col: 'cargo_contacto', t: 'Cargo del contacto' }, { k: 'tipoCliente', col: 'tipo_cliente', t: 'Tipo de cliente', tipo: 'sel-tipo' },
  { k: 'asesorId', col: 'asesor_id', t: 'Asesor', tipo: 'sel-asesor' }, { k: 'responsableId', col: 'responsable_id', t: 'Responsable', tipo: 'sel-responsable' }, { k: 'medioCaptacion', col: 'medio_captacion', t: 'Medio de captación' },
  { k: 'cumpleanos', col: 'cumpleanos', t: 'Cumpleaños', tipo: 'fecha' }, { k: 'aniversarioEmpresa', col: 'aniversario_empresa', t: 'Aniversario de la empresa', tipo: 'fecha' }, { k: 'fechaRegistro', col: 'fecha_registro', t: 'Fecha de registro', tipo: 'lectura' },
]

/* ============================ Pantalla principal ============================ */
export default function Clientes({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [total, setTotal] = useState(0)
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [qDeb, setQDeb] = useState('')
  const [fAse, setFAse] = useState('')
  const [ord, setOrd] = useState('compras')
  const [filtro, setFiltro] = useState('todos')
  const [lim, setLim] = useState(PAGINA)
  const [asesores, setAsesores] = useState<Emp[]>([])
  const [abierto, setAbierto] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [cargando, setCargando] = useState(false)
  const peticion = useRef(0)
  const puedeCrear = puede(perfil, 'clientes', 'crear')

  useEffect(() => { const t = setTimeout(() => { setQDeb(q); setLim(PAGINA) }, 220); return () => clearTimeout(t) }, [q])
  useEffect(() => { supabase.from('v_directorio_empleados').select('id,nombre').order('nombre').then(({ data }) => setAsesores((data as Emp[]) ?? [])) }, [])

  const cargarKpis = useCallback(() => { supabase.from('v_clientes_kpis').select('*').single().then(({ data }) => { if (data) setKpis(data as unknown as Kpis) }) }, [])
  useEffect(() => { cargarKpis() }, [cargarKpis])

  const cargar = useCallback(async () => {
    const n = ++peticion.current
    setCargando(true)
    let c = supabase.from('v_clientes_lista').select('id,identificacion,nombre,institucion,ciudad,telefono,email,asesor,registro,total_cotizaciones,total_ventas,monto_ventas,ultima_actividad', { count: 'exact' })
    for (const w of limpiar(qDeb).split(/\s+/).filter(Boolean)) c = c.or(`nombre.ilike.%${w}%,identificacion.ilike.%${w}%,institucion.ilike.%${w}%,ciudad.ilike.%${w}%,telefono.ilike.%${w}%,email.ilike.%${w}%,asesor.ilike.%${w}%`)
    if (fAse) c = c.eq('asesor', fAse)
    if (filtro === 'compras') c = c.gt('total_ventas', 0)
    else if (filtro === 'cotizan') c = c.eq('total_ventas', 0).gt('total_cotizaciones', 0)
    else if (filtro === 'inactivos') c = c.lt('ultima_actividad', new Date(Date.now() - 182 * 864e5).toISOString())
    else if (filtro === 'nuevos') c = c.eq('total_ventas', 0).eq('total_cotizaciones', 0)
    if (ord === 'nombre') c = c.order('nombre')
    else if (ord === 'reciente') c = c.order('ultima_actividad', { ascending: false, nullsFirst: false })
    else if (ord === 'nuevo') c = c.order('registro', { ascending: false, nullsFirst: false })
    else c = c.order('monto_ventas', { ascending: false, nullsFirst: false }).order('total_cotizaciones', { ascending: false, nullsFirst: false })
    const { data, error, count } = await c.range(0, lim - 1)
    if (n !== peticion.current) return
    setCargando(false)
    if (error) { setError(error.message); return }
    setError(''); setTotal(count ?? 0)
    type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    setFilas(((data ?? []) as R[]).map((x) => ({ id: x.id, identificacion: x.identificacion ?? '', nombre: x.nombre ?? '', institucion: x.institucion ?? '', ciudad: x.ciudad ?? '', telefono: x.telefono ?? '', email: x.email ?? '', asesor: x.asesor ?? '', registro: x.registro ?? '', cotizaciones: Number(x.total_cotizaciones) || 0, facturas: Number(x.total_ventas) || 0, comprado: Number(x.monto_ventas) || 0, ultima: x.ultima_actividad ?? '' })))
  }, [qDeb, fAse, ord, filtro, lim])
  useEffect(() => { cargar() }, [cargar])

  const estado = (c: Fila) => c.facturas ? <span className="pill ok">{c.facturas} compra{c.facturas === 1 ? '' : 's'}</span> : c.cotizaciones ? <span className="pill wa">Cotizó {c.cotizaciones}</span> : <span className="pill gr">Sin gestiones</span>

  return (
    <div className="vm-cli">
      <header className="hdr text-white">
        <div className="max-w-[1250px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap vm-head-pad">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0"><Users /></div>
          <div className="min-w-0"><h1 className="font-display font-bold text-lg leading-tight">Clientes</h1><p className="text-[11px] text-white/70">{kpis ? ent(kpis.clientes) + ' clientes · ' : ''}{perfil.nombre}</p></div>
          <div className="ml-auto flex gap-2">
            {puedeCrear && <button className="btn !bg-white !text-[var(--navy)]" onClick={() => setNuevo(true)}><UserPlus /><span className="hidden sm:inline">Nuevo cliente</span></button>}
            <button className="btn !bg-white/10 !border-white/20 !text-white" title="Actualizar" onClick={() => { cargar(); cargarKpis() }}><RefreshCw className={cargando ? 'animate-spin' : ''} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-[1250px] mx-auto px-4 py-4 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[['Clientes', kpis ? ent(kpis.clientes) : '…'], ['Con compras', kpis ? ent(kpis.con_compras) : '…'], ['Total facturado', kpis ? money(kpis.facturado) : '…'], ['Sin actividad 6 meses', kpis ? ent(kpis.inactivos) : '…']].map(([t, v]) => <div key={t} className="kpi"><b>{v}</b><span>{t}</span></div>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_200px_210px]">
          <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="inp !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, cédula/RUC, empresa, ciudad, teléfono o correo…" autoComplete="off" /></div>
          <select className="inp" value={fAse} onChange={(e) => { setFAse(e.target.value); setLim(PAGINA) }}><option value="">Todos los asesores</option>{asesores.map((a) => <option key={a.id}>{a.nombre}</option>)}</select>
          <select className="inp" value={ord} onChange={(e) => setOrd(e.target.value)}><option value="compras">Ordenar: más compras</option><option value="reciente">Ordenar: actividad reciente</option><option value="nombre">Ordenar: nombre</option><option value="nuevo">Ordenar: registrados recientes</option></select>
        </div>
        <div className="chips">{FILTROS.map(([k, t, campo]) => <button key={k} className={'chip' + (filtro === k ? ' on' : '')} onClick={() => { setFiltro(k); setLim(PAGINA) }}>{t}<b>{kpis ? ent(kpis[campo]) : ''}</b></button>)}</div>

        {error && <div className="sec text-center py-10"><b className="text-[var(--red)]">No se pudo cargar</b><p className="s mt-1">{error}</p><button className="btn mt-3" onClick={cargar}>Reintentar</button></div>}
        {!error && filas === null && <div className="text-center py-16 text-slate-400"><span className="spin" /> Cargando clientes…</div>}
        {filas && !filas.length && <div className="sec text-center py-10 text-slate-500">Ningún cliente coincide.</div>}
        {filas && filas.length > 0 && (
          <>
            <div className="hidden md:block tw">
              <table className="t"><thead><tr><th>Cliente</th><th>Cédula / RUC</th><th>Ciudad</th><th>Contacto</th><th>Asesor</th><th>Estado</th><th className="num">Comprado</th><th className="num">Última actividad</th></tr></thead>
                <tbody>{filas.map((c) => (
                  <tr key={c.id} onClick={() => setAbierto(c.id)}>
                    <td><div className="flex items-center gap-2"><span className="ava !w-8 !h-8 !text-[11px]">{iniciales(c.nombre)}</span><div className="min-w-0"><b className="block text-[13px] text-[var(--navy)] truncate max-w-[260px]">{c.nombre}</b>{c.institucion && <span className="s">{c.institucion}</span>}</div></div></td>
                    <td className="mono text-[12px]">{c.identificacion}</td><td>{c.ciudad || '—'}</td>
                    <td className="text-[12px]">{c.telefono}{c.email && <div className="s truncate max-w-[200px]">{c.email}</div>}</td>
                    <td className="text-[12px]">{c.asesor || '—'}</td><td>{estado(c)}</td><td className="num"><b>{c.comprado ? money(c.comprado) : '—'}</b></td><td className="num s">{dfecha(c.ultima)}</td></tr>))}</tbody></table>
            </div>
            <div className="md:hidden grid gap-2">{filas.map((c) => (
              <div key={c.id} className="card" onClick={() => setAbierto(c.id)}><div className="flex items-center gap-3"><span className="ava">{iniciales(c.nombre)}</span><div className="min-w-0 flex-1"><b className="block text-[13.5px] text-[var(--navy)] leading-snug">{c.nombre}</b><span className="s mono">{c.identificacion}</span>
                <div className="flex gap-3 mt-2 text-[12px] text-slate-600"><span>Comprado <b>{money(c.comprado)}</b></span><span>Últ. {dfecha(c.ultima)}</span></div></div></div></div>))}</div>
            {total > filas.length ? <div className="text-center mt-3"><button className="btn" onClick={() => setLim((n) => n + 120)}>Mostrar más ({ent(total - filas.length)})</button></div> : <p className="s mt-2">{ent(total)} cliente(s)</p>}
          </>
        )}
      </main>

      {abierto && <Ficha id={abierto} perfil={perfil} asesores={asesores} cerrar={() => setAbierto(null)} aviso={aviso} cambio={() => { cargar(); cargarKpis() }} />}
      {nuevo && <NuevoCliente perfil={perfil} asesores={asesores} cerrar={() => setNuevo(false)} aviso={aviso} creado={(id) => { setNuevo(false); cargar(); cargarKpis(); setAbierto(id) }} />}
    </div>
  )
}

/* ============================ Ficha del cliente ============================ */
type Datos = Record<string, string>
type Factura = { id: string; numero: string; fecha: string; total: number; nc: number; asesor: string; factura: string; acta: string; guia: string; productos: { nombre: string; id: string; cantidad: number }[] }
type Cot = { id: string; tipo: string; estado: string; fecha: string; asesor: string; subtotal: number; empresa: string; pdf: string; items: { nombre: string; cantidad: number }[] }
type Inter = { id?: string; tipo: string; nota: string; fecha: string; por: string; ref?: string }
type Detalle = { datos: Datos; facturas: Factura[]; cotizaciones: Cot[]; productos: { id: string; nombre: string; cantidad: number; veces: number; ultima: string }[]; historial: Inter[]; notas: Inter[]; datosVenta: Record<string, unknown> | null }
const TABS: [string, string][] = [['resumen', 'Resumen'], ['datos', 'Datos'], ['facturas', 'Facturas'], ['cotizaciones', 'Cotizaciones'], ['productos', 'Productos'], ['historial', 'Historial'], ['notas', 'Notas']]
const idNum = (v: string) => v.replace(/\D/g, '')

/* La ficha completa también se abre desde el CRM (botón «Ficha Cliente» de una gestión). */
export { Ficha as FichaCliente }
function Ficha({ id, perfil, asesores, cerrar, aviso, cambio }: { id: string; perfil: Perfil; asesores: Emp[]; cerrar: () => void; aviso: (t: string) => void; cambio: () => void }) {
  const [d, setD] = useState<Detalle | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('resumen')
  const [guardado, setGuardado] = useState('Se guarda solo al escribir')
  const [nota, setNota] = useState('')
  const [notaEstado, setNotaEstado] = useState('')
  const [elim, setElim] = useState(false)
  const timers = useRef<Record<string, number>>({})
  const editar = puede(perfil, 'clientes', 'editar'), eliminar = puede(perfil, 'clientes', 'eliminar')

  useEffect(() => {
    let vivo = true
    ;(async () => {
      type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      const [c, f, q] = await Promise.all([
        supabase.from('clientes').select('*').eq('id', id).single(),
        supabase.from('facturas').select('id,codigo,numero_contifico,fecha_facturacion,created_at,total,total_notas_credito,pdf_url,acta_garantia_url,guia_envio_url,items,asesor:empleados!asesor_id(nombre)').eq('cliente_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(200),
        supabase.from('cotizaciones').select('id,codigo,tipo_registro,estado_crm,fecha,total,empresa,pdf_url,items,asesor:empleados!asesor_id(nombre)').eq('cliente_id', id).is('deleted_at', null).order('fecha', { ascending: false }).limit(200),
      ])
      const idsCot = ((q.data ?? []) as R[]).map((r) => r.id as string).slice(0, 150)
      const i = await supabase.from('interacciones').select('id,tipo,nota,fecha,usuario_texto,cotizacion:cotizaciones(codigo)')
        .or('cliente_id.eq.' + id + (idsCot.length ? ',cotizacion_id.in.(' + idsCot.join(',') + ')' : '')).is('deleted_at', null).order('fecha', { ascending: false }).limit(300)
      if (!vivo) return
      if (c.error || !c.data) { setError(c.error?.message ?? 'No se encontró el cliente'); return }
      const x = c.data as R
      const datos: Datos = {}
      CAMPOS.forEach((k) => { datos[k.k] = x[k.col] ?? '' })
      const facturas: Factura[] = ((f.data ?? []) as R[]).map((r) => ({ id: r.codigo, numero: r.numero_contifico ?? '', fecha: r.fecha_facturacion || r.created_at, total: Number(r.total) || 0, nc: Number(r.total_notas_credito) || 0, asesor: r.asesor?.nombre ?? '', factura: r.pdf_url ?? '', acta: r.acta_garantia_url ?? '', guia: r.guia_envio_url ?? '', productos: ((r.items ?? []) as R[]).map((p) => ({ nombre: p.nombre, id: p.codigo ?? '', cantidad: Number(p.cantidad) || 0 })) }))
      const cotizaciones: Cot[] = ((q.data ?? []) as R[]).map((r) => ({ id: r.codigo, tipo: r.tipo_registro === 'Venta' ? 'Venta' : 'Cotización', estado: r.estado_crm ?? '', fecha: r.fecha, asesor: r.asesor?.nombre ?? '', subtotal: (Number(r.total) || 0) / 1.15, empresa: r.empresa, pdf: r.pdf_url ?? '', items: ((r.items ?? []) as R[]).map((p) => ({ nombre: p.nombre, cantidad: Number(p.cantidad) || 0 })) }))
      const pm = new Map<string, { id: string; nombre: string; cantidad: number; veces: number; ultima: string }>()
      facturas.forEach((fa) => fa.productos.forEach((p) => { const k = p.id || p.nombre; const e = pm.get(k) ?? { id: p.id, nombre: p.nombre, cantidad: 0, veces: 0, ultima: '' }; e.cantidad += p.cantidad; e.veces++; if (fa.fecha > e.ultima) e.ultima = fa.fecha; pm.set(k, e) }))
      const todas: Inter[] = ((i.data ?? []) as R[]).map((r) => ({ id: r.id, tipo: r.tipo ?? '', nota: r.nota ?? '', fecha: r.fecha, por: r.usuario_texto ?? '', ref: r.cotizacion?.codigo ?? '' }))
      const notas = todas.filter((t) => t.tipo === 'Nota Cliente')
      setD({ datos, facturas, cotizaciones, productos: [...pm.values()].sort((a, b) => b.cantidad - a.cantidad), historial: todas.filter((t) => t.tipo !== 'Nota Cliente'), notas, datosVenta: x.datos_venta && Object.keys(x.datos_venta).length ? x.datos_venta : null })
      setNota(notas[0]?.nota ?? '')
    })()
    return () => { vivo = false }
  }, [id])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])

  function guardarCampo(k: string, valor: string) {
    window.clearTimeout(timers.current[k]); setGuardado('Escribiendo…')
    timers.current[k] = window.setTimeout(async () => {
      const campo = CAMPOS.find((c) => c.k === k)!
      let v: string | null = valor.trim() || null
      if (k === 'email' && v) v = v.toLowerCase()
      if (k === 'nombre' && !v) { setGuardado('El nombre no puede quedar vacío'); return }
      setGuardado('Guardando…')
      const { error } = await supabase.from('clientes').update({ [campo.col]: v }).eq('id', id)
      if (error) { setGuardado('No se guardó'); aviso(error.message); return }
      setGuardado('Guardado ✓ ' + new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })); cambio()
    }, 1000)
  }
  function cambiaDato(k: string, v: string) { setD((x) => (x ? { ...x, datos: { ...x.datos, [k]: v } } : x)); guardarCampo(k, v) }
  function guardarNota(t: string) {
    setNota(t); setNotaEstado('Escribiendo…'); window.clearTimeout(timers.current.nota)
    timers.current.nota = window.setTimeout(async () => {
      const ult = d?.notas[0]
      const mia = !!ult?.id && ult.por === perfil.nombre && Date.now() - Date.parse(ult.fecha) < 15 * 60000
      if (!mia && !t.trim()) { setNotaEstado(''); return }
      const nuevaId = crypto.randomUUID(), ahora = new Date().toISOString()
      const r = mia
        ? await supabase.from('interacciones').update({ nota: t, fecha: ahora }).eq('id', ult!.id!)
        : await supabase.from('interacciones').insert({ id: nuevaId, codigo: 'INT-' + crypto.randomUUID().slice(0, 8), ref_tipo: 'Cliente', cliente_id: id, tipo: 'Nota Cliente', nota: t, fecha: ahora, empleado_id: perfil.id, usuario_texto: perfil.nombre })
      if (r.error) { setNotaEstado('No se guardó'); aviso(r.error.message); return }
      setNotaEstado('Guardado ✓')
      setD((x) => (x ? { ...x, notas: mia ? [{ ...x.notas[0], nota: t, fecha: ahora }, ...x.notas.slice(1)] : [{ id: nuevaId, tipo: 'Nota Cliente', nota: t, fecha: ahora, por: perfil.nombre }, ...x.notas] } : x))
    }, 900)
  }
  async function borrar(motivo: string) {
    const { error } = await supabase.from('clientes').update({ deleted_at: new Date().toISOString(), motivo_eliminacion: motivo || null }).eq('id', id)
    if (error) { aviso('No se pudo eliminar: ' + error.message); return }
    setElim(false); aviso('Cliente eliminado (está en la Papelera del CRM)'); cambio(); cerrar()
  }

  const x = d?.datos
  const tel = String(x?.telefono ?? '').replace(/\D/g, ''), wa = tel ? (tel.length === 10 && tel[0] === '0' ? '593' + tel.slice(1) : tel) : ''
  const comprado = (d?.facturas ?? []).reduce((s, f) => s + f.total - f.nc, 0), nf = d?.facturas.length ?? 0
  const ultC = d?.facturas[0]?.fecha
  const ganadas = (d?.cotizaciones ?? []).filter((c) => /ganad/i.test(c.estado)).length, ncot = d?.cotizaciones.length ?? 0
  const cnt: Record<string, number> = { facturas: nf, cotizaciones: ncot, productos: d?.productos.length ?? 0, historial: d?.historial.length ?? 0, notas: d?.notas.length ?? 0 }
  const lst = (items: React.ReactNode) => <div className="sec"><div className="lst">{items}</div></div>
  const filaFactura = (f: Factura, completo = false) => (
    <div key={f.id}><div className="flex gap-2 items-baseline"><b className="text-[13px] flex-1">Factura {f.numero || f.id}</b><b className="text-[13px]">{money(f.total)}</b></div>
      <p className="s">{dfecha(f.fecha)}{f.asesor ? ' · ' + f.asesor : ''}{f.nc ? ' · nota de crédito ' + money(f.nc) : ''}</p>
      {completo && f.productos.length > 0 && <p className="text-[12px] text-slate-600 mt-1">{f.productos.map((p) => `${p.cantidad} × ${p.nombre}`).join(' · ')}</p>}
      <div className="flex gap-1.5 flex-wrap mt-1">{([['factura', 'Factura'], ['acta', 'Acta'], ['guia', 'Guía']] as const).filter(([k]) => /^https:\/\//.test(f[k])).map(([k, t]) => <a key={k} className="btn !py-1 !px-2 !text-[11px]" target="_blank" rel="noopener" href={f[k]}><FileText />{t}</a>)}</div></div>
  )
  const filaCot = (c: Cot, completo = false) => (
    <div key={c.id}><div className="flex gap-2 items-baseline"><b className="text-[13px] flex-1">{c.tipo} <span className="mono s">{c.id}</span></b><span className={'pill ' + (/ganad/i.test(c.estado) ? 'ok' : /perdid/i.test(c.estado) ? 'no' : 'wa')}>{c.estado}</span></div>
      <p className="s">{dfecha(c.fecha)}{c.asesor ? ' · ' + c.asesor : ''}{c.subtotal ? ' · ' + money(c.subtotal) + ' + IVA' : ''}{c.empresa && c.empresa !== 'VIMEDIC' ? ' · ' + c.empresa : ''}</p>
      {completo && c.items.length > 0 && <p className="text-[12px] text-slate-600 mt-1">{c.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(' · ')}</p>}
      {c.pdf && <a className="btn !py-1 !px-2 !text-[11px] mt-1" target="_blank" rel="noopener" href={c.pdf}><FileText />Ver PDF</a>}</div>
  )
  const lectura = (t: string, v: string | undefined) => (v ? <><dt className="s font-semibold">{t}</dt><dd className="m-0">{v}</dd></> : null)

  return (
    <div className="ovl" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="panel" role="dialog" aria-modal="true">
        <div className="hdr text-white sticky top-0 z-10"><div className="px-4 py-3 flex items-start gap-3">
          <span className="ava !bg-white/20">{iniciales(x?.nombre ?? '')}</span>
          <div className="min-w-0 flex-1"><h2 className="font-display font-bold text-lg leading-tight">{x?.nombre ?? 'Cargando…'}</h2>
            <p className="text-[11.5px] text-white/75"><span className="mono">{x?.identificacion}</span>{x?.institucion ? ' · ' + x.institucion : ''}{x?.ciudad ? ' · ' + x.ciudad : ''}</p>
            <div className="flex gap-1.5 flex-wrap mt-2">
              {tel && <a className="btn !py-1 !px-2 !bg-white/10 !border-white/20 !text-white" href={'tel:' + tel}><Phone />Llamar</a>}
              {wa && <a className="btn !py-1 !px-2 !bg-white/10 !border-white/20 !text-white" target="_blank" rel="noopener" href={'https://wa.me/' + wa}><MessageCircle />WhatsApp</a>}
              {x?.email && <a className="btn !py-1 !px-2 !bg-white/10 !border-white/20 !text-white" href={'mailto:' + x.email}><Mail />Correo</a>}
              {x?.urlMaps && /^https:\/\//.test(x.urlMaps) && <a className="btn !py-1 !px-2 !bg-white/10 !border-white/20 !text-white" target="_blank" rel="noopener" href={x.urlMaps}><MapPin />Ubicación</a>}</div></div>
          <button className="btn !bg-white/10 !border-white/20 !text-white" onClick={cerrar} aria-label="Cerrar"><X /></button></div></div>

        {error && <div className="p-4"><div className="sec text-center py-8"><b className="text-[var(--red)]">No se pudo cargar</b><p className="s mt-1">{error}</p></div></div>}
        {!error && !d && <div className="p-4"><div className="text-center py-14 text-slate-400"><span className="spin" /> Cargando la ficha completa…</div></div>}
        {d && x && (
          <>
            <div className="px-4 pt-3"><div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {[['Total comprado', money(comprado)], ['Facturas', ent(nf)], ['Ticket promedio', money(nf ? comprado / nf : 0)], ['Cotizaciones', ent(ncot)], ['Conversión', (ncot ? Math.round((ganadas / ncot) * 100) : 0) + ' %'], ['Última compra', dfecha(ultC)]].map(([t, v]) => <div key={t} className="kpi"><b className="!text-[16px]">{v}</b><span>{t}</span></div>)}</div>
              <div className="tabs mt-3">{TABS.map(([k, t]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{t}{cnt[k] ? <b>{cnt[k]}</b> : null}</button>)}</div></div>
            <div className="p-4">
              {tab === 'resumen' && (
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="sec"><p className="font-display font-bold text-[var(--navy)] mb-1">Datos principales</p><dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                    {lectura('Teléfono', [x.telefono, x.telefono2].filter(Boolean).join(' · '))}{lectura('Correo', x.email)}{lectura('Dirección', [x.direccion, x.ciudad].filter(Boolean).join(', '))}
                    {lectura('Contacto', [x.personaContacto, x.cargoContacto].filter(Boolean).join(' · '))}{lectura('Tipo', x.tipoCliente)}{lectura('Asesor', asesores.find((a) => a.id === x.asesorId)?.nombre)}{lectura('Registro', x.fechaRegistro ? dfecha(x.fechaRegistro) : '')}</dl></div>
                  <div className="sec"><p className="font-display font-bold text-[var(--navy)] mb-1">Lo que más compra</p>{d.productos.length ? <div className="lst">{d.productos.slice(0, 5).map((p) => <div key={p.id + p.nombre} className="flex gap-2"><span className="flex-1 min-w-0 text-[13px]">{p.nombre} <span className="s mono">{p.id}</span></span><b className="text-[13px]">{ent(p.cantidad)} u</b></div>)}</div> : <p className="s">Sin compras registradas.</p>}</div>
                  <div className="sec"><p className="font-display font-bold text-[var(--navy)] mb-1">Últimas facturas</p>{d.facturas.length ? <div className="lst">{d.facturas.slice(0, 3).map((f) => filaFactura(f))}</div> : <p className="s">Sin facturas.</p>}</div>
                  <div className="sec"><p className="font-display font-bold text-[var(--navy)] mb-1">Últimas cotizaciones</p>{d.cotizaciones.length ? <div className="lst">{d.cotizaciones.slice(0, 3).map((c) => filaCot(c))}</div> : <p className="s">Sin cotizaciones.</p>}</div>
                </div>
              )}
              {tab === 'datos' && (
                <div className="sec"><div className="flex items-center gap-2 mb-2"><p className="font-display font-bold text-[var(--navy)] flex-1">Datos del cliente</p><span className="estado">{editar ? guardado : 'Solo lectura'}</span></div>
                  <div className="grid gap-2 sm:grid-cols-2">{CAMPOS.map((c) => {
                    const dis = !editar || c.tipo === 'lectura' || c.tipo === 'id', v = x[c.k] ?? ''
                    if (c.tipo === 'sel-tipo') return <label key={c.k} className="f">{c.t}<select className="inp" disabled={dis} value={v} onChange={(e) => cambiaDato(c.k, e.target.value)}><option value="">—</option><option>PVP</option><option>DIS</option></select></label>
                    if (c.tipo === 'sel-asesor' || c.tipo === 'sel-responsable') return <label key={c.k} className="f">{c.t}<select className="inp" disabled={dis} value={v} onChange={(e) => cambiaDato(c.k, e.target.value)}><option value="">Sin asignar</option>{asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
                    return <label key={c.k} className="f">{c.t}<input className="inp" disabled={dis} type={c.tipo === 'fecha' ? 'date' : c.tipo === 'correo' ? 'email' : c.tipo === 'tel' ? 'tel' : 'text'} value={c.tipo === 'fecha' || c.tipo === 'lectura' ? String(v).slice(0, 10) : v} onChange={(e) => cambiaDato(c.k, c.tipo === 'tel' ? idNum(e.target.value) : e.target.value)} /></label>
                  })}</div>
                  {d.datosVenta && <><p className="font-display font-bold text-[var(--navy)] mt-4 mb-1">Datos de venta predeterminados</p><dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">{Object.keys(d.datosVenta).filter((k) => d.datosVenta![k] !== '' && typeof d.datosVenta![k] !== 'object').map((k) => <><dt key={k + 't'} className="s font-semibold">{k}</dt><dd key={k + 'v'} className="m-0 break-words">{String(d.datosVenta![k])}</dd></>)}</dl></>}
                  {eliminar && <div className="mt-4 pt-3 border-t border-slate-100"><button className="btn btn-r" onClick={() => setElim(true)}><Trash2 />Eliminar cliente</button></div>}</div>
              )}
              {tab === 'facturas' && (d.facturas.length ? lst(d.facturas.map((f) => filaFactura(f, true))) : <div className="sec text-center py-8 text-slate-500 text-sm">Este cliente no tiene facturas.</div>)}
              {tab === 'cotizaciones' && (d.cotizaciones.length ? lst(d.cotizaciones.map((c) => filaCot(c, true))) : <div className="sec text-center py-8 text-slate-500 text-sm">Este cliente no tiene cotizaciones.</div>)}
              {tab === 'productos' && (d.productos.length
                ? <div className="sec overflow-x-auto"><table className="t"><thead><tr><th>Producto</th><th className="num">Unidades</th><th className="num">Veces</th><th className="num">Última compra</th></tr></thead><tbody>{d.productos.map((p) => <tr key={p.id + p.nombre} style={{ cursor: 'default' }}><td><b className="text-[13px]">{p.nombre}</b><div className="s mono">{p.id}</div></td><td className="num"><b>{ent(p.cantidad)}</b></td><td className="num">{ent(p.veces)}</td><td className="num s">{dfecha(p.ultima)}</td></tr>)}</tbody></table></div>
                : <div className="sec text-center py-8 text-slate-500 text-sm">Sin productos comprados todavía.</div>)}
              {tab === 'historial' && (d.historial.length ? lst(d.historial.map((i, k) => <div key={k}><div className="flex gap-2"><b className="text-[13px] flex-1">{i.tipo || 'Interacción'}</b><span className="s">{dfecha(i.fecha)}</span></div>{i.nota && <p className="text-[13px] text-slate-600 mt-0.5">{i.nota}</p>}{(i.por || i.ref) && <p className="s">{[i.por, i.ref].filter(Boolean).join(' · ')}</p>}</div>)) : <div className="sec text-center py-8 text-slate-500 text-sm">Sin actividad registrada.</div>)}
              {tab === 'notas' && (
                <div className="sec"><div className="flex items-center gap-2 mb-2"><p className="font-display font-bold text-[var(--navy)] flex-1">Notas internas</p><span className="estado">{notaEstado || (d.notas[0] ? 'Última: ' + d.notas[0].por + ' · ' + dfecha(d.notas[0].fecha) : 'Se guarda sola')}</span></div>
                  <textarea className="inp" rows={5} maxLength={2000} value={nota} disabled={!editar} onChange={(e) => guardarNota(e.target.value)} placeholder="Preferencias, condiciones de pago, contactos clave…" />
                  {d.notas.length > 1 && <div className="lst mt-3">{d.notas.slice(1).map((n, k) => <div key={n.id ?? k}><p className="text-[13px] whitespace-pre-line">{n.nota}</p><p className="s">{n.por} · {dfecha(n.fecha)}</p></div>)}</div>}</div>
              )}
            </div>
          </>
        )}
      </div>
      {elim && <ConfirmarEliminar titulo={`¿Eliminar a ${x?.nombre ?? 'este cliente'}?`} detalle="Deja de aparecer en Clientes y en el buscador. Sus cotizaciones y ventas se conservan, y se puede restaurar desde la Papelera." ok={borrar} cerrar={() => setElim(false)} />}
    </div>
  )
}

/* ============================ Nuevo cliente ============================ */
function NuevoCliente({ perfil, asesores, cerrar, creado, aviso }: { perfil: Perfil; asesores: Emp[]; cerrar: () => void; creado: (id: string) => void; aviso: (t: string) => void }) {
  const [v, setV] = useState<Datos>({ asesorId: perfil.id })
  const [guardando, setGuardando] = useState(false)
  async function crear() {
    if (!v.nombre?.trim() || !/^\d{10}(\d{3})?$/.test(v.identificacion ?? '')) { aviso('Escribe el nombre y una cédula (10 dígitos) o RUC (13 dígitos).'); return }
    setGuardando(true)
    const dup = await supabase.from('clientes').select('id').eq('identificacion', v.identificacion).is('deleted_at', null).limit(1)
    if (dup.data?.length) { setGuardando(false); aviso('Ya existe un cliente con esa cédula/RUC.'); return }
    const fila: Record<string, unknown> = { id: crypto.randomUUID(), codigo: 'CLI-' + crypto.randomUUID().slice(0, 6).toUpperCase(), empresa: perfil.empresa, fecha_registro: new Date().toISOString() }
    CAMPOS.filter((c) => c.tipo !== 'lectura').forEach((c) => { const val = (v[c.k] ?? '').trim(); if (val) fila[c.col] = c.k === 'email' ? val.toLowerCase() : val })
    const { error } = await supabase.from('clientes').insert(fila)
    setGuardando(false)
    if (error) { aviso(error.message); return }
    aviso('Cliente creado'); creado(fila.id as string)
  }
  return (
    <div className="ovl modal-c" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="flex items-center gap-2 mb-3"><h3 className="font-display font-bold text-[var(--navy)] flex-1">Nuevo cliente</h3><button className="btn" onClick={cerrar} aria-label="Cerrar"><X /></button></div>
        <div className="grid gap-2 sm:grid-cols-2">{CAMPOS.filter((c) => c.tipo !== 'lectura').map((c) => {
          if (c.tipo === 'sel-tipo') return <label key={c.k} className="f">{c.t}<select className="inp" value={v[c.k] ?? ''} onChange={(e) => setV({ ...v, [c.k]: e.target.value })}><option value="">—</option><option>PVP</option><option>DIS</option></select></label>
          if (c.tipo === 'sel-asesor' || c.tipo === 'sel-responsable') return <label key={c.k} className="f">{c.t}<select className="inp" value={v[c.k] ?? ''} onChange={(e) => setV({ ...v, [c.k]: e.target.value })}><option value="">Sin asignar</option>{asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
          return <label key={c.k} className="f">{c.t}{['identificacion', 'nombre'].includes(c.k) ? ' *' : ''}<input className="inp" type={c.tipo === 'fecha' ? 'date' : c.tipo === 'correo' ? 'email' : c.tipo === 'tel' ? 'tel' : 'text'} inputMode={c.k === 'identificacion' || c.tipo === 'tel' ? 'numeric' : undefined} maxLength={c.k === 'identificacion' ? 13 : undefined} value={v[c.k] ?? ''} onChange={(e) => setV({ ...v, [c.k]: c.k === 'identificacion' || c.tipo === 'tel' ? idNum(e.target.value) : e.target.value })} /></label>
        })}</div>
        <div className="flex gap-2 mt-4"><button className="btn" onClick={cerrar}>Cancelar</button><button className="btn btn-p flex-1" onClick={crear} disabled={guardando}>{guardando ? <span className="spin" /> : <><UserPlus />Crear cliente</>}</button></div>
      </div>
    </div>
  )
}
