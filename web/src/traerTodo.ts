/* Supabase entrega como máximo 1.000 filas por consulta, aunque se pida un .limit() mayor: lo que pasa de 1.000 no
   llega y la pantalla queda incompleta sin avisar. traerTodo pide en tandas de 1.000 (con .range) hasta traer todo
   o llegar a «max». La consulta debe tener un orden estable (terminar en .order('id')) para no repetir ni saltar filas. */
type Tanda<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export async function traerTodo<T>(consulta: (desde: number, hasta: number) => Tanda<T>, max = 10000): Promise<{ data: T[]; error: { message: string } | null }> {
  const LOTE = 1000
  const out: T[] = []
  for (let desde = 0; desde < max; desde += LOTE) {
    const { data, error } = await consulta(desde, Math.min(desde + LOTE, max) - 1)
    if (error) return { data: out, error }
    const filas = data ?? []
    out.push(...filas)
    if (filas.length < LOTE) break
  }
  return { data: out, error: null }
}
