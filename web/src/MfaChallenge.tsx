import { useState } from 'react'
import { supabase } from './supabase'
import './estilos/login.css'

// Segundo paso del login cuando la cuenta ya tiene verificación en dos pasos activa (aal1 → aal2).
export default function MfaChallenge({ onOk }: { onOk: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function confirmar(e: React.FormEvent) {
    e.preventDefault()
    if (codigo.trim().length < 6) { setError('Escribe el código de 6 dígitos de tu app autenticadora.'); return }
    setCargando(true); setError('')
    const { data: factores, error: e0 } = await supabase.auth.mfa.listFactors()
    const factorId = factores?.totp?.find((f) => f.status === 'verified')?.id
    if (e0 || !factorId) { setCargando(false); setError('No se encontró tu verificación en dos pasos.'); return }
    const { data: ch, error: e1 } = await supabase.auth.mfa.challenge({ factorId })
    if (e1) { setCargando(false); setError(e1.message); return }
    const { error: e2 } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: codigo.trim() })
    setCargando(false)
    if (e2) { setError('Código incorrecto o vencido. Intenta de nuevo.'); return }
    onOk()
  }

  return (
    <div className="vm-login">
      <div className="card">
        <div className="panel-left">
          <div>
            <div className="logo-mark">✳</div>
            <h1>Un paso<br />más 🔐</h1>
            <p>Esta cuenta tiene verificación en dos pasos. Escribe el código de tu app autenticadora para continuar.</p>
          </div>
          <div className="brand">Vimedic · Equipos Médicos</div>
        </div>
        <div className="panel-right">
          <div className="brand-name">VIMEDIC</div>
          <h2>Verificación en dos pasos</h2>
          <p className="subtitle">Abre tu app autenticadora (Google Authenticator, Authy…) y escribe el código actual.</p>
          {error && <div id="msgError" style={{ display: 'block' }}>{error}</div>}
          <form onSubmit={confirmar}>
            <div className="field">
              <label htmlFor="mfa-code">Código</label>
              <input id="mfa-code" inputMode="numeric" maxLength={6} autoFocus placeholder="123456" required
                value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }} />
            </div>
            <button type="submit" className="btn-primary" disabled={cargando}>{cargando ? 'Verificando…' : 'Continuar'}</button>
          </form>
          <p className="foot-row">¿Perdiste el acceso a tu app autenticadora? <a href="#" onClick={(e) => { e.preventDefault(); alert('Pide a un administrador que quite tu verificación en dos pasos desde Seguridad.') }}>Pide ayuda</a></p>
          <p className="foot-row"><a href="#" onClick={(e) => { e.preventDefault(); supabase.auth.signOut() }}>Salir e intentar con otra cuenta</a></p>
        </div>
      </div>
    </div>
  )
}
