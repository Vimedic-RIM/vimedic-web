// Correo URGENTE al asesor cuando recibe un cliente potencial de Meta (CorreoLeadsMeta.gs de la app original).
// HTML para correo (tablas y estilos en línea: se ve bien en Gmail, Outlook y el celular). Tres diseños a elegir en
// Marketing › Configuración: 1 Alerta urgente · 2 Ficha del cliente · 3 Oscuro moderno.
// Funciones puras: las usa la Edge Function meta-leads y se prueban sin red.

export const DISENOS_CORREO: Record<number, string> = { 1: 'Alerta urgente', 2: 'Ficha del cliente', 3: 'Oscuro moderno' }

export type DatosCorreoLead = {
  nombre: string; telefono?: string | null; email?: string | null; ciudad?: string | null; respuestas: { t: string; v: string }[]
  red: string; organico: boolean; anuncio?: string | null; campana?: string | null; formulario?: string | null; fecha: string
  idCrm: string; metaId: string; asesor: string; existente: boolean
}

const sinEmojis = (v: unknown) => String(v ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s{2,}/g, ' ').trim()
const e = (v: unknown) => sinEmojis(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const waNumero = (tel: unknown) => { let d = String(tel ?? '').replace(/\D/g, ''); if (/^0\d{9}$/.test(d)) d = '593' + d.slice(1); return d }
const iniciales = (n: string) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x.charAt(0)).join('').toUpperCase() || '?'
const primero = (n: string) => String(n || '').trim().split(/\s+/)[0] || ''

/** Datos listos para el correo (saludo sugerido y enlaces de WhatsApp, llamada, correo y CRM). */
function preparar(d: DatosCorreoLead, crmUrl: string) {
  const area = d.respuestas.find((r) => /area/i.test(r.t.normalize('NFD').replace(/[̀-ͯ]/g, '')))
  const saludo = 'Hola ' + primero(d.nombre) + ', le saluda ' + primero(d.asesor) + ' de VIMEDIC. Recibimos su solicitud' +
    (area ? ' sobre ' + String(area.v).toLowerCase() : '') + '. ¿Le parece si conversamos unos minutos para entender lo que necesita y enviarle una propuesta?'
  const wa = waNumero(d.telefono)
  const f = new Date(d.fecha)
  const fecha = isNaN(+f) ? '' : f.toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric' }) + ' a las ' + f.toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hour12: false })
  return {
    ...d, nombre: sinEmojis(d.nombre) || 'Cliente sin nombre', telefono: d.telefono || '', email: d.email || '', ciudad: d.ciudad || '', anuncio: d.anuncio || '', campana: d.campana || '', formulario: d.formulario || '',
    fecha, saludo, iniciales: iniciales(d.nombre),
    waUrl: wa ? 'https://wa.me/' + wa + '?text=' + encodeURIComponent(saludo) : '',
    telUrl: d.telefono ? 'tel:' + String(d.telefono).replace(/[^\d+]/g, '') : '',
    mailUrl: d.email ? 'mailto:' + d.email + '?subject=' + encodeURIComponent('VIMEDIC · Su solicitud de información') : '',
    crmUrl,
  }
}

