// Leads: Contactos (actualizaciones) y LeadsWhatsApp (nuevos y actualizaciones). Los de Meta ya están como contactos (ID CRM).
const { deducidas, auto, procesar, informe, L, fs } = require('./x3_motor.cjs')
const T = 'leads'
const ATR_WA = { 11: 'origen', 12: 'utm_source', 13: 'utm_medium', 14: 'utm_campaign', 15: 'utm_content', 16: 'utm_term', 17: 'fbclid', 18: 'ttclid', 19: 'gclid', 20: 'wbraid', 21: 'gbraid', 22: 'epik', 23: 'landing_url', 24: 'referrer', 25: 'producto_id', 26: 'producto_nombre', 27: 'producto_categoria', 28: 'event_id', 29: 'campana_id', 30: 'grupo_anuncios_id', 31: 'anuncio_id', 32: 'producto_url', 33: 'conversion_url', 34: 'fecha_contacto_publicitario', 35: 'fecha_conversion_utc', 36: 'canal_conversion', 37: 'tipo_conversion', 38: 'contexto_producto', 40: 'primer_contacto_json', 41: 'ultima_campana_json', 42: 'version_atribucion', 43: 'estado_atribucion' }
const atr = (f, mapa) => { const o = {}; for (const [i, k] of Object.entries(mapa)) { const v = L.aTexto(f[+i]); if (v) o[k] = v } return o }
const estado = (v) => { const s = L.aTexto(v); return s === 'Eliminado' ? 'Perdido' : s === 'Sin Contestar' ? 'Sin Respuesta' : s || 'Nuevo' }
const ACT = ['estado_crm', 'ultima_actividad', 'proximo_seguimiento', 'asesor_id', 'nombre', 'email', 'telefono', 'ciudad', 'interes', 'contesto', 'medio_captacion', 'identificacion']
const res = {}
// Contactos
{
  const base = deducidas(T, 52, ['leads_contactos'], ['estado_crm'])
  res.contactos = procesar({
    tabla: T, idCol: 0, muestras: ['leads_contactos'], hojas: [{ n: 52 }], noVaciar: true,
    saltar: (f, x, prev) => !prev,   // los contactos que faltan ya se revisaron: no hay nuevos
    cols: { ...auto(T, base), estado_crm: (f) => estado(f[8]), asesor_id: (f) => L.empleado(f[7]) },
    actualizar: ACT,
  })
  informe('leads · contactos', res.contactos)
}
// WhatsApp
{
  const base = deducidas(T, 67, ['leads_wa'], ['estado_crm'])
  res.wa = procesar({
    tabla: T, idCol: 0, muestras: ['leads_wa'], hojas: [{ n: 67 }], noVaciar: true,
    cols: { ...auto(T, base), estado_crm: (f) => estado(f[7]), asesor_id: (f) => L.empleado(f[6]), ultima_actividad: (f) => L.convertir(T, 'ultima_actividad', f[8]),
      origen_tipo: () => 'whatsapp', empresa: () => 'VIMEDIC', atribucion: (f) => atr(f, ATR_WA), meta_datos: () => ({}),
    },
    actualizar: ACT,
  })
  delete res.wa.val.productos_solicitados
  for (const n of res.wa.nuevos) delete n.productos_solicitados
  informe('leads · whatsapp', res.wa)
}
// Si en pruebas hubo actividad más reciente que en la hoja (pruebas en qa), no se pisa
for (const k of ['contactos', 'wa']) res[k].cambios = res[k].cambios.filter((c) => !(c.antes.ultima_actividad && c.cambios.ultima_actividad && Date.parse(c.antes.ultima_actividad) > Date.parse(c.cambios.ultima_actividad)))
const r = { nuevos: [...res.contactos.nuevos, ...res.wa.nuevos], cambios: [...res.contactos.cambios, ...res.wa.cambios] }
for (const c of r.cambios) console.log(' ', c.codigo, JSON.stringify(c.antes).slice(0, 100), '→', JSON.stringify(c.cambios).slice(0, 100))
for (const n of r.nuevos) console.log(' NUEVO', n.codigo, n.nombre, n.telefono, n.estado_crm, !!n.asesor_id)
fs.writeFileSync(L.S + '/x3_out_leads.json', JSON.stringify(r))
