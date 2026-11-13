import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, CalendarDays, Check, PackageOpen, PackagePlus, Plus, Search, Trash2, Wallet, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'
import '../estilos/comun.css'

/* Adquisiciones (IngresosProveedores.gs + Facturacion.html en modo ingresos): registrar una compra local a
   proveedor que sube el stock, distinto de Importaciones (compras al exterior con embarque/aduana).
   Como el original: indicadores, lista con proveedor / factura / responsable / productos / monto, detalle de
   cada ingreso y, al registrar, crear el proveedor o el producto si todavía no existen. */

type Item = { codigo: string; nombre: string; cantidad: string; precio: string; aplicaIva: boolean }
type LineaIng = { codigo: string; nombre?: string; cantidad: number; precio?: number; aplicaIva?: boolean; observacion?: string | null }
type Ingreso = {
  id: string; codigo: string; proveedor_texto: string; numero_factura: string | null; fecha_factura: string | null; total: number | null
  observacion: string | null; items: LineaIng[]; created_at: string; responsable: { nombre: string } | null
}
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = (i: Ingreso) => (i.fecha_factura ? new Date(i.fecha_factura + 'T12:00:00') : new Date(i.created_at))
const totalIng = (i: Ingreso) => (i.total != null ? Number(i.total) : (i.items ?? []).reduce((t, l) => t + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0))

export default function Adquisiciones({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Ingreso[] | null>(null)
  const [error, setError] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const [abierto, setAbierto] = useState<Ingreso | null>(null)
  const [q, setQ] = useState('')
  const crear = puede(perfil, 'importaciones', 'crear') || puede(perfil, 'facturacion', 'crear')

  const cargar = useCallback(() => {
    supabase.from('ingresos_proveedor').select('id,codigo,proveedor_texto,numero_factura,fecha_factura,total,observacion,items,created_at,responsable:empleados!responsable_id(nombre)').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) setError(error.message); else setLista((data as unknown as Ingreso[]) ?? []) })
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const kpis = useMemo(() => {
    const l = lista ?? [], d = new Date(), mes = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    const delMes = l.filter((i) => fecha(i).getTime() >= mes)
    return { total: l.length, nMes: delMes.length, mMes: delMes.reduce((t, i) => t + totalIng(i), 0), proveedores: new Set(l.map((i) => i.proveedor_texto.trim().toLowerCase())).size }
  }, [lista])
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (lista ?? []).filter((i) => !t || [i.proveedor_texto, i.codigo, i.numero_factura, i.responsable?.nombre, ...(i.items ?? []).map((x) => x.codigo + ' ' + (x.nombre ?? ''))].join(' ').toLowerCase().includes(t))
  }, [lista, q])

  const kpi = (Icono: typeof Wallet, c: string, b: string, valor: string | number, texto: string) => (
    <div className="card p-3 flex items-center gap-2.5 min-w-0">
      <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: b, color: c }}><Icono className="w-4 h-4" /></span>
      <div className="min-w-0"><b className="block font-display text-base text-slate-800 leading-tight truncate">{valor}</b><small className="text-[10.5px] text-slate-500">{texto}</small></div>
    </div>
  )

  return (
    <div className="vm-ui h-full flex flex-col overflow-hidden" style={{ background: '#f8fafc' }}>
      <header className="shrink-0 px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><PackagePlus className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1"><h2 className="font-display font-bold text-lg leading-tight">Adquisiciones</h2><p className="text-[11px] text-white/70">Ingresos de mercadería: compras a proveedor local que suben el stock.</p></div>
          {crear && <button onClick={() => setNuevo(true)} className="text-xs font-bold px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 flex items-center gap-1.5"><Plus className="w-4 h-4" />Nuevo ingreso</button>}
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-5 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {kpi(PackageOpen, '#0e7490', '#e6f6f8', kpis.total, 'Ingresos registrados')}
          {kpi(CalendarDays, '#055c9d', '#eaf3fb', kpis.nMes, 'Ingresos este mes')}
          {kpi(Wallet, '#04896f', '#e7f6f2', money(kpis.mMes), 'Comprado este mes')}
          {kpi(Building2, '#7c3aed', '#f3eefe', kpis.proveedores, 'Proveedores')}
        </div>
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor, ID, factura, responsable o producto…" className="inp w-full pl-9" />
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
        {error && <div className="card p-4 text-xs text-red-700 bg-red-50 border border-red-200">{error}</div>}
        {!lista && !error && <p className="text-xs text-slate-400 text-center py-10">Cargando…</p>}
        {lista && !lista.length && <div className="card p-10 text-center text-xs text-slate-400">Todavía no hay ingresos registrados.</div>}
        {lista && lista.length > 0 && !visibles.length && <div className="card p-6 text-center text-xs text-slate-400">Sin coincidencias.</div>}
        <div className="space-y-2.5">
          {visibles.map((i) => (
            <button key={i.id} type="button" onClick={() => setAbierto(i)} className="card p-4 w-full text-left flex items-center gap-3 flex-wrap hover:shadow-md">
              <div className="min-w-0 flex-1" style={{ minWidth: 200 }}>
                <p className="text-sm font-bold text-slate-800 truncate">{i.proveedor_texto}</p>
                <p className="text-[11px] text-slate-500">{fecha(i).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })} · {i.codigo}{i.numero_factura ? ' · Factura ' + i.numero_factura : ''}</p>
                <p className="text-[11px] text-slate-400">{i.responsable?.nombre ?? 'Sin responsable'} · {(i.items ?? []).length} producto{(i.items ?? []).length === 1 ? '' : 's'} · {(i.items ?? []).reduce((t, l) => t + (Number(l.cantidad) || 0), 0)} u.</p>
              </div>
              <b className="text-sm text-slate-700">{money(totalIng(i))}</b>
            </button>
          ))}
        </div>
      </main>
      {abierto && <DetalleIngreso i={abierto} cerrar={() => setAbierto(null)} />}
      {nuevo && <NuevoIngreso perfil={perfil} cerrar={() => setNuevo(false)} creado={() => { setNuevo(false); cargar(); aviso('Ingreso registrado: stock actualizado.') }} aviso={aviso} />}
    </div>
  )
}

