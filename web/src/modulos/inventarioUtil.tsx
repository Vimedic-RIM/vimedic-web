/* Piezas pequeñas de Inventario que usan otros módulos. Viven aparte para que esos módulos
   (y la entrada de la app) no tengan que descargar todo Inventario solo por esto. */

// Igual que la app original: los enlaces de Drive se piden como miniatura del ancho necesario.
// Cuando las imágenes pasen a R2 (media.vimedic.com.ec) esta función devuelve la URL tal cual.
export function imagen(url: string | null | undefined, ancho: number): string {
  const v = String(url || '').trim()
  if (!v) return ''
  try {
    const u = new URL(v)
    if (u.hostname !== 'drive.google.com' && !/^lh[0-9]+\.googleusercontent\.com$/.test(u.hostname)) return v
    const m = u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/)
    const id = m ? m[1] : u.searchParams.get('id')
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return v
    return `https://lh3.googleusercontent.com/d/${id}=w${ancho}`
  } catch { return v }
}

export function Interruptor({ activo, cambiar }: { activo: boolean; cambiar: () => void }) {
  return (
    <button type="button" onClick={cambiar} className="relative w-11 h-6 rounded-full transition-colors shrink-0" style={{ background: activo ? 'var(--teal)' : '#cbd5e1' }}>
      <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform" style={{ transform: activo ? 'translateX(20px)' : 'translateX(0)' }} />
    </button>
  )
}
