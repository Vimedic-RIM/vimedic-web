import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, ShieldOff, X } from 'lucide-react'
import { supabase } from './supabase'

/* Verificación en dos pasos (TOTP): inscripción, código de verificación y lista de factores.
   Una vez inscrito, la base de datos exige el segundo paso (aal2) para cambios sensibles
   (roles y permisos, datos de empleados, restauraciones de Bases de Datos). */
type Factor = { id: string; friendly_name: string | null; factor_type: string; status: string; created_at: string }

export default function MfaPanel({ cerrar }: { cerrar: () => void }) {
  const [factores, setFactores] = useState<Factor[] | null>(null)
  const [error, setError] = useState('')
  const [inscribiendo, setInscribiendo] = useState<{ factorId: string; qr: string; secreto: string } | null>(null)
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) { setError(error.message); return }
    setError(''); setFactores((data.totp ?? []) as Factor[])
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function iniciar() {
    setError(''); setOcupado(true)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'VIMEDIC · ' + new Date().toLocaleDateString('es-EC') })
    setOcupado(false)
    if (error) { setError(error.message); return }
    setInscribiendo({ factorId: data.id, qr: data.totp.qr_code, secreto: data.totp.secret })
  }
  async function verificar() {
    if (!inscribiendo || codigo.trim().length < 6) { setError('Escribe el código de 6 dígitos de tu app autenticadora.'); return }
    setOcupado(true); setError('')
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId: inscribiendo.factorId })
    if (e1) { setOcupado(false); setError(e1.message); return }
    const { error: e2 } = await supabase.auth.mfa.verify({ factorId: inscribiendo.factorId, challengeId: ch.id, code: codigo.trim() })
    setOcupado(false)
    if (e2) { setError('Código incorrecto o vencido. Intenta de nuevo.'); return }
    setInscribiendo(null); setCodigo(''); cargar()
  }
  async function quitar(id: string) {
    if (!confirm('¿Quitar esta verificación en dos pasos? Volverás a entrar solo con tu contraseña.')) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id })
    if (error) { setError(error.message); return }
    cargar()
  }

  return (
    <div className="vr-modal on" role="dialog" aria-modal="true" aria-label="Verificación en dos pasos" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vr-caja" style={{ maxWidth: 440 }}>
        <div className="vr-pcab">
          <div><h3>Verificación en dos pasos</h3><p>Protege tu cuenta con un código además de tu contraseña.</p></div>
          <button type="button" className="vr-mini" onClick={cerrar} aria-label="Cerrar"><X className="ic" /></button>
        </div>
        <div style={{ padding: '4px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <p style={{ fontSize: 12, color: '#c0392b', background: '#fdecea', borderRadius: 10, padding: '8px 12px' }}>{error}</p>}

          {!inscribiendo && (
            <>
              {!factores && <p style={{ fontSize: 12, color: '#64748b' }}>Cargando…</p>}
              {factores?.map((f) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 12px' }}>
                  <ShieldCheck className="ic" style={{ color: f.status === 'verified' ? '#04896f' : '#c98a1f' }} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    <b style={{ display: 'block', color: '#1e293b' }}>{f.friendly_name || 'App autenticadora'}</b>
                    <span style={{ color: '#64748b' }}>{f.status === 'verified' ? 'Activa' : 'Pendiente de verificar'} · desde {new Date(f.created_at).toLocaleDateString('es-EC')}</span>
                  </div>
                  <button type="button" className="btn btn-light" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => quitar(f.id)}><ShieldOff className="w-3.5 h-3.5" />Quitar</button>
                </div>
              ))}
              {factores && !factores.length && (
                <p style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                  No tienes verificación en dos pasos activa. Úsala con una app autenticadora (Google Authenticator, Microsoft Authenticator, Authy…).
                  Es obligatoria para cambiar roles y permisos, datos de empleados y restaurar Bases de Datos.
                </p>
              )}
              <button type="button" className="btn btn-primary" onClick={iniciar} disabled={ocupado}><ShieldCheck className="w-3.5 h-3.5" />{ocupado ? 'Preparando…' : 'Activar verificación en dos pasos'}</button>
            </>
          )}

          {inscribiendo && (
            <>
              <p style={{ fontSize: 12.5, color: '#475569' }}>1. Escanea este código con tu app autenticadora.</p>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, alignSelf: 'center' }} dangerouslySetInnerHTML={{ __html: inscribiendo.qr }} />
              <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', wordBreak: 'break-all' }}>¿No puedes escanear? Clave manual: <b>{inscribiendo.secreto}</b></p>
              <p style={{ fontSize: 12.5, color: '#475569' }}>2. Escribe el código de 6 dígitos que te muestra la app.</p>
              <input className="vr-mfa-in" inputMode="numeric" maxLength={6} autoFocus value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="123456" style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={async () => { await supabase.auth.mfa.unenroll({ factorId: inscribiendo.factorId }); setInscribiendo(null); setCodigo('') }}>Cancelar</button>
                <button type="button" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={verificar} disabled={ocupado}>{ocupado ? 'Verificando…' : 'Confirmar y activar'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
