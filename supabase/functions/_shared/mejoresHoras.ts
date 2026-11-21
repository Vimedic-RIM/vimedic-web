// «Mejores horas para publicar» (Marketing › Planificador), como Metricool. Funciones puras (se prueban sin red).
//   · Zernio /analytics/best-time: interacción promedio (me gusta + comentarios + compartidos + guardados) de las
//     publicaciones por día de la semana (0 = lunes) y hora UTC.
//   · mkt_horas_clientes: cuántos clientes escribieron (leads) por día y hora de Ecuador, por red.
//   Se combinan en un «calor» de 0 a 1 por día y hora de Ecuador (60 % interacción, 40 % clientes; si falta una
//   fuente, la otra sola) y se eligen las mejores franjas entre 6:00 y 22:00.

export type SlotZernio = { day_of_week: number; hour: number; avg_engagement: number; post_count: number }
export type FilaClientes = { red: string; dia: number; hora: number; n: number }
export type Franja = { dia: number; hora: number; calor: number; interaccion: number | null; publicaciones: number; clientes: number }
export type Red = { calor: number[][]; mejores: Franja[]; interaccion: boolean; clientes: number }

const OFFSET_EC = -5 // Ecuador: UTC−5, sin horario de verano
export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const vacia = () => Array.from({ length: 7 }, () => Array(24).fill(0) as number[])

/** Hora UTC de Zernio → día y hora de Ecuador. */
export function aEcuador(dia: number, hora: number): { dia: number; hora: number } {
  let h = hora + OFFSET_EC, d = dia
  if (h < 0) { h += 24; d = (d + 6) % 7 }
  if (h > 23) { h -= 24; d = (d + 1) % 7 }
  return { dia: d, hora: h }
}

/** Interacción de Zernio por día y hora de Ecuador (promedio ajustado por cuántas publicaciones hubo) y cuántas fueron. */
export function matrizInteraccion(slots: SlotZernio[]): { valor: number[][]; publicaciones: number[][]; promedio: number[][] } {
  const valor = vacia(), publicaciones = vacia(), promedio = vacia()
  for (const s of slots ?? []) {
    const d = Number(s.day_of_week), h = Number(s.hour), avg = Number(s.avg_engagement) || 0, n = Number(s.post_count) || 0
    if (!(d >= 0 && d <= 6 && h >= 0 && h <= 23) || n <= 0) continue
    const e = aEcuador(d, h)
    // Con 1 o 2 publicaciones el promedio es poco confiable: pesa menos.
    valor[e.dia][e.hora] = avg * Math.min(1, n / 3)
    publicaciones[e.dia][e.hora] = n
    promedio[e.dia][e.hora] = avg
  }
  return { valor, publicaciones, promedio }
}

/** Clientes por día y hora (de las redes indicadas; vacío = todas). */
export function matrizClientes(filas: FilaClientes[], redes: string[] = []): number[][] {
  const m = vacia()
  for (const f of filas ?? []) {
    if (redes.length && !redes.includes(f.red)) continue
    const d = Number(f.dia), h = Number(f.hora)
    if (d >= 0 && d <= 6 && h >= 0 && h <= 23) m[d][h] += Number(f.n) || 0
  }
  return m
}

/** Suaviza (una hora antes y después pesan la mitad) y lleva a 0..1. */
function normalizar(m: number[][], suavizar: boolean): number[][] {
  const s = m.map((fila) => fila.map((v, h) => suavizar ? v + 0.5 * ((fila[h - 1] ?? 0) + (fila[h + 1] ?? 0)) : v))
  const max = Math.max(0, ...s.flat())
  return s.map((fila) => fila.map((v) => (max > 0 ? v / max : 0)))
}

