import { useCallback, useEffect, useState } from 'react'
import { Copy, MessageCircle, Phone, Search, Trash2, UserPlus, UserRoundPlus, X } from 'lucide-react'
import { supabase, type Perfil } from '../supabase'
import { puede } from '../permisos'

type Asesor = { id: string; nombre: string }
export type Cliente = {
  id: string; codigo: string | null; identificacion: string | null; nombre: string; telefono: string | null; telefono2: string | null
  email: string | null; ciudad: string | null; direccion: string | null; tipo_cliente: string | null; descuento_fijo: string | null
  institucion: string | null; url_maps: string | null; asesor_id: string | null; persona_contacto: string | null; cargo_contacto: string | null
  medio_captacion: string | null; responsable_id: string | null; fecha_registro: string | null; cumpleanos: string | null; aniversario_empresa: string | null
}
const COLS = 'id,codigo,identificacion,nombre,telefono,telefono2,email,ciudad,direccion,tipo_cliente,descuento_fijo,institucion,url_maps,asesor_id,persona_contacto,cargo_contacto,medio_captacion,responsable_id,fecha_registro,cumpleanos,aniversario_empresa'

const MEDIOS: [string, string[]][] = [
  ['Web y catálogo VIMEDIC', ['🤖 Chat bot web', '📝 Cotización web', '📅 Visita web', '🔓 Desbloqueo precios y stock web', '🛒 Catálogo web', '🌐 Página web']],
  ['Publicidad pagada', ['📣 Anuncio en Facebook o Instagram', '🎵 Anuncio en TikTok', '🔎 Anuncio en Google', '▶️ Anuncio en YouTube']],
  ['Redes sociales (sin pago)', ['📱 Publicación en redes sociales', '📖 Historia o estado', '💬 Mensaje directo en redes sociales']],
  ['El cliente nos contactó directo', ['🔗 Enlace directo de WhatsApp', '📲 Escribió al WhatsApp del asesor', '☎️ Llamada entrante', '✉️ Correo electrónico entrante']],
  ['Búsqueda en internet', ['📍 Google Maps', '🔍 Búsqueda en Google (sin anuncio)']],
  ['Recomendación', ['🤝 Referido por un cliente', '🩺 Referido por un médico o profesional de salud', '🏷️ Distribuidor o aliado comercial']],
  ['Gestión comercial', ['🚶 Visita comercial', '🏢 Visita del cliente a nuestras instalaciones', '📞 Prospección telefónica', '🎪 Feria o evento', '🏛️ Compra pública (SERCOP)', '🔄 Reactivación o seguimiento']],
]
const soloNum = (s: string) => s.replace(/\D/g, '')
const titulo = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())
const wa = (t: string | null) => { const d = soloNum(t || ''); return d ? 'https://wa.me/' + (d.startsWith('0') ? '593' + d.slice(1) : d) : '' }

/* ============== Confirmar eliminación (VMACC.confirmarEliminar) ============== */
export function ConfirmarEliminar({ titulo: t, detalle, ok, cerrar }: { titulo: string; detalle: string; ok: (motivo: string) => void; cerrar: () => void }) {
  const [motivo, setMotivo] = useState('')
  return (
    <div className="vmpap-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vmpap" role="dialog" aria-modal="true">
        <div className="vmpap-h"><b>{t}<small>{detalle}</small></b><button className="vmpap-x" aria-label="Cerrar" onClick={cerrar}>×</button></div>
        <div className="vmpap-b"><textarea className="vmpap-in" maxLength={500} placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></div>
        <div className="vmpap-p"><button className="vmpap-c" onClick={cerrar}>Cancelar</button><button className="vmpap-e" onClick={() => ok(motivo.trim())}>Eliminar</button></div>
      </div>
    </div>
  )
}

