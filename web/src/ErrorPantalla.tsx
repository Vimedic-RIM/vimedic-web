/* Evita la pantalla en blanco.
   · Si al abrir un módulo falta un archivo de la app (pasa cuando se publica una versión nueva mientras alguien trabaja:
     los archivos de la versión anterior ya no existen), la página se recarga sola una vez y abre la versión nueva.
   · Si un módulo falla al mostrarse por otra razón, se ve un aviso con «Volver a intentar» y «Recargar» en lugar de
     dejar todo en blanco; el resto de la app sigue funcionando. */
import { Component, type ReactNode } from 'react'

const esErrorDeCarga = (e: unknown): boolean =>
  /dynamically imported module|Importing a module script failed|module script|Unable to preload CSS|ChunkLoadError|Loading chunk \S+ failed|not a valid JavaScript MIME type/i
    .test(String((e as Error)?.message ?? e))

/** Recarga la página para tomar la versión nueva (como máximo una vez cada 20 s, para no quedar en un bucle). */
export function recargarPorVersionNueva(): boolean {
  try {
    const t = Number(sessionStorage.getItem('vm_recarga_version') || 0)
    if (Date.now() - t < 20000) return false
    sessionStorage.setItem('vm_recarga_version', String(Date.now()))
  } catch { /* sin almacenamiento: se recarga igual */ }
  window.location.reload()
  return true
}

type Estado = { error: Error | null; recargando: boolean }
export class ErrorPantalla extends Component<{ children: ReactNode; donde?: string }, Estado> {
  state: Estado = { error: null, recargando: false }
  static getDerivedStateFromError(error: Error): Partial<Estado> { return { error } }
  componentDidCatch(error: Error) {
    console.error('Error al mostrar ' + (this.props.donde ?? 'la pantalla') + ':', error)
    if (esErrorDeCarga(error) && recargarPorVersionNueva()) this.setState({ recargando: true })
  }
  render() {
    const { error, recargando } = this.state
    if (!error) return this.props.children
    const caja: React.CSSProperties = { maxWidth: 520, margin: '48px auto', padding: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 10px 30px -18px rgba(11,37,69,.45)', fontFamily: 'Inter, sans-serif', color: '#0f172a' }
    const boton = (fondo: string, color: string): React.CSSProperties => ({ border: fondo === '#fff' ? '1px solid #cbd5e1' : 0, background: fondo, color, borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' })
    if (recargando) return <div style={caja}><p style={{ margin: 0, fontWeight: 700 }}>Hay una versión nueva de la app. Actualizando…</p></div>
    const carga = esErrorDeCarga(error)
    return (
      <div style={caja} role="alert">
        <p style={{ margin: 0, fontWeight: 800, fontSize: 15 }}>{carga ? 'Hay una versión nueva de la app' : 'Algo falló al mostrar ' + (this.props.donde ?? 'esta pantalla')}</p>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#475569' }}>{carga ? 'Recarga la página para seguir trabajando. Lo que ya guardaste no se pierde.' : 'Vuelve a intentarlo. Si se repite, envía este mensaje a sistemas:'}</p>
        {!carga && <pre style={{ margin: '10px 0 0', padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 11.5, color: '#b91c1c', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{error.message}</pre>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {!carga && <button type="button" style={boton('#fff', '#0f172a')} onClick={() => this.setState({ error: null })}>Volver a intentar</button>}
          <button type="button" style={boton('#055c9d', '#fff')} onClick={() => window.location.reload()}>Recargar la página</button>
        </div>
      </div>
    )
  }
}
