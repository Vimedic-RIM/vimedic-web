/* Plantillas de documentos: cada documento se arma con una lista de BLOQUES que se pueden ordenar, ocultar y editar en el
   módulo «Plantillas de documentos» (modulos/Plantillas.tsx):
     · «seccion»: una parte que llena la app con sus datos (cliente, productos, totales, firmas…); se puede mover, ocultar
       y cambiar su título, pero su contenido lo calcula el sistema.
     · «texto», «imagen», «linea», «espacio», «firma»: bloques libres. El texto acepta **negrita** y variables {cliente},
       {factura}, {fecha}… que se reemplazan con los datos de cada documento.
   Sin cambios guardados, cada documento usa el diseño por defecto de aquí (el mismo que tenía antes).
   La marca (logo, colores, leyenda y pie) es la plantilla «general» y la aplica documentoMarca.ts a todos los documentos. */
import { supabase } from './supabase'
import { fijarMarca, MARCA_DEF, type MarcaDoc } from './documentoMarca'

export type TipoBloque = 'seccion' | 'texto' | 'imagen' | 'linea' | 'espacio' | 'firma'
export type Alinear = 'izquierda' | 'centro' | 'derecha'
export type Bloque = {
  id: string; tipo: TipoBloque; visible: boolean
  /** seccion: qué parte del sistema es. */
  clave?: string
  /** Título del bloque (secciones y textos) o la línea encima de la firma. */
  titulo?: string
  /** texto: el contenido; firma: el rótulo del recuadro de la firma (vacío = sin recuadro). */
  texto?: string
  url?: string; ancho?: number; alto?: number; alinear?: Alinear
  nombre?: string; cargo?: string
  tamano?: number
}
export type Plantilla = { titulo: string; titulo2?: string; lugar?: string; bloques: Bloque[] }
export type DefDoc = {
  codigo: string; nombre: string; desc: string
  base: Plantilla
  /** Secciones del sistema: clave → nombre que ve quien edita. */
  secciones: Record<string, string>
  /** Variables que se pueden usar en los textos: clave → qué es. */
  variables: Record<string, string>
  /** El encabezado usa el campo «lugar» (Quito, …). */
  conLugar?: boolean
}

let n = 0
const b = (tipo: TipoBloque, x: Partial<Bloque> = {}): Bloque => ({ id: 'b' + (++n), tipo, visible: true, ...x })
const sec = (clave: string, titulo = '') => b('seccion', { clave, titulo })

const VARS_CLIENTE = { cliente: 'Nombre del cliente', ruc: 'Cédula / RUC del cliente', fecha: 'Fecha del documento' }

