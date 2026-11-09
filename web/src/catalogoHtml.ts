import qrcode from 'qrcode-generator'
import { LOGO_BLANCO, LOGO_RATIO } from './catalogoAssets'

/* Catálogo en HTML: una sola página web (sin imágenes incrustadas, sin capturas de pantalla) que se genera al instante,
   se puede editar quitando productos y se descarga o se imprime como PDF desde el navegador. */
export type ProdH = { id: string; n: string; det: string; pvp: number; iva: boolean; foto: string; link: string }
export type SegH = { nombre: string; productos: ProdH[] }
export type CfgH = { precios: boolean; contra: boolean; cliente: string; asesor: { nombre: string; whatsapp: string }; web: string; lema: string }

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const waNum = (t: string) => { let s = String(t || '').replace(/\D/g, ''); if (!s) return ''; if (s.indexOf('593') === 0) return s; if (s.charAt(0) === '0') s = s.slice(1); return s.length === 9 ? '593' + s : s }
const waVer = (n: string) => (n.length === 12 && n.indexOf('593') === 0 ? '+593 ' + n.slice(3, 5) + ' ' + n.slice(5, 8) + ' ' + n.slice(8) : '+' + n)
const wa = (n: string, msg: string) => (n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg) : '')
const precio = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pad = (n: number) => (n < 10 ? '0' : '') + n
const qr = (t: string, px: number) => { try { const q = qrcode(0, 'M'); q.addData(t); q.make(); return `<img class="qr" alt="QR" width="${px}" height="${px}" src="${q.createDataURL(5, 1)}">` } catch { return '' } }
const WA_SVG = '<svg viewBox="2.5 2.5 19 19" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.9 11.89L4 20l4.2-1.1a7.93 7.93 0 0 0 3.8 1h.05a7.94 7.94 0 0 0 5.55-13.58zM12.05 18.4h-.03a6.55 6.55 0 0 1-3.34-.92l-.24-.14-2.5.66.67-2.44-.16-.25a6.56 6.56 0 0 1 10.24-8.05 6.5 6.5 0 0 1 1.92 4.63 6.58 6.58 0 0 1-6.56 6.51zm3.6-4.9c-.2-.1-1.17-.58-1.35-.64s-.32-.1-.45.1-.5.64-.62.77-.24.15-.44.05a5.4 5.4 0 0 1-1.59-.98 6 6 0 0 1-1.1-1.37c-.12-.2 0-.3.09-.4.09-.1.2-.24.3-.36a1.4 1.4 0 0 0 .2-.33.37.37 0 0 0 0-.35c-.05-.1-.45-1.08-.62-1.48-.16-.39-.33-.34-.45-.34h-.38a.73.73 0 0 0-.53.25 2.2 2.2 0 0 0-.69 1.64 3.86 3.86 0 0 0 .81 2.03 8.8 8.8 0 0 0 3.38 3 8.9 8.9 0 0 0 1.2.45 2.9 2.9 0 0 0 1.34.08 2.2 2.2 0 0 0 1.44-1.02 1.8 1.8 0 0 0 .12-1.02c-.05-.09-.18-.14-.38-.24z"/></svg>'

