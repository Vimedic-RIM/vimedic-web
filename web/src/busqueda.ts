/* Búsqueda sin tildes ni mayúsculas (todos los buscadores de clientes).
   La base guarda en clientes.busqueda el texto del cliente ya normalizado (sin tildes, en minúsculas); aquí se normaliza lo que la persona
   escribe de la misma manera y se compara palabra por palabra: "jose perez" encuentra a "José Pérez" y a "Pérez, José". */

/** Sin tildes y en minúsculas: "Muñoz Ávila" → "munoz avila". */
export const sinTildes = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Palabras a buscar: normalizadas y sin los signos que rompen los filtros de la API. */
export const palabras = (texto: string): string[] => sinTildes(texto).replace(/[,()%*\\_"']/g, ' ').split(/\s+/).filter(Boolean)

/** Para listas que ya están cargadas: ¿el texto contiene todas las palabras buscadas? Sin nada escrito, sí. */
export const coincide = (texto: unknown, buscado: string): boolean => {
  const t = sinTildes(texto)
  return palabras(buscado).every((w) => t.includes(w))
}
