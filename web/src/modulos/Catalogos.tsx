import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import qrcode from 'qrcode-generator'
import { supabase, type Perfil } from '../supabase'
import { imagen } from './Inventario'
import { LOGO_BLANCO, LOGO_COLOR, LOGO_RATIO } from '../catalogoAssets'
import { htmlCatalogo } from '../catalogoHtml'
import '../estilos/catalogos.css'

/* ============================ Constantes (idénticas a catalogo-pdf.js) ============================ */
const POR_PAGINA = 6
const NAVY = '#1d2344', ACC = '#36a9e1', PANEL = '#283063', BORDE = '#3a4478', SUAVE = '#c9cfe6', VERDE = '#0f7a3f'
const PREF = 'vm_catalogo_sel_v1'
const WEB = 'vimedic.com.ec'
const LEMA = 'Equipos médicos con respaldo técnico, garantía y entrega en todo el Ecuador.'

type Prod = { id: string; n: string; det: string; pvp: number; iva: boolean; foto: string; link: string }
type Seg = { nombre: string; productos: Prod[] }
type Asesor = { nombre: string; whatsapp: string }
type Cfg = { formato: 'digital' | 'impreso'; precios: boolean; contra: boolean; cliente: string; asesor: Asesor }

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const pad = (n: number) => (n < 10 ? '0' : '') + n
const norm = (s: unknown) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const limpio = (s: unknown) => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '').replace(/\s+/g, ' ').trim()
const precio = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cortaPalabras = (s: string, n: number) => { s = String(s || '').trim(); if (s.length <= n) return s; const c = s.slice(0, n), k = c.lastIndexOf(' '); return (k > n * 0.6 ? c.slice(0, k) : c).replace(/[\s,.;:–-]+$/, '') + '…' }
function waNum(t: string) { let s = String(t || '').replace(/\D/g, ''); if (!s) return ''; if (s.indexOf('593') === 0) return s; if (s.charAt(0) === '0') s = s.slice(1); return s.length === 9 ? '593' + s : s }
const waVer = (n: string) => (n.length === 12 && n.indexOf('593') === 0 ? '+593 ' + n.slice(3, 5) + ' ' + n.slice(5, 8) + ' ' + n.slice(8) : '+' + n)
const waLink = (a: Asesor, msg: string) => { const n = waNum(a.whatsapp); return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg) : '' }