/** Correo del asesor en el diseño elegido. logos = URL de las imágenes (cid: en el correo, data: en la vista previa). */
export function correoLeadAsesor(d: DatosCorreoLead, diseno: number, crmUrl: string, logos = { color: 'cid:vmlogo', blanco: 'cid:vmlogoblanco' }): { asunto: string; html: string; texto: string } {
  const x = preparar(d, crmUrl), F = 'font-family:Arial,Helvetica,sans-serif;'
  const boton = (url: string, txt: string, bg: string, color: string, borde?: string) => !url ? '' :
    '<a href="' + e(url) + '" style="display:inline-block;' + F + 'font-size:15px;font-weight:bold;text-decoration:none;color:' + color + ';background:' + bg + ';border:2px solid ' + (borde || bg) + ';padding:13px 22px;border-radius:12px;margin:4px 6px 4px 0">' + txt + '</a>'
  const filaDato = (lbl: string, val: string, url: string, colorLbl: string, colorVal: string, linea: string) => !val ? '' :
    '<tr><td style="padding:11px 0;border-bottom:1px solid ' + linea + ';' + F + 'font-size:12px;color:' + colorLbl + ';width:120px;padding-right:10px;vertical-align:top;text-transform:uppercase;letter-spacing:.5px">' + e(lbl) + '</td>' +
    '<td style="padding:11px 0;border-bottom:1px solid ' + linea + ';' + F + 'font-size:15px;color:' + colorVal + ';font-weight:bold;vertical-align:top">' + (url ? '<a href="' + e(url) + '" style="color:' + colorVal + ';text-decoration:none">' + e(val) + '</a>' : e(val)) + '</td></tr>'
  const origen = (x.organico ? 'Publicación orgánica en ' : 'Anuncio pagado en ') + x.red
  const previa = '<div style="display:none;max-height:0;overflow:hidden;opacity:0">Nuevo cliente potencial: ' + e(x.nombre) + (x.ciudad ? ' · ' + e(x.ciudad) : '') + '. Contáctalo ya por WhatsApp.</div>'
  const envoltura = (fondo: string, interior: string) =>
    '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Nuevo cliente potencial</title></head>' +
    '<body style="margin:0;padding:0;background:' + fondo + '">' + previa +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + fondo + '"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">' + interior + '</table></td></tr></table></body></html>'
  const asunto = 'URGENTE · Nuevo cliente potencial: ' + (x.nombre || 'sin nombre') + (x.ciudad ? ' (' + x.ciudad + ')' : '')
  const texto = 'URGENTE · Nuevo cliente potencial asignado\n\n' + x.nombre + '\nWhatsApp: ' + (x.telefono || '-') + '\nCorreo: ' + (x.email || '-') + '\nCiudad: ' + (x.ciudad || '-') + '\n' +
    x.respuestas.map((r) => r.t + ': ' + r.v).join('\n') + '\nOrigen: ' + (x.organico ? 'orgánico ' : 'anuncio ') + x.red + (x.anuncio ? ' · ' + x.anuncio : '') +
    '\n\nWhatsApp directo: ' + (x.waUrl || '-') + '\nCRM: ' + x.crmUrl + ' (gestión ' + x.idCrm + ')\n\nSaludo sugerido: ' + x.saludo
  let html: string

  if (diseno === 2) {
    // ───── 2 · Ficha del cliente (blanco, limpio, con pasos)
    const chips = x.respuestas.map((r) => '<td style="padding:0 8px 8px 0;vertical-align:top"><div style="background:#eef6fd;border:1px solid #cfe3f5;border-radius:12px;padding:10px 12px"><div style="' + F + 'font-size:11px;color:#5b7894;text-transform:uppercase;letter-spacing:.4px">' + e(r.t) + '</div><div style="' + F + 'font-size:15px;font-weight:bold;color:#0b2545;margin-top:3px">' + e(r.v) + '</div></div></td>')
    let filasChips = ''; for (let i = 0; i < chips.length; i += 2) filasChips += '<tr>' + chips[i] + (chips[i + 1] || '<td></td>') + '</tr>'
    const dato2 = (lbl: string, val: string, url = '') => val ? '<td width="50%" style="padding:0 10px 14px 0;vertical-align:top"><div style="' + F + 'font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px">' + lbl + '</div><div style="' + F + 'font-size:15px;font-weight:bold;color:#1e293b;margin-top:3px">' + (url ? '<a href="' + e(url) + '" style="color:#055c9d;text-decoration:none">' + e(val) + '</a>' : e(val)) + '</div></td>' : '<td width="50%"></td>'
    const paso = (n: number, t: string, s: string) => '<tr><td style="width:34px;vertical-align:top;padding:0 0 12px"><div style="width:26px;height:26px;border-radius:13px;background:#055c9d;color:#ffffff;' + F + 'font-size:13px;font-weight:bold;text-align:center;line-height:26px">' + n + '</div></td><td style="padding:2px 0 12px;' + F + 'font-size:14px;color:#1e293b"><b>' + t + '</b><br><span style="font-size:12.5px;color:#64748b">' + s + '</span></td></tr>'
    html = envoltura('#f4f6f9',
      '<tr><td style="padding:0 4px 14px;' + F + 'font-size:13px;color:#64748b"><img src="' + logos.color + '" width="130" alt="VIMEDIC" style="display:inline-block;width:130px;height:auto;border:0;vertical-align:middle"> &nbsp;·&nbsp; CRM &nbsp;·&nbsp; ' + e(x.fecha) + '</td></tr>' +
      '<tr><td style="background:#ffffff;border-radius:18px;border-top:6px solid #f59e0b;padding:26px 28px;box-shadow:0 8px 24px rgba(11,37,69,.08)">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><span style="display:inline-block;background:#fef3c7;color:#92400e;' + F + 'font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px">Nuevo cliente potencial · prioridad alta</span></td></tr></table>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr>' +
          '<td style="width:68px;vertical-align:middle"><div style="width:58px;height:58px;border-radius:29px;background:#055c9d;color:#ffffff;' + F + 'font-size:22px;font-weight:bold;text-align:center;line-height:58px">' + e(x.iniciales) + '</div></td>' +
          '<td style="vertical-align:middle"><div style="' + F + 'font-size:24px;font-weight:bold;color:#0b2545;line-height:1.2">' + e(x.nombre) + '</div><div style="' + F + 'font-size:13.5px;color:#64748b;margin-top:4px">' + (x.ciudad ? e(x.ciudad) + ' · ' : '') + e(origen) + '</div></td></tr></table>' +
        (x.existente ? '<p style="margin:14px 0 0;' + F + 'font-size:13px;color:#92400e">Ya es tu cliente: se te asignó por ser su asesor.</p>' : '') +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px"><tr>' + dato2('WhatsApp', x.telefono, x.waUrl) + dato2('Correo', x.email, x.mailUrl) + '</tr><tr>' + dato2('Ciudad', x.ciudad) + dato2('Asignado a', x.asesor) + '</tr></table>' +
        (filasChips ? '<div style="' + F + 'font-size:12px;font-weight:bold;color:#0b2545;margin:6px 0 10px">Respuestas del formulario</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + filasChips + '</table>' : '') +
        '<div style="margin-top:12px">' + boton(x.waUrl, 'Escribir por WhatsApp', '#16a34a', '#ffffff') + boton(x.telUrl, 'Llamar ahora', '#055c9d', '#ffffff') + '</div></td></tr>' +
      '<tr><td style="padding:16px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px"><tr><td style="padding:22px 28px">' +
        '<div style="' + F + 'font-size:14px;font-weight:bold;color:#0b2545;margin-bottom:12px">Próximos pasos</div><table role="presentation" cellpadding="0" cellspacing="0">' +
        paso(1, 'Escríbele en los próximos 5 minutos', 'El botón de WhatsApp abre el chat con el saludo listo.') + paso(2, 'Registra el contacto en el CRM', 'Mueve la gestión ' + e(x.idCrm) + ' a «Contactado» y anota lo que necesita.') + paso(3, 'Envía la proforma', 'Con los equipos que pidió; agenda el seguimiento.') +
        '</table><div style="margin-top:6px;padding:12px 14px;background:#f8fafc;border-radius:10px;' + F + 'font-size:13px;line-height:1.5;color:#334155"><b>Saludo sugerido:</b> ' + e(x.saludo) + '</div>' +
        '<div style="margin-top:14px">' + boton(x.crmUrl, 'Abrir el CRM', '#ffffff', '#055c9d', '#9cc3e4') + '</div></td></tr></table></td></tr>' +
      '<tr><td style="padding:16px 6px;' + F + 'font-size:11px;line-height:1.6;color:#94a3b8;text-align:center">' + (x.anuncio ? 'Anuncio: ' + e(x.anuncio) + ' · ' : '') + (x.campana ? 'Campaña: ' + e(x.campana) + ' · ' : '') + 'Lead de Meta ' + e(x.metaId) + '<br>Asignado automáticamente con reparto justo · VIMEDIC CRM</td></tr>')
  } else if (diseno === 3) {
    // ───── 3 · Oscuro moderno (azul noche + celeste)
    const resp3 = x.respuestas.map((r) => filaDato(r.t, r.v, '', '#7f93b2', '#ffffff', '#24305e')).join('')
    html = envoltura('#0d1330',
      '<tr><td style="padding:0 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="' + logos.blanco + '" width="150" alt="VIMEDIC" style="display:block;width:150px;height:auto;border:0"></td>' +
        '<td align="right"><span style="display:inline-block;background:#ff4d4f;color:#ffffff;' + F + 'font-size:12px;font-weight:bold;padding:6px 12px;border-radius:999px">LEAD CALIENTE</span></td></tr></table></td></tr>' +
      '<tr><td style="background:#1d2344;border:1px solid #2c3670;border-radius:20px;padding:28px">' +
        '<p style="margin:0;' + F + 'font-size:13px;color:#36a9e1;font-weight:bold;letter-spacing:1px">NUEVO CLIENTE POTENCIAL ASIGNADO A ' + e(String(x.asesor).toUpperCase()) + '</p>' +
        '<p style="margin:10px 0 0;' + F + 'font-size:32px;line-height:1.1;font-weight:bold;color:#ffffff">' + e(x.nombre) + '</p>' +
        '<p style="margin:10px 0 0;' + F + 'font-size:14px;color:#a9b7d6">' + e(x.fecha) + ' · ' + e(origen) + '</p>' +
        (x.existente ? '<p style="margin:12px 0 0;' + F + 'font-size:13px;color:#fcd34d">Ya es tu cliente: se te asignó por ser su asesor.</p>' : '') +
        '<div style="margin-top:20px">' + boton(x.waUrl, 'WhatsApp', '#25d366', '#0b2e1a') + boton(x.telUrl, 'Llamar', '#36a9e1', '#0b1a33') + boton(x.mailUrl, 'Correo', '#1d2344', '#ffffff', '#4a5a99') + '</div>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">' +
          filaDato('WhatsApp', x.telefono, x.waUrl, '#7f93b2', '#4ade80', '#24305e') + filaDato('Correo', x.email, x.mailUrl, '#7f93b2', '#7cc9ef', '#24305e') +
          filaDato('Ciudad', x.ciudad, '', '#7f93b2', '#ffffff', '#24305e') + resp3 + '</table></td></tr>' +
      '<tr><td style="padding:16px 0 0"><div style="background:#151b3d;border:1px dashed #36a9e1;border-radius:16px;padding:18px 20px">' +
        '<p style="margin:0 0 6px;' + F + 'font-size:12px;color:#36a9e1;font-weight:bold;letter-spacing:1px">MENSAJE LISTO PARA ENVIAR</p>' +
        '<p style="margin:0;' + F + 'font-size:14px;line-height:1.55;color:#e2e8f0">' + e(x.saludo) + '</p></div></td></tr>' +
      '<tr><td style="padding:18px 0 0;text-align:center">' + boton(x.crmUrl, 'Abrir en el CRM', '#ffffff', '#1d2344') + '</td></tr>' +
      '<tr><td style="padding:18px 0 0;' + F + 'font-size:11px;line-height:1.6;color:#6b7aa6;text-align:center">' + (x.anuncio ? 'Anuncio: ' + e(x.anuncio) + ' · ' : '') + (x.campana ? 'Campaña: ' + e(x.campana) + '<br>' : '') +
        'CRM ' + e(x.idCrm) + ' · Meta ' + e(x.metaId) + ' · Reparto justo automático</td></tr>')
  } else {
    // ───── 1 · Alerta urgente (rojo + azul VIMEDIC)
    const resp1 = x.respuestas.map((r) => '<tr><td style="padding:9px 14px;' + F + 'font-size:12px;color:#64748b;background:#f8fafc;border-bottom:1px solid #eef2f6;width:45%">' + e(r.t) + '</td><td style="padding:9px 14px;' + F + 'font-size:14px;font-weight:bold;color:#0b2545;border-bottom:1px solid #eef2f6">' + e(r.v) + '</td></tr>').join('')
    html = envoltura('#eef2f7',
      '<tr><td style="background:#d92d20;border-radius:16px 16px 0 0;padding:12px 24px;' + F + 'font-size:13px;font-weight:bold;color:#ffffff;letter-spacing:.6px;text-align:center">URGENTE · CONTÁCTALO EN LOS PRÓXIMOS 5 MINUTOS</td></tr>' +
      '<tr><td style="background:#0b2545;background:linear-gradient(135deg,#0b2545,#055c9d);padding:26px 28px">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><img src="' + logos.blanco + '" width="190" alt="VIMEDIC" style="display:block;width:190px;height:auto;border:0"></td>' +
        '<td align="right" style="' + F + 'font-size:12px;color:#bcd3ea">' + e(x.fecha) + '</td></tr></table>' +
        '<p style="margin:18px 0 4px;' + F + 'font-size:14px;color:#9cc3e4">Hola ' + e(primero(x.asesor)) + ', se te asignó un nuevo cliente potencial</p>' +
        '<p style="margin:0;' + F + 'font-size:30px;line-height:1.15;font-weight:bold;color:#ffffff">' + e(x.nombre) + '</p>' +
        '<p style="margin:8px 0 0;' + F + 'font-size:14px;color:#d6e6f5">' + (x.ciudad ? e(x.ciudad) + ' &nbsp;·&nbsp; ' : '') + e(origen) + '</p></td></tr>' +
      '<tr><td style="background:#ffffff;padding:22px 28px 6px">' +
        boton(x.waUrl, 'Escribir por WhatsApp', '#16a34a', '#ffffff') + boton(x.telUrl, 'Llamar', '#ffffff', '#0b2545', '#cbd5e1') + boton(x.mailUrl, 'Correo', '#ffffff', '#0b2545', '#cbd5e1') +
        (x.existente ? '<p style="margin:12px 0 0;padding:10px 14px;background:#fff7e6;border-radius:10px;' + F + 'font-size:13px;color:#92400e">Ya es cliente: te lo asignamos porque eres su asesor.</p>' : '') + '</td></tr>' +
      '<tr><td style="background:#ffffff;padding:8px 28px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
        filaDato('Nombre', x.nombre, '', '#64748b', '#0b2545', '#eef2f6') + filaDato('WhatsApp', x.telefono, x.waUrl, '#64748b', '#16a34a', '#eef2f6') +
        filaDato('Correo', x.email, x.mailUrl, '#64748b', '#055c9d', '#eef2f6') + filaDato('Ciudad', x.ciudad, '', '#64748b', '#0b2545', '#eef2f6') + '</table></td></tr>' +
      (resp1 ? '<tr><td style="background:#ffffff;padding:16px 28px 4px"><p style="margin:0 0 8px;' + F + 'font-size:12px;font-weight:bold;color:#055c9d;letter-spacing:.6px">LO QUE NOS CONTÓ EN EL FORMULARIO</p>' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef2f6;border-radius:10px;border-collapse:separate;overflow:hidden">' + resp1 + '</table></td></tr>' : '') +
      '<tr><td style="background:#ffffff;padding:18px 28px"><p style="margin:0 0 6px;' + F + 'font-size:12px;font-weight:bold;color:#055c9d;letter-spacing:.6px">MENSAJE SUGERIDO</p>' +
        '<p style="margin:0;padding:14px 16px;background:#f0fdf4;border-left:4px solid #16a34a;border-radius:8px;' + F + 'font-size:14px;line-height:1.5;color:#14532d">' + e(x.saludo) + '</p></td></tr>' +
      '<tr><td style="background:#ffffff;padding:4px 28px 24px">' + boton(x.crmUrl, 'Abrir en el CRM', '#0b2545', '#ffffff') + '</td></tr>' +
      '<tr><td style="background:#f8fafc;border-radius:0 0 16px 16px;padding:16px 28px;' + F + 'font-size:11.5px;line-height:1.6;color:#64748b">' +
        (x.anuncio ? 'Anuncio: <b>' + e(x.anuncio) + '</b><br>' : '') + (x.campana ? 'Campaña: ' + e(x.campana) + '<br>' : '') + (x.formulario ? 'Formulario: ' + e(x.formulario) + '<br>' : '') +
        'Gestión en el CRM: <b>' + e(x.idCrm) + '</b> · Lead de Meta: ' + e(x.metaId) + '<br>Asignado automáticamente con reparto justo entre asesores.</td></tr>')
  }
  return { asunto, html, texto }
}

/** Ejemplo para «Ver los diseños» y el correo de prueba (metaCorreoEjemplo_ del original). */
export function ejemploCorreoLead(asesor: string): DatosCorreoLead {
  return {
    nombre: 'María José Pérez', telefono: '0987111111', email: 'mariajose.perez@clinicasanmarcos.ec', ciudad: 'Quito',
    respuestas: [{ t: 'Área a equipar', v: 'Equipamiento de quirófano' }, { t: 'Tipo de establecimiento', v: 'Clínica privada' }],
    red: 'Instagram', organico: false, anuncio: 'Quirófano completo · Octubre', campana: 'Campaña Equipamiento Q4', formulario: 'Vimedic | Contacto con asesor',
    fecha: new Date().toISOString(), idCrm: 'META-1388719543026186', metaId: '1388719543026186', asesor: asesor || 'Diego Coronado', existente: false,
  }
}

/* ---------------- Mensaje MIME para la Gmail API (HTML + texto + logos adjuntos dentro del correo) ---------------- */
const b64 = (s: string) => { const bytes = new TextEncoder().encode(s); let t = ''; for (let i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(t) }
const lineas76 = (s: string) => s.replace(/(.{76})/g, '$1\r\n')
const encabezado = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?='
/** Mensaje listo para users.messages.send (base64url). */
export function mensajeGmail(o: { de: string; nombreDe: string; para: string; cc?: string; asunto: string; html: string; texto: string; imagenes: { cid: string; nombre: string; png: string }[] }): string {
  const R = 'vmR' + crypto.randomUUID().replace(/-/g, ''), A = 'vmA' + crypto.randomUUID().replace(/-/g, '')
  const partes = [
    'From: ' + encabezado(o.nombreDe) + ' <' + o.de + '>', 'To: ' + o.para, ...(o.cc ? ['Cc: ' + o.cc] : []), 'Subject: ' + encabezado(o.asunto),
    'MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="' + R + '"', '',
    '--' + R, 'Content-Type: multipart/alternative; boundary="' + A + '"', '',
    '--' + A, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', lineas76(b64(o.texto)),
    '--' + A, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', lineas76(b64(o.html)),
    '--' + A + '--',
    ...o.imagenes.flatMap((im) => ['--' + R, 'Content-Type: image/png; name="' + im.nombre + '"', 'Content-Transfer-Encoding: base64', 'Content-ID: <' + im.cid + '>', 'Content-Disposition: inline; filename="' + im.nombre + '"', '', lineas76(im.png)]),
    '--' + R + '--', '',
  ]
  return btoa(partes.join('\r\n')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
