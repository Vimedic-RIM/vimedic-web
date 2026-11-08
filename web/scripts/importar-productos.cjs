const { createClient } = require('@supabase/supabase-js')
const { leerCsv, num, fecha, si, vacio } = require('./csv.cjs')

// Uso: SUPABASE_URL=... SUPABASE_KEY=<anon/publicable> IMPORT_EMAIL=... IMPORT_PW=... node scripts/importar-productos.cjs <ruta.csv> [limite]
const RUTA = process.argv[2]
const LIMITE = Number(process.argv[3] || 0) // 0 = todo
if (!RUTA) { console.error('Falta la ruta del CSV'); process.exit(1) }
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

;(async () => {
  const a = await s.auth.signInWithPassword({ email: process.env.IMPORT_EMAIL, password: process.env.IMPORT_PW })
  if (a.error) throw new Error('login: ' + a.error.message)

  const filas = leerCsv(RUTA)
  const datos = filas.slice(1).slice(0, LIMITE || undefined)

  // 1) Categorías (nombre único). Se reactivan si estaban archivadas.
  const nombres = [...new Set(datos.map((f) => f[2].trim()).filter(Boolean))]
  const { data: cats0, error: e0 } = await s.from('categorias').select('id,nombre')
  if (e0) throw e0
  const mapa = new Map(cats0.map((c) => [c.nombre, c.id]))
  const nuevas = nombres.filter((n) => !mapa.has(n))
  if (nuevas.length) {
    const { data, error } = await s.from('categorias').insert(nuevas.map((nombre, i) => ({ id: crypto.randomUUID(), nombre, orden: i + 1 }))).select('id,nombre')
    if (error) throw error
    data.forEach((c) => mapa.set(c.nombre, c.id))
  }
  console.log('categorías nuevas:', nuevas.length)

  // 2) Productos
  const filaDB = (f) => {
    const iva = String(f[13] || '').trim().toUpperCase()
    const img = vacio(f[5])
    return {
      id: crypto.randomUUID(),
      codigo: f[0].trim(),
      nombre: f[1].trim(),
      categoria_id: mapa.get(f[2].trim()) ?? null,
      descripcion: vacio(f[3]),
      ficha_tecnica_url: vacio(f[4]),
      imagen_url: img && !/NO ENCONTRADO/i.test(img) ? img : null,
      drive_carpeta_url: vacio(f[6]),
      stock: num(f[7]) ?? 0,
      pvp: num(f[8]),
      precio_dis: num(f[9]),
      en_catalogo: si(f[10]),
      estado: vacio(f[11]),
      reservaciones: vacio(f[12]),
      aplica_iva: !(iva === 'NO' || iva === 'SIN IVA'),
      orden: num(f[14]),
      oculto: si(f[15]) || si(f[25]),
      stock_no_disponible_nc: num(f[16]) ?? 0,
      stock_fisico: num(f[17]) ?? 0,
      codigo_unico: vacio(f[18]),
      marca: vacio(f[19]),
      fecha_creacion: fecha(f[20]),
      sin_etiqueta_nuevo: si(f[21]),
      referencia_proveedor: vacio(f[22]),
      stock_por_reparar: num(f[23]) ?? 0,
      requiere_serie: si(f[24]),
      caracteristicas: vacio(f[26]),
      especificaciones: vacio(f[27]),
      accesorios: vacio(f[28]),
      certificaciones: vacio(f[29]),
      deleted_at: null, // reactiva los productos de prueba archivados con el mismo código
    }
  }
  const lote = 200
  let ok = 0
  for (let i = 0; i < datos.length; i += lote) {
    const parte = datos.slice(i, i + lote).map(filaDB)
    const { error } = await s.from('productos').upsert(parte, { onConflict: 'codigo' })
    if (error) { console.log('ERROR lote', i, error.message, error.details || ''); process.exit(1) }
    ok += parte.length
    process.stdout.write(`\rimportados ${ok}/${datos.length}`)
  }
  console.log()
})().catch((e) => { console.error('FALLÓ:', e.message || e); process.exit(1) })
