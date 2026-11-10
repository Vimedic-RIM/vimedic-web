import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Eye, EyeOff, KeyRound, UserRound, X } from 'lucide-react'
import { supabase, type Perfil } from './supabase'

/* Configuración personal: completar datos de contacto (teléfono, correo personal, cédula,
   cumpleaños, foto) y cambiar la contraseña. Cada quien solo puede tocar su propia ficha
   (lo exige la base de datos, no solo esta pantalla). */
type Datos = { telefono: string; correo_personal: string; cedula: string; cumpleanos: string; foto_url: string }
const MAX_MB = 5

export default function PerfilConfig({ perfil, cerrar, aviso, alGuardar }: { perfil: Perfil; cerrar: () => void; aviso: (t: string) => void; alGuardar?: (foto: string) => void }) {
  const [tab, setTab] = useState<'datos' | 'clave'>('datos')
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.from('empleados').select('telefono,correo_personal,cedula,cumpleanos,foto_url').eq('id', perfil.id).single()
      .then(({ data, error }) => {
        if (error) { setError('No se pudieron cargar tus datos: ' + error.message); return }
        const f = data as { telefono: string | null; correo_personal: string | null; cedula: string | null; cumpleanos: string | null; foto_url: string | null }
        setD({ telefono: f.telefono ?? '', correo_personal: f.correo_personal ?? '', cedula: f.cedula ?? '', cumpleanos: f.cumpleanos ?? '', foto_url: f.foto_url ?? '' })
      })
  }, [perfil.id])

  async function subirFoto(file: File) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('La foto debe ser JPG, PNG o WEBP.'); return }
    if (file.size > MAX_MB * 1048576) { setError(`La foto no puede pesar más de ${MAX_MB} MB.`); return }
    setError(''); setSubiendo(true)
    const { data: u } = await supabase.auth.getUser()
    const uid = u.user?.id
    if (!uid) { setSubiendo(false); setError('Tu sesión expiró. Vuelve a entrar.'); return }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const ruta = `${uid}-${Date.now()}.${ext}`
    const { error: e1 } = await supabase.storage.from('avatares').upload(ruta, file, { contentType: file.type, cacheControl: '31536000' })
    if (e1) { setSubiendo(false); setError('No se pudo subir la foto: ' + e1.message); return }
    const url = supabase.storage.from('avatares').getPublicUrl(ruta).data.publicUrl
    const { error: e2 } = await supabase.from('empleados').update({ foto_url: url }).eq('id', perfil.id)
    setSubiendo(false)
    if (e2) { setError('No se pudo guardar la foto: ' + e2.message); return }
    setD((x) => (x ? { ...x, foto_url: url } : x)); alGuardar?.(url); aviso('Foto de perfil actualizada.')
  }

  async function guardarDatos() {
    if (!d) return
    setError(''); setGuardando(true)
    const { error } = await supabase.from('empleados').update({
      telefono: d.telefono.trim() || null, correo_personal: d.correo_personal.trim() || null,
      cedula: d.cedula.trim() || null, cumpleanos: d.cumpleanos || null,
    }).eq('id', perfil.id)
    setGuardando(false)
    if (error) { setError('No se pudo guardar: ' + error.message); return }
    aviso('Tus datos se guardaron.')
  }

  const ini = String(perfil.nombre || perfil.email || 'U').trim().split(/\s+/).slice(0, 2).map((x) => x[0] || '').join('').toUpperCase() || 'V'

  return (
    <div className="vr-modal on" role="dialog" aria-modal="true" aria-label="Configuración" onClick={(e) => { if (e.target === e.currentTarget) cerrar() }}>
      <div className="vr-caja" style={{ maxWidth: 460 }}>
        <div className="vr-pcab">
          <div><h3>Configuración</h3><p>Completa tus datos y administra tu contraseña.</p></div>
          <button type="button" className="vr-mini" onClick={cerrar} aria-label="Cerrar"><X className="ic" /></button>
        </div>

        <div className="vr-ptabs">
          <button type="button" className={'vr-ptab' + (tab === 'datos' ? ' on' : '')} onClick={() => setTab('datos')}><UserRound className="w-3.5 h-3.5" /> Mis datos</button>
          <button type="button" className={'vr-ptab' + (tab === 'clave' ? ' on' : '')} onClick={() => setTab('clave')}><KeyRound className="w-3.5 h-3.5" /> Contraseña</button>
        </div>

        <div style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <p style={{ fontSize: 12, color: '#c0392b', background: '#fdecea', borderRadius: 10, padding: '8px 12px' }}>{error}</p>}

          {tab === 'datos' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                  {d?.foto_url
                    ? <img src={d.foto_url} alt="" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--line)' }} />
                    : <span style={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--navy)', color: '#fff', fontWeight: 700, fontSize: 20 }}>{ini}</span>}
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={subiendo}
                    style={{ position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: '50%', background: 'var(--primary)', color: '#fff', border: '2px solid #fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                    aria-label="Cambiar foto" title="Cambiar foto">
                    {subiendo ? <span style={{ width: 10, height: 10, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} /> : <Camera style={{ width: 13, height: 13 }} />}
                  </button>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirFoto(f); e.target.value = '' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <b style={{ display: 'block', fontSize: 14, color: '#1e293b' }}>{perfil.nombre}</b>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{perfil.email}</span>
                </div>
              </div>

              {!d ? <p style={{ fontSize: 12, color: '#64748b' }}>Cargando…</p> : (
                <>
                  <label className="vr-f">Teléfono<input className="vr-mfa-in" type="tel" value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} placeholder="09…" /></label>
                  <label className="vr-f">Correo personal<input className="vr-mfa-in" type="email" value={d.correo_personal} onChange={(e) => setD({ ...d, correo_personal: e.target.value })} placeholder="opcional" /></label>
                  <label className="vr-f">Cédula<input className="vr-mfa-in" value={d.cedula} onChange={(e) => setD({ ...d, cedula: e.target.value })} /></label>
                  <label className="vr-f">Cumpleaños<input className="vr-mfa-in" type="date" value={d.cumpleanos} onChange={(e) => setD({ ...d, cumpleanos: e.target.value })} /></label>
                  <button type="button" className="btn btn-primary" onClick={guardarDatos} disabled={guardando}><Check className="w-3.5 h-3.5" />{guardando ? 'Guardando…' : 'Guardar datos'}</button>
                </>
              )}
            </>
          )}

          {tab === 'clave' && <CambiarClave aviso={aviso} setError={setError} />}
        </div>
      </div>
    </div>
  )
}