const CSS = `
:root{--navy:#1d2344;--panel:#283063;--acc:#36a9e1;--wa:#25D366;--tx:#1d2344;--mut:#5b6685;--bg:#f4f6fb;--line:#e3e8f2}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--tx);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,.sora{font-family:Sora,Inter,system-ui,sans-serif}
a{color:inherit;text-decoration:none}
.hero{background:radial-gradient(1200px 500px at 85% -10%,#2b6cb0 0,transparent 60%),linear-gradient(135deg,#1d2344,#283063 65%,#1d3f73);color:#fff;padding:28px clamp(18px,5vw,64px) 40px}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px}
.top .año{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#c9cfe6;font-weight:700}
.hero h1{font-size:clamp(30px,6vw,58px);line-height:1.05;letter-spacing:-1.2px;margin:34px 0 12px;font-weight:800;max-width:760px}
.hero h1 i{font-style:normal;color:var(--acc)}
.lema{font-size:clamp(14px,2vw,17px);line-height:1.55;color:#c9cfe6;max-width:600px;margin:0}
.chip-cli{display:inline-flex;flex-direction:column;gap:3px;margin-top:20px;padding:12px 18px;border-radius:16px;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.2)}
.chip-cli small{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);font-weight:700}.chip-cli b{font-family:Sora,Inter,sans-serif;font-size:20px}
.asesor{margin-top:28px;display:flex;flex-wrap:wrap;align-items:center;gap:18px;padding:16px 20px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);max-width:640px}
.asesor .q{flex:1;min-width:200px}.asesor small{display:block;font-size:11px;color:#c9cfe6;letter-spacing:.04em}.asesor b{font-size:17px}
.btn-wa{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--wa);color:#0b2e1a;font-weight:800;border-radius:12px;padding:11px 18px;font-size:14px;box-shadow:0 8px 20px -10px rgba(37,211,102,.9);transition:transform .15s,filter .15s}
.btn-wa:hover{transform:translateY(-1px);filter:brightness(1.05)}
.qr{background:#fff;border-radius:10px;padding:4px;display:block}
.nav{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);display:flex;gap:8px;overflow-x:auto;padding:10px clamp(14px,4vw,64px);scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.nav a{white-space:nowrap;font-size:12.5px;font-weight:700;padding:7px 13px;border-radius:999px;background:#eef2fa;color:var(--navy);border:1px solid var(--line)}
.nav a:hover{background:var(--navy);color:#fff}
main{padding:10px clamp(14px,4vw,64px) 120px;max-width:1380px;margin:0 auto}
.seg{margin-top:34px}
.seg-h{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-bottom:12px;border-bottom:2px solid var(--navy);margin-bottom:18px}
.seg-h .n{font-family:Sora,Inter,sans-serif;font-weight:800;font-size:44px;line-height:.9;color:var(--acc)}
.seg-h h2{margin:0;font-size:clamp(20px,3vw,30px);letter-spacing:-.5px}
.seg-h small{display:block;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);font-weight:700;margin-bottom:3px}
.seg-h .l{display:flex;align-items:flex-end;gap:14px}
.seg-h .cta{font-size:12.5px;padding:8px 14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}
.card{position:relative;background:#fff;border:1px solid var(--line);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 1px 2px rgba(29,35,68,.04);transition:transform .18s,box-shadow .18s;break-inside:avoid}
.card:hover{transform:translateY(-3px);box-shadow:0 18px 34px -18px rgba(29,35,68,.35)}
.ph{aspect-ratio:4/3;background:#fff;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--line);padding:10px}
.ph img{max-width:100%;max-height:100%;object-fit:contain;display:block}
.ph.v{background:linear-gradient(135deg,#eef2fa,#f8faff);color:#9aa5c3;font-size:34px}
.cb{padding:14px 14px 16px;display:flex;flex-direction:column;gap:6px;flex:1}
.pn{font-weight:700;font-size:14.5px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.6em}
.pm{font-size:10.5px;color:var(--mut);letter-spacing:.06em;font-weight:600}
.pd{font-size:12px;line-height:1.5;color:#4a5575;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pr{margin-top:auto;padding-top:6px;display:flex;align-items:baseline;gap:6px}.pr b{font-family:Sora,Inter,sans-serif;font-size:20px;color:var(--navy)}.pr span{font-size:11px;color:var(--mut);font-weight:600}
.acts{display:flex;gap:8px;margin-top:8px}
.acts a{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:12.5px;font-weight:700;border-radius:11px;padding:9px 8px;min-height:38px}
.acts .ver{background:var(--navy);color:#fff}.acts .ver:hover{background:#2a3470}
.acts .w{background:var(--wa);color:#0b2e1a;flex:0 0 auto;padding:9px 13px}.acts .w svg{width:18px;height:18px}
.sala{margin-top:46px;background:linear-gradient(135deg,#1d2344,#283063);color:#fff;border-radius:26px;padding:clamp(22px,4vw,40px);display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between}
.sala h3{margin:0 0 8px;font-size:clamp(20px,3vw,30px);line-height:1.15;max-width:560px}.sala p{margin:0 0 6px;color:#c9cfe6;font-size:14px;line-height:1.55;max-width:560px}
.sala .tag{display:inline-block;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);border:1px solid var(--acc);border-radius:999px;padding:5px 12px;font-weight:800;margin-bottom:12px}
footer{margin-top:40px;padding:24px 0 0;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;color:var(--mut);font-size:13px}
.fab{position:fixed;right:18px;bottom:18px;z-index:40;display:flex;align-items:center;gap:10px;background:var(--wa);color:#0b2e1a;font-weight:800;border-radius:999px;padding:13px 20px 13px 16px;box-shadow:0 16px 34px -12px rgba(37,211,102,.9);font-size:14px}
.fab svg{width:24px;height:24px}
.fab::before{content:'';position:absolute;inset:0;border-radius:999px;border:2px solid var(--wa);animation:pul 2.2s ease-out infinite}
@keyframes pul{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.35);opacity:0}}
@media(max-width:600px){.fab span{display:none}.fab{padding:14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cb{padding:10px}.pn{font-size:12.5px}.pd{display:none}.pr b{font-size:16px}.acts a{font-size:11.5px;padding:8px 6px}.card{border-radius:14px}}
.ed{display:none}
body.edit .ed{display:flex}
body.edit .card .x{position:absolute;top:8px;right:8px;z-index:3;width:32px;height:32px;border-radius:50%;border:0;background:#c0392b;color:#fff;font-size:18px;line-height:1;cursor:pointer;align-items:center;justify-content:center;box-shadow:0 6px 14px -6px rgba(192,57,43,.9)}
body.edit .card .x:hover{background:#a93226;transform:scale(1.08)}
body.edit .seg-h .xs{border:1px solid #f0c3bd;background:#fff5f4;color:#a93226;border-radius:10px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer}
@media print{
  @page{size:A4;margin:10mm}
  .nav,.fab,.ed,.acts .w{display:none!important}
  body{background:#fff}.hero{padding:18px 20px 22px;border-radius:0}.hero h1{margin-top:16px}
  main{padding:0 0 10px}.grid{grid-template-columns:repeat(3,1fr);gap:10px}
  .card{box-shadow:none;border-radius:12px}.card:hover{transform:none;box-shadow:none}
  .seg{margin-top:18px}.seg-h{break-after:avoid}.pd{-webkit-line-clamp:2}.sala{break-inside:avoid}
}`