export const DOCS: DefDoc[] = [
  {
    codigo: 'proforma', nombre: 'Proforma / Cotización', desc: 'La cotización que el asesor envía al cliente desde el CRM.',
    base: { titulo: 'Proforma / Cotización', bloques: [sec('datos'), sec('nota'), sec('pago_entrega'), sec('productos'), sec('totales')] },
    secciones: { datos: 'Datos del cliente y del asesor', nota: 'Nota importante (si la cotización tiene)', pago_entrega: 'Detalles de pago y entrega', productos: 'Tabla de productos', totales: 'Subtotal, IVA y total' },
    variables: { ...VARS_CLIENTE, numero: 'Número de la solicitud', asesor: 'Asesor comercial', correo: 'Correo del cliente', telefono: 'Teléfono del cliente', total: 'Total con IVA' },
  },
  {
    codigo: 'venta', nombre: 'Comprobante de venta', desc: 'El comprobante de una venta ganada en el CRM.',
    base: { titulo: 'Comprobante de venta', bloques: [sec('datos'), sec('nota'), sec('pago_entrega'), sec('productos'), sec('totales')] },
    secciones: { datos: 'Datos del cliente y del asesor', nota: 'Nota importante (si la venta tiene)', pago_entrega: 'Detalles de pago y entrega', productos: 'Tabla de productos', totales: 'Subtotal, IVA y total' },
    variables: { ...VARS_CLIENTE, numero: 'Número de la venta', asesor: 'Asesor comercial', correo: 'Correo del cliente', telefono: 'Teléfono del cliente', total: 'Total con IVA' },
  },
  {
    codigo: 'acta_entrega', nombre: 'Acta de entrega', desc: 'Acta de entrega / entera satisfacción (Facturación). Lleva la única firma del cliente.', conLugar: true,
    base: {
      titulo: 'Acta de entrega /', titulo2: 'Entera satisfacción', lugar: 'Quito',
      bloques: [
        b('texto', { texto: 'A través de la presente, se deja constancia de la entrega adecuada, oportuna y a entera satisfacción del cliente, de los equipos detallados a continuación{con_carta}:' }),
        sec('cliente', 'Información del Cliente'),
        sec('equipos', 'Detalle de Equipos Entregados'),
        b('texto', { titulo: 'Cláusulas', texto: '1. Todos los equipos en la presente acta, a partir de la firma, estarán bajo responsabilidad, buen uso y custodia de quien recibe.\n2. Se deja constancia de que los equipos se encuentran instalados/entregados, revisados y en perfecto estado de funcionamiento.\n{clausulas_garantia}' }),
        sec('firmas'),
      ],
    },
    secciones: { cliente: 'Información del cliente', equipos: 'Tabla de equipos entregados (series y garantía)', firmas: 'Firmas de entrega y recepción' },
    variables: { ...VARS_CLIENTE, factura: 'Número de factura', ciudad: 'Ciudad del cliente', garantia: 'Tiempo de garantía', con_carta: '«, junto con su respectiva Carta de Garantía» (solo si hay garantía)', clausulas_garantia: 'Cláusulas 3 y 4 sobre la carta de garantía (cambian si no hay garantía)' },
  },
  {
    codigo: 'carta_garantia', nombre: 'Carta de garantía', desc: 'Va junto al acta cuando hay equipos con garantía. Lleva la firma electrónica de la empresa.', conLugar: true,
    base: {
      titulo: 'Carta de', titulo2: 'Garantía', lugar: 'Quito DM',
      bloques: [
        b('texto', { texto: 'Por la factura **N° {factura}** con fecha {fecha} emitida a **{cliente}** con RUC **{ruc}**, se confiere la presente carta de garantía de los siguientes equipos:' }),
        sec('equipos_garantia', 'Equipos en Garantía'),
        b('texto', { titulo: 'Condiciones de Garantía', texto: '1. Los equipos son entregados previa verificación de funcionamiento; se comprueba que se encuentran 100% operativos y en perfecto estado. Una vez recibidos a conformidad, no se aceptan cambios ni devoluciones.\n\n2. Se otorga garantía por defectos de fábrica por el período indicado para cada equipo (**{garantia}**), contado desde la fecha de entrega. Esta garantía no incluye golpes, rayaduras, uso incorrecto, uso inadecuado u otros daños similares.\n\n3. {condicion_mantenimiento}\n\n4. Cada mantenimiento, sea preventivo o correctivo, tiene un valor que será determinado por el departamento técnico luego de la revisión correspondiente y deberá ser cubierto por el acreedor.\n\n5. Si durante un mantenimiento preventivo se detecta la necesidad de mantenimiento correctivo, este tendrá un valor adicional por reparación, repuestos y demás rubros aplicables.\n\n6. Si el departamento técnico detecta manipulación o mantenimiento por parte de personal ajeno, la garantía se perderá inmediatamente.\n\n7. Esta carta forma parte del Acta de Entrega / Entera Satisfacción N° {factura}, firmada por el cliente; no requiere una firma adicional del cliente.' }),
        sec('cronograma', 'Cronograma de Mantenimiento'),
        b('texto', { texto: 'Sin otro particular que mencionar.\nSaludos cordiales.' }),
        b('firma', { titulo: 'Atentamente', texto: 'Espacio para firma electrónica', nombre: 'Victor Ricardo Lopez Cordonez', cargo: 'Director Ejecutivo', alinear: 'centro' }),
      ],
    },
    secciones: { equipos_garantia: 'Tabla de equipos en garantía', cronograma: 'Cronograma de mantenimiento (cada 6 meses)' },
    variables: { ...VARS_CLIENTE, factura: 'Número de factura', garantia: 'Tiempo de garantía', condicion_mantenimiento: 'Condición 3 (cambia si hay mantenimientos)' },
  },
  {
    codigo: 'anexo_series', nombre: 'Anexo de números de serie', desc: 'Hoja para pegar los stickers de serie (opcional, al final del acta).', conLugar: true,
    base: {
      titulo: 'Anexo /', titulo2: 'Números de serie', lugar: 'Quito',
      bloques: [b('texto', { texto: 'En este anexo se colocarán los stickers correspondientes a los números de serie de los equipos entregados.' }), sec('series', 'Detalle de Series')],
    },
    secciones: { series: 'Tabla para pegar los stickers' },
    variables: { ...VARS_CLIENTE, factura: 'Número de factura' },
  },
  {
    codigo: 'guia_despacho', nombre: 'Guía de despacho', desc: 'Sale de Facturación con el QR de seguimiento; la firman Bodega, Logística y el cliente.',
    base: { titulo: 'Guía de despacho', bloques: [sec('datos'), sec('productos'), sec('observaciones', 'Observaciones generales'), sec('firmas')] },
    secciones: { datos: 'Datos del cliente y de entrega', productos: 'Tabla de productos', observaciones: 'Observaciones generales (si hay)', firmas: 'Firmas: Bodega, Logística y cliente' },
    variables: { ...VARS_CLIENTE, guia: 'Número de guía', factura: 'Número de factura', asesor: 'Asesor', direccion: 'Dirección de entrega', ciudad: 'Ciudad', recibe: 'Quién recibe', telefono: 'Teléfono', enlace: 'Enlace de seguimiento' },
  },
  {
    codigo: 'constancia_entrega', nombre: 'Constancia de entrega', desc: 'Logística la descarga cuando el cliente recibe el pedido (con su firma).',
    base: {
      titulo: 'Constancia de entrega',
      bloques: [sec('datos'), sec('productos'), sec('recepcion'), b('texto', { texto: 'Entregado por {entregado_por}. El cliente declara recibir los productos detallados en buen estado.', tamano: 10 })],
    },
    secciones: { datos: 'Cliente, factura, dirección y modalidad', productos: 'Tabla de productos y series', recepcion: 'Quién recibió, fecha, ubicación y firma' },
    variables: { ...VARS_CLIENTE, numero: 'Código de la entrega', factura: 'Número de factura', entregado_por: 'Quién entregó', recibio: 'Quién recibió' },
  },
]
export const DOC = (codigo: string) => DOCS.find((d) => d.codigo === codigo)