function CambiarClave({ aviso, setError }: { aviso: (t: string) => void; setError: (t: string) => void }) {
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [ver, setVer] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setError('')
    if (nueva.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (nueva !== confirmar) { setError('Las contraseñas no coinciden.'); return }
    setGuardando(true)
    const { error } = await supabase.auth.updateUser({ password: nueva })
    setGuardando(false)
    if (error) { setError('No se pudo cambiar la contraseña: ' + error.message); return }
    setNueva(''); setConfirmar(''); aviso('Contraseña actualizada.')
  }

  return (
    <>
      <p style={{ fontSize: 12, color: '#64748b' }}>Mínimo 8 caracteres. Si entraste con Google, esto además te deja iniciar sesión con correo y contraseña.</p>
      <label className="vr-f">Nueva contraseña
        <div style={{ position: 'relative' }}>
          <input className="vr-mfa-in" type={ver ? 'text' : 'password'} value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" style={{ paddingRight: 36 }} />
          <button type="button" onClick={() => setVer((v) => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', background: 'none', border: 0, cursor: 'pointer', display: 'grid' }} aria-label={ver ? 'Ocultar' : 'Mostrar'}>
            {ver ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </label>
      <label className="vr-f">Confirmar contraseña<input className="vr-mfa-in" type={ver ? 'text' : 'password'} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" /></label>
      <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}><KeyRound className="w-3.5 h-3.5" />{guardando ? 'Guardando…' : 'Cambiar contraseña'}</button>
    </>
  )
}