/* Íconos como imagen: se ven igual en pantalla y en el PDF */
const IC: Record<string, string> = {
  foto: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  wa: '<path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.9 11.89L4 20l4.2-1.1a7.93 7.93 0 0 0 3.8 1h.05a7.94 7.94 0 0 0 5.55-13.58zM12.05 18.4h-.03a6.55 6.55 0 0 1-3.34-.92l-.24-.14-2.5.66.67-2.44-.16-.25a6.56 6.56 0 0 1 10.24-8.05 6.5 6.5 0 0 1 1.92 4.63 6.58 6.58 0 0 1-6.56 6.51zm3.6-4.9c-.2-.1-1.17-.58-1.35-.64s-.32-.1-.45.1-.5.64-.62.77-.24.15-.44.05a5.4 5.4 0 0 1-1.59-.98 6 6 0 0 1-1.1-1.37c-.12-.2 0-.3.09-.4.09-.1.2-.24.3-.36a1.4 1.4 0 0 0 .2-.33.37.37 0 0 0 0-.35c-.05-.1-.45-1.08-.62-1.48-.16-.39-.33-.34-.45-.34h-.38a.73.73 0 0 0-.53.25 2.2 2.2 0 0 0-.69 1.64 3.86 3.86 0 0 0 .81 2.03 8.8 8.8 0 0 0 3.38 3 8.9 8.9 0 0 0 1.2.45 2.9 2.9 0 0 0 1.34.08 2.2 2.2 0 0 0 1.44-1.02 1.8 1.8 0 0 0 .12-1.02c-.05-.09-.18-.14-.38-.24z"/>',
  ext: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6"/><path d="M9 15l3 3 3-3"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  bajar: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
}
function icUrl(n: string, color: string, sw = 2) {
  const s = n === 'wa'
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="2.5 2.5 19 19" fill="${color}">${IC[n]}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${IC[n]}</svg>`
  return 'data:image/svg+xml;base64,' + btoa(s)
}
const ic = (n: string, color: string, px: number, sw?: number) => `<img alt="" src="${icUrl(n, color, sw)}" style="width:${px}px;height:${px}px;display:block;flex-shrink:0">`
const logo = (blanco: boolean, alto: number) => `<img alt="VIMEDIC" src="${blanco ? LOGO_BLANCO : LOGO_COLOR}" style="height:${alto}px;width:${Math.round(alto * LOGO_RATIO)}px;display:block">`
function qrBox(texto: string, px: number) {
  try { const q = qrcode(0, 'M'); q.addData(texto); q.make(); return `<img alt="" src="${q.createDataURL(6, 2)}" style="width:${px}px;height:${px}px;display:block">` } catch { return '' }
}
const ICON = (n: string) => n
const boton = (o: { href?: string; texto: string; fondo: string; color: string; icono?: string; iconoDer?: boolean; alto?: number; fs?: number; borde?: string; ancho?: boolean; mayus?: boolean; ls?: number; pad?: number }) => {
  const h = o.alto || 36, isz = o.icono ? Math.round(h * (o.icono === 'wa' ? 0.5 : 0.42)) : 0
  const icono = o.icono ? ic(ICON(o.icono), o.color, isz, 2.4) : ''
  const cuerpo = `<span style="font-size:${o.fs || 13}px;${o.ls ? 'letter-spacing:' + o.ls + 'px;' : ''}${o.mayus ? 'text-transform:uppercase;' : ''}">${esc(o.texto)}</span>`
  const estilo = `height:${h}px;padding:0 ${o.pad || 18}px;background:${o.fondo};color:${o.color};${o.borde ? 'border:1.5px solid ' + o.borde + ';' : ''}${o.ancho ? 'width:100%;' : ''}`
  const interior = o.iconoDer ? cuerpo + icono : icono + cuerpo
  return o.href ? `<a href="${esc(o.href)}" class="vmcp-btn" style="${estilo}">${interior}</a>` : `<div class="vmcp-btn" style="${estilo}">${interior}</div>`
}

/* ============================ Páginas del PDF ============================ */
function bloqueAsesor(c: Cfg) {
  const a = c.asesor, n = waNum(a.whatsapp)
  const link = waLink(a, `Hola ${a.nombre}, revisé el catálogo VIMEDIC y quisiera más información.`)
  if (c.formato === 'impreso') {
    return `<div style="display:flex;align-items:center;gap:14px"><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
      <div style="font-size:12.5px;color:${SUAVE}">Su asesor: <b style="color:#fff">${esc(a.nombre)}</b></div>
      ${n ? `<div style="display:flex;align-items:center;gap:8px">${ic('wa', '#25D366', 22)}<span class="vmcp-s" style="font-size:20px;font-weight:800">${esc(waVer(n))}</span></div>` : ''}
      <div style="font-size:12px;color:${SUAVE}">${WEB}</div></div>${link ? `<div style="background:#fff;border-radius:12px;padding:6px">${qrBox(link, 72)}</div>` : ''}</div>`
  }
  return `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;font-size:13px;color:${SUAVE}"><div>Su asesor: <b style="color:#fff">${esc(a.nombre)}</b></div>
    ${n ? boton({ href: link, texto: 'WhatsApp ' + waVer(n), fondo: '#25D366', color: '#0b2e1a', icono: 'wa', alto: 42, fs: 14 }) : ''}<div>${WEB}</div></div>`
}
function pPortada(segs: Seg[], imgs: Record<string, string>, c: Cfg) {
  const primera = (() => { for (const s of segs) for (const p of s.productos) if (imgs[p.id]) return imgs[p.id]; return '' })()
  const nombres = segs.map((s) => s.nombre), lineas = nombres.slice(0, 4).join(' · ') + (nombres.length > 4 ? ' y más' : '')
  const caja = primera
    ? `<div style="margin:44px 64px 0;flex:1;border-radius:28px;background:#fff;padding:28px;display:flex"><div class="vmcp-phi" style="flex:1;background-image:url('${primera}')"></div></div>`
    : `<div style="margin:44px 64px 0;flex:1;border-radius:28px;background:${PANEL};border:1px solid ${BORDE};display:flex;align-items:center;justify-content:center"><img alt="" src="${LOGO_BLANCO}" style="width:320px;height:${Math.round(320 / LOGO_RATIO)}px"></div>`
  return `<div class="vmcp" style="background:${NAVY};color:#fff">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:52px 64px 0">${logo(true, 40)}<div class="vmcp-k" style="color:${SUAVE}">Catálogo ${new Date().getFullYear()}</div></div>
    <div style="padding:58px 64px 0;display:flex;flex-direction:column;gap:20px"><div style="width:64px;height:6px;border-radius:3px;background:${ACC}"></div>
      <div class="vmcp-s" style="font-weight:700;font-size:68px;line-height:1.05;letter-spacing:-1.5px">Catálogo de equipos médicos</div>
      <div style="font-size:18px;line-height:1.55;color:${SUAVE};max-width:540px">${esc(LEMA)}</div>
      ${c.cliente ? `<div style="align-self:flex-start;display:flex;flex-direction:column;gap:6px;padding:14px 22px;border-radius:16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);max-width:620px"><div class="vmcp-k" style="color:${ACC}">Preparado para</div><div class="vmcp-s" style="font-weight:700;font-size:26px;line-height:1.2">${esc(c.cliente)}</div></div>` : ''}
    </div>${caja}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:24px;padding:28px 64px 40px;background:${NAVY}">
      <div style="display:flex;flex-direction:column;gap:8px;max-width:340px"><div class="vmcp-k" style="color:${ACC}">Segmentos</div><div style="font-size:15px;line-height:1.5;color:#e6e9f5">${esc(lineas)}</div></div>${bloqueAsesor(c)}</div></div>`
}
function tarjeta(p: Prod, imgs: Record<string, string>, alto: number, c: Cfg) {
  const f = imgs[p.id]
  const foto = f ? `<div class="vmcp-ph" style="height:${alto}px"><div class="vmcp-phi" style="background-image:url('${f}')"></div></div>` : `<div class="vmcp-ph v" style="height:${alto}px">${ic('foto', '#8a95b3', 34, 1.4)}</div>`
  const pr = c.precios ? `<div class="vmcp-pr">${p.pvp > 0 ? `<b>${esc(precio(p.pvp))}</b><span>${p.iva ? '+ IVA' : 'IVA 0%'}</span>` : '<span>Consultar precio</span>'}</div>` : ''
  const accion = c.formato === 'impreso'
    ? `<div class="vmcp-qr">${qrBox(p.link, 50)}<div><b>Escanee para ver más</b><span>Fotos, video y ficha técnica</span></div></div>`
    : `<div style="margin-top:10px">${boton({ href: p.link, texto: 'Ver más', fondo: NAVY, color: '#ffffff', icono: 'ext', iconoDer: true, alto: 34, ancho: true, fs: 12.5 })}</div>`
  return `<div class="vmcp-card">${foto}<div class="vmcp-cb"><div class="vmcp-pn" data-fit>${esc(p.n)}</div><div class="vmcp-pm">Cód. ${esc(p.id)}</div><div class="vmcp-pd" data-fit>${esc(p.det)}</div>${pr}${accion}</div></div>`
}
function pSegmento(seg: Seg, num: number, ps: Prod[], parte: number, partes: number, pagina: number, imgs: Record<string, string>, c: Cfg) {
  const a = c.asesor, n = waNum(a.whatsapp), imp = c.formato === 'impreso'
  const link = waLink(a, `Hola ${a.nombre}, vi el catálogo VIMEDIC y me interesa el segmento ${seg.nombre}.`)
  const alto = 214 - (imp ? 24 : 0) - (c.precios ? 20 : 0)
  const contacto = !n ? '' : imp
    ? `<div class="vmcp-wap"><div class="vmcp-wai">${ic('wa', '#ffffff', 28)}</div><div style="flex:1;display:flex;flex-direction:column;gap:1px"><div style="font-size:12px;color:#3c4766">¿Le interesa algún equipo? Escríbale a su asesor <b style="color:${NAVY}">${esc(a.nombre)}</b></div><div class="vmcp-s" style="font-size:23px;font-weight:800">${esc(waVer(n))}</div></div>
       <div style="display:flex;align-items:center;gap:10px"><div style="font-size:10.5px;color:#56607e;text-align:right;line-height:1.3">Escanee para<br>escribirle</div>${qrBox(link, 62)}</div></div>`
    : `<div class="vmcp-wab"><div class="vmcp-wai">${ic('wa', '#ffffff', 28)}</div><div style="flex:1;display:flex;flex-direction:column;gap:3px"><div style="font-weight:700;font-size:14px">¿Le interesa algún equipo de este segmento?</div><div style="font-size:12.5px;color:#3c4766">Escríbale a su asesor <b>${esc(a.nombre)}</b> · ${esc(waVer(n))}</div></div>
       ${boton({ href: link, texto: 'Escribir por WhatsApp', fondo: '#25D366', color: '#0b2e1a', icono: 'wa', alto: 42 })}</div>`
  return `<div class="vmcp" style="background:#f4f6fb">
    <div style="background:${NAVY};color:#fff;padding:30px 44px 24px;display:flex;justify-content:space-between;align-items:flex-end"><div style="display:flex;align-items:flex-end;gap:18px">
      <div class="vmcp-s" style="font-weight:800;font-size:54px;line-height:.9;color:${ACC}">${pad(num)}</div>
      <div style="display:flex;flex-direction:column;gap:6px"><div class="vmcp-k" style="color:${SUAVE}">Segmento${partes > 1 ? ` · ${parte} de ${partes}` : ''}</div>
      <div class="vmcp-s" style="font-size:${seg.nombre.length > 26 ? 24 : 32}px;font-weight:700;letter-spacing:-.5px;max-width:470px;line-height:1.15">${esc(seg.nombre)}</div></div></div>${logo(true, 26)}</div>
    <div class="vmcp-grid" style="padding-top:22px;gap:16px">${ps.map((p) => tarjeta(p, imgs, alto, c)).join('')}</div>
    <div style="flex:1;min-height:12px"></div>${contacto}
    <div class="vmcp-pie"><div>${WEB}</div><div>${esc(seg.nombre)} · <b style="color:${NAVY}">pág. ${pad(pagina)}</b></div></div></div>`
}
function pContra(c: Cfg) {
  const a = c.asesor, n = waNum(a.whatsapp), imp = c.formato === 'impreso'
  const agendar = waLink(a, `Hola ${a.nombre}, quisiera agendar una cita para visitar la sala de exhibición de VIMEDIC.`)
  const sala = { nombre: 'Sala de exhibición', direccion: 'Quito, Ecuador', horario: 'Atención únicamente con cita previa' }
  const acciones = imp
    ? `<div style="display:flex;align-items:center;gap:14px;margin-top:12px">${n ? `<div style="flex:1;display:flex;flex-direction:column;gap:2px"><div style="font-size:11.5px;color:${SUAVE}">Agende su cita por WhatsApp</div><div style="display:flex;align-items:center;gap:8px">${ic('wa', '#25D366', 20)}<span class="vmcp-s" style="font-size:19px;font-weight:800;color:#fff">${esc(waVer(n))}</span></div></div>` : '<div style="flex:1"></div>'}${agendar ? `<div style="background:#fff;border-radius:8px;padding:4px">${qrBox(agendar, 56)}</div>` : ''}</div>`
    : `<div style="display:flex;gap:12px;margin-top:14px;flex-wrap:wrap">${agendar ? boton({ href: agendar, texto: 'Agendar mi cita', fondo: '#25D366', color: '#0b2e1a', icono: 'wa', alto: 42 }) : ''}</div>`
  return `<div class="vmcp" style="background:${NAVY};color:#fff">
    <div style="height:380px;background:${PANEL};border-bottom:1px solid ${BORDE};display:flex;align-items:center;justify-content:center">${ic('pin', '#8f9acb', 90, 1.1)}</div>
    <div style="padding:34px 64px 0;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex">${boton({ texto: 'Solo con cita previa', mayus: true, ls: 2, fondo: 'transparent', color: ACC, borde: ACC, icono: 'cal', alto: 30, fs: 11, pad: 14 })}</div>
      <div class="vmcp-s" style="font-weight:700;font-size:46px;line-height:1.08;letter-spacing:-1px">Reserve su visita a nuestra sala de exhibición</div>
      <div style="font-size:16px;line-height:1.55;color:${SUAVE};max-width:600px">Un espacio dedicado solo a usted: un especialista le mostrará en funcionamiento los equipos que le interesan y resolverá sus dudas técnicas.</div>
      <div style="font-size:13px;line-height:1.5;color:#e6e9f5"><b style="color:#fff">Para garantizar esa atención personalizada, no recibimos visitas sin cita.</b> Agéndela con su asesor.</div></div>
    <div style="margin:24px 64px 0;display:flex;gap:16px;align-items:stretch"><div style="flex:1;background:${PANEL};border:1px solid ${BORDE};border-radius:20px;padding:18px 22px;display:flex;flex-direction:column;gap:6px">
      <div class="vmcp-k" style="color:${ACC}">${esc(sala.nombre)}</div><div style="font-size:15px;font-weight:600;color:#fff;line-height:1.4">${esc(sala.direccion)}</div><div style="font-size:12.5px;color:${SUAVE}">${esc(sala.horario)}</div>${acciones}</div></div>
    <div style="flex:1;min-height:16px"></div>
    <div style="margin:0 64px;padding:18px 0;border-top:1px solid ${BORDE};display:flex;justify-content:space-between;align-items:center;gap:20px"><div style="display:flex;align-items:center;gap:14px"><div style="background:#fff;border-radius:14px;padding:6px">${qrBox('https://' + WEB, 92)}</div>
      <div style="display:flex;flex-direction:column;gap:4px;max-width:260px"><div class="vmcp-s" style="font-size:17px;font-weight:700;line-height:1.25">Conozca más equipos en la web</div><div style="font-size:11.5px;color:${SUAVE};line-height:1.4">Escanee y vea el catálogo completo en ${WEB}</div></div></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 64px 34px">${logo(true, 30)}<div style="font-size:12.5px;color:${SUAVE};text-align:right">${n ? 'WhatsApp ' + esc(waVer(n)) + ' · ' : ''}${WEB}</div></div></div>`
}
export function paginasHtml(segs: Seg[], imgs: Record<string, string>, c: Cfg) {
  const out = [pPortada(segs, imgs, c)]
  let pagina = 2
  segs.forEach((s, i) => {
    const partes = Math.ceil(s.productos.length / POR_PAGINA)
    for (let k = 0; k < partes; k++) out.push(pSegmento(s, i + 1, s.productos.slice(k * POR_PAGINA, (k + 1) * POR_PAGINA), k + 1, partes, pagina++, imgs, c))
  })
  if (c.contra) out.push(pContra(c))
  return out
}

