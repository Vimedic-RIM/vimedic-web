import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'

const POR_PAGINA = 25

type Fila = {
  id: string
  codigo: string
  codigo_unico: string | null
  nombre: string
  marca: string | null
  pvp: number | null
  stock: number
  stock_minimo: number | null
  imagen_url: string | null
  en_catalogo: boolean
  oculto: boolean
  categoria: { nombre: string } | null
}

type Categoria = { id: string; nombre: string }

type Detalle = {
  id: string
  codigo: string
  codigo_unico: string | null
  nombre: string
  categoria_id: string | null
  marca: string | null
  descripcion: string | null
  pvp: number | null
  precio_dis: number | null
  aplica_iva: boolean
  stock: number
  stock_minimo: number | null
  stock_maximo: number | null
  en_catalogo: boolean
  oculto: boolean
  imagen_url: string | null
}

const COLUMNAS_LISTA =
  'id,codigo,codigo_unico,nombre,marca,pvp,stock,stock_minimo,imagen_url,en_catalogo,oculto,categoria:categorias(nombre)'

const COLUMNAS_DETALLE =
  'id,codigo,codigo_unico,nombre,categoria_id,marca,descripcion,pvp,precio_dis,aplica_iva,stock,stock_minimo,stock_maximo,en_catalogo,oculto,imagen_url'

const dinero = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('es-EC', { style: 'currency', currency: 'USD' })

// Quita caracteres que rompen el filtro .or() de PostgREST.
const limpiar = (t: string) => t.replace(/[,()%*\\]/g, ' ').trim()

function EtiquetaStock({ f }: { f: Fila }) {
  if (f.stock <= 0) return <span className="chip chip-rojo">{f.stock < 0 ? `${f.stock} (facturado sin stock)` : 'Sin stock'}</span>
  if (f.stock_minimo != null && f.stock <= f.stock_minimo) return <span className="chip chip-ambar">{f.stock} · bajo</span>
  return <span className="chip chip-verde">{f.stock} en stock</span>
}