/* ---------------------------------------------------------------- Carga y caché */
let guardadas: Record<string, unknown> = {}
let cargadoEn = 0
let cargando: Promise<void> | null = null
const borradores: Record<string, Plantilla | null> = {}

/** Lee las plantillas guardadas (cada 60 s como mucho). Sin sesión o sin conexión se quedan los diseños por defecto. */
export function cargarPlantillas(forzar = false): Promise<void> {
  if (!forzar && Date.now() - cargadoEn < 60000) return Promise.resolve()
  if (cargando && !forzar) return cargando
  cargando = (async () => {
    try {
      const { data, error } = await supabase.from('plantillas_documento').select('codigo,contenido').is('deleted_at', null)
      if (error) return
      guardadas = Object.fromEntries(((data as { codigo: string; contenido: unknown }[]) ?? []).map((f) => [f.codigo, f.contenido]))
      fijarMarca((guardadas.general as Partial<MarcaDoc>) ?? null)
      cargadoEn = Date.now()
    } catch { /* sin conexión: diseños por defecto */ } finally { cargando = null }
  })()
  return cargando
}

/** Una plantilla guardada, completada con lo que el sistema necesita (secciones nuevas se agregan al final). */
export function normalizar(def: DefDoc, p: Partial<Plantilla> | null | undefined): Plantilla {
  if (!p || !Array.isArray(p.bloques)) return clonar(def.base)
  const vistos = new Set<string>()
  const bloques = (p.bloques as Bloque[]).filter((x) => {
    if (!x || typeof x !== 'object' || !x.tipo) return false
    if (x.tipo !== 'seccion') return true
    if (!x.clave || !def.secciones[x.clave] || vistos.has(x.clave)) return false
    vistos.add(x.clave); return true
  }).map((x, i) => ({ ...x, id: x.id || 'g' + i, visible: x.visible !== false }))
  for (const s of def.base.bloques) if (s.tipo === 'seccion' && s.clave && !vistos.has(s.clave)) bloques.push({ ...s })
  return { titulo: typeof p.titulo === 'string' ? p.titulo : def.base.titulo, titulo2: typeof p.titulo2 === 'string' ? p.titulo2 : def.base.titulo2, lugar: typeof p.lugar === 'string' ? p.lugar : def.base.lugar, bloques }
}
export const clonar = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** La plantilla con la que se arma un documento (la del editor si se está previsualizando). */
export function plantillaDe(codigo: string): Plantilla {
  const def = DOC(codigo)
  if (!def) return { titulo: '', bloques: [] }
  return borradores[codigo] ?? normalizar(def, guardadas[codigo] as Partial<Plantilla> | undefined)
}
/** Vista previa: arma un documento con una plantilla sin guardar. */
export function conBorrador<T>(codigo: string, p: Plantilla | null, fn: () => T): T {
  const antes = borradores[codigo] ?? null; borradores[codigo] = p
  try { return fn() } finally { borradores[codigo] = antes }
}
export const guardadaDe = (codigo: string): unknown => guardadas[codigo]
export function marcaGuardada(): MarcaDoc { return { ...MARCA_DEF, ...((guardadas.general as Partial<MarcaDoc>) ?? {}) } }