/* ============================ Utilidades de generación ============================ */
function ajustarTextos(raiz: HTMLElement) {
  raiz.querySelectorAll<HTMLElement>('[data-fit]').forEach((el) => {
    const max = el.clientHeight + 1
    if (el.scrollHeight <= max) return
    const pal = el.textContent!.replace(/…$/, '').split(' ')
    while (pal.length > 1 && el.scrollHeight > max) { pal.pop(); el.textContent = pal.join(' ').replace(/[\s,.;:–-]+$/, '') + '…' }
  })
}
async function aDataUrl(url: string): Promise<string> {
  try {
    const r = await fetch(url, { mode: 'cors' })
    if (!r.ok) return ''
    const b = await r.blob()
    return await new Promise<string>((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => ok(''); f.readAsDataURL(b) })
  } catch { return '' }
}
async function fuentes() {
  if (!document.querySelector('link[data-vmc-fuentes]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap'; l.setAttribute('data-vmc-fuentes', '1'); document.head.appendChild(l)
  }
  if (!document.fonts?.load) return
  const lista = ['600 16px Sora', '700 16px Sora', '800 16px Sora', '400 16px Inter', '600 16px Inter', '700 16px Inter']
  await Promise.race([Promise.all(lista.map((f) => document.fonts.load(f).catch(() => null))).then(() => document.fonts.ready), new Promise((ok) => setTimeout(ok, 5000))])
}

/* ============================ Pantalla ============================ */
export default function Catalogos({ perfil, aviso }: { perfil: Perfil; aviso: (t: string) => void }) {
  const [segmentos, setSegmentos] = useState<Seg[] | null>(null)
  const [asesor, setAsesor] = useState<Asesor>({ nombre: perfil.nombre, whatsapp: '' })
  const [error, setError] = useState('')
  const [formato, setFormato] = useState<'' | 'digital' | 'impreso'>('')
  const [precios, setPrecios] = useState(false)
  const [conCliente, setConCliente] = useState(false)
  const [cliente, setCliente] = useState('')
  const [off, setOff] = useState<Record<string, boolean>>({})
  const [ex, setEx] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [contra, setContra] = useState(true)
  const [gen, setGen] = useState<{ f: number; txt: string } | null>(null)
  const [msg, setMsg] = useState('')
  const ocupado = useRef(false)
  const [vista, setVista] = useState<string | null>(null)
  const marco = useRef<HTMLIFrameElement>(null)
  /* Lo que se quita dentro de la vista previa HTML se refleja aquí (y queda recordado para la próxima vez). */
  useEffect(() => {
    const f = (e: MessageEvent) => {
      const d = e.data as { vmc?: string; id?: string } | null
      if (!d || !d.vmc || !d.id || e.source !== marco.current?.contentWindow) return
      const id = d.id
      if (d.vmc === 'quitar') setEx((x) => ({ ...x, [id]: true }))
      else if (d.vmc === 'volver') setEx((x) => { const n = { ...x }; delete n[id]; return n })
    }
    window.addEventListener('message', f)
    return () => window.removeEventListener('message', f)
  }, [])

  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem(PREF) || 'null'); if (p) { setOff(p.off || {}); setEx(p.ex || {}); setContra(p.contra !== false); setPrecios(!!p.precios) } } catch { /* sin preferencias */ }
    supabase.from('productos').select('codigo,nombre,descripcion,pvp,aplica_iva,imagen_url,orden,categoria:categorias(nombre)').eq('en_catalogo', true).is('deleted_at', null).order('orden', { ascending: true }).limit(3000)
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        const mapa = new Map<string, Prod[]>()
        ;((data ?? []) as unknown as { codigo: string; nombre: string; descripcion: string | null; pvp: number | null; aplica_iva: boolean; imagen_url: string | null; categoria: { nombre: string } | null }[]).forEach((p) => {
          const seg = limpio(p.categoria?.nombre) || 'Otros equipos'
          const lista = mapa.get(seg) ?? []
          lista.push({ id: p.codigo, n: limpio(p.nombre), det: cortaPalabras(limpio(p.descripcion), 150), pvp: Number(p.pvp) || 0, iva: p.aplica_iva !== false, foto: p.imagen_url ?? '', link: `https://${WEB}/equipo/?id=${encodeURIComponent(p.codigo)}` })
          mapa.set(seg, lista)
        })
        setSegmentos([...mapa.entries()].map(([nombre, productos]) => ({ nombre, productos })))
      })
    supabase.from('empleados').select('nombre,telefono').eq('id', perfil.id).single().then(({ data }) => { const d = data as { nombre: string; telefono: string | null } | null; if (d) setAsesor({ nombre: d.nombre, whatsapp: d.telefono ?? '' }) })
  }, [perfil.id])
  useEffect(() => { try { localStorage.setItem(PREF, JSON.stringify({ off, ex, contra, precios })) } catch { /* sin almacenamiento */ } }, [off, ex, contra, precios])

  const incluidos = (s: Seg) => s.productos.filter((p) => !ex[p.id])
  const seleccion = useMemo(() => (segmentos ?? []).filter((s) => !off[s.nombre]).map((s) => ({ nombre: s.nombre, productos: s.productos.filter((p) => !ex[p.id]) })).filter((s) => s.productos.length), [segmentos, off, ex])
  const nProd = seleccion.reduce((a, s) => a + s.productos.length, 0)
  const nPag = 1 + (contra ? 1 : 0) + seleccion.reduce((a, s) => a + Math.ceil(s.productos.length / POR_PAGINA), 0)
  const faltaCliente = conCliente && !cliente.trim()
  const n = waNum(asesor.whatsapp)
  const qn = norm(q).trim()

  async function generar() {
    if (ocupado.current || !formato) return
    ocupado.current = true; setMsg(''); setGen({ f: 0.03, txt: 'Preparando…' })
    const cfg: Cfg = { formato, precios, contra, cliente: conCliente ? cliente.trim() : '', asesor }
    try {
      await fuentes()
      /* Fotos de los productos elegidos, 4 a la vez */
      const imgs: Record<string, string> = {}
      const todos = seleccion.flatMap((s) => s.productos).filter((p) => p.foto)
      let hecho = 0
      const cola = [...todos]
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (cola.length) {
          const p = cola.shift()!
          const u = await aDataUrl(imagen(p.foto, 520))
          if (u) imgs[p.id] = u
          hecho++; setGen({ f: 0.03 + 0.47 * (hecho / Math.max(1, todos.length)), txt: `Descargando fotos ${hecho} de ${todos.length}…` })
        }
      }))
      /* Una página a la vez (evita lienzos gigantes) */
      const paginas = paginasHtml(seleccion, imgs, cfg)
      const cont = document.createElement('div')
      cont.style.cssText = 'position:absolute;left:0;top:0;width:794px;height:1123px;overflow:hidden;opacity:0;pointer-events:none;z-index:-1'
      cont.id = 'vmc-render'; cont.innerHTML = paginas.join(''); document.body.appendChild(cont)
      const pags = Array.from(cont.querySelectorAll<HTMLElement>('.vmcp'))
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
      const k = 210 / 794
      try {
        for (let i = 0; i < pags.length; i++) {
          const pg = pags[i]
          pags.forEach((p, j) => { p.style.display = j === i ? 'flex' : 'none' })
          setGen({ f: 0.5 + 0.5 * (i / pags.length), txt: `Armando página ${i + 1} de ${pags.length}…` })
          await new Promise((r) => setTimeout(r, 30))
          ajustarTextos(pg)
          const base = pg.getBoundingClientRect()
          const cv = await html2canvas(pg, {
            scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, width: 794, height: 1123, x: base.left + window.scrollX, y: base.top + window.scrollY, scrollX: 0, scrollY: 0,
            windowWidth: Math.max(document.documentElement.clientWidth, 1000), windowHeight: Math.max(document.documentElement.clientHeight, 1200),
            onclone: (doc) => { const c = doc.getElementById('vmc-render'); if (c) { c.style.opacity = '1'; c.style.zIndex = '2147483000' } },
          })
          if (i > 0) pdf.addPage('a4', 'p')
          pdf.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
          if (formato !== 'impreso') pg.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => { const r = a.getBoundingClientRect(); pdf.link((r.left - base.left) * k, (r.top - base.top) * k, r.width * k, r.height * k, { url: a.getAttribute('href')! }) })
          cv.width = 0; cv.height = 0
        }
      } finally { cont.remove() }
      const nombre = 'Catalogo_Vimedic_' + (cfg.cliente || asesor.nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + new Date().toISOString().slice(0, 10) + '.pdf'
      const blob = pdf.output('blob')
      pdf.save(nombre)
      setGen(null); aviso('Catálogo listo: ' + nombre)
      /* Registro para Marketing ("Catálogos personalizados del período") */
      supabase.from('catalogos_generados').insert({
        id: crypto.randomUUID(), codigo: 'CAT-' + crypto.randomUUID().slice(0, 6).toUpperCase(), asesor_id: perfil.id, cliente_texto: cfg.cliente || null, formato: formato === 'impreso' ? 'Impreso' : 'Digital',
        precios: precios ? 'Con precios' : 'Sin precios', contraportada: contra, segmentos: seleccion.map((s) => s.nombre).join(', '), n_productos: nProd,
        productos: seleccion.flatMap((s) => s.productos.map((p) => p.id)).join(','), paginas: pags.length, tamano_kb: Math.round((blob.size / 1024) * 10) / 10,
      }).then(() => undefined)
    } catch (e) {
      setGen(null); setMsg('No se pudo generar el PDF: ' + ((e as Error).message || e))
    } finally { ocupado.current = false }
  }

  function abrirHtml() {
    if (!nProd || faltaCliente) return
    const segs = seleccion.map((s) => ({ nombre: s.nombre, productos: s.productos.map((p) => ({ ...p, foto: p.foto ? imagen(p.foto, 520) : '' })) }))
    setMsg(''); setVista(htmlCatalogo(segs, { precios, contra, cliente: conCliente ? cliente.trim() : '', asesor, web: WEB, lema: LEMA }))
  }
  function htmlLimpio() {
    const doc = marco.current?.contentDocument
    if (!doc) return ''
    const c = doc.documentElement.cloneNode(true) as HTMLElement
    c.querySelectorAll('.ed, #vmc-edit').forEach((e) => e.remove())
    c.querySelector('body')?.classList.remove('edit')
    return '<!doctype html>' + c.outerHTML
  }
  function registrar(formatoTxt: string, tam: number) {
    supabase.from('catalogos_generados').insert({
      id: crypto.randomUUID(), codigo: 'CAT-' + crypto.randomUUID().slice(0, 6).toUpperCase(), asesor_id: perfil.id, cliente_texto: conCliente ? cliente.trim() || null : null, formato: formatoTxt,
      precios: precios ? 'Con precios' : 'Sin precios', contraportada: contra, segmentos: seleccion.map((s) => s.nombre).join(', '), n_productos: nProd,
      productos: seleccion.flatMap((s) => s.productos.map((p) => p.id)).join(','), paginas: nPag, tamano_kb: Math.round((tam / 1024) * 10) / 10,
    }).then(() => undefined)
  }
  function descargarHtml() {
    const h = htmlLimpio(); if (!h) return
    const nombre = 'Catalogo_Vimedic_' + ((conCliente && cliente.trim()) || asesor.nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + new Date().toISOString().slice(0, 10) + '.html'
    const blob = new Blob([h], { type: 'text/html;charset=utf-8' }), a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    registrar('HTML', blob.size); aviso('Catálogo HTML descargado: ' + nombre)
  }
  function imprimirHtml() {
    const w = marco.current?.contentWindow; if (!w) return
    w.document.body.classList.remove('edit'); w.focus(); w.print(); w.document.body.classList.add('edit')
    registrar('PDF (impresión)', 0)
  }

  const resumen = msg ? <span className="vmc-err">{msg}</span>
    : !formato ? <span style={{ color: '#9a5b00', fontWeight: 600 }}>Elija si el catálogo es digital o impreso.</span>
    : faltaCliente ? <span style={{ color: '#9a5b00', fontWeight: 600 }}>Escriba el nombre del cliente o desmarque la opción.</span>
    : nProd ? <><b>{nProd} producto{nProd === 1 ? '' : 's'}</b> · {seleccion.length} segmento{seleccion.length === 1 ? '' : 's'} · {nPag} páginas A4 · {formato === 'impreso' ? 'Impreso' : 'Digital'}{precios ? ' con precios' : ''}</>
    : <>No hay productos seleccionados.</>

  return (
    <div className="vm-cat">
      <header className="cat-hdr"><div className="cat-hdr-in vm-head-pad">
        <span className="cat-ic"><img alt="" src={icUrl('pdf', '#ffffff')} style={{ width: 20, height: 20 }} /></span>
        <div style={{ minWidth: 0 }}><h1>Catálogos personalizados</h1><p>Elige segmentos y productos: el PDF lleva tu WhatsApp de asesor en cada hoja.</p></div>
      </div></header>
      <main className="cat-main">
        <div className="vmc-dlg" role="dialog" aria-label="Catálogo PDF">
          {error && <div className="vmc-carga vmc-err">{error}</div>}
          {!error && segmentos === null && <div className="vmc-carga">Cargando productos públicos…</div>}
          {segmentos && gen && (
            <div className="vmc-gen"><div style={{ fontWeight: 700, fontSize: 20, fontFamily: 'Sora,Inter,sans-serif' }}>Generando su catálogo…</div><div className="vmc-bar"><i style={{ width: Math.round(gen.f * 100) + '%' }} /></div><div style={{ fontSize: 13, color: '#56607e' }}>{gen.txt}</div></div>
          )}
          {segmentos && !gen && (
            <>
              <div className="vmc-bd">
                <div className="vmc-izq">
                  <b style={{ fontSize: 14 }}>1. ¿Catálogo digital o impreso?</b>
                  <div className="vmc-fmt">
                    {([['digital', 'Digital', 'Para enviar por WhatsApp o correo. Con botones y enlaces.'], ['impreso', 'Impreso', 'Para imprimir. Códigos QR en lugar de botones.']] as const).map(([v, t, d]) => (
                      <label key={v} className={'vmc-fo' + (formato === v ? ' on' : formato ? '' : ' vmc-falta')}><b><input type="radio" name="vmc-fmt" checked={formato === v} onChange={() => { setFormato(v); setMsg('') }} />{t}</b>{d}</label>
                    ))}
                  </div>
                  <label className="vmc-opt"><input type="checkbox" checked={precios} onChange={(e) => setPrecios(e.target.checked)} /><span>Mostrar precios (PVP)</span></label>
                  <label className="vmc-opt"><input type="checkbox" checked={conCliente} onChange={(e) => setConCliente(e.target.checked)} /><span>Incluir nombre del cliente en la portada</span></label>
                  {conCliente && <input type="text" className={'vmc-cli' + (faltaCliente ? ' vmc-falta' : '')} maxLength={80} placeholder="Nombre del cliente o institución" autoComplete="off" value={cliente} onChange={(e) => setCliente(e.target.value)} />}
                  <div className="vmc-sep" />
                  <div className="vmc-h"><b>2. Segmentos</b><div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" className="vmc-lnk" onClick={() => setOff({})}>Todos</button>
                    <button type="button" className="vmc-lnk" onClick={() => setOff(Object.fromEntries(segmentos.map((s) => [s.nombre, true])))}>Ninguno</button></div></div>
                  <div className="vmc-nota">En el mismo orden del inventario</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {segmentos.map((s, i) => { const on = !off[s.nombre]; return (
                      <label key={s.nombre} className={'vmc-seg' + (on ? ' on' : '')}><input type="checkbox" checked={on} onChange={() => setOff((o) => ({ ...o, [s.nombre]: on }))} />
                        <span className="vmc-num">{pad(i + 1)}</span><span className="vmc-sn">{s.nombre}</span><span className="vmc-cnt">{incluidos(s).length}/{s.productos.length}</span></label>) })}
                    {!segmentos.length && <div className="vmc-nota">No hay productos públicos.</div>}
                  </div>
                  <div className="vmc-sep" /><b style={{ fontSize: 14 }}>Páginas extra</b>
                  <label className="vmc-opt"><input type="checkbox" checked disabled /><span>Portada</span></label>
                  <label className="vmc-opt"><input type="checkbox" checked={contra} onChange={(e) => setContra(e.target.checked)} /><span>Contraportada · sala de exhibición</span></label>
                  <div className={'vmc-as ' + (n ? 'ok' : 'no')}><div className="vmc-wa"><img alt="" src={icUrl('wa', '#ffffff')} style={{ width: 17, height: 17 }} /></div>
                    <div><b>{asesor.nombre}</b>{n ? waVer(n) + ' · desde su ficha en Empleados' : 'Su ficha en Empleados no tiene celular: el catálogo saldrá sin WhatsApp.'}</div></div>
                </div>
                <div className="vmc-der">
                  <div className="vmc-h"><b>3. Productos a incluir</b>
                    <label className="vmc-bus"><img alt="" src={icUrl('buscar', '#56607e')} style={{ width: 16, height: 16 }} /><input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o código" aria-label="Buscar producto" /></label></div>
                  <div className="vmc-lista">
                    {segmentos.every((s) => off[s.nombre]) && <div className="vmc-vacio">Elija al menos un segmento a la izquierda.</div>}
                    {segmentos.map((s, i) => {
                      if (off[s.nombre]) return null
                      const ps = s.productos.filter((p) => !qn || norm(p.n + ' ' + p.id).includes(qn))
                      if (!ps.length) return null
                      return (
                        <div key={s.nombre}><div className="vmc-gh"><div className="vmc-gt"><span>{pad(i + 1)}</span> · {s.nombre}</div><div className="vmc-ga">
                          <button type="button" className="vmc-lnk" onClick={() => setEx((e) => { const x = { ...e }; s.productos.forEach((p) => delete x[p.id]); return x })}>Incluir todos</button>
                          <button type="button" className="vmc-lnk" onClick={() => setEx((e) => { const x = { ...e }; s.productos.forEach((p) => { x[p.id] = true }); return x })}>Quitar todos</button></div></div>
                          <div className="vmc-grid">{ps.map((p) => { const on = !ex[p.id]; return (
                            <label key={p.id} className={'vmc-p' + (on ? '' : ' off')}><input type="checkbox" checked={on} onChange={() => setEx((e) => { const x = { ...e }; if (on) x[p.id] = true; else delete x[p.id]; return x })} />
                              <span className="vmc-th">{p.foto ? <img className="f" alt="" loading="lazy" src={imagen(p.foto, 96)} onError={(e) => e.currentTarget.remove()} /> : <img alt="" src={icUrl('foto', '#8a95b3', 1.6)} style={{ width: 18, height: 18 }} />}</span>
                              <span className="vmc-pn">{p.n}<small>Cód. {p.id}</small></span><span className="vmc-es" style={{ color: on ? VERDE : '#a3341f' }}>{on ? 'Incluido' : 'Excluido'}</span></label>) })}</div></div>
                      )
                    })}
                    {segmentos.some((s) => !off[s.nombre]) && qn && !segmentos.some((s) => !off[s.nombre] && s.productos.some((p) => norm(p.n + ' ' + p.id).includes(qn))) && <div className="vmc-vacio">Ningún producto coincide con la búsqueda.</div>}
                  </div>
                </div>
              </div>
              <div className="vmc-ft"><div className="vmc-res">{resumen}</div>
                <button type="button" className="vmc-b pri" onClick={abrirHtml} disabled={!nProd || faltaCliente} title="Se arma al instante y puedes quitar productos desde la vista previa"><img alt="" src={icUrl('ext', '#ffffff')} style={{ width: 17, height: 17 }} />Crear catálogo web (rápido)</button>
                <button type="button" className="vmc-b" onClick={generar} disabled={!nProd || !formato || faltaCliente}><img alt="" src={icUrl('bajar', '#ffffff')} style={{ width: 17, height: 17 }} />Descargar PDF (lento)</button></div>
            </>
          )}
        </div>
      </main>
      {vista && (
        <div className="vmc-pre" role="dialog" aria-label="Vista previa del catálogo">
          <div className="vmc-pre-bar">
            <div className="vmc-pre-t"><b>Vista previa del catálogo</b><span>Toca la <b style={{ color: '#ff8a7a' }}>×</b> de cada producto para quitarlo · {nProd} producto{nProd === 1 ? '' : 's'}</span></div>
            <button type="button" className="vmc-b" onClick={() => marco.current?.contentWindow?.postMessage({ vmc: 'deshacer' }, '*')}>Deshacer</button>
            <button type="button" className="vmc-b" onClick={imprimirHtml}>Imprimir / PDF</button>
            <button type="button" className="vmc-b pri" onClick={descargarHtml}><img alt="" src={icUrl('bajar', '#ffffff')} style={{ width: 16, height: 16 }} />Descargar HTML</button>
            <button type="button" className="vmc-b" onClick={() => setVista(null)}>Cerrar</button>
          </div>
          <iframe ref={marco} className="vmc-pre-f" title="Catálogo" srcDoc={vista} />
        </div>
      )}
    </div>
  )
}
