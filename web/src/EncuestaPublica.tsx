import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import './estilos/encuesta.css'

/* Encuesta de satisfacción del cliente (vmEncuestaDatos / vmEncuestaGuardar del original).
   Página pública: /encuesta/?c=<código de seguimiento>. No pide iniciar sesión. */
type Respuesta = { general: number | null; asesor: number | null; entrega: number | null; producto: number | null; recomienda: number | null; comentario: string; queja: boolean; tipoQueja: string; contactar: boolean }
type Datos = { marca: string; cliente: string; factura: string; asesor: string; productos: string[]; tiposQueja: string[]; respuesta: Respuesta | null }
const vacia: Respuesta = { general: null, asesor: null, entrega: null, producto: null, recomienda: null, comentario: '', queja: false, tipoQueja: '', contactar: false }

function Estrellas({ valor, set, etiqueta }: { valor: number | null; set: (n: number) => void; etiqueta: string }) {
  return (
    <div className="enc-estrellas" role="radiogroup" aria-label={etiqueta}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={valor === n} aria-label={n + ' de 5'} className={valor != null && n <= valor ? 'on' : ''} onClick={() => set(n)}>★</button>
      ))}
    </div>
  )
}

export default function EncuestaPublica() {
  const codigo = new URLSearchParams(window.location.search).get('c') ?? ''
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [r, setR] = useState<Respuesta>(vacia)
  const [enviando, setEnviando] = useState(false)
  const [listo, setListo] = useState(false)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    document.title = 'Encuesta de satisfacción'
    if (!codigo) { setError('El enlace no es válido. Ábrelo desde el mensaje que te enviamos.'); return }
    supabase.rpc('encuesta_datos', { p_token: codigo }).then(({ data, error: e }) => {
      if (e) { setError(e.message || 'No pudimos cargar la encuesta.'); return }
      const d = data as Datos
      setDatos(d)
      if (d.respuesta) setR({ ...vacia, ...d.respuesta })
      document.title = 'Encuesta de satisfacción | ' + d.marca
    })
  }, [codigo])

  const set = <K extends keyof Respuesta>(k: K, v: Respuesta[K]) => setR((x) => ({ ...x, [k]: v }))
  async function enviar() {
    setAviso('')
    if (!r.general) { setAviso('Califica tu experiencia general.'); return }
    if (r.queja && !r.comentario.trim()) { setAviso('Cuéntanos qué pasó para poder ayudarte.'); return }
    setEnviando(true)
    const { error: e } = await supabase.rpc('encuesta_guardar', { p_token: codigo, p: r })
    setEnviando(false)
    if (e) { setAviso(e.message || 'No se pudo enviar. Inténtalo de nuevo.'); return }
    setListo(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const marca = datos?.marca ?? 'VIMEDIC'
  return (
    <div className="enc">
      <header className="enc-top"><div className="enc-wrap">
        <b className="enc-marca">{marca}</b>
        <h1>¿Cómo te fue con tu pedido?</h1>
        <p>{datos ? <>Factura {datos.factura || '—'}{datos.cliente ? ' · ' + datos.cliente : ''}</> : 'Tu opinión nos ayuda a mejorar.'}</p>
      </div></header>
      <main className="enc-wrap">
        {error && <div className="enc-card"><p className="enc-msg err">{error}</p></div>}
        {!error && !datos && <div className="enc-card"><div className="enc-spin" aria-label="Cargando" /></div>}
        {datos && listo && (
          <div className="enc-card enc-gracias">
            <div className="enc-ok">✓</div>
            <h2>¡Gracias por tu respuesta!</h2>
            <p>{r.queja || r.contactar ? 'Lamentamos lo ocurrido. Una persona de nuestro equipo te contactará pronto.' : 'Nos alegra haberte atendido. ¡Gracias por confiar en ' + marca + '!'}</p>
            <button type="button" className="enc-link" onClick={() => setListo(false)}>Corregir mi respuesta</button>
          </div>
        )}
        {datos && !listo && (
          <div className="enc-card">
            {datos.respuesta && <p className="enc-msg info">Ya respondiste esta encuesta. Puedes corregir tu respuesta y volver a enviarla.</p>}
            {datos.productos.length > 0 && <div className="enc-prods"><h4>Tu pedido</h4><ul>{datos.productos.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}</ul></div>}

            <section className="enc-preg"><h3>Experiencia general <span className="req">*</span></h3><Estrellas valor={r.general} set={(n) => set('general', n)} etiqueta="Experiencia general" /></section>
            <section className="enc-preg"><h3>Atención de {datos.asesor || 'tu asesor'}</h3><Estrellas valor={r.asesor} set={(n) => set('asesor', n)} etiqueta="Atención del asesor" /></section>
            <section className="enc-preg"><h3>La entrega</h3><Estrellas valor={r.entrega} set={(n) => set('entrega', n)} etiqueta="Entrega" /></section>
            <section className="enc-preg"><h3>Estado del producto al recibirlo</h3><Estrellas valor={r.producto} set={(n) => set('producto', n)} etiqueta="Estado del producto" /></section>

            <section className="enc-preg"><h3>¿Nos recomendarías a un colega?</h3>
              <div className="enc-nps" role="radiogroup" aria-label="Recomendación de 0 a 10">{Array.from({ length: 11 }, (_, n) => <button key={n} type="button" role="radio" aria-checked={r.recomienda === n} className={r.recomienda === n ? 'on' : ''} onClick={() => set('recomienda', n)}>{n}</button>)}</div>
              <div className="enc-nps-et"><span>Nada probable</span><span>Muy probable</span></div></section>

            <label className="enc-check"><input type="checkbox" checked={r.queja} onChange={(e) => set('queja', e.target.checked)} />Tuve un problema con mi pedido</label>
            {r.queja && <select className="enc-inp" value={r.tipoQueja} onChange={(e) => set('tipoQueja', e.target.value)} aria-label="Tipo de problema"><option value="">¿Qué pasó?</option>{datos.tiposQueja.map((t) => <option key={t}>{t}</option>)}</select>}
            <section className="enc-preg"><h3>{r.queja ? 'Cuéntanos qué pasó' : 'Comentarios (opcional)'}{r.queja && <span className="req"> *</span>}</h3>
              <textarea className="enc-inp" rows={4} maxLength={2000} value={r.comentario} onChange={(e) => set('comentario', e.target.value)} placeholder={r.queja ? 'Describe el problema para poder ayudarte.' : '¿Algo que podamos mejorar?'} /></section>
            <label className="enc-check"><input type="checkbox" checked={r.contactar} onChange={(e) => set('contactar', e.target.checked)} />Quiero que me contacten</label>

            {aviso && <p className="enc-msg err">{aviso}</p>}
            <button type="button" className="enc-enviar" disabled={enviando} onClick={enviar}>{enviando ? 'Enviando…' : datos.respuesta ? 'Actualizar mi respuesta' : 'Enviar encuesta'}</button>
          </div>
        )}
        <p className="enc-pie">{marca} · Equipos médicos</p>
      </main>
    </div>
  )
}
