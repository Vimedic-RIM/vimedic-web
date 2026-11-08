import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, type Perfil } from './supabase'
import { MODULOS } from './modulos'

function iniciales(nombre: string) {
  return nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
}

function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setCargando(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave })
    if (error) setError('Correo o contraseña incorrectos.')
    setCargando(false)
  }

  return (
    <div className="login-fondo">
      <form className="login-card" onSubmit={entrar}>
        <div className="marca-logo">VIMEDIC</div>
        <h1>Mi Espacio</h1>
        <p className="muted">Ingresa con tu correo de empleado.</p>
        <label>
          Correo
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          Contraseña
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required autoComplete="current-password" />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn-primario" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </div>
  )
}

function MiEspacio({ perfil }: { perfil: Perfil }) {
  const visibles = MODULOS.filter((m) => perfil.es_superadmin || perfil.permisos?.[m.clave]?.includes('ver'))
  const hoy = new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="bar">
            <div className="brand">
              <div className="brand-icon">V</div>
              <div>
                <div className="brand-title">VIMEDIC</div>
                <div className="brand-sub">{perfil.empresa === 'FEMEDICS' ? 'Femedics' : 'Sistema interno'}</div>
              </div>
            </div>
            <div className="bar-right">
              <div className="user-chip">
                <div className="user-avatar">{iniciales(perfil.nombre)}</div>
                <div>
                  <div className="user-name">{perfil.nombre}</div>
                  <div className="user-role">{perfil.rol ?? 'Sin rol'}</div>
                </div>
              </div>
              <button className="hbtn" onClick={() => supabase.auth.signOut()}>Salir</button>
            </div>
          </div>
          <div className="hello">
            <div>
              <h1>Hola, {perfil.nombre.split(' ')[0]}</h1>
              <p>{perfil.cargo ?? 'Bienvenido a tu espacio de trabajo'}</p>
            </div>
            <div className="hello-date">{hoy}</div>
          </div>
        </div>
      </header>

      <main className="contenido">
        <div className="sec-head"><h2>Tus módulos</h2></div>
        {visibles.length === 0 ? (
          <p className="muted">Todavía no tienes módulos asignados. Pide acceso a tu administrador.</p>
        ) : (
          <div className="grid">
            {visibles.map((m) => (
              <div key={m.clave} className={'modulo' + (m.listo ? '' : ' pronto')} style={{ ['--c' as string]: m.color }}>
                <div className="modulo-barra" />
                <div className="module-title">{m.titulo}</div>
                <p>{m.desc}</p>
                {!m.listo && <span className="etiqueta">Próximamente</span>}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [perfil, setPerfil] = useState<Perfil | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setPerfil(session === null ? null : undefined); return }
    supabase.rpc('mi_perfil').then(({ data }) => setPerfil((data as Perfil | null) ?? null))
  }, [session])

  if (session === undefined) return <div className="centro muted">Cargando…</div>
  if (!session) return <Login />
  if (perfil === undefined) return <div className="centro muted">Cargando tu perfil…</div>
  if (!perfil)
    return (
      <div className="centro">
        <div className="login-card">
          <h1>Sin acceso</h1>
          <p className="muted">Tu cuenta no está vinculada a un empleado activo. Contacta al administrador.</p>
          <button className="btn-primario" onClick={() => supabase.auth.signOut()}>Salir</button>
        </div>
      </div>
    )
  return <MiEspacio perfil={perfil} />
}