const SCRIPT = `(function(){
  var pila=[];
  function total(){var n=document.querySelectorAll('.card').length;document.querySelectorAll('[data-total]').forEach(function(e){e.textContent=n});}
  function cuenta(seg){var c=seg.querySelectorAll('.card').length;var e=seg.querySelector('[data-cuenta]');if(e)e.textContent=c+(c===1?' producto':' productos');return c;}
  function quitarCard(card,aviso){var seg=card.closest('.seg');pila.push({card:card,padre:card.parentNode,sig:card.nextSibling,seg:seg});card.remove();
    if(aviso)parent.postMessage({vmc:'quitar',id:card.getAttribute('data-id')},'*');
    if(cuenta(seg)===0){var nav=document.querySelector('.nav a[href="#'+seg.id+'"]');pila[pila.length-1].segOculto=true;pila[pila.length-1].segPadre=seg.parentNode;pila[pila.length-1].segSig=seg.nextSibling;seg.remove();if(nav){pila[pila.length-1].nav=nav;pila[pila.length-1].navPadre=nav.parentNode;pila[pila.length-1].navSig=nav.nextSibling;nav.remove();}}
    total();}
  document.addEventListener('click',function(e){
    var x=e.target.closest('.x');if(x){e.preventDefault();quitarCard(x.closest('.card'),true);return;}
    var s=e.target.closest('.xs');if(s){e.preventDefault();var seg=s.closest('.seg');seg.querySelectorAll('.card').forEach(function(c){quitarCard(c,true)});}
  });
  function deshacer(){var u=pila.pop();if(!u)return;
    if(u.segOculto){u.segPadre.insertBefore(u.seg,u.segSig);if(u.nav)u.navPadre.insertBefore(u.nav,u.navSig);}
    u.padre.insertBefore(u.card,u.sig);cuenta(u.seg);total();parent.postMessage({vmc:'volver',id:u.card.getAttribute('data-id')},'*');}
  window.addEventListener('message',function(e){if(e.data&&e.data.vmc==='deshacer')deshacer();});
  total();
})();`

function tarjeta(p: ProdH, c: CfgH, wan: string) {
  const foto = p.foto ? `<div class="ph"><img src="${esc(p.foto)}" alt="${esc(p.n)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.className='ph v';this.remove()"></div>` : '<div class="ph v">▣</div>'
  const pr = c.precios ? `<div class="pr">${p.pvp > 0 ? `<b>${esc(precio(p.pvp))}</b><span>${p.iva ? '+ IVA' : 'IVA 0%'}</span>` : '<span>Consultar precio</span>'}</div>` : ''
  const msg = `Hola ${c.asesor.nombre}, me interesa el equipo ${p.n} (cód. ${p.id}) del catálogo VIMEDIC.`
  const w = wan ? `<a class="w" href="${esc(wa(wan, msg))}" target="_blank" rel="noopener" title="Consultar por WhatsApp" aria-label="Consultar ${esc(p.n)} por WhatsApp">${WA_SVG}</a>` : ''
  return `<article class="card" data-id="${esc(p.id)}"><button type="button" class="x ed" title="Quitar del catálogo" aria-label="Quitar ${esc(p.n)}">×</button>${foto}<div class="cb"><div class="pn">${esc(p.n)}</div><div class="pm">CÓD. ${esc(p.id)}</div>${p.det ? `<div class="pd">${esc(p.det)}</div>` : ''}${pr}<div class="acts"><a class="ver" href="${esc(p.link)}" target="_blank" rel="noopener">Ver más ↗</a>${w}</div></div></article>`
}