/* ---------------------------------------------------------------- Armado */
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Texto de una plantilla → HTML: escapa, **negrita**, saltos de línea y {variables} (sus valores ya vienen en HTML). */
export function formatear(texto: string, vars: Record<string, string>): string {
  return esc(texto)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
    .replace(/\r?\n/g, '<br>')
}
const alin = (a?: Alinear) => (a === 'centro' ? 'center' : a === 'derecha' ? 'right' : 'left')

export type Armado = {
  /** Contenido de cada sección del sistema; recibe el título que se le puso en la plantilla. */
  secciones: Record<string, (titulo: string) => string>
  /** Valores de las variables, YA en HTML (escapados). */
  vars: Record<string, string>
  /** Cómo se ve el título de un bloque de texto en ese documento. */
  tituloSeccion: (t: string) => string
  /** Tamaño de letra base de los textos (px). */
  letra?: number
}
export function armarBloques(p: Plantilla, a: Armado): string {
  return p.bloques.filter((x) => x.visible).map((x) => {
    switch (x.tipo) {
      case 'seccion': return x.clave && a.secciones[x.clave] ? a.secciones[x.clave](x.titulo ?? '') : ''
      case 'texto': {
        const t = (x.titulo ? a.tituloSeccion(formatear(x.titulo, a.vars)) : '')
        const cuerpo = x.texto ? `<div style="margin:0 0 10px;text-align:${alin(x.alinear)};line-height:1.55;font-size:${x.tamano || a.letra || 11}px">${formatear(x.texto, a.vars)}</div>` : ''
        return t + cuerpo
      }
      case 'imagen': return x.url ? `<div style="text-align:${alin(x.alinear ?? 'centro')};margin:10px 0;break-inside:avoid;page-break-inside:avoid"><img src="${esc(x.url)}" alt="" style="max-width:${Math.min(100, Math.max(5, x.ancho || 40))}%;height:auto"></div>` : ''
      case 'linea': return '<div style="border-top:1px solid #cbd5e1;margin:12px 0"></div>'
      case 'espacio': return `<div style="height:${Math.min(400, Math.max(4, x.alto || 24))}px"></div>`
      case 'firma': {
        const caja = x.texto ? `<div style="border:1px dashed #e2e8f0;border-radius:8px;padding:30px 10px;margin:8px auto;width:240px;color:#cbd5e1;font-size:9.5px;text-align:center">${formatear(x.texto, a.vars)}</div>` : '<div style="height:54px"></div>'
        return `<div style="text-align:${alin(x.alinear ?? 'centro')};margin:18px 0 8px;break-inside:avoid;page-break-inside:avoid"><div style="display:inline-block;min-width:240px;text-align:center;font-size:11px">`
          + (x.titulo ? `<p style="margin:0 0 4px">${formatear(x.titulo, a.vars)}</p>` : '') + caja
          + `<div style="${x.texto ? '' : 'border-top:1px solid #334155;'}padding-top:4px"><strong>${formatear(x.nombre || '', a.vars)}</strong>${x.cargo ? '<br>' + formatear(x.cargo, a.vars) : ''}</div></div></div>`
      }
      default: return ''
    }
  }).join('')
}

/* ---------------------------------------------------------------- Guardar e historial */
export async function guardarPlantilla(codigo: string, nombre: string, contenido: unknown, nota = ''): Promise<number> {
  const { data, error } = await supabase.rpc('plantilla_guardar', { p_codigo: codigo, p_nombre: nombre, p_contenido: contenido, p_nota: nota || null })
  if (error) throw new Error(error.message)
  await cargarPlantillas(true)
  return Number(data) || 0
}
export type Version = { id: string; version: number; created_at: string; nota: string | null; contenido: unknown; autor: { nombre: string } | null }
export async function versionesDe(codigo: string): Promise<Version[]> {
  const { data, error } = await supabase.from('plantillas_documento_versiones').select('id,version,created_at,nota,contenido,autor:empleados!plantillas_versiones_guardado_por_fk(nombre)')
    .eq('codigo', codigo).is('deleted_at', null).order('version', { ascending: false }).limit(30)
  if (error) throw new Error(error.message)
  return (data as unknown as Version[]) ?? []
}
