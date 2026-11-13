import { useCallback, useEffect, useState } from 'react'
import { Check, PackagePlus, Plus, Trash2, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'

/* Adquisiciones (IngresosProveedores.gs): registrar una compra local a proveedor que sube el stock,
   distinto de Importaciones (compras al exterior con embarque/aduana). */

type Item = { codigo: string; nombre: string; cantidad: string; precio: string; aplicaIva: boolean }
type Ingreso = { id: string; codigo: string; proveedor_texto: string; numero_factura: string | null; fecha_factura: string | null; total: number | null; items: { codigo: string; nombre: string; cantidad: number }[]; created_at: string }
const money = (n: number) => '$' + (Number(n) || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Adquisiciones({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [lista, setLista] = useState<Ingreso[] | null>(null)
  const [error, setError] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const crear = puede(perfil, 'importaciones', 'crear') || puede(perfil, 'facturacion', 'crear')

  const cargar = useCallback(() => {
    supabase.from('ingresos_proveedor').select('id,codigo,proveedor_texto,numero_factura,fecha_factura,total,items,created_at').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (error) setError(error.message); else setLista((data as unknown as Ingreso[]) ?? []) })
  }, [])
  useEffect(() => { cargar() }, [cargar])

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: '#f8fafc' }}>
      <header className="shrink-0 px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg,var(--navy),var(--primary))' }}>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><PackagePlus className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1"><h2 className="font-display font-bold text-lg leading-tight">Adquisiciones</h2><p className="text-[11px] text-white/70">Ingresos de mercadería: compras a proveedor local que suben el stock.</p></div>
          {crear && <button onClick={() => setNuevo(true)} className="text-xs font-bold px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 flex items-center gap-1.5"><Plus className="w-4 h-4" />Nuevo ingreso</button>}
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-5">
        {error && <div className="card p-4 mb-3 text-xs text-red-700 bg-red-50 border border-red-200">{error}</div>}
        {!lista && !error && <p className="text-xs text-slate-400 text-center py-10">Cargando…</p>}
        {lista && !lista.length && <div className="card p-10 text-center text-xs text-slate-400">Todavía no hay ingresos registrados.</div>}
        <div className="space-y-2.5">
          {lista?.map((i) => (
            <article key={i.id} className="card p-4 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800">{i.proveedor_texto}</p>
                <p className="text-[11px] text-slate-500">{i.codigo} · {i.numero_factura ? 'Factura ' + i.numero_factura + ' · ' : ''}{i.fecha_factura ?? new Date(i.created_at).toLocaleDateString('es-EC')} · {i.items.length} producto{i.items.length === 1 ? '' : 's'} ({i.items.reduce((s, x) => s + (Number(x.cantidad) || 0), 0)} u.)</p>
              </div>
              <b className="text-sm text-slate-700">{money(i.total ?? 0)}</b>
            </article>
          ))}
        </div>
      </main>
      {nuevo && <NuevoIngreso perfil={perfil} cerrar={() => setNuevo(false)} creado={() => { setNuevo(false); cargar(); aviso('Ingreso registrado: stock actualizado.') }} aviso={aviso} />}
    </div>
  )
}

function NuevoIngreso({ cerrar, creado, aviso }: { perfil: Perfil; cerrar: () => void; creado: () => void; aviso: (t: string) => void }) {
  const [proveedor, setProveedor] = useState('')
  const [proveedores, setProveedores] = useState<string[]>([])
  const [numeroFactura, setNumeroFactura] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [observacion, setObservacion] = useState('')
  const [items, setItems] = useState<Item[]>([{ codigo: '', nombre: '', cantidad: '', precio: '', aplicaIva: true }])
  const [busqueda, setBusqueda] = useState<{ fila: number; texto: string; res: { codigo: string; nombre: string }[] } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('proveedores').select('razon_social').is('deleted_at', null).order('razon_social').limit(500)
      .then(({ data }) => setProveedores([...new Set(((data as { razon_social: string }[]) ?? []).map((x) => x.razon_social))]))
  }, [])

  function buscarProducto(fila: number, texto: string) {
    setBusqueda({ fila, texto, res: [] })
    if (texto.trim().length < 2) return
    supabase.from('productos').select('codigo,nombre').or(`codigo.ilike.%${texto.trim()}%,nombre.ilike.%${texto.trim()}%`).is('deleted_at', null).limit(8)
      .then(({ data }) => setBusqueda((b) => (b && b.fila === fila ? { ...b, res: (data as { codigo: string; nombre: string }[]) ?? [] } : b)))
  }
  function elegirProducto(fila: number, p: { codigo: string; nombre: string }) {
    setItems((a) => a.map((x, i) => (i === fila ? { ...x, codigo: p.codigo, nombre: p.nombre } : x)))
    setBusqueda(null)
  }
  function agregarFila() { setItems((a) => [...a, { codigo: '', nombre: '', cantidad: '', precio: '', aplicaIva: true }]) }
  function quitarFila(i: number) { setItems((a) => a.filter((_, k) => k !== i)) }

  const total = items.reduce((s, x) => s + (Number(x.cantidad) || 0) * (Number(x.precio) || 0), 0)

  async function guardar() {
    if (!proveedor.trim()) { setError('Selecciona o escribe el proveedor.'); return }
    const validos = items.filter((x) => x.codigo && Number(x.cantidad) > 0)
    if (!validos.length) { setError('Agrega al menos un producto con código y cantidad.'); return }
    setGuardando(true); setError('')
    const { data, error } = await supabase.rpc('registrar_ingreso_proveedor', {
      p_proveedor_texto: proveedor.trim(), p_numero_factura: numeroFactura.trim() || null, p_fecha_factura: fecha || null, p_observacion: observacion.trim() || null,
      p_items: validos.map((x) => ({ codigo: x.codigo, cantidad: Number(x.cantidad), precio: Number(x.precio) || 0, aplicaIva: x.aplicaIva, observacion: null })),
    })
    setGuardando(false)
    if (error) { setError(error.message); return }
    void data; creado()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0"><h3 className="font-display font-bold text-sm text-slate-800">Nuevo ingreso de mercadería</h3><button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button></div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <label className="block text-[11px] font-bold text-slate-500">Proveedor *
            <input type="text" list="dlProvIng" value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="inp w-full mt-1" placeholder="RUC o razón social" />
            <datalist id="dlProvIng">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-[11px] font-bold text-slate-500">N.º de factura del proveedor
              <input type="text" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} className="inp w-full mt-1" /></label>
            <label className="block text-[11px] font-bold text-slate-500">Fecha de factura
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="inp w-full mt-1" /></label>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">Productos *</p>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-2 items-start relative">
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
                  <button type="button" onClick={() => quitarFila(i)} className="w-9 h-9 rounded-lg border border-red-200 text-red-600 flex items-center justify-center shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
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
