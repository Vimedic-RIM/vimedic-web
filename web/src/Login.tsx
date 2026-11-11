import { useState } from 'react'
import { supabase } from './supabase'
import './estilos/login.css'

// Pantalla de inicio de sesión: misma estructura y estilos que LoginEmpleados.html de la app original.
export default function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim() || !clave) { setError('Ingresa tu correo y tu contraseña.'); return }
    setCargando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave })
    if (error) { setError('Correo o contraseña incorrectos.'); setCargando(false) }
  }

  // El login lo valida Google; el acceso real lo decide la base de datos según el correo del empleado.
  async function entrarConGoogle() {
    setError(''); setCargando(true)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin, queryParams: { hd: 'vimedic.com.ec' } } })
    if (error) { setError('No se pudo abrir el acceso con Google: ' + error.message); setCargando(false) }
    // si no hay error, el navegador ya está yendo hacia Google
  }

  return (
    <div className="vm-login">
      <div className="card">
        <div className="panel-left">
          <div>
            <div className="logo-mark">✳</div>
            <h1>Hola,<br />Vimedic&nbsp;👋</h1>
            <p>Ingresa con tu correo y contraseña de empleado para acceder a Mi Espacio y únicamente a los módulos internos que tengas habilitados.</p>
          </div>
          <div className="brand">Vimedic · Equipos Médicos</div>
        </div>

        <div className="panel-right">
          <div className="brand-name">VIMEDIC</div>
          <h2>Bienvenido de nuevo</h2>
          <p className="subtitle">Inicia sesión con tu cuenta de empleado.</p>

          {error && <div id="msgError" style={{ display: 'block' }}>{error}</div>}

          <form onSubmit={entrar}>
            <div className="field">
              <label htmlFor="email">Correo</label>
              <input type="email" id="email" autoComplete="username" placeholder="tu.correo@vimedic.com.ec" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <input type="password" id="password" autoComplete="current-password" placeholder="••••••••" required value={clave} onChange={(e) => setClave(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary" disabled={cargando}>{cargando ? 'Ingresando…' : 'Iniciar Sesión'}</button>
          </form>

          <div className="divider">o</div>

          <button type="button" className="btn-google" disabled={cargando} onClick={entrarConGoogle}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" /><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" /><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z" /><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" /></svg>
            Iniciar sesión con Google
          </button>

          <p className="foot-row">¿Olvidaste tu contraseña? <a href="#" onClick={(e) => { e.preventDefault(); alert('Pide a un administrador (módulo Empleados) que te genere una contraseña nueva.') }}>Pide una nueva</a></p>
        </div>
      </div>
    </div>
  )
}
