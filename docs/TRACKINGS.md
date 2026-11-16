# Trackings — seguimiento de pedidos (Issue #38)

Proceso nuevo desde el 16-nov-2026: aplica a las ventas que pasan del CRM a Facturación de aquí en adelante.
Los pedidos anteriores siguen en Bodega y Logística como antes.

## Etapas

| # | Etapa | Quién la mueve | Cómo avanza (automático) | Tiempo objetivo (días hábiles) |
|---|---|---|---|---|
| 1 | Venta confirmada | CRM | La venta se envía a Facturación | 0 |
| 2 | Enviada a facturar | Facturación | Se crea la factura pendiente | 1 |
| 3 | Facturada | Bodega | La factura pasa a "Facturado" | 1 |
| 4 | En preparación | Bodega | El despacho pasa a "En preparación" (pantalla o escáner) | 2 |
| 5 | Lista para despacho | Bodega | El despacho pasa a "Lista" | 1 |
| 6 | Despachada | Logística | Bodega despacha (fotos y cantidades) | 1 |
| 7 | En camino | Logística | La entrega pasa a "En ruta" o "Con transportista" | local 1 · provincia 4 |
| 8 | Entregada | — | Todas las entregas confirmadas (firma, foto y GPS) | — |
| 9 | Instalación / capacitación | Servicio Técnico | Solo si Logística lo marca. Se cierra al finalizar la orden de ST | 3 |

- Los tiempos se cambian en **Trackings › Tiempos objetivo** (permiso `tracking` › editar). Se cuentan
  días hábiles (lunes a viernes, sin los feriados que se configuren) o días corridos.
- Las novedades de Bodega, los "Por reprogramar" y las incidencias de Logística quedan como **errores** del pedido.
- Al entregarse, el **asesor de la venta recibe un aviso** (campana) que abre el pedido en Trackings.

## Un solo código por pedido

El pedido (`pedidos_seguimiento.token`) comparte su código con el despacho y la entrega. Por eso **el QR de la
guía**, el enlace que se manda desde el CRM y la encuesta de satisfacción son el mismo pedido.

## Enlaces

| Para | Enlace | Dónde se obtiene |
|---|---|---|
| Cliente | `https://app.vimedic.com.ec/seguimiento/?c=<código>` | CRM › detalle de la venta ganada › "Copiar mensaje" / "Copiar enlace" / WhatsApp. También en Trackings › pedido. Es el mismo QR de la guía. |
| Personal | `https://app.vimedic.com.ec/escanear` | Guardarlo como ícono en la pantalla del celular. Abre la cámara de una vez. |

(En pruebas cambia `app.` por `qa.`.)

La página del cliente muestra la etapa, la fecha estimada, el recorrido, los productos (sin precios), las fotos
de la entrega y el contacto del asesor. Se lee con una Edge Function (`seguimiento`) que valida el código; no hay
acceso anónimo a las tablas. Si alguien del equipo con sesión iniciada abre el QR con la cámara normal del
celular, la página le ofrece "Registrar el avance de este pedido".

## Escáner

Lee el QR de la guía, o se escribe el código `TRK-…` o el número de guía `GD-…`. Según el área de quien escanea y
la etapa del pedido muestra la acción que le toca:

- Bodega: **Iniciar preparación** y **Marcar lista** (si ya están todas las series). Lo que necesita series o
  fotos abre el despacho en Bodega.
- Logística: **Salir a entregar (en ruta)** con chofer propio. Confirmar, programar y registrar la entrega
  (firma, foto, GPS) abre la entrega en Logística.
- Servicio Técnico: abre la orden de instalación, o marca la instalación como realizada.
- Facturación: abre Facturación.

Las acciones rápidas aplican las mismas reglas que las pantallas. Cada escaneo queda en la bitácora del pedido.
Modo **Continuo**: después de cada acción vuelve a la cámara para el siguiente pedido.

## Mapa de proceso (Dashboard Ejecutivo)

Sección **Proceso de pedidos**, justo después del Resumen. Usa el período del Dashboard y sus propios filtros
(empresa, local/provincia, asesor). Los cálculos los hace la base (`trk_proceso`).

- **Indicadores:** pedidos en curso, atrasados ahora, tiempo promedio venta → entrega (contra la suma de los
  objetivos), % entregado a tiempo y errores del período.
- **Mapa:** una caja por etapa con los pedidos que están ahí ahora, los atrasados, una barra con el tiempo
  promedio de la etapa (la marca es el objetivo), % a tiempo y errores. Color + ícono + texto:
  En tiempo / Al límite (hasta 25 % sobre el objetivo) / Con atraso / Sin datos aún.
- **Cuello de botella:** la etapa con más pedidos atrasados ahora (o la más lenta frente a su objetivo).
- **Detalle:** al tocar una etapa se listan sus pedidos actuales y los errores del período; cada uno abre el
  pedido en Trackings. "Ver tabla" muestra todas las cifras en una tabla.
- **Tendencia semanal:** ventas que entraron vs. pedidos entregados, y días de venta a entrega contra el objetivo.

Criterios: "ahora" es la foto actual (no depende del período); el tiempo de una etapa se cuenta cuando el pedido
sale de ella dentro del período; venta → entrega cuenta los pedidos entregados en el período.

## Permisos

- `tracking` › ver: todos los pedidos. `tracking` › editar: configurar tiempos, cancelar pedidos.
- Asesores (CRM / Femedics › ver): ven en Trackings sus propias ventas y las de su equipo; `ver_todos` ve todas.
- Escáner: quien tenga ver en Trackings, Bodega, Logística, Servicio Técnico o Facturación.
- Dashboard Ejecutivo › ver: ve el mapa de proceso y puede abrir cualquier pedido desde ahí (verlo y anotarle).

## Piezas

- `supabase/migrations/20261116000000_seguimiento_pedidos.sql`: tablas, disparadores, cálculo de tiempos, RPC `trk_*`.
- `supabase/migrations/20261116010000_seguimiento_escaner.sql`: `trk_escanear`, `trk_accion`.
- `supabase/migrations/20261116020000_seguimiento_proceso.sql`: `trk_proceso` (mapa del Dashboard).
- `supabase/migrations/20261116030000_seguimiento_ver_dashboard.sql`: el Dashboard puede abrir pedidos.
- `supabase/functions/seguimiento/`: página pública.
- `web/src/modulos/Tracking.tsx`, `Escanear.tsx`, `TrackingVenta.tsx`, `DashboardProceso.tsx`, `web/src/SeguimientoPublico.tsx`.