/* Detalle de un ingreso (openIncomeProducts): productos con su costo, factura y observación. */
function DetalleIngreso({ i, cerrar }: { i: Ingreso; cerrar: () => void }) {
  const [prods, setProds] = useState<Record<string, { nombre: string; imagen_url: string | null }>>({})
  useEffect(() => {
    const cods = [...new Set((i.items ?? []).map((l) => l.codigo).filter(Boolean))]
    if (!cods.length) return
    supabase.from('productos').select('codigo,nombre,imagen_url').in('codigo', cods).then(({ data }) => {
      const m: Record<string, { nombre: string; imagen_url: string | null }> = {}
      for (const p of (data as { codigo: string; nombre: string; imagen_url: string | null }[]) ?? []) m[p.codigo] = { nombre: p.nombre, imagen_url: p.imagen_url }
      setProds(m)
    })
  }, [i])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [cerrar])
  return (
    <div className="vm-ui fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 text-white shrink-0" style={{ background: 'linear-gradient(135deg,var(--navy),#0e7490)' }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-wider text-white/70">Detalle de ingreso</p><h3 className="font-display font-bold text-lg leading-tight truncate">{i.proveedor_texto}</h3>
              <p className="text-[11px] text-white/70">{[i.codigo, fecha(i).toLocaleDateString('es-EC'), i.responsable?.nombre].filter(Boolean).join(' · ')}</p></div>
            <div className="text-right shrink-0"><p className="text-[9px] font-bold uppercase text-white/60">Total</p><p className="font-display font-bold text-xl">{money(totalIng(i))}</p></div>
            <button onClick={cerrar} className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 grid place-items-center shrink-0" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="pill" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>Ingreso</span>
            {i.numero_factura && <span className="pill" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>Factura {i.numero_factura}</span>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {i.observacion && <div className="text-[11.5px] rounded-xl px-3 py-2" style={{ background: '#f7fbff', border: '1px solid #d9e9f5', color: '#334155' }}><b style={{ color: '#055c9d' }}>Observación: </b>{i.observacion}</div>}
          {(i.items ?? []).map((l, k) => {
            const p = prods[l.codigo], sub = (Number(l.cantidad) || 0) * (Number(l.precio) || 0)
            return (
              <div key={k} className="flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2">
                {p?.imagen_url ? <img src={p.imagen_url} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover border border-slate-100 shrink-0" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} /> : <span className="w-11 h-11 rounded-lg bg-slate-100 grid place-items-center shrink-0"><PackageOpen className="w-5 h-5 text-slate-300" /></span>}
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold text-slate-800 leading-snug"><span className="font-mono-spec text-[10.5px] text-slate-400 mr-1.5">{l.codigo}</span>{l.nombre || p?.nombre || ''}</p>
                  <p className="text-[11px] text-slate-500">{l.cantidad} u. × {money(Number(l.precio) || 0)}{l.aplicaIva === false ? ' · IVA 0%' : ' · + IVA'}{l.observacion ? ' · ' + l.observacion : ''}</p>
                </div>
                <b className="text-[12.5px] text-slate-700 shrink-0">{money(sub)}</b>
              </div>
            )
          })}
          {!(i.items ?? []).length && <p className="text-xs text-slate-400 text-center py-6">Este ingreso no tiene productos registrados.</p>}
        </div>
      </div>
    </div>
  )
}

type Categoria = { id: string; nombre: string }
function NuevoIngreso({ perfil, cerrar, creado, aviso }: { perfil: Perfil; cerrar: () => void; creado: () => void; aviso: (t: string) => void }) {
  const [proveedor, setProveedor] = useState('')
  const [proveedores, setProveedores] = useState<string[]>([])
  const [numeroFactura, setNumeroFactura] = useState('')
  const [fechaF, setFechaF] = useState(() => new Date().toISOString().slice(0, 10))
  const [observacion, setObservacion] = useState('')
  const [items, setItems] = useState<Item[]>([{ codigo: '', nombre: '', cantidad: '', precio: '', aplicaIva: true }])
  const [busqueda, setBusqueda] = useState<{ fila: number; texto: string; res: { codigo: string; nombre: string }[] } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [nuevoProv, setNuevoProv] = useState<null | { ruc: string; nombre: string; email: string; telefono: string; direccion: string }>(null)
  const [nuevoProd, setNuevoProd] = useState<null | { fila: number; codigo: string; nombre: string; categoria: string; pvp: string; descripcion: string }>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const puedeCrearProducto = puede(perfil, 'inventario', 'crear')

  const cargarProveedores = useCallback(() => {
    supabase.from('proveedores').select('razon_social').is('deleted_at', null).order('razon_social').limit(500)
      .then(({ data }) => setProveedores([...new Set(((data as { razon_social: string }[]) ?? []).map((x) => x.razon_social).filter(Boolean))]))
  }, [])
  useEffect(() => { cargarProveedores() }, [cargarProveedores])
  useEffect(() => { if (nuevoProd && !categorias.length) supabase.from('categorias').select('id,nombre').is('deleted_at', null).order('nombre').then(({ data }) => setCategorias((data as Categoria[]) ?? [])) }, [nuevoProd, categorias.length])

  function buscarProducto(fila: number, texto: string) {
    setBusqueda({ fila, texto, res: [] })
    const t = texto.trim().replace(/[,()%*\\]/g, ' ')
    if (t.length < 2) return
    supabase.from('productos').select('codigo,nombre').or(`codigo.ilike.%${t}%,nombre.ilike.%${t}%`).is('deleted_at', null).order('en_vista_publica', { ascending: false }).limit(8)
      .then(({ data }) => setBusqueda((b) => (b && b.fila === fila ? { ...b, res: (data as { codigo: string; nombre: string }[]) ?? [] } : b)))
  }
  function elegirProducto(fila: number, p: { codigo: string; nombre: string }) {
    setItems((a) => a.map((x, i) => (i === fila ? { ...x, codigo: p.codigo, nombre: p.nombre } : x)))
    setBusqueda(null)
  }
  function agregarFila() { setItems((a) => [...a, { codigo: '', nombre: '', cantidad: '', precio: '', aplicaIva: true }]) }
  function quitarFila(i: number) { setItems((a) => a.filter((_, k) => k !== i)) }

  /* vmCrearProveedorIngreso: RUC / ID y nombre obligatorios; no se repite el RUC. */
  async function guardarProveedor() {
    if (!nuevoProv) return
    const ruc = nuevoProv.ruc.trim(), nombre = nuevoProv.nombre.trim()
    if (!ruc || !nombre) { aviso('El RUC/ID y el nombre del proveedor son obligatorios.'); return }
    const { data: ya } = await supabase.from('proveedores').select('id').ilike('ruc', ruc).is('deleted_at', null).limit(1)
    if (ya?.length) { aviso('Ya existe un proveedor con ese RUC/ID. Selecciónalo en el buscador.'); return }
    const { error: e } = await supabase.from('proveedores').insert({ id: crypto.randomUUID(), ruc, razon_social: nombre, email: nuevoProv.email.trim() || null, telefono: nuevoProv.telefono.trim() || null, direccion: nuevoProv.direccion.trim() || null, fecha_registro: new Date().toISOString() })
    if (e) { aviso('No se pudo crear el proveedor: ' + e.message); return }
    setProveedor(nombre); setNuevoProv(null); cargarProveedores(); aviso('Proveedor creado.')
  }
  /* vmCrearProductoIngreso: crea el producto (con permiso de Inventario) y lo deja en la línea del ingreso. */
  async function guardarProducto() {
    if (!nuevoProd) return
    const codigo = nuevoProd.codigo.trim().toUpperCase(), nombre = nuevoProd.nombre.trim(), pvp = Number(nuevoProd.pvp)
    if (!/^[A-Z0-9._/-]+$/.test(codigo)) { aviso('Usa letras, números, puntos, guiones o barras en el código del producto.'); return }
    if (!nombre) { aviso('Escribe el nombre del producto.'); return }
    if (!isFinite(pvp) || pvp < 0) { aviso('El PVP debe ser un número mayor o igual a cero.'); return }
    const { error: e } = await supabase.from('productos').insert({ id: crypto.randomUUID(), codigo, nombre, pvp, categoria_id: nuevoProd.categoria || null, descripcion: nuevoProd.descripcion.trim() || null, stock: 0 })
    if (e) { aviso(/duplicate|unique/i.test(e.message) ? 'Ya existe un producto con ese código.' : 'No se pudo crear el producto: ' + e.message); return }
    elegirProducto(nuevoProd.fila, { codigo, nombre }); setNuevoProd(null); aviso('Producto creado y añadido al ingreso.')
  }

  const total = items.reduce((s, x) => s + (Number(x.cantidad) || 0) * (Number(x.precio) || 0), 0)

  async function guardar() {
    if (!proveedor.trim()) { setError('Selecciona o escribe el proveedor.'); return }
    const validos = items.filter((x) => x.codigo && Number(x.cantidad) > 0)
    if (!validos.length) { setError('Agrega al menos un producto con código y cantidad.'); return }
    setGuardando(true); setError('')
    const { data, error } = await supabase.rpc('registrar_ingreso_proveedor', {
      p_proveedor_texto: proveedor.trim(), p_numero_factura: numeroFactura.trim() || null, p_fecha_factura: fechaF || null, p_observacion: observacion.trim() || null,
      p_items: validos.map((x) => ({ codigo: x.codigo, nombre: x.nombre, cantidad: Number(x.cantidad), precio: Number(x.precio) || 0, aplicaIva: x.aplicaIva, observacion: null })),
    })
    setGuardando(false)
    if (error) { setError(error.message); return }
    void data; creado()
  }

  return (
    <div className="vm-ui fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">Nuevo ingreso de mercadería</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-500">Proveedor *
              <input type="text" list="dlProvIng" value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="inp w-full mt-1" placeholder="RUC o razón social" />
              <datalist id="dlProvIng">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
            </label>
            {!nuevoProv && <button type="button" onClick={() => setNuevoProv({ ruc: '', nombre: proveedor, email: '', telefono: '', direccion: '' })} className="mt-1 text-[11px] font-bold flex items-center gap-1" style={{ color: 'var(--primary)' }}><Plus className="w-3 h-3" />Crear proveedor</button>}
            {nuevoProv && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-[11px] font-bold text-slate-600">Proveedor nuevo</p>
                <div className="grid grid-cols-2 gap-2">
                  <input value={nuevoProv.ruc} onChange={(e) => setNuevoProv({ ...nuevoProv, ruc: e.target.value })} placeholder="RUC / ID *" className="inp" />
                  <input value={nuevoProv.nombre} onChange={(e) => setNuevoProv({ ...nuevoProv, nombre: e.target.value })} placeholder="Razón social *" className="inp" />
                  <input value={nuevoProv.email} onChange={(e) => setNuevoProv({ ...nuevoProv, email: e.target.value })} placeholder="Correo" className="inp" />
                  <input value={nuevoProv.telefono} onChange={(e) => setNuevoProv({ ...nuevoProv, telefono: e.target.value })} placeholder="Teléfono" className="inp" />
                </div>
                <input value={nuevoProv.direccion} onChange={(e) => setNuevoProv({ ...nuevoProv, direccion: e.target.value })} placeholder="Dirección" className="inp w-full" />
                <div className="flex gap-2 justify-end"><button type="button" onClick={() => setNuevoProv(null)} className="btn">Cancelar</button><button type="button" onClick={guardarProveedor} className="btn btn-primary">Guardar y seleccionar</button></div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-[11px] font-bold text-slate-500">N.º de factura del proveedor
              <input type="text" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} className="inp w-full mt-1" /></label>
            <label className="block text-[11px] font-bold text-slate-500">Fecha de factura
              <input type="date" value={fechaF} onChange={(e) => setFechaF(e.target.value)} className="inp w-full mt-1" /></label>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">Productos *</p>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex gap-2 items-start relative">
                    <div className="flex-1 min-w-0 relative">
                      <input type="text" value={it.codigo ? `${it.codigo} · ${it.nombre}` : busqueda?.fila === i ? busqueda.texto : ''} onChange={(e) => { setItems((a) => a.map((x, k) => (k === i ? { ...x, codigo: '', nombre: '' } : x))); buscarProducto(i, e.target.value) }}
                        placeholder="Buscar producto por código o nombre" className="inp w-full" />
                      {busqueda?.fila === i && busqueda.res.length > 0 && (
                        <div className="absolute z-10 top-full left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
                          {busqueda.res.map((p) => <button key={p.codigo} type="button" onClick={() => elegirProducto(i, p)} className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50"><b>{p.codigo}</b> · {p.nombre}</button>)}
                        </div>
                      )}
                    </div>
                    <input type="number" min="0" step="1" value={it.cantidad} onChange={(e) => setItems((a) => a.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))} placeholder="Cant." className="inp w-20" />
                    <input type="number" min="0" step="0.01" value={it.precio} onChange={(e) => setItems((a) => a.map((x, k) => (k === i ? { ...x, precio: e.target.value } : x)))} placeholder="Costo u." className="inp w-24" />
                    <button type="button" onClick={() => quitarFila(i)} className="w-9 h-9 rounded-lg border border-red-200 text-red-600 flex items-center justify-center shrink-0" aria-label="Quitar"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  {!it.codigo && puedeCrearProducto && busqueda?.fila === i && busqueda.texto.trim().length >= 2 && !busqueda.res.length && nuevoProd?.fila !== i && (
                    <button type="button" onClick={() => setNuevoProd({ fila: i, codigo: '', nombre: busqueda.texto.trim(), categoria: '', pvp: '', descripcion: '' })} className="text-[11px] font-bold flex items-center gap-1" style={{ color: 'var(--primary)' }}><Plus className="w-3 h-3" />No existe: crear producto «{busqueda.texto.trim()}»</button>
                  )}
                  {nuevoProd?.fila === i && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                      <p className="text-[11px] font-bold text-slate-600">Producto nuevo (se crea en Inventario)</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={nuevoProd.codigo} onChange={(e) => setNuevoProd({ ...nuevoProd, codigo: e.target.value })} placeholder="Código * (EQM…)" className="inp" />
                        <input type="number" min="0" step="0.01" value={nuevoProd.pvp} onChange={(e) => setNuevoProd({ ...nuevoProd, pvp: e.target.value })} placeholder="PVP *" className="inp" />
                      </div>
                      <input value={nuevoProd.nombre} onChange={(e) => setNuevoProd({ ...nuevoProd, nombre: e.target.value })} placeholder="Nombre *" className="inp w-full" />
                      <select value={nuevoProd.categoria} onChange={(e) => setNuevoProd({ ...nuevoProd, categoria: e.target.value })} className="inp w-full"><option value="">Categoría</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
                      <textarea rows={2} value={nuevoProd.descripcion} onChange={(e) => setNuevoProd({ ...nuevoProd, descripcion: e.target.value })} placeholder="Descripción" className="inp w-full" />
                      <div className="flex gap-2 justify-end"><button type="button" onClick={() => setNuevoProd(null)} className="btn">Cancelar</button><button type="button" onClick={guardarProducto} className="btn btn-primary">Crear y añadir al ingreso</button></div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button type="button" onClick={agregarFila} className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Agregar producto</button>
          </div>
          <label className="block text-[11px] font-bold text-slate-500">Observación
            <textarea rows={2} value={observacion} onChange={(e) => setObservacion(e.target.value)} className="inp w-full mt-1" /></label>
          <p className="text-sm font-bold text-slate-700 text-right">Total estimado: {money(total)}</p>
          {error && <div className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
        </div>
        <div className="shrink-0 border-t border-slate-100 p-4"><button onClick={guardar} disabled={guardando} className="btn btn-primary w-full justify-center"><Check className="w-4 h-4" />{guardando ? 'Guardando…' : 'Registrar ingreso'}</button></div>
      </div>
    </div>
  )
}