export default function Inventario({ perfil, volver }: { perfil: Perfil; volver: () => void }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [texto, setTexto] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [stockFiltro, setStockFiltro] = useState('')
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<string | 'nuevo' | null>(null)
  const peticion = useRef(0)

  const crear = puede(perfil, 'inventario', 'crear')

  // Búsqueda con espera de 300 ms para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => { setBusqueda(limpiar(texto)); setPagina(0) }, 300)
    return () => clearTimeout(t)
  }, [texto])

  useEffect(() => {
    supabase.from('categorias').select('id,nombre').eq('activo', true).is('deleted_at', null).order('nombre')
      .then(({ data }) => setCategorias((data as Categoria[]) ?? []))
  }, [])

  const cargar = useCallback(async () => {
    const n = ++peticion.current
    setCargando(true)
    let q = supabase.from('productos').select(COLUMNAS_LISTA, { count: 'exact' }).is('deleted_at', null)
    if (busqueda) q = q.or(`nombre.ilike.%${busqueda}%,codigo.ilike.%${busqueda}%,codigo_unico.ilike.%${busqueda}%`)
    if (categoria) q = q.eq('categoria_id', categoria)
    if (stockFiltro === 'con') q = q.gt('stock', 0)
    if (stockFiltro === 'sin') q = q.lte('stock', 0)
    const desde = pagina * POR_PAGINA
    const { data, count, error } = await q.order('nombre').range(desde, desde + POR_PAGINA - 1)
    if (n !== peticion.current) return // llegó una respuesta más nueva
    if (error) setError('No se pudo cargar el inventario: ' + error.message)
    else { setError(''); setFilas((data as unknown as Fila[]) ?? []); setTotal(count ?? 0) }
    setCargando(false)
  }, [busqueda, categoria, stockFiltro, pagina])

  useEffect(() => { cargar() }, [cargar])

  // Tiempo real: si alguien cambia un producto, se refresca la lista.
  useEffect(() => {
    const canal = supabase.channel('inventario-productos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => cargar())
      .subscribe()
    return () => { supabase.removeChannel(canal) }
  }, [cargar])

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))

  return (
    <>
      <header className="topbar topbar-chica">
        <div className="topbar-inner">
          <div className="bar">
            <button className="hbtn" onClick={volver}>← Mi Espacio</button>
            <div className="brand-title" style={{ marginLeft: 8 }}>Inventario</div>
            <div className="bar-right">
              {crear && <button className="hbtn" onClick={() => setAbierto('nuevo')}>+ Nuevo producto</button>}
            </div>
          </div>
        </div>
      </header>

      <main className="contenido contenido-chico">
        <div className="panel">
          <div className="filtros">
            <input className="campo" type="search" placeholder="Buscar por nombre, código o modelo…" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <select className="campo" value={categoria} onChange={(e) => { setCategoria(e.target.value); setPagina(0) }}>
              <option value="">Todas las categorías</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select className="campo" value={stockFiltro} onChange={(e) => { setStockFiltro(e.target.value); setPagina(0) }}>
              <option value="">Todo el stock</option>
              <option value="con">Con stock</option>
              <option value="sin">Sin stock</option>
            </select>
          </div>

          {error && <div className="error">{error}</div>}

          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr><th></th><th>Código</th><th>Producto</th><th>Categoría</th><th>Marca</th><th className="der">PVP</th><th>Stock</th></tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} onClick={() => setAbierto(f.id)} className={f.oculto ? 'fila-oculta' : ''}>
                    <td className="celda-img">
                      {f.imagen_url ? <img src={f.imagen_url} alt="" loading="lazy" width={40} height={40} /> : <div className="sin-img" />}
                    </td>
                    <td className="mono">{f.codigo}{f.codigo_unico && <div className="sub">{f.codigo_unico}</div>}</td>
                    <td className="nombre">{f.nombre}{f.en_catalogo && <span className="chip chip-azul">Catálogo</span>}</td>
                    <td>{f.categoria?.nombre ?? '—'}</td>
                    <td>{f.marca ?? '—'}</td>
                    <td className="der">{dinero(f.pvp)}</td>
                    <td><EtiquetaStock f={f} /></td>
                  </tr>
                ))}
                {!cargando && filas.length === 0 && (
                  <tr><td colSpan={7} className="vacio">
                    {total === 0 && !busqueda && !categoria && !stockFiltro
                      ? 'Todavía no hay productos. Cuando se importen los datos del inventario aparecerán aquí.'
                      : 'No se encontraron productos con esos filtros.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pie-tabla">
            <span className="muted">{cargando ? 'Cargando…' : `${total.toLocaleString('es-EC')} producto${total === 1 ? '' : 's'}`}</span>
            <div className="paginas">
              <button className="hbtn-claro" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
              <span className="muted">Página {pagina + 1} de {paginas}</span>
              <button className="hbtn-claro" disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
            </div>
          </div>
        </div>
      </main>

      {abierto && (
        <FichaProducto
          perfil={perfil}
          id={abierto}
          categorias={categorias}
          cerrar={() => setAbierto(null)}
          guardado={() => { setAbierto(null); cargar() }}
        />
      )}
    </>
  )
}

function FichaProducto({ perfil, id, categorias, cerrar, guardado }: {
  perfil: Perfil; id: string | 'nuevo'; categorias: Categoria[]; cerrar: () => void; guardado: () => void
}) {
  const nuevo = id === 'nuevo'
  const editable = puede(perfil, 'inventario', nuevo ? 'crear' : 'editar')
  const puedeArchivar = puede(perfil, 'inventario', 'eliminar')
  const [p, setP] = useState<Detalle | null>(nuevo ? {
    id: crypto.randomUUID(), codigo: '', codigo_unico: null, nombre: '', categoria_id: null, marca: null, descripcion: null,
    pvp: null, precio_dis: null, aplica_iva: true, stock: 0, stock_minimo: null, stock_maximo: null,
    en_catalogo: false, oculto: false, imagen_url: null,
  } : null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (nuevo) return
    supabase.from('productos').select(COLUMNAS_DETALLE).eq('id', id).single()
      .then(({ data, error }) => { if (error) setError(error.message); else setP(data as Detalle) })
  }, [id, nuevo])

  function cambiar<K extends keyof Detalle>(k: K, v: Detalle[K]) { setP((x) => (x ? { ...x, [k]: v } : x)) }
  const num = (s: string) => (s === '' ? null : Number(s))

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!p) return
    setGuardando(true); setError('')
    const { id: pid, ...campos } = p
    const { error } = nuevo
      ? await supabase.from('productos').insert({ id: pid, ...campos })
      : await supabase.from('productos').update(campos).eq('id', pid)
    setGuardando(false)
    if (error) setError(error.code === '23505' ? 'Ya existe un producto con ese código.' : error.message)
    else guardado()
  }

  async function archivar() {
    if (!p || !confirm(`¿Archivar "${p.nombre}"? Dejará de aparecer en el inventario.`)) return
    // Borrado lógico: nunca DELETE.
    const { error } = await supabase.from('productos').update({ deleted_at: new Date().toISOString() }).eq('id', p.id)
    if (error) setError(error.message); else guardado()
  }

  return (
    <div className="velo" onClick={cerrar}>
      <aside className="lateral" onClick={(e) => e.stopPropagation()}>
        <div className="lateral-cab">
          <h2>{nuevo ? 'Nuevo producto' : 'Producto'}</h2>
          <button className="cerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
        </div>
        {!p ? <p className="muted">{error || 'Cargando…'}</p> : (
          <form onSubmit={guardar} className="form">
            {p.imagen_url && <img className="foto" src={p.imagen_url} alt="" loading="lazy" />}
            <label>Código interno *<input className="campo" required disabled={!nuevo} value={p.codigo} onChange={(e) => cambiar('codigo', e.target.value.trim())} /></label>
            <label>Modelo / código único<input className="campo" disabled={!editable} value={p.codigo_unico ?? ''} onChange={(e) => cambiar('codigo_unico', e.target.value || null)} /></label>
            <label>Nombre *<input className="campo" required disabled={!editable} value={p.nombre} onChange={(e) => cambiar('nombre', e.target.value)} /></label>
            <div className="dos">
              <label>Categoría
                <select className="campo" disabled={!editable} value={p.categoria_id ?? ''} onChange={(e) => cambiar('categoria_id', e.target.value || null)}>
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
              <label>Marca<input className="campo" disabled={!editable} value={p.marca ?? ''} onChange={(e) => cambiar('marca', e.target.value || null)} /></label>
            </div>
            <div className="dos">
              <label>PVP<input className="campo" type="number" step="0.01" min="0" disabled={!editable} value={p.pvp ?? ''} onChange={(e) => cambiar('pvp', num(e.target.value))} /></label>
              <label>Precio distribuidor<input className="campo" type="number" step="0.01" min="0" disabled={!editable} value={p.precio_dis ?? ''} onChange={(e) => cambiar('precio_dis', num(e.target.value))} /></label>
            </div>
            <div className="tres">
              <label>Stock<input className="campo" type="number" step="1" disabled={!editable} value={p.stock} onChange={(e) => cambiar('stock', Number(e.target.value))} /></label>
              <label>Mínimo<input className="campo" type="number" step="1" min="0" disabled={!editable} value={p.stock_minimo ?? ''} onChange={(e) => cambiar('stock_minimo', num(e.target.value))} /></label>
              <label>Máximo<input className="campo" type="number" step="1" min="0" disabled={!editable} value={p.stock_maximo ?? ''} onChange={(e) => cambiar('stock_maximo', num(e.target.value))} /></label>
            </div>
            <label>Descripción<textarea className="campo" rows={4} disabled={!editable} value={p.descripcion ?? ''} onChange={(e) => cambiar('descripcion', e.target.value || null)} /></label>
            <div className="checks">
              <label><input type="checkbox" disabled={!editable} checked={p.aplica_iva} onChange={(e) => cambiar('aplica_iva', e.target.checked)} /> Aplica IVA</label>
              <label><input type="checkbox" disabled={!editable} checked={p.en_catalogo} onChange={(e) => cambiar('en_catalogo', e.target.checked)} /> Visible en el catálogo</label>
              <label><input type="checkbox" disabled={!editable} checked={p.oculto} onChange={(e) => cambiar('oculto', e.target.checked)} /> Oculto</label>
            </div>
            {error && <div className="error">{error}</div>}
            <div className="acciones">
              {!nuevo && puedeArchivar && <button type="button" className="btn-peligro" onClick={archivar}>Archivar</button>}
              <span style={{ flex: 1 }} />
              <button type="button" className="hbtn-claro" onClick={cerrar}>{editable ? 'Cancelar' : 'Cerrar'}</button>
              {editable && <button className="btn-primario ancho-auto" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>}
            </div>
          </form>
        )}
      </aside>
    </div>
  )
}
