import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

/* Página pública /contacto-lead/?t=<enlace firmado>&v=wa|tel (botones «WhatsApp» y «Llamar» del correo del lead de Meta).
   Registra el contacto en el CRM (Nuevo → Contactado, seguimiento a 1 día) con la Edge Function lead-contacto y abre
   WhatsApp o la llamada. No pide iniciar sesión: el enlace firmado del correo es la autorización. */
type Resp = { destino: string; via: 'wa' | 'tel'; codigo: string; nombre: string; registrado: boolean; motivo: string | null; cambio: boolean; estado: string; seguimiento: string | null }

const C = { azul: '#055c9d', verde: '#16a34a', texto: '#1e293b', gris: '#64748b', fondo: '#f1f5f9' }

export default function ContactoLead() {
  const q = new URLSearchParams(window.location.search)
  const t = q.get('t') ?? '', v = q.get('v') === 'tel' ? 'tel' : 'wa'
  const [r, setR] = useState<Resp | null>(null)
  const [error, setError] = useState('')
  const hecho = useRef(false)

  useEffect(() => {
    document.title = 'VIMEDIC · Contacto con el cliente'
    if (hecho.current) return
    hecho.current = true
    if (!t) { setError('El enlace no es válido. Ábrelo desde el correo del lead.'); return }
    supabase.functions.invoke('lead-contacto', { body: { t, v } }).then(async ({ data, error: e }) => {
      if (e) {
        let m = 'No se pudo registrar el contacto.'
        try { const j = await (e as unknown as { context?: Response }).context?.json?.(); if (j?.error) m = j.error } catch { /* sin detalle */ }
        setError(m); return
      }
      const d = data as Resp & { error?: string }
      if (d?.error) { setError(d.error); return }
      setR(d)
      // Abre WhatsApp o la llamada enseguida (el botón queda por si el teléfono no lo abre solo).
      setTimeout(() => { window.location.href = d.destino }, 900)
    })
  }, [t, v])

  const titulo = !r ? '' : !r.registrado
    ? (r.motivo === 'reasignado' ? 'Este lead ya no está a tu nombre' : 'El contacto ya estaba registrado')
    : r.cambio ? `${r.codigo} pasó a Contactado` : `Seguimiento registrado en ${r.codigo}`
  const detalle = !r ? '' : !r.registrado
    ? (r.motivo === 'reasignado' ? 'No se registró nada en el CRM; igual puedes escribirle o llamarle.' : 'No se repite la gestión.')
    : (r.cambio ? 'Observación: se contactó mediante el correo de aviso del lead.' : `Sigue en «${r.estado}».`) + (r.seguimiento ? ` Próximo seguimiento: ${r.seguimiento}.` : '')

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, display: 'grid', placeItems: 'center', padding: 16, fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 18, padding: '28px 22px', boxShadow: '0 10px 30px rgba(15,23,42,.08)', textAlign: 'center' }}>
        <div style={{ fontWeight: 800, letterSpacing: '.08em', color: C.azul, fontSize: 13 }}>VIMEDIC · CRM</div>
        {!r && !error && <p style={{ color: C.gris, fontSize: 15, marginTop: 22 }}>Registrando el contacto…</p>}
        {error && <>
          <p style={{ color: '#a3341f', background: '#fdecea', borderRadius: 12, padding: '12px 14px', fontSize: 14, marginTop: 20 }}>{error}</p>
          <a href={window.location.origin + '/#crm'} style={{ display: 'inline-block', marginTop: 16, background: C.azul, color: '#fff', textDecoration: 'none', fontWeight: 700, padding: '13px 22px', borderRadius: 12 }}>Abrir el CRM</a>
        </>}
        {r && <>
          <div style={{ width: 54, height: 54, borderRadius: '50%', margin: '20px auto 10px', display: 'grid', placeItems: 'center', background: r.registrado ? '#ecfaf5' : '#fff7e6', color: r.registrado ? '#04896f' : '#92400e', fontSize: 28, fontWeight: 800 }}>{r.registrado ? '✓' : 'i'}</div>
          <h1 style={{ color: C.texto, fontSize: 19, margin: '4px 0 8px' }}>{titulo}</h1>
          <p style={{ color: C.gris, fontSize: 14, lineHeight: 1.45, margin: 0 }}>{detalle}</p>
          <a href={r.destino} style={{ display: 'block', marginTop: 22, background: r.via === 'wa' ? C.verde : C.azul, color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 16, padding: '15px 22px', borderRadius: 14 }}>
            {r.via === 'wa' ? `Abrir WhatsApp con ${r.nombre}` : `Llamar a ${r.nombre}`}</a>
          <a href={window.location.origin + '/#crm'} style={{ display: 'inline-block', marginTop: 12, color: C.azul, fontSize: 13, textDecoration: 'none' }}>Ver la gestión en el CRM</a>
        </>}
      </div>
    </div>
  )
}
