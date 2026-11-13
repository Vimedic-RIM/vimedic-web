/* Tiempo real sin recargas en cascada.
   Cada fila que cambia en la base manda un aviso a las pantallas abiertas. Cuando cambian muchas
   filas seguidas (una carga de datos, una importación, un proceso masivo), recargar la lista con
   cada aviso hace que la app se ponga lenta. `agrupar` junta los avisos que llegan seguidos y
   recarga una sola vez: espera `espera` ms de calma, pero nunca más de `maximo` ms desde el primer
   aviso, para que la pantalla siga actualizándose aunque los cambios no paren. */
export type Agrupada = (() => void) & { cancelar: () => void }

export function agrupar(fn: () => void, espera = 900, maximo = 5000): Agrupada {
  let t: number | undefined
  let primero = 0
  const f = (() => {
    const ahora = Date.now()
    if (!primero) primero = ahora
    window.clearTimeout(t)
    t = window.setTimeout(() => { primero = 0; fn() }, Math.max(0, Math.min(espera, maximo - (ahora - primero))))
  }) as Agrupada
  f.cancelar = () => { window.clearTimeout(t); primero = 0 }
  return f
}