/* ============== Papelera del CRM ============== */
type ItemPapelera = { id: string; tabla: 'leads' | 'cotizaciones' | 'clientes'; tipoTitulo: string; descripcion: string; fecha: string; motivo: string }
export function Papelera({ cerrar, alRestaurar, aviso, empresa }: { empresa: 'VIMEDIC' | 'FEMEDICS'; cerrar: () => void; alRestaurar: () => void; aviso: (t: string) => void }) {
  const [items, setItems] = useState<ItemPapelera[] | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('leads').select('id,codigo,nombre,deleted_at,motivo_eliminacion').eq('empresa', empresa).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100),
      supabase.from('cotizaciones').select('id,codigo,tipo_registro,nombre,deleted_at,motivo_eliminacion').eq('empresa', empresa).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100),
      supabase.from('clientes').select('id,codigo,nombre,deleted_at,motivo_eliminacion').eq('empresa', empresa).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(100),
    ]).then(([l, c, k]) => {
      const err = l.error || c.error || k.error
      if (err) { setError(err.message); return }
      type F = { id: string; codigo: string | null; nombre: string | null; deleted_at: string; motivo_eliminacion: string | null; tipo_registro?: string }
      const mk = (rows: unknown, tabla: ItemPapelera['tabla'], tt: (r: F) => string): ItemPapelera[] =>
        ((rows ?? []) as F[]).map((r) => ({ id: r.id, tabla, tipoTitulo: tt(r), descripcion: `${r.nombre ?? ''}${r.codigo ? ' · ' + r.codigo : ''}`, fecha: r.deleted_at, motivo: r.motivo_eliminacion ?? '' }))
      setItems([...mk(l.data, 'leads', () => 'Gestión'), ...mk(c.data, 'cotizaciones', (r) => r.tipo_registro === 'Venta' ? 'Venta' : 'Cotización'), ...mk(k.data, 'clientes', () => 'Cliente')]
        .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)))
    })
  }, [])

  async function restaurar(it: ItemPapelera) {
    setOcupado(it.id)
    const { error } = await supabase.from(it.tabla).update({ deleted_at: null, motivo_eliminacion: null }).eq('id', it.id)
    setOcupado('')
    if (error) { aviso('No se pudo restaurar: ' + error.message); return }
    setItems((a) => (a ?? []).filter((x) => x.id !== it.id)); alRestaurar()
  }

  return (
    <div className="vmpap-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vmpap" role="dialog" aria-modal="true">
        <div className="vmpap-h"><b>Papelera · CRM<small>Lo eliminado no se borra de la base: aquí puedes devolverlo a la app.</small></b><button className="vmpap-x" aria-label="Cerrar" onClick={cerrar}>×</button></div>
        <div className="vmpap-b">
          {error && <div className="vmpap-v">{error}</div>}
          {!error && items === null && <div className="vmpap-v">Cargando…</div>}
          {items?.length === 0 && <div className="vmpap-v">La papelera está vacía.</div>}
          {items?.map((x) => (
            <div key={x.id} className="vmpap-i">
              <div className="vmpap-t">
                <p className="d"><span className="tg">{x.tipoTitulo}</span>{x.descripcion}</p>
                <p className="m">Eliminado · {new Date(x.fecha).toLocaleString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                {x.motivo && <p className="m">Motivo: {x.motivo}</p>}
              </div>
              <button className="vmpap-r" disabled={ocupado === x.id} onClick={() => restaurar(x)}>{ocupado === x.id ? 'Restaurando…' : 'Restaurar'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ============== Gestión de Clientes (lista) ============== */
export function ClientesLista({ perfil, asesores, cerrar, aviso, empresa }: { empresa: 'VIMEDIC' | 'FEMEDICS'; perfil: Perfil; asesores: Asesor[]; cerrar: () => void; aviso: (t: string) => void }) {
  const [q, setQ] = useState('')
  const [lista, setLista] = useState<Cliente[] | null>(null)
  const [total, setTotal] = useState(0)
  const [editar, setEditar] = useState<Cliente | 'nuevo' | null>(null)

  const buscar = useCallback(() => {
    const t = q.trim().replace(/[,()%*\\]/g, ' ')
    let consulta = supabase.from('clientes').select(COLS, { count: 'exact' }).is('deleted_at', null).eq('empresa', empresa)
    if (t) {
      for (const p of t.split(/\s+/)) consulta = consulta.or(`nombre.ilike.%${p}%,identificacion.ilike.%${p}%,email.ilike.%${p}%,telefono.ilike.%${p}%`)
    } else consulta = consulta.eq('asesor_id', perfil.id)
    consulta.order('nombre').range(0, t ? 49 : 19).then(({ data, count }) => { setLista((data as Cliente[]) ?? []); setTotal(count ?? 0) })
  }, [q, perfil.id])
  useEffect(() => { const t = setTimeout(buscar, 250); return () => clearTimeout(t) }, [buscar])

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[60] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
        <div className="bg-white sm:rounded-2xl shadow-2xl w-full h-[100dvh] sm:h-[85vh] sm:max-w-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
            <h3 className="font-display font-bold text-sm text-slate-800">Gestión de Clientes</h3>
            <button onClick={cerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-5 shrink-0 flex gap-2">
            <div className="relative flex-grow sticky top-0 z-10 bg-white">
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, cédula o correo..." className="w-full border border-slate-200 rounded-lg p-2 pl-8 text-xs focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as string]: 'var(--cyan)' }} />
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            {puede(perfil, empresa === 'FEMEDICS' ? 'femedics' : 'crm', 'crear') && (
              <button onClick={() => setEditar('nuevo')} className="text-xs font-bold px-3.5 py-2 rounded-lg text-white flex items-center gap-1.5 shrink-0" style={{ background: 'var(--primary)' }}><UserPlus className="w-3.5 h-3.5" /> Nuevo Cliente</button>
            )}
          </div>
          <div className="flex-grow overflow-y-auto px-5 pb-5 space-y-1.5">
            {lista === null && <p className="text-xs text-slate-400 text-center py-6">Cargando clientes...</p>}
            {lista?.length === 0 && <p className="text-xs text-slate-400 text-center py-6">{q ? 'Sin clientes que coincidan.' : 'Todavía no tienes clientes propios. Escribe arriba para buscar entre todos.'}</p>}
            {lista?.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2.5 hover:bg-slate-50 cursor-pointer" onClick={() => setEditar(c)}>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">{c.nombre}</p>
                  <p className="text-[11px] text-slate-500 truncate">{c.identificacion || '—'} · {c.ciudad || '—'} · {c.email || '—'} · {c.telefono || '—'}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {c.telefono && <a href={'tel:' + c.telefono} title="Llamar" className="text-[11px] font-bold p-1.5 rounded-lg border flex items-center" style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}><Phone className="w-3.5 h-3.5" /></a>}
                  {wa(c.telefono) && <a href={wa(c.telefono)} target="_blank" rel="noopener" title="Escribir por WhatsApp" className="p-1.5 rounded-lg border flex items-center" style={{ borderColor: '#25D366', color: '#25D366' }}><MessageCircle className="w-3.5 h-3.5" /></a>}
                </div>
              </div>
            ))}
            {lista && total > lista.length && <p className="text-[11px] text-slate-400 text-center py-2">Mostrando {lista.length} de {total}{q ? '' : ' — escribe para buscar entre todos'}.</p>}
          </div>
        </div>
      </div>
      {editar && <FormularioCliente empresa={empresa} perfil={perfil} asesores={asesores} cliente={editar === 'nuevo' ? null : editar} cerrar={() => setEditar(null)} aviso={aviso} guardado={() => { setEditar(null); buscar() }} />}
    </>
  )
}