const SEPARACION_H = 2
/** Mejores franjas entre 6:00 y 22:00, sin dos casi iguales (mismo día a menos de 2 horas). */
export function mejoresFranjas(calor: number[][], cuantas = 5): { dia: number; hora: number; calor: number }[] {
  const celdas: { dia: number; hora: number; calor: number }[] = []
  for (let d = 0; d < 7; d++) for (let h = 6; h <= 22; h++) if (calor[d][h] > 0) celdas.push({ dia: d, hora: h, calor: calor[d][h] })
  celdas.sort((a, b) => b.calor - a.calor || a.dia - b.dia || a.hora - b.hora)
  const elegidas: typeof celdas = []
  for (const c of celdas) {
    if (elegidas.some((e) => e.dia === c.dia && Math.abs(e.hora - c.hora) < SEPARACION_H)) continue
    elegidas.push(c)
    if (elegidas.length >= cuantas) break
  }
  return elegidas
}

const red2 = (v: number) => Math.round(v * 100) / 100

/** Calor de una red: interacción de Zernio (si hay) + clientes de esa red (o de todas, si la red no trae leads). */
export function calcularRed(slots: SlotZernio[] | null, clientes: number[][]): Red {
  const inter = slots && slots.length ? matrizInteraccion(slots) : null
  const hayInter = !!inter && Math.max(...inter.valor.flat()) > 0
  const totalClientes = clientes.flat().reduce((a, b) => a + b, 0)
  const nInter = hayInter ? normalizar(inter!.valor, false) : null
  const nCli = totalClientes > 0 ? normalizar(clientes, true) : null
  const calor = vacia().map((fila, d) => fila.map((_, h) => {
    const a = nInter ? nInter[d][h] : null, b = nCli ? nCli[d][h] : null
    return red2(a !== null && b !== null ? 0.6 * a + 0.4 * b : (a ?? b ?? 0))
  }))
  // Solo con datos de clientes, no se recomienda una hora en la que nadie escribió (el suavizado no basta).
  const base = hayInter ? calor : calor.map((fila, d) => fila.map((v, h) => (clientes[d][h] > 0 ? v : 0)))
  const mejores: Franja[] = mejoresFranjas(base).map((f) => ({
    ...f,
    interaccion: inter ? red2(inter.promedio[f.dia][f.hora]) || null : null,
    publicaciones: inter ? inter.publicaciones[f.dia][f.hora] : 0,
    clientes: clientes[f.dia][f.hora],
  }))
  return { calor, mejores, interaccion: hayInter, clientes: totalClientes }
}

/** Con menos clientes que esto, una red usa los de todas (con pocos datos el patrón es ruido). */
export const MIN_CLIENTES_RED = 30

/** Todas las redes conectadas en Zernio + «general» (todas juntas). */
export function calcularMejoresHoras(porRed: Record<string, SlotZernio[]>, filas: FilaClientes[], plataformas: string[]): Record<string, Red> {
  const out: Record<string, Red> = {}
  const todas = Object.values(porRed).flat()
  out.general = calcularRed(todas.length ? todas : null, matrizClientes(filas))
  for (const p of plataformas) {
    const propios = matrizClientes(filas, [p])
    const cli = propios.flat().reduce((a, b) => a + b, 0) >= MIN_CLIENTES_RED ? propios : matrizClientes(filas)
    out[p] = calcularRed(porRed[p] ?? null, cli)
  }
  return out
}

/** Resumen compacto para la IA (sin la matriz completa). */
export function resumenParaIA(redes: Record<string, Red>): string {
  return Object.entries(redes).map(([red, r]) =>
    `${red === 'general' ? 'TODAS LAS REDES' : red.toUpperCase()} (${r.interaccion ? 'con interacción de publicaciones' : 'sin datos de interacción'}; ${r.clientes} clientes en 6 meses): ` +
    r.mejores.map((f) => `${DIAS[f.dia]} ${String(f.hora).padStart(2, '0')}:00 calor ${f.calor}` +
      (f.interaccion !== null ? ` interacción ${f.interaccion} (${f.publicaciones} publ.)` : '') + ` clientes ${f.clientes}`).join(' | ')
  ).join('\n')
}
