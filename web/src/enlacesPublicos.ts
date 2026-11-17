/* Enlaces que se envían a los clientes. El del seguimiento del pedido sale con el dominio público de VIMEDIC
   (https://vimedic.com.ec/seguimiento/?c=…) y no con el de la app (qa.vimedic.com.ec hoy, app.vimedic.com.ec después).
   La página vimedic.com.ec/seguimiento/ del sitio público (archivo hostinger/seguimiento/index.html) muestra dentro de ella
   la página de seguimiento de la app. Mientras esa página no esté subida, VITE_URL_SEGUIMIENTO va vacía y el enlace sale con
   el dominio de la app, para que ningún cliente reciba un enlace que no abre. */
const BASE_SEGUIMIENTO = String(import.meta.env.VITE_URL_SEGUIMIENTO || '').trim() || window.location.origin + '/seguimiento/'

/** Enlace del seguimiento de un pedido (el mismo del código QR de la guía de despacho). */
export const enlaceSeguimiento = (token: string): string => BASE_SEGUIMIENTO + '?c=' + encodeURIComponent(token)