/* ============== Formulario de cliente ============== */
export function FormularioCliente({ perfil, asesores, cliente, cerrar, guardado, aviso, empresa, prefill }: {
  empresa: 'VIMEDIC' | 'FEMEDICS'; perfil: Perfil; asesores: Asesor[]; cliente: Cliente | null; cerrar: () => void; guardado: (id: string) => void; aviso: (t: string) => void
  prefill?: { nombre?: string; telefono?: string; email?: string; ciudad?: string; identificacion?: string }
}) {
  const v = (x: string | null | undefined) => x ?? ''
  const [f, setF] = useState({
    identificacion: v(cliente?.identificacion ?? prefill?.identificacion), nombre: v(cliente?.nombre ?? prefill?.nombre), telefono: v(cliente?.telefono ?? prefill?.telefono), email: v(cliente?.email ?? prefill?.email),
    ciudad: v(cliente?.ciudad ?? prefill?.ciudad), direccion: v(cliente?.direccion), tipo: v(cliente?.tipo_cliente), descuento: v(cliente?.descuento_fijo),
    telefono2: v(cliente?.telefono2), institucion: v(cliente?.institucion), url_maps: v(cliente?.url_maps),
    asesor: cliente?.asesor_id ?? perfil.id, contacto: v(cliente?.persona_contacto), cargo: v(cliente?.cargo_contacto), medio: v(cliente?.medio_captacion),
    responsable: v(cliente?.responsable_id), fecha: cliente?.fecha_registro ? cliente.fecha_registro.slice(0, 19) : '',
    cumple: v(cliente?.cumpleanos), aniv: v(cliente?.aniversario_empresa),
  })
  const [error, setError] = useState('')
  const [dup, setDup] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [elim, setElim] = useState(false)
  const set = (k: keyof typeof f, val: string) => setF((a) => ({ ...a, [k]: val }))

  const obligatorios = [f.identificacion, f.nombre.trim(), f.telefono, f.email.trim(), f.ciudad.trim(), f.direccion.trim(), f.tipo]
  const progreso = Math.round((obligatorios.filter(Boolean).length / obligatorios.length) * 100)

  async function verificarDuplicada() {
    if (f.identificacion.length < 10) { setDup(''); return }
    const { data } = await supabase.from('clientes').select('id,nombre').eq('identificacion', f.identificacion).is('deleted_at', null).limit(1)
    const o = data?.[0]
    setDup(o && o.id !== cliente?.id ? `Esta cédula/RUC ya está registrada a nombre de ${o.nombre}.` : '')
  }

  async function guardar() {
    setError('')
    if (![10, 13].includes(f.identificacion.length)) { setError('La cédula debe tener 10 dígitos o el RUC 13.'); return }
    if (obligatorios.some((x) => !x)) { setError('Completa los datos obligatorios (*).'); return }
    if (!/^\S+@\S+\.\S+$/.test(f.email)) { setError('El correo no es válido.'); return }
    if (f.tipo === 'DIS' && !f.descuento) { setError('Elige el nivel de descuento del distribuidor.'); return }
    if (dup) { setError(dup); return }
    setGuardando(true)
    const fila = {
      identificacion: f.identificacion, nombre: f.nombre.trim(), telefono: f.telefono, email: f.email.trim().toLowerCase(), ciudad: f.ciudad.trim(), direccion: f.direccion.trim(),
      tipo_cliente: f.tipo, descuento_fijo: f.tipo === 'DIS' ? f.descuento : null, telefono2: f.telefono2 || null, institucion: f.institucion.trim() || null,
      url_maps: f.url_maps.trim() || null, asesor_id: f.asesor || null, persona_contacto: f.contacto.trim() || null, cargo_contacto: f.cargo.trim() || null,
      medio_captacion: f.medio || null, responsable_id: f.responsable || null, fecha_registro: f.fecha ? new Date(f.fecha).toISOString() : null,
      cumpleanos: f.cumple || null, aniversario_empresa: f.aniv || null,
    }
    const idNuevo = cliente?.id ?? crypto.randomUUID()
    const r = cliente
      ? await supabase.from('clientes').update(fila).eq('id', cliente.id)
      : await supabase.from('clientes').insert({ id: idNuevo, codigo: 'CLI-' + crypto.randomUUID().slice(0, 6).toUpperCase(), empresa, ...fila, fecha_registro: fila.fecha_registro ?? new Date().toISOString() })
    setGuardando(false)
    if (r.error) { setError(r.error.message); return }
    aviso(cliente ? 'Cliente actualizado.' : 'Cliente creado.'); guardado(idNuevo)
  }

  async function eliminar(motivo: string) {
    if (!cliente) return
    const { error } = await supabase.from('clientes').update({ deleted_at: new Date().toISOString(), motivo_eliminacion: motivo || null }).eq('id', cliente.id)
    if (error) { aviso('No se pudo eliminar: ' + error.message); return }
    setElim(false); aviso('Cliente enviado a la Papelera.'); guardado(cliente.id)
  }

  function copiarSolicitud() {
    const t = `Hola${f.nombre ? ' ' + f.nombre : ''}, para registrarlo(a) necesitamos: cédula o RUC, nombre completo, teléfono, correo, ciudad y dirección. ¡Gracias!`
    navigator.clipboard?.writeText(t).then(() => aviso('Mensaje copiado: pégalo en el chat del cliente.'))
  }

  const campo = (et: string, k: keyof typeof f, props: React.InputHTMLAttributes<HTMLInputElement> = {}, tr: (s: string) => string = (s) => s, extra?: React.ReactNode, cls = '') => (
    <label className={'cf-f ' + cls}><span>{et}</span>
      <input className="ns-input cf-in" value={f[k]} onChange={(e) => set(k, tr(e.target.value))} {...props} />{extra}
    </label>
  )

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] z-[70] flex items-center justify-center p-0 sm:p-4" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="ns-shell nq-theme bg-slate-50 sm:rounded-3xl shadow-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:max-w-2xl flex flex-col overflow-hidden">
        <div className="ns-head px-5 pt-4 pb-3 text-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl grid place-items-center bg-white/15 shrink-0"><UserRoundPlus className="w-5 h-5" /></span>
            <div className="min-w-0"><h3 className="font-display font-bold text-base leading-tight">{cliente ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
              <p className="text-[11px] text-white/70">Los datos con * son obligatorios; el resto puedes completarlo después.</p></div>
            <button onClick={cerrar} className="ml-auto w-9 h-9 rounded-full grid place-items-center bg-white/10 hover:bg-white/20" aria-label="Cerrar"><X className="w-4 h-4" /></button>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-white/15 overflow-hidden"><i className="block h-full rounded-full bg-white transition-all duration-300" style={{ width: progreso + '%' }} /></div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 cf-body space-y-3">
          <section className="ns-sec cf-sec">
            <header><span className="ns-num">1</span><h4>Datos del cliente</h4><span className="ml-auto text-[10px] text-slate-400">obligatorios</span></header>
            <div className="cf-grid">
              {campo('Cédula / RUC *', 'identificacion', { inputMode: 'numeric', maxLength: 13, placeholder: '10 o 13 dígitos', onBlur: verificarDuplicada }, soloNum, dup ? <p className="cf-err">{dup}</p> : null)}
              {campo('Nombre completo *', 'nombre', { placeholder: 'Ej. Juan Pérez' }, titulo)}
              {campo('Teléfono *', 'telefono', { inputMode: 'numeric', placeholder: '09xxxxxxxx' }, soloNum)}
              {campo('Correo *', 'email', { type: 'email', placeholder: 'correo@ejemplo.com' }, (s) => s.toLowerCase())}
              {campo('Ciudad *', 'ciudad', { placeholder: 'Ej. Quito' }, titulo)}
              {campo('Dirección *', 'direccion', { placeholder: 'Calle, número, referencia' })}
              <div className="cf-f"><span>Tipo de cliente *</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(empresa === 'FEMEDICS' ? [['PVP', 'PVP']] : [['PVP', 'PVP'], ['DIS', 'DIS (Distribuidor)']]).map(([val, t]) => (
                    <button key={val} type="button" onClick={() => set('tipo', val)} className={'cf-tipo-btn ns-chip' + (f.tipo === val ? ' active' : '')} style={{ height: 40, borderRadius: 12 }}>{t}</button>
                  ))}
                </div>
              </div>
              {f.tipo === 'DIS' && (
                <div className="cf-f cf-full"><span>Nivel de descuento del distribuidor</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {['5', '10', '15', 'VIP'].map((d) => <button key={d} type="button" onClick={() => set('descuento', d)} className={'cf-desc-btn ns-chip' + (f.descuento === d ? ' active' : '')} style={{ borderRadius: 12 }}>{d === 'VIP' ? 'VIP' : d + '%'}</button>)}
                  </div>
                  <p className="cf-hint">VIP usa el precio real de distribuidor. Los demás aplican ese % sobre el PVP.</p>
                </div>
              )}
            </div>
          </section>

          <section className="ns-sec cf-sec">
            <header><span className="ns-num">2</span><h4>Información adicional</h4><span className="ml-auto text-[10px] text-slate-400">opcional</span></header>
            <div className="cf-grid">
              {campo('Teléfono 2', 'telefono2', { inputMode: 'numeric', placeholder: 'Otro número' }, soloNum)}
              {campo('Institución / Empresa', 'institucion', { placeholder: 'Clínica, hospital, consultorio…' }, titulo)}
              {campo('URL Google Maps', 'url_maps', { placeholder: 'https://maps.google.com/…' }, (s) => s, null, 'cf-full')}
            </div>
          </section>

          <section className="ns-sec cf-sec">
            <header><span className="ns-num">3</span><h4>Gestión comercial</h4><span className="ml-auto text-[10px] text-slate-400">se puede completar después</span></header>
            <div className="cf-grid">
              <label className="cf-f"><span>Asesor / Vendedor</span>
                <select className="ns-input cf-in" value={f.asesor} onChange={(e) => set('asesor', e.target.value)}>
                  <option value="">Sin asignar</option>{asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select></label>
              {campo('Persona de contacto', 'contacto', { placeholder: 'Nombre de quien atiende' }, titulo)}
              {campo('Cargo del contacto', 'cargo', { placeholder: 'Ej. Jefe de compras' }, titulo)}
              <label className="cf-f"><span>Medio de captación</span>
                <select className="ns-input cf-in" value={f.medio} onChange={(e) => set('medio', e.target.value)}>
                  <option value="">Selecciona…</option>
                  {MEDIOS.map(([g, ops]) => <optgroup key={g} label={g}>{ops.map((o) => <option key={o} value={o}>{o}</option>)}</optgroup>)}
                </select></label>
              <label className="cf-f"><span>Responsable</span>
                <select className="ns-input cf-in" value={f.responsable} onChange={(e) => set('responsable', e.target.value)}>
                  <option value="">Sin responsable</option>{asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select></label>
              {campo('Fecha de registro', 'fecha', { type: 'datetime-local', step: 1 })}
            </div>
          </section>

          <section className="ns-sec cf-sec">
            <header><span className="ns-num">4</span><h4>Fechas especiales</h4><span className="ml-auto text-[10px] text-slate-400">opcional</span></header>
            <div className="cf-grid">
              {campo('Cumpleaños', 'cumple', { type: 'date' })}
              {campo('Aniversario de la empresa', 'aniv', { type: 'date' })}
            </div>
          </section>
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white p-3 sm:p-4 flex flex-col sm:flex-row gap-2 vm-cf-foot">
          {error && <p className="text-[11px] font-semibold flex-1" style={{ alignSelf: "center", color: '#c0392b' }}>{error}</p>}
          <button onClick={copiarSolicitud} className="text-xs font-bold px-4 py-2.5 rounded-xl border flex items-center justify-center gap-1.5" style={{ borderColor: '#25D366', color: '#16a34a' }}><Copy className="w-3.5 h-3.5" /> Solicitar datos al cliente</button>
          {cliente && puede(perfil, empresa === 'FEMEDICS' ? 'femedics' : 'crm', 'eliminar') && <button type="button" onClick={() => setElim(true)} className="text-xs font-bold px-4 py-2.5 rounded-xl border flex items-center justify-center gap-1.5" style={{ borderColor: '#fecaca', color: '#b91c1c', background: '#fff5f5' }}><Trash2 className="w-3.5 h-3.5" /> Eliminar cliente</button>}
          <button onClick={guardar} disabled={guardando} className="ns-submit">{guardando ? 'Guardando…' : 'Guardar cliente'}</button>
        </div>
      </div>
      {elim && <ConfirmarEliminar titulo={`¿Eliminar a "${f.nombre || 'este cliente'}"?`} detalle="Deja de aparecer en Clientes y en el buscador. Sus cotizaciones y ventas se conservan, y se puede restaurar desde la Papelera." ok={eliminar} cerrar={() => setElim(false)} />}
    </div>
  )
}