export function htmlCatalogo(segs: SegH[], c: CfgH): string {
  const wan = waNum(c.asesor.whatsapp), año = new Date().getFullYear()
  const hola = wa(wan, `Hola ${c.asesor.nombre}, revisé el catálogo VIMEDIC y quisiera más información.`)
  const cita = wa(wan, `Hola ${c.asesor.nombre}, quisiera agendar una cita para visitar la sala de exhibición de VIMEDIC.`)
  const nav = segs.map((s, i) => `<a href="#s${i + 1}">${pad(i + 1)} · ${esc(s.nombre)}</a>`).join('')
  const secciones = segs.map((s, i) => {
    const q = wa(wan, `Hola ${c.asesor.nombre}, vi el catálogo VIMEDIC y me interesa el segmento ${s.nombre}.`)
    return `<section class="seg" id="s${i + 1}"><div class="seg-h"><div class="l"><div class="n">${pad(i + 1)}</div><div><small>Segmento · <span data-cuenta>${s.productos.length} ${s.productos.length === 1 ? 'producto' : 'productos'}</span></small><h2>${esc(s.nombre)}</h2></div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="xs ed" title="Quitar todo el segmento">Quitar segmento</button>${q ? `<a class="btn-wa cta" href="${esc(q)}" target="_blank" rel="noopener">${WA_SVG} Consultar este segmento</a>` : ''}</div></div>
      <div class="grid">${s.productos.map((p) => tarjeta(p, c, wan)).join('')}</div></section>`
  }).join('')
  const sala = c.contra ? `<section class="sala"><div><span class="tag">Solo con cita previa</span><h3 class="sora">Reserve su visita a nuestra sala de exhibición</h3><p>Un especialista le mostrará en funcionamiento los equipos que le interesan y resolverá sus dudas técnicas. Para garantizar esa atención personalizada no recibimos visitas sin cita: agéndela con su asesor.</p></div>${cita ? `<a class="btn-wa" href="${esc(cita)}" target="_blank" rel="noopener" style="padding:14px 22px;font-size:15px">${WA_SVG} Agendar mi cita</a>` : ''}</section>` : ''
  const asesor = `<div class="asesor"><div class="q"><small>Su asesor comercial</small><b>${esc(c.asesor.nombre)}</b>${wan ? `<small style="margin-top:4px;font-size:13px;color:#fff;font-weight:600">${esc(waVer(wan))}</small>` : ''}</div>${hola ? `<a class="btn-wa" href="${esc(hola)}" target="_blank" rel="noopener">${WA_SVG} Escribir por WhatsApp</a>${qr(hola, 64)}` : ''}</div>`
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catálogo VIMEDIC${c.cliente ? ' · ' + esc(c.cliente) : ''}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${CSS}</style></head>
<body class="edit"><header class="hero"><div class="top"><img alt="VIMEDIC" src="${LOGO_BLANCO}" width="${Math.round(40 * LOGO_RATIO)}" height="40"><div class="año">Catálogo ${año}</div></div>
<h1 class="sora">Catálogo de <i>equipos médicos</i></h1><p class="lema">${esc(c.lema)}</p>
${c.cliente ? `<div class="chip-cli"><small>Preparado para</small><b>${esc(c.cliente)}</b></div>` : ''}${asesor}</header>
<nav class="nav" aria-label="Segmentos">${nav}</nav>
<main>${secciones}${sala}<footer><div>${esc(c.web)} · <span data-total>0</span> equipos</div><div>${wan ? 'WhatsApp ' + esc(waVer(wan)) + ' · ' : ''}${esc(c.asesor.nombre)}</div></footer></main>
${hola ? `<a class="fab" href="${esc(hola)}" target="_blank" rel="noopener" aria-label="Escribir por WhatsApp">${WA_SVG}<span>WhatsApp ${esc(c.asesor.nombre.split(' ')[0])}</span></a>` : ''}
<script id="vmc-edit">${SCRIPT}</script></body></html>`
}
