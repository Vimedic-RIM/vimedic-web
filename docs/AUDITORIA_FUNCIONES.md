# Auditoría función por función: app original (Apps Script) → app nueva

Fuente: código de Apps Script versión 4 (`origen_appscript/Web App Vimedic (4).json`, 13-nov-2026).
Método: por cada pantalla se listan las funciones de servidor que llama (`google.script.run.*`) y sus
botones, pestañas y ventanas; se busca el equivalente en `web/src/modulos` y `supabase/` (sin suponer).

Estados: ✅ existe en la app nueva · 🆕 recuperado en esta auditoría · ⚠️ parcial · ❌ falta · ➖ no aplica.

## Orden de trabajo (acordado con el usuario)

1. ✅ CRM Vimedic y FEMEDICS
2. ✅ Facturación
3. ✅ Marketing
4. ✅ Carga del Excel actualizado (`datos_origen/Web App Vimedic (2).xlsx`) en vimedic-pruebas
5. ✅ Inventario y Movimientos
6. ✅ Clientes
7. ✅ Agenda
8. ✅ Bodega y Logística
9. ✅ Servicio Técnico
10. ✅ Importaciones, Artículos, Adquisiciones y Recepción
11. ✅ Empleados y Solicitudes del personal
12. ✅ Talento Humano y Financiero
13. ✅ Catálogos, Ofertas y Promociones
14. ✅ Dashboard Ejecutivo
15. ✅ Seguridad, Base de Datos y Mi Espacio (pregunta abierta en #36)
16. ✅ Rendimiento, diseño y uso en el teléfono

Regla: lo construido en la app nueva no se reemplaza (Promociones con aprobación por producto, Por
aprobar, vista de campaña, integraciones de Marketing, Rutas y Viáticos, Adquisiciones, etc.); solo se
agrega lo que falta.

---

## 1. CRM Vimedic y FEMEDICS — Issue #20

Pantallas: `CRMDashboard.html`, `FemedicsCRM.html` (64 funciones de servidor).
Commits: 1dd60b5, d3df08d, 8c42d3d.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `getLeads`, `getLeadDetail`, `getLeadHistory` | Pipeline y ficha | ✅ | `Crm.tsx` |
| `updateLeadStatus` | Cambiar de etapa con reglas | 🆕 | `crm_cambiar_estado` + `FormEtapa` (Contactado, Sin respuesta, Seguimiento, Negociación, Visita, Perdido) |
| `vmRegistrarSeguimiento`, `vmNuevoIntento_` | Seguimiento / nuevo intento sin cambiar etapa | 🆕 | `crm_registrar_seguimiento`; botón en tarjeta y ficha; también al crear una proforma |
| `vmSubirCapturaGestion` | Evidencia (captura o PDF) | 🆕 | Storage `crm/capturas/…` (obligatoria en computadora) |
| `vmRenderEstadoDetalle_` | Detalle del estado actual | 🆕 | `DetalleEstado` en la ficha |
| `addNote` | Nota | ✅ | Ficha |
| `reassignAdvisor` | Cambiar asesor (con aviso) | 🆕 | Ficha + aviso interno al asesor nuevo |
| `updateLeadFields` | Editar datos del contacto | 🆕 | Ficha → "Editar datos" |
| `eliminarGestion`, `vmPapeleraListar/Restaurar` | Papelera | ✅ | `CrmClientes.tsx` |
| `revertirGanado` | Revertir Ganado | ✅ | #13 |
| `crearContactoManual` | Nueva gestión | ✅ + 🆕 | Anuncio/campaña y evidencia conectados |
| `getAnunciosActivos`, `agregarAnuncioActivo` | Anuncios activos | 🆕 | Nueva gestión (Marketing agrega) |
| `processInternalQuote`, `updateInternalQuote`, `processInternalSale`, `convertirLeadAVenta`, `getLeadSaleDetail` | Cotizar / vender | ✅ | `CrmDocumento.tsx` |
| `vmDuplicarCotizacion_` | Duplicar cotización | 🆕 | Ficha |
| `vmRegenerarProformaPdf`, `vmPdfDocumentoBase64` | PDF de la proforma | ✅ / ➖ | La proforma se genera en el navegador |
| `getPipelineStages`, `savePipelineStages` | Administrar etapas | 🆕 | `crm_guardar_etapas` + editor (cierra #15) |
| `getRecentActivity` | Actividad reciente | 🆕 | Campana del CRM |
| `getSimulatableProfiles` (Ver como) | Ver como otro usuario | 🆕 ⚠️ | Filtro "Ver como asesor" (para quien tiene ver_todos) |
| `getFacturasPorCliente` | Facturas del cliente | 🆕 | "Ficha Cliente" abre la ficha completa de Clientes |
| `vmDatosVentaClientes`, `vmGuardarDatosVentaCliente` | Datos de venta predeterminados | ✅ | `clientes.datos_venta` |
| `buscarClientePorIdentificacion`, `createClient`, `updateClientRecord`, `getClientsList`, `vmClienteEliminar` | Clientes | ✅ | `CrmClientes.tsx` |
| `vmInvEstadoStock` (v4) | Stock en revisión / reparación / por llegar al cotizar | 🆕 | `estadoStock.tsx` + `CrmDocumento.tsx` |
| precio con IVA (v4) | "$X IVA incluido" en la tarjeta | 🆕 | `CrmDocumento.tsx` |
| `vmLeadsMetaPanel`, `vmLeadsMetaAsignar` + reparto automático | Leads de Meta | 🆕 | `crm_meta_panel`, `crm_meta_asignar`, trigger de reparto justo |
| `fmGuardarConfig` | Datos de FEMEDICS (remitente de la guía) | 🆕 | `empresa_datos` |
| Mensajería: `getEstadoInicialMensajesCRM`, `getHistorialConversacionCRM`, `enviarMensajeFacebook`, `obtenerUrlAdjuntoZernio`, `marcarConversacionLeidaCRM`, `reasignarConversacionCRM`, `getPerfil*ZernioCRM`, `getCambiosMensajesCRM` | Mensajes | 🆕 | Edge Function `crm-mensajes` + `CrmMensajes.tsx` (cierra #1) |
| `generarRespuestaIA` | Redactar respuesta con IA | 🆕 | `crm-mensajes` (Gemini). En el original faltaba la función de servidor |
| `createRoute`, `createViatico`, `getRoutesList`, `getViaticosList`, `updateViaticoStatus` | Rutas y viáticos | ✅ | #17 |
| `getExtendedDashboardStats` | Gráficos ampliados del CRM (VIMEDIC y FEMEDICS) | ✅ | Panel "Gráficos" del CRM (`CrmGraficos.tsx` + `crm_graficos`), módulo 14 · #35 |
| `getClientAccessStatus`, `setClientAccess` | Acceso de clientes al catálogo | ❌ | Depende del catálogo público (#2) |
| `getMyRoleInfo`, `vmMisPermisosAcciones`, `vmEmpresaCall`, `vmRpc` | Infraestructura | ➖ | `mi_perfil`, RLS y parámetro `empresa` |

Además:
- Avisos internos (tabla `notificaciones`): había avisos guardados que nadie podía ver. Ahora salen en la campana de la barra lateral, en tiempo real.
- Diseño: se quitó una regla de Inventario que cortaba las tarjetas del CRM, y las ventanas grandes ya no quedan debajo de la barra lateral.
- Rendimiento: CRM, Facturación y Empleados se descargan solo al abrirlos (paquete inicial de 927 kB a 547 kB).

Para activar en el uso real (no se puede hacer desde la app):
- Zernio → Webhooks: apuntar a `https://<proyecto>.supabase.co/functions/v1/crm-mensajes?webhook=1` y guardar el secreto como `webhookSecret` en la integración de Zernio. Hacerlo solo al pasar a producción: hoy el webhook apunta a la app de Apps Script.
- Leads de Meta: falta la entrada automática (webhook de Meta Lead Ads). El reparto ya funciona con cualquier lead que entre con `origen_tipo = 'meta'`. Pasa a la vuelta de Marketing.

Recuperado el 16-nov-2026 (#41): la promoción Black en los formularios de proforma y de venta. El primer repaso del CRM no lo vio.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmOfertaChipHtml_` | Chip naranja "OFERTA -30% · Black Sales 2026 · hasta 16/12" en el selector de productos y "OFERTA APLICADA" en el carrito | ✅ | `CrmDocumento.tsx` (proforma y venta de VIMEDIC; en FEMEDICS no, el original tampoco lo usaba) |
| `vmAplicarOferta_` | Al agregar el producto se aplica sola la oferta como descuento; el asesor la puede cambiar | ✅ | `ofertaLinea.ts` (`mejorDeLosDos`) y `CrmDocumento.tsx`; también para los productos que llegan del cotizador de Inventario |
| `vmAplicarDescCliente_` | Si el cliente tiene descuento propio (DIS), se queda con el mejor de los dos | ✅ | `descuentoConCliente` (al agregar y al elegir o cambiar el cliente) |
| `ofActivasMapa_`, `prQuedan_` | Una oferta de campaña (o con límite) deja de aplicar al agotarse el stock o las unidades; con varias ofertas del mismo producto gana la de mayor descuento | ✅ | `inv_ofertas_vigentes` (`quedan`, `apagada`) |
| — | La oferta con la que se cotizó queda guardada en la línea (`items[].oferta`) | 🆕 | La proforma dice con qué promoción se cotizó aunque la campaña termine después |
| — (pedido nuevo) | Porcentaje de la oferta editable en cada línea ("Desc. oferta %", con "Volver a 35 %"); en 0 se quita la oferta | 🆕 | `CrmDocumento.tsx`. La línea sigue siendo "promoción" con el % que lleve (la proforma imprime ese %); al elegir cliente se respeta el % editado |
| — (pedido nuevo) | Proformas hechas antes de la promoción: al abrirlas, aviso en pantalla con los productos que están en promoción y no la llevan, y "Aplicar la promoción" abre la proforma para editar con la oferta ya puesta; cada línea también tiene su botón "Aplicar oferta" | 🆕 | `Crm.tsx` + `proforma.tsx` (el aviso no se imprime) + `CrmDocumento.tsx`. Se corrige por "Editar" para que quede en el historial de versiones |

---

## 2. Facturación — Issue #21 (cierra #6)

Pantalla: `Facturacion.html` (26 funciones de servidor). Commits: 5d6d8b3, c3c7f52 y ca5ca83.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `getFacturacionInicial`, `getFacturacionVista`, `getFacturacionVersion` | Cola de ventas y aviso de cambios | ✅ | `Facturacion.tsx` con tiempo real |
| `getDetalleFacturacion` | Detalle de la venta | ✅ | `Detalle` |
| `subirFactura` | Número y PDF de la factura | ✅ + 🆕 | El PDF se sube a la unidad compartida (Drive); antes solo se podía pegar un enlace |
| `vmFactEditarProductos` | Editar productos antes de facturar | 🆕 | `fact_editar_productos` + `ModalEditarProductos`; actualiza también la cotización del CRM |
| `getMovimientosPorOperacion` | Líneas de la operación | ✅ | Desde `facturas.items` |
| `generarActaCompleta`, `getDatosActaParaEditar` | Acta de entrega / garantía | ✅ | #5 |
| `generarGuiaEnvio`, `getDatosEnvioParaGuia` | Etiqueta de envío | ✅ | `ModalGuiaEnvio` |
| `registrarNotaCredito`, `registrarRecepcionNC`, `getNotasCreditoFactura` | Notas de crédito y recepción de devoluciones | ✅ + 🆕 | `nc_*`; ahora también se sube el PDF de la nota (cierra #6) |
| `completarNotaCredito`, `completarRecepcionNC`, `vmNcRegistrosDanados` | Reintentos y reparación de datos de la hoja | ➖ | En la base nueva cada operación es atómica |
| `crearIngreso`, `getIngresosList`, `vmCatalogosIngreso` | Ingresos de proveedor (modo Adquisiciones) | ✅ + 🆕 | `Adquisiciones.tsx`: indicadores, buscador, detalle de cada ingreso |
| `vmCrearProveedorIngreso` | Crear proveedor desde el ingreso | 🆕 | `Adquisiciones.tsx` |
| `vmCrearProductoIngreso` | Crear producto desde el ingreso | 🆕 | `Adquisiciones.tsx` (con permiso de Inventario) |
| filtros, agrupar, exportar CSV, indicadores | Herramientas de la cola | ✅ | `Facturacion.tsx` |
| `vmPdfDocumentoBase64` | Abrir PDFs de Drive dentro de la app | ➖ | Se abren directo |

Pedidos del usuario durante la vuelta (CRM): al vender o cotizar, el cliente que ya existe se vincula solo
(c3c7f52); el medio de captación de la venta se guarda aparte del medio del lead (ca5ca83).

Además: Adquisiciones y Rutas y viáticos se veían sin estilo (usaban clases que solo existen dentro de otros
módulos); ahora tienen una hoja común (`estilos/comun.css`).

### Datos (13-nov-2026): CRM y Facturación al día con el Excel nuevo

Pedido del usuario: actualizar CRM y Facturación y depurar lo que no exista (pruebas hechas en qa).
- Clientes, leads (contactos, WhatsApp, citas, Meta), cotizaciones y ventas, interacciones, facturas, notas de
  crédito, ingresos de proveedor y movimientos: lo nuevo se insertó y lo existente quedó igual que en la app
  original (insertar o actualizar por código).
- Se dieron de baja (borrado lógico con motivo) los registros de prueba que no están en el Excel: 2 clientes,
  52 interacciones y 1 factura, además de las versiones de proforma y los despachos que dependían de pruebas.
- Las pruebas de qa habían modificado cotizaciones reales (convertidas en venta, etapas cambiadas): con la
  actualización volvieron a su estado real.
- El stock de los productos se vuelve a tomar del Excel en la vuelta de Inventario.

Corregido el 16-nov-2026: buscador de clientes del CRM y restricción "cliente de otro asesor" como el original.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `getClientsList` (esPropio), `filaResultadoCliente_`, `clienteCoincideBusqueda_` | El buscador cruza TODOS los clientes: los propios primero; los de otro asesor salen en rojo con candado, solo con el nombre y "Asignado a: X — no editable" (sin cédula, ciudad, correo ni teléfono). Sin tildes ni mayúsculas; cédula y teléfono también por dígitos | ✅ corregido | `crm_buscar_clientes` (migración `20261116100000`) en el formulario de cotización/venta, la lista de Clientes del CRM y Nueva gestión. Antes un asesor solo encontraba sus propios clientes (y podía duplicar uno ajeno) |
| esPropio = sin asesor | Un cliente sin asesor lo puede ver y usar cualquier asesor | ✅ corregido | Políticas `clientes_ver_sin_asesor` / `clientes_editar_sin_asesor` (antes los asesores no los veían) |
| `verificarClienteNoAjeno_` | Bloqueo real: no se crea cotización/venta para la cédula/RUC de un cliente de otro asesor (quien ve todo queda exento); el Asistente de Gerencia con un cliente de un jefe la deja a nombre de ese jefe | ✅ corregido | Disparador `tg_cotizacion_cliente_no_ajeno`. Cliente con cédula repetida: mensaje claro (`tg_cliente_no_duplicado`) |
| `submitSale` (CRMDashboard.html) | Una venta exige un cliente existente; el lead solo sirve para cotizar | ✅ corregido | `CrmDocumento.tsx` (antes una venta abierta desde un lead podía guardarse sin cliente) |
| Asistente Ventas Gerencia (`Leads.gs`) | Todo lo que crea queda a nombre de un jefe (se elige "A nombre de"), nunca a su nombre | ✅ | `CrmDocumento.tsx`: el selector solo muestra a la Alta Dirección y es obligatorio |

Pruebas: `supabase/tests/crm_clientes_buscador.sql` (14 casos).

Corregido el 16-nov-2026: actas y guía de envío iguales al original.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `generarActaCompleta` (FOR.ADM.08 / FOR.ADM.09) | Un solo PDF con el número de la factura: **Acta de Entrega / Entera Satisfacción** (información del cliente, equipos con series y garantía, cláusulas 1-4, firmas de entrega y recepción) + **Carta de Garantía** (equipos en garantía, condiciones 1-7, cronograma de mantenimiento cada 6 meses con fechas, firma electrónica del Director Ejecutivo) + **Anexo** para stickers de serie. Exige la factura subida; garantía 0-10 años o 0-120 meses; equipos añadidos a mano (hasta 30); "sin garantía" por equipo | ✅ corregido | `documentosFacturacion.ts` (`htmlActa`, `pdfDeHtml`) y `ModalActaGarantia`. Antes se generaba una página HTML simplificada distinta del original. Ahora se arma el PDF, se guarda en Drive (carpeta "Actas"), los datos quedan en `acta_datos` con el formato del original (series por código|ocurrencia) y al editar se cargan; si no hay, toma las series que registró Bodega. Se anota en la bitácora y en el historial del CRM |
| `generarGuiaEnvio`, `getDatosEnvioParaGuia` | Etiqueta con logo, franja de aviso (frágil · equipo médico), ciudad, destinatario y remitente; todo con el tamaño de letra más grande que entra en una hoja (30 → 14 px); solo para ventas por Envío (o con guía previa) | ✅ corregido | `htmlGuia`, `tamanoGuia` y `ModalGuiaEnvio`: PDF en Drive (carpeta "Guias de Envio"), datos en `guia_datos` (se cargan para volver a generarla), remitente del Pago/Entrega. Imagen de aviso del original en `web/public/aviso-guia.jpg` |
| Botones **Editar acta** / **Editar guía** (lápiz en la tarjeta y en el panel: `openWarranty` / `openGuide` con lo guardado) | Abrir el mismo formulario con lo ya generado para corregir y volver a generar el PDF | ✅ agregado (faltaba: con el PDF hecho solo salía «Ver») | `PanelLateral` y panel de Documentos de `Facturacion.tsx` |
| Formulario del acta: añadir equipos (`acAnadirEquipo_`, lista del catálogo), quitar con confirmación, Enter pasa a la siguiente serie, contador «n / N series», «Garantía: X» por equipo, «Mantenimiento N (mes 6N)» | Agregar productos que no están en la venta con su cantidad y series | ✅ corregido | `ModalActaGarantia`: listado rápido con foto, código y nombre (visibles al público primero); cantidad editable en lo añadido; se arreglaron la fila de añadir y el cronograma, que usaban clases inexistentes en el CSS |
| Formulario de la guía: etiquetas de cada campo | Saber qué campo es cuál al editar (con todo lleno) | ✅ corregido | `ModalGuiaEnvio` |

Corregido el 16-nov-2026: datos de pago/entrega en Facturación, Bodega desde cero y enlace público del seguimiento.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `crearRegistroFacturacion_` ("Datos Completos") | La venta llega a Facturación con su Pago/Entrega; solo si falta se avisa "Faltan datos de pago/entrega" y no se puede subir la factura | ✅ corregido | La primera carga no trajo la columna "Pago Entrega JSON" de la hoja Cotizaciones. Recuperado en QA: 239 facturas (`pago_entrega`, `datos_completos`) y 243 ventas del CRM (pago, método, entrega, dirección, fecha, `detalle_venta`). Quedan 11 facturas sin esos datos tampoco en el Excel. Anotado en `MAPEO_HOJAS.md` para la carga de producción |
| Bodega (pedido del 16-nov-2026) | Empezar desde cero: solo los pedidos nuevos | ✅ | Los 130 pedidos "Por preparar" / "En preparación" anteriores quedaron archivados (`deleted_at = 2026-11-16 23:00-05`, se pueden recuperar quitando esa fecha) |
| Enlace de seguimiento del pedido | Que el cliente reciba vimedic.com.ec/seguimiento/ y no el dominio de la app | ⚠️ listo, falta subir la página | `web/src/enlacesPublicos.ts` (`VITE_URL_SEGUIMIENTO`), `hostinger/seguimiento/index.html` (para `public_html/seguimiento/`), `_headers` (se deja mostrar dentro de vimedic.com.ec). Pasos en `docs/PASO_A_APP.md` |

Corregido el 16-nov-2026 (urgente): cuando una oferta termina, todo vuelve a la normalidad.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `ofActivasMapa_` | Una oferta deja de aplicarse al pasar su fecha de fin (vale hasta el final de ese día), al pausarse o cancelarse y al quedarse sin unidades (campaña o con límite) | ✅ corregido | `ofertasInv.ts` (`hoyEC`, `ofertaActiva`), `ofertaLinea.ts` (`ofertaDeLinea`, `mapaOfertas`) e `Inventario.tsx`. Antes la tarjeta del Inventario seguía mostrando la oferta cuando estaba apagada (sin unidades) y una pestaña abierta no se enteraba del fin hasta recargar. Ahora se vuelve a leer cada 5 minutos y al volver a la pestaña, y el cambio de día se aplica en menos de un minuto. Con la oferta terminada: sin cinta ni precio tachado, el botón vuelve al portapapeles y el texto de WhatsApp lleva el precio normal; cotización y venta tampoco la aplican (las ya guardadas conservan su precio) |

Agregado el 16-nov-2026 (urgente): copia rápida del Inventario con la promoción (Black) para WhatsApp.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `copiarProducto` de Inventario.html (botones PVP / DIS) | Si el producto tiene una promoción vigente para ese tipo de cliente, el texto para WhatsApp lleva la etiqueta y el descuento en negrita (`*BLACK -20%*`; "PROMOCIÓN" si la campaña no es Black), el PVP anterior tachado (`~`) y el precio nuevo en negrita. En la tarjeta el botón sigue diciendo PVP / DIS y cambia el portapapeles por un fuego amarillo; en el panel de la lista y en la ficha el botón dice BLACK. En DIS el descuento se da siempre sobre el PVP y solo se menciona cuando es MAYOR que el descuento normal de su precio DIS; si no lo supera, queda el "Precio distribuidor" de siempre. Sin promoción el texto sigue igual | ✅ agregado | `Inventario.tsx` (`copiarTexto`, `ofertaCopiaPvp`, `ofertaCopiaDis`, `useOfertaDis`; tarjeta, panel de la lista y ficha), `ofertasInv.ts` (`etiquetaOferta`), `inventario-ofertas.css`. No se muestra si la oferta está apagada, es próxima o es un Combo |

Agregado el 16-nov-2026 (urgente): ofertas por tipo de cliente (PVP, DIS o ambos), puestas solas en cotización y venta.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| (mejora pedida; el original daba la oferta a todos) | Cada oferta y cada campaña dice a quién se da: clientes PVP, distribuidores DIS o ambos (por defecto ambos: lo que ya existía no cambia). Un producto puede tener una oferta distinta para cada tipo. En cotización y venta la oferta se pone sola solo al tipo de cliente elegido (sin cliente = PVP); al cambiar de cliente se quita la que no le corresponde; un DIS se queda con lo mejor entre su precio DIS y la oferta | ✅ agregado | Migración `20261116090000_ofertas_publico_pvp_dis.sql`: `ofertas.aplica_a`, `promo_campanas.aplica_a`, trigger que hereda de la campaña al aprobar, `ofertas_aplicar_publico` y `inv_ofertas_vigentes` con `aplicaA`/`ganaPara`. Pruebas en `supabase/tests/ofertas_publico.sql` (15 casos). Front: `CrmDocumento.tsx`, `Crm.tsx` (aviso de promoción faltante), `ofertaLinea.ts`, `ofertasInv.ts` |
| Pantallas | Ofertas: selector "Se da a" en cada oferta y etiqueta "Solo PVP / Solo DIS". Marketing › Promociones: "Se da a" al crear la campaña y en su detalle (cambia también las ofertas ya creadas). Inventario › Ofertas vigentes: filtro Todos / Para PVP / Para DIS y el PDF sale para cada tipo de cliente | ✅ agregado | `Ofertas.tsx`, `MarketingExtra.tsx`, `InventarioOfertas.tsx`, `ofertasPdf.ts`, `Inventario.tsx` (la cinta de precio sigue siendo la del público: PVP) |

Corregido el 16-nov-2026 (urgente): cotización/venta con clientes DIS y búsqueda de clientes sin tildes ni mayúsculas.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `esTipoClienteDIS_`, `calcularDescuentoParaCliente_`, `vmAplicarDescCliente_`, `vmDisExacto_` | Cliente DIS: nivel 5/10/15 = ese % sobre el PVP; VIP y DIS "a secas" (sin nivel) = precio DIS de cada producto, mostrado como PVP con el % exacto al centavo (si no cuadra, se mueve el precio unitario unos centavos) | ✅ corregido | `modulos/precioCliente.ts` y `CrmDocumento.tsx`. Antes solo el VIP usaba el precio DIS (y como precio sin descuento): los 249 clientes DIS sin nivel (de 263) se cotizaban a PVP, y al elegir el cliente después de agregar productos no recibían su precio. Con 2.359 productos de QA: 2.277 cuadran al centavo, 270 con ajuste de centavos (igual que el original), 78 sin precio DIS utilizable. Al abrir una proforma guardada con su mismo cliente ya no se recalcula nada. La tarjeta de producto muestra lo que paga el cliente y "DIS −X% · PVP" |
| (mejora pedida) | Los buscadores de clientes no distinguen tildes ni mayúsculas ("jose" encuentra a "José", "munoz" a "Muñoz": en QA 35 → 55 y 0 → 13 resultados) | ✅ | Columna generada `clientes.busqueda` (texto normalizado + índice trigram), `public.sin_tildes()` y `web/src/busqueda.ts`. Formulario de cotización/venta, lista de Clientes del CRM, módulo Clientes (incluye al asesor), nueva gestión, Rutas y Viáticos, Servicio Técnico (factura por cliente), bandeja de mensajes y reparto de Meta |

Agregado el 16-nov-2026 (urgente): rol "Asistente Comercial Gerencia" — cotizaciones y ventas de la Alta Dirección.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| (necesidad nueva, no existía en Apps Script) | Quien asiste a los jefes gestiona TODO lo comercial de la Alta Dirección (leads, clientes, cotizaciones, ventas y su seguimiento) a su nombre, sin ver el resto del CRM | ✅ agregado | Migración `20261116070000_rol_asistente_comercial_gerencia.sql`: rol de sistema con los permisos de un Asesor; `app.gerencia_asistida()`; políticas **adicionales** en `leads`, `cotizaciones` y `clientes` (ver y editar lo asignado a la Alta Dirección); `app.trk_ve` incluye a los asistidos; `mi_perfil()` trae `asiste_a`. NO se tocó `es_yo_o_subordinado` (Rutas y Viáticos no se abren). Los jefes = rol CRM "Alta Dirección"; el asistente = rol CRM "Asistente Comercial Gerencia". Pruebas: `supabase/tests/asistente_gerencia.sql` (24 casos) |
| Formularios de Cotización/Venta y lista de Clientes | El cliente de un jefe ya no se bloquea ("ya está asignado a otro asesor"); la proforma/venta sale a nombre del jefe (por el cliente o por la gestión de origen); el selector de asesor pone primero a la Alta Dirección; la lista de Clientes incluye los de los jefes | ✅ agregado | `CrmDocumento.tsx` (`deGerencia`, `ajeno`, `elegirCliente`, selector), `CrmClientes.tsx`, `Crm.tsx` (`origen.asesorId`), `supabase.ts` (`Perfil.asiste_a`). Se asigna en Empleados → Rol |

Corregido el 16-nov-2026: el formato de los nombres en los formularios se había perdido.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `primeraMayusculaEnVivo_`, `formatearNombrePropio_` (CRMDashboard.html, Empleados.html) | Primera Mayúscula y el resto en minúscula, mientras se escribe, en Nombre completo, Institución/Empresa, Persona y Cargo de contacto, Ciudad, lead rápido de cotización/venta y Empleados | ✅ corregido | `formatoNombres.ts`. La app nueva solo subía la primera letra: un nombre pegado, traído de un lead o escrito en mayúsculas se guardaba en mayúsculas (cliente CLI-B1EFD7 "LOPEZ DIAZ CRISTOPHER ADRIAN"). Ahora también se aplica a lo que llega ya escrito y al guardar; al editar, lo que no se tocó queda como estaba (razones sociales migradas como "HTOM S.A.S.") |

Corregido el 16-nov-2026 (#42, urgente): el envío de una venta a Facturación no funcionaba.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `crearRegistroFacturacion_` | Cada venta del CRM entra a Facturación como "Pendiente" con sus datos de pago y entrega | ✅ corregido | `public.enviar_venta_a_facturacion` (existía solo en el esquema `app`, que la API no expone: el formulario mostraba "No se pudo enviar a Facturación" y la venta quedaba "Ganado" sin factura) |
| `registrar_bitacora`, `registrar_ingreso_proveedor` | Bitácora de Facturación (guía de despacho, acta) e ingreso de proveedores (Adquisiciones) | ✅ corregido | Mismo defecto y misma corrección: versiones en `public`. Pruebas en `supabase/tests/facturacion_envio.sql` |
| — | Un reintento del formulario creaba otra venta | ✅ corregido | `CrmDocumento.tsx` reutiliza la venta ya guardada |

Recuperado el 16-nov-2026 (#41): la etiqueta de promoción en la proforma.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `generateInternalQuotePDFBase_` (Documentos.gs, `enPromo`) | Si el producto está con una oferta vigente y la línea lleva descuento: etiqueta con el nombre de la campaña y el % junto al nombre, "PRECIO NORMAL" tachado y "PRECIO PROMOCIÓN" en los totales | ✅ | `proforma.tsx` (proforma y comprobante de venta). Más exacto que el original: solo se marca si el descuento de la línea es el de la oferta (con otro descuento, p. ej. el del cliente, no se dice que es promoción) |

---

## 3. Marketing — Issue #22

Pantalla: `Marketing.html` (85 funciones de servidor) con `Data Marketing.gs`, `MarketingFlujo.gs`,
`Data Audiovisual.gs`, `MarketingIA.gs`, `MarketingSeo.gs`, `Galeria*.gs`, `MediaWeb.gs`, `InformesDesempeno.gs`.
Commits: ee8b3ef, 67e8b51, 9d8bcf1, 7c2e431 y el de Anuncios.

### Planificador (`MarketingPlanificador.tsx` + Edge Function `marketing-integraciones`)

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `mkCuentas` | Cuentas conectadas en Zernio | ✅ | `zernio_cuentas` |
| `mkPublicaciones` | Publicaciones con estado, error y enlace de cada red, producto y pieza | 🆕 | `zernio_posts` (con páginas) |
| calendario semana / mes / lista, filtros por estado y red | Vista del planificador | 🆕 | Antes solo había una lista |
| `mkReprogramar` | Arrastrar para cambiar la fecha | 🆕 | `zernio_reprogramar` |
| `mkEditarPublicacion` | Editar texto y fecha; publicar un borrador | 🆕 | `zernio_editar` |
| `mkEliminarPublicacion` | Eliminar (solo borradores, programadas o fallidas) | ✅ + 🆕 | `zernio_eliminar` revisa el estado |
| `mkPresign` | Subir imagen o video directo a Zernio (hasta 300 MB) | 🆕 | `zernio_presign`; el navegador sube el archivo |
| `mkPublicar` | Feed, Historia o Reel; video; reglas de Instagram, TikTok y YouTube; borrador; sin duplicados | 🆕 | `zernio_crear` (antes solo imágenes) |
| `mkGenerarCopyIA`, plantilla rápida | Copy por tipo con datos reales del producto; siempre invita a la web | 🆕 | `ia_texto` |
| cola en segundo plano | Las cargas siguen con avance y reintento | 🆕 | Planificador |
| bandeja "Listo para publicar" (`programarAvEn`) | Arrastrar una pieza al calendario | 🆕 | Planificador |
| `mkfDiferir_` | Lo que publica Asistente o Audiovisual espera a Coordinación | 🆕 | `marketing_mi_rol` + `zernio_aplicar` |

### Audiovisual

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `avListar`, `avGuardar`, `avCambiarEstado`, `avEliminar` | Piezas, tablero por estado, papelera | ✅ | `Marketing.tsx` (eliminar ahora pide confirmación) |
| `avIniciarSubida`, `avSubirParte`, `avEstadoSubida` | Videos grandes por partes (hasta 2 GB) | 🆕 | Hasta 45 MB en la app; más pesados a Drive por partes (`drive` › `subida_iniciar`) |
| `avMiniatura`, `avGuardarMiniatura`, portada | Miniatura y portada de cada video | 🆕 | `audiovisual.miniatura_url` |
| detalle (`openAvDetail`, `avGuardarDetalle`) | Vista previa, producto, fecha, responsable, reemplazar archivo, copiar enlace | 🆕 | `ModalPieza` |
| `avPrepararZernio`, `avCompletarEnlaces` | Enlace directo para Zernio | 🆕 / ➖ | `drive` › `compartir`; los archivos de la app ya son públicos |
| `avVincularPublicacion` | La pieza queda Programada o Publicada | ✅ | Edge Function |

### Revisión del equipo (`MarketingRevision.tsx`)

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `mkfCambiar_`, `mkfGuardarCampo` | Directo, corrección menor, publicación directa o a revisión; reenvío al corregir | 🆕 | `mkt_cambiar_campo` (la Biblioteca lo usa) |
| `mkfRegistrarDirecto_` | Cambios de galería quedan para revisar | 🆕 | `mkt_registrar_directo` |
| `mkfBandeja`, `mkfContador`, `mkfMisEnvios` | Por aprobar, aplicados, contador, mis envíos | 🆕 | `mkt_revision_bandeja`, `mkt_revision_contador`, `mkt_mis_envios` |
| `mkfAprobar` (con edición), `mkfDevolver`, `mkfRechazar`, `mkfMarcarRevisado`, `mkfDeshacer` | Decisiones de Coordinación | 🆕 | `mkt_revision_decidir` |
| `mkfDesempeno`, `mkfDefinirDirecta` | Desempeño por persona; publicación directa | 🆕 | `mkt_desempeno`, `mkt_definir_directa` |
| `mkfInformeDesempeno` | Informe PDF semanal o mensual (Marketing y comercial) | 🆕 | `mkt_informe_comercial`; el PDF queda en Drive › Informes |
| `mkfGuardarAjustes` | Contacto de la ficha técnica | 🆕 | `marketing_ajustes` |
| `mkfEnviarResumen`, `mkfAprobarDesdeCorreo_` | Resumen y aprobación por correo | ❌ | Falta un servicio de correo (pregunta en #23) |
| `ftRegenerarTodas`, `mkfSeoOptimizarTodo` | Rehacer todo en segundo plano | ⚠️ | Por producto desde la Biblioteca |

### Biblioteca

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `mkProductos`, `mkVisiblePublico`, `mkEtiquetaNuevo`, `mkGuardarEnlaces`, `mkSubirArchivo` | Datos del producto | ✅ | `MarketingIntegraciones.tsx` |
| `mkfPendientes` | Por completar y Videos pendientes, por cotizaciones | 🆕 | `mkt_pendientes` + `MarketingPendientes.tsx` |
| `mkCambiarImagen`, `mkSubirImagenProducto` | Subir imagen principal | 🆕 | Espacio `catalogo` (WebP) |
| `mkGuardarGaleriaProducto`, `mkAvGaleriaPreparar/Parte`, `mkMediaPermiso` | Subir fotos y videos a la galería; tipo de video | 🆕 | Espacio `catalogo` |
| `mkIADescripcionProducto` | Descripción y características con IA | ✅ | `ia_producto` |
| `mkIAEspecificaciones` | Especificaciones leídas de la ficha PDF | 🆕 | `ia_especificaciones` |
| `mkfSeoRevision`, `mkfSeoProductoAhora` | Puntaje SEO y textos alternativos | ✅ / ⚠️ | Renombrar archivos de Drive no aplica a los archivos nuevos |
| `mkCategoriasCatalogo`, `mkGuardarCategoriaCatalogo` | Tarjetas de categorías del catálogo | ➡️ | Vuelta de Catálogos (#10) |

### Resumen y Anuncios

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `mkDashboard` | Resumen de resultados | ✅ | `Marketing.tsx` |
| `mkAnuncios` | Gasto, impresiones, clics y conversiones de cada anuncio (Zernio Ads) | 🆕 | `zernio_anuncios` + `MarketingAnuncios.tsx` |
| `mkEstadisticas_` | Leads y ventas del CRM por anuncio o campaña; costo por lead | 🆕 | `mkt_atribucion` |
| `mkPuedeIndicadores_` | Resumen y Anuncios solo con "Ver indicadores de Marketing" | 🆕 | `marketing_mi_rol.indicadores` (el permiso existía en Empleados pero no se usaba) |

### Otros archivos

- `Marketing tracking.gs`, `Tracking_Campanas.gs`: píxeles, conversiones y feed de Pinterest ✅ (#12).
- `Contenido zernio.gs`: reemplazado por la Edge Function ✅. `Diagnostico conexión redes.gs`: herramientas del editor ➖ (Configuración › Probar conexión).
- `LeadsMeta.gs`, `CorreoLeadsMeta.gs`: el reparto ya funciona (#20); la entrada automática y los correos necesitan una decisión (#23).
- `Promociones.gs` (informe final, interesados, kit de arte, tablero) pasa a la vuelta 13; `MaterialProveedores.gs` y Recepción (`vmRec*`) a la vuelta 10.

Para probar en qa: Coordinación es quien tiene el rol "Coordinación" en Empleados o el permiso Marketing › aprobar.
En pruebas, la única persona con rol de Marketing también es superadministrador, así que todo le sale directo;
para ver el flujo de aprobación hay que darle a alguien el rol Marketing sin ser superadministrador.

---

## 4. Datos del Excel nuevo: resto de módulos (13-nov-2026) — Issue #24

Fuente: `datos_origen/Web App Vimedic (2).xlsx`. Método: insertar lo nuevo y actualizar por código solo las filas
que cambiaron en la app original (las demás no se tocan ni cambian su fecha de actualización). **No se borró nada
creado en qa.** Antes de aplicar se hizo un ensayo en seco de cada tabla dentro de una transacción que se deshace.

| Tabla | Filas en el Excel | Nuevas | Actualizadas | Nota |
|---|---|---|---|---|
| `productos` | 2 870 | 0 | 42 | 31 con otro stock, 7 descripciones, 7 fichas, 6 características y especificaciones, 5 carpetas, 2 reservaciones, 2 accesorios, 1 nombre, 1 visible en el catálogo |
| `despachos` | 113 | 14 | 0 | Los enlaces de seguimiento creados en qa se conservan |
| `imp_expedientes` | 3 | 0 | 1 | |
| `imp_ordenes_st` | 2 | 1 | 0 | |
| `imp_recepciones` | 24 | 4 | 0 | |
| `marketing_cambios` | 270 | 124 | 15 | Las 15 son revisiones de Coordinación en la app original |
| `catalogo_actividad` | 355 | 43 | 0 | |
| `bitacora` | 599 | 368 | 0 | |
| `producto_galeria` | 209 | 24 | 0 | |
| `fichas_tecnicas` | 35 | 15 | 0 | |

Sin cambios (ya estaban al día): proyectos, actividades, monedas de la agenda, rutas, viáticos, ítems y códigos de
importación, mensajes y asignaciones, audiovisual, publicaciones, promociones, material de proveedores, documentos
técnicos, anuncios activos, catálogos generados, tipos de permiso, proveedores y aliados.

Cambios de stock (antes → después): EQM003 -1→0, EQM025 -1→-2, EQM080 0→-1, EQM1025 2→1, EQM1188 1→0, EQM128 52→50,
EQM246 19→18, EQM327 -1→0, EQM512 2→1, EQM639 0→-1, EQMH004 0→1, EQMH016 5→1, FLETE EXT -103→-105, FLETE IN -76→-75,
INM892 205→209, INM893 -22→-18, MOB032 5→3, MOBI020 89→3, MOBI051 -6→-5, MOBI053 9→8, MOBI074 1→0, MOBI078 -2→-3,
MOBI091 87→86, MOBI092 46→45, MOBI340 1→3, MOBI703 0→-2, MOBIH005 4→9, MOBIH037 7→6, REH093 1→0, REH553 -1→-2, VAR048 23→19.

Se conservó lo de qa a propósito:
- EQM491: el Excel trae "NO ENCONTRADO…" en lugar de un enlace de imagen.
- MOBI050: tiene datos destacados en qa y vacíos en el Excel. Los destacados del Excel se guardan con el formato de la app nueva (`dato|dato`).
- Promociones: solo se agregan las que faltan; las 4 campañas dadas de baja en qa siguen así (tienen aprobaciones por producto de la app nueva).
- Proveedores: qa tiene 106 y el Excel 11; los creados en la app nueva (Adquisiciones) se conservan.

Empleados (no se tocó nada; decisión en el Issue #24): no hay empleados nuevos. `asistente.gerencia@` y
`ejecutiva.ventas@` están inactivos en qa y activos en el original; el cargo de `direccion.marketing@` en qa es
"Administrador del sistema" y en el original "Marketing"; `prueba@` solo existe en qa.

No se cargan (no hacen falta): Codigos Faltantes (reporte), Marketing Enlaces (enlaces de un solo uso del correo),
Sesiones y Accesos (los reemplaza Supabase Auth), Papelera (la reemplaza el borrado lógico).

---

## 5. Inventario y Movimientos — Issue #25

Pantallas: `Inventario.html` (20 funciones de servidor) y `Movimientos.html` (5). Archivos: `Productos inventario.gs`,
`DataMovimientos.gs`, `CargaRapida.gs`, `CategoriasCatalogo.gs`, `FichaTecnica.gs`, `DocumentosTecnicos.gs`, `ProductoDetalle.gs`.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmInventarioInicial`, `getFullInventoryForCRM`, `getProducts`, `getCategories` | Carga del inventario (búsqueda, categorías, orden, páginas) | ✅ | `Inventario.tsx` |
| `crearProducto`, `actualizarProducto` | Agregar / editar producto | ✅ | `FormularioProducto` (#9) |
| `subirImagenProducto`, `subirImagenProductoForm` | Subir la imagen desde la computadora | 🆕 | Formulario y "Editar multimedia" (WebP en el espacio `catalogo`); antes solo se podía pegar el enlace |
| `getProductoRawMultimedia`, `actualizarMultimediaProducto` | Imagen, ficha técnica y carpeta de multimedia | 🆕 | `inv_guardar_multimedia` + `InventarioMultimedia.tsx` |
| `getGaleriaProducto`, `guardarGaleriaProducto` | Galería: fotos, videos, orden, texto alternativo, tipo de video | ✅ / 🆕 | Se veía en el detalle; ahora se edita (`inv_galeria_guardar`) |
| permiso "Editar Multimedia" (`puedeEditarMultimedia_`) | Editar multimedia sin editar el resto del producto | 🆕 | `app.puede_multimedia` (el permiso existía en Empleados pero no se usaba) |
| precios Femedics (`invPreciosFemedics_`, `fmReglaPrecio_`) | PVP +11,11 % para quien tiene el permiso o es de FEMEDICS, con aviso | 🆕 | `mis_banderas` + `Inventario.tsx` (el permiso existía pero no se aplicaba) |
| `copiarCorto_`, `linkEquipoInv_` | Copiar nombre, código y precio con "Ver equipo" y el asesor | ✅ + 🆕 | Faltaba el enlace con `&a=asesor` |
| `toggleEstadoProducto`, mostrar inactivos | Activar / desactivar | ✅ | `Inventario.tsx` |
| `guardarOrdenInventario` | Ordenar arrastrando | ✅ | `inv_guardar_orden` |
| `vmInvEstadoStock` | En revisión, en reparación, por llegar | ✅ | `inv_estado_stock` |
| etiqueta `p.oferta` ("OFERTA -X % · $precio") | Oferta vigente en la tarjeta y el detalle del producto | ✅ (16-nov, #39) | `inv_ofertas_vigentes` + `Inventario.tsx`; se había perdido en la migración |
| — (pedido nuevo, #39) | Filtro "Solo con oferta" y pantalla "Ofertas vigentes": elegir categorías y productos y descargar PDF (catálogo con fotos o lista compacta con foto pequeña de cada producto, VIMEDIC/FEMEDICS, con o sin IVA, versión interna, compartir). #40: fecha límite que ve el cliente (la real, otra o ninguna) y el nombre de la campaña como título | 🆕 | `InventarioOfertas.tsx`, `ofertasPdf.ts` |
| `vmProductoEliminar`, `vmPapeleraListar/Restaurar` | Eliminar y papelera | ✅ | `PapeleraProductos` |
| `getCategoriasCatalogo`, `guardarCategoriaCatalogo` | Categorías del catálogo | ✅ | `GestionCategorias` (#10) |
| `ft*` (ficha técnica), `dt*` (documentos técnicos) | Ficha automática y documentos | ✅ | Marketing › Biblioteca (#7, #11) |
| `vmPdfDocumentoBase64`, `vmImagenProductoBase64` | Ver PDF dentro de la app; descargar imagen | ➖ | Se abren directo |
| `copiarProducto`, `copiarImagenProducto_` | Copia completa y copiar imagen | ➖ | Código sin uso en el original (ningún botón los llamaba) |
| `mvDatos`, `vmMovDetalle`, `vmEditarMovimiento`, `vmRecalcularStockGeneral` | Movimientos: lista, detalle, modificar con motivo, recalcular stock | ✅ | `Movimientos.tsx` |
| `getMovimientosPorProducto`, `actualizarStockInventario`, `separarDetallesProductos`, `vmCRMInicial`, `vmAgendaCatalogos`… | Ayudas internas y cargas rápidas de otras pantallas | ➖ | Consultas y RLS de la base nueva |

Verificación del stock (13-nov-2026): de 1 448 productos con movimientos, el stock coincide con la suma de sus
movimientos salvo en 2 (EQM327: stock 0, movimientos −2; MOBI053: stock 8, movimientos 9). Están así en la app
original; "Recalcular stock" los dejaría en el valor de los movimientos.

---

## 6. Clientes — Issue #26

Pantalla: `ClientesVista.html` (5 funciones de servidor: `ClientesModulo.gs`). Las de `Clientes.gs` las usa el CRM (sección 1).

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmCliLista` | Lista con indicadores, búsqueda, asesor, orden y filtros (con compras, solo cotizaron, sin actividad, sin gestiones) | ✅ | `Clientes.tsx` (`v_clientes_lista`, `v_clientes_kpis`) |
| `vmCliDetalle` | Ficha: resumen, datos, facturas (factura, acta, guía), cotizaciones, productos comprados | ✅ | `Ficha` |
| `vmCliDetalle` › historial | Interacciones de las cotizaciones y gestiones del cliente | ⚠️ → 🆕 | Salía siempre vacío: buscaba por cliente y las interacciones están ligadas a la cotización. Ahora trae ambas |
| `vmCliGuardarNota` | Notas internas que se guardan solas | ⚠️ → 🆕 | Sobrescribía la última nota aunque fuera de otra persona. Ahora, como el original, solo actualiza tu nota de los últimos 15 minutos; si no, agrega una nueva, y se ven las anteriores |
| `vmCliGuardar` | Crear y editar cliente (cédula 10 o RUC 13 dígitos, sin repetir, correo válido) | ✅ | `NuevoCliente` y pestaña Datos |
| `vmCliEliminar` | Eliminar con motivo (papelera) | ✅ | `ConfirmarEliminar` |
| `getClientsList`, `buscarClientePorIdentificacion`, `createClient`, `updateClientRecord`, `vmDatosVentaClientes`, `vmGuardarDatosVentaCliente`, `vmClienteEliminar` | Clientes desde el CRM | ✅ | `CrmClientes.tsx` (sección 1) |
| columnas extra de la hoja | Otras columnas sin formulario | ➖ | La tabla nueva no tiene columnas sueltas |

---

## 7. Agenda — Issue #27

Pantalla: `Agenda.html` (todas sus llamadas pasan por `llamarServidor_`). Archivos: `Data agenda.gs`, `TiendaAgenda.gs`,
`Rutas viaticos.gs`.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `getMisPermisosAgenda`, `vmMisPermisosAcciones` | Acceso y botones según permisos | ✅ | `puede(perfil, 'agenda', …)` |
| `getMisActividades` | Mi agenda, me asignaron, delegadas y ver equipo (jefatura) | ✅ | `Agenda.tsx` + RLS de `actividades` |
| `guardarActividad` (tarea) | Crear / editar, delegar a personas o a un área (una tarjeta por persona), revisar al terminar, fecha, prioridad, proyecto, evidencias | ✅ | `Formulario` |
| `guardarActividad` (reunión) | "¿Con quién?": compañeros y correos externos como invitados, sin delegar; exige fecha, hora y participantes | ❌ → 🆕 | Antes la reunión creaba una tarea por persona. Ahora guarda `invitados` y queda en la agenda de quien organiza |
| título de 4 palabras (`afOracion_`) | Máximo 4 palabras, mayúscula inicial | ⚠️ → 🆕 | Se recorta y se ajusta al guardar |
| `agendaSincronizarEventoFila_`, `agendaCrearMeet_`, `crearRecordatorioFechaActividad_` | Evento en Google Calendar con invitados y Meet automático | ⚠️ | Botón "Agregar a Google Calendar" con los invitados ya puestos (lo envía tu cuenta de Google) y "Unirse a la reunión". La sincronización automática necesita una decisión: pregunta en #27 |
| `notificarDelegacionAgenda_`, `procesarAvisosPendientesAgenda` | Correo al delegar / devolver | ⚠️ | Aviso dentro de la app (`notificaciones`). Correo: pendiente de #23 |
| `iniciarCronometro`, `pausarCronometro`, `obtenerTimerActivo` | Un solo cronómetro activo por persona | ✅ | `ag_iniciar`, `ag_pausar`, barra "Trabajando en" |
| `cambiarEstadoActividad`, `cancelarActividad` | Arrastrar entre columnas y cancelar | ✅ | `ag_estado`. Cancelar queda solo para quien la creó o jefatura, como el original |
| `finalizarActividad` | Cierre con resultado, pendiente, evidencias, tiempo y moneda | ✅ | `ag_finalizar` |
| `editarTiempoActividad` | Corregir el tiempo de una actividad terminada | ❌ → 🆕 | `ag_editar_tiempo` + "Corregir tiempo" en el detalle |
| `devolverActividad` | Devolver para corregir | ✅ + 🆕 | `ag_devolver`. Faltaba el botón "Devolver" en una actividad delegada ya terminada |
| `calificarActividad` | Revisar / aprobar | ✅ | `ag_calificar` (el detalle ahora dice "Aprobada") |
| `getAlertasAgenda` | Vencidas, devueltas, por revisar | ✅ | Panel de alertas |
| `getIndicadoresAgenda` + configuración de indicadores | Hoy, mes, actividades hoy/mes, por hacer, en marcha, vencidas, devueltas, por revisar; ocultar, agregar y ordenar | ⚠️ → 🆕 | Faltaban "Actividades hoy/del mes" y poder ocultar, agregar y ordenar (se recuerda en el navegador) |
| `getProyectosActivos` | Proyectos del área de la persona (o sin área) | ⚠️ → 🆕 | Filtro por área en el formulario |
| `getProyectosConHoras` | Lista de jefatura con horas acumuladas | ⚠️ → 🆕 | `ag_proyectos_horas` |
| `guardarProyecto`, `eliminarProyecto` | Crear (cualquiera), editar y eliminar (jefatura) | ✅ | Editar ahora también lo exige la base (antes cualquiera con permiso de editar) |
| `vmPapeleraListar`, `vmPapeleraRestaurar` | Papelera de proyectos | ❌ → 🆕 | "Papelera" dentro de Proyectos |
| `subirEvidenciaActividad`, `agendaEvidenciaVista` | Subir y ver evidencias | ✅ | Espacio privado `agenda` + visor |
| `getMonedasUsuario`, `revisarMonedasVencidas_` | Saldo, nivel, racha, moneda perdida por vencimiento | ✅ | `ag_economia`, `ag_revisar_vencidas` |
| `getAgendaEconomia`, `gestionarCanjeAgenda` | Tienda y entrega / cancelación de canjes | ✅ | `ag_economia`, `ag_gestionar_canje` |
| `canjearPremioAgenda` | Canje con nota y aviso si el precio cambió | ⚠️ → 🆕 | `ag_canjear(p_premio, p_nota, p_costo)` |
| `guardarPremioAgenda` | Premios con categoría y descripción, solo administración de la tienda | ⚠️ → 🆕 | `ag_guardar_premio` |
| `createRoute`, `getRoutesList`, `createViatico`, `getViaticosList`, `updateViaticoStatus` | Rutas y viáticos | ✅ | `RutasViaticos.tsx` (módulo nuevo, no se tocó) |
| `getCatalogosAgenda` | Listas fijas | ➖ | Sin uso en la pantalla; las listas están en `Agenda.tsx` |

Seguridad corregida en esta vuelta (probado dentro de una transacción que se deshace al final):
- Cualquiera con permiso en la Agenda podía cancelar o terminar actividades ajenas sin "delegado a" (y ganarse la moneda): `app.ag_es_mia` comparaba con nulos.
- Las monedas se podían sumar o editar directo desde fuera de la pantalla; ahora solo las mueven las funciones de la Agenda, y cada quien ve solo las suyas (administración de la tienda ve todas).
- Desde la pantalla ya no se puede cambiar el estado, el tiempo, las monedas ni la revisión de una actividad sin pasar por sus funciones.
- Los precios de los premios solo los cambia quien administra la tienda.

---

## 8. Bodega y Logística — Issue #28

Pantallas: `BodegaVista.html` (15 funciones de Bodega + la bandeja de recepción `vmRec*`) y `LogisticaVista.html` (11).
Archivos: `Bodega.gs`, `Logistica.gs`, `Aviso Guia.gs`.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmBodegaCrearDesdeFacturacion_`, `vmBodegaImportar` | La orden de despacho nace al facturar; "traer facturas" de los últimos días | ✅ | `tg_factura_a_bodega`, `bodega_traer_facturas` |
| `vmBodegaInicial`, `vmBodegaDetalle` | Tablero, pestañas, indicadores y detalle | ✅ | `Bodega.tsx` |
| `vmBodegaGuardarSeries` | Series por unidad (escáner o teclado), sin repetir | ✅ | `Bodega.tsx` |
| `vmBodegaAccion` | Iniciar, lista, verificar (otra persona), reabrir | ✅ | `Bodega.tsx` |
| `vmBodegaSinSerie` | Marcar un producto sin número de serie | ✅ | `Bodega.tsx` (también en el producto) |
| `vmBodegaSubirFoto`, `vmBodegaQuitarFoto`, `vmBodegaIniciarVideo`, `vmBodegaSubirParteVideo`, `vmBodegaRegistrarVideo` | Fotos y videos de evidencia | ✅ | Espacio `despachos` |
| `vmBodegaNovedad`, `vmBodegaResolverNovedad` | Novedades con aviso al asesor y a Facturación | ✅ | `bodega_avisar_novedad` |
| `vmBodegaDespachar` | Despacho total o parcial, exige series y foto, pasa a Logística | ✅ | `bodega_despachar` |
| `impValidarSeriesDespacho_`, `impMarcarVendidas_` | Solo salen equipos importados revisados en la Bodega principal; la serie pasa a "Vendida" | ❌ → 🆕 | `app.tg_despacho_envio` |
| `logInteraction_` (Bodega, Logística) | "Despachado completo / parcial" y "Entregado" en el historial del CRM | ❌ → 🆕 | `app.tg_despacho_envio`, `app.tg_entrega_entregada` |
| `vmBodegaBuscarSerie` | Buscar una serie despachada o en bodega | ✅ | `bodega_buscar_serie` |
| `vmLogisticaInicial`, `vmLogisticaDetalle` | Pestañas, equipo de choferes, detalle | ✅ | `Logistica.tsx`, `lg_equipo` |
| `vmLogisticaConfirmar`, `vmLogisticaEnRuta`, `vmLogisticaGuia`, `vmLogisticaSubirArchivo` | Confirmar con el cliente, modalidad, guía del transportista | ✅ | `Logistica.tsx` |
| `vmLogisticaEntregar`, `vmLogisticaNoEntregada` | Entrega con firma, cédula, fotos y GPS; no entregada | ✅ | `lg_entregar` |
| `vmLogisticaIncidencia`, `vmLogisticaResolverIncidencia` | Incidencias con aviso | ✅ | `Logistica.tsx` |
| `vmLogisticaMensajeEnviado` | Mensajes de WhatsApp con el enlace | ✅ | `Mensajes` |
| `lgConstancia_` | Constancia de entrega | ✅ | `descargarConstancia` |
| `lgActivarPostventas_`, `lgCrearPostventa_`, `lgInstalarActivador` | Gestión de postventa para el asesor | ✅ | `lg_activar_postventas` |
| `vmSeguimientoPedido` | Página pública de seguimiento | ✅ | `tracking_publico` (la página está en el sitio público) |
| `vmEncuestaDatos`, `vmEncuestaGuardar` | Encuesta de satisfacción con aviso si hay queja | ❌ → 🆕 | `encuesta_datos`, `encuesta_guardar` + página pública `/encuesta/?c=` en la app (`EncuestaPublica.tsx`) |
| `lgActualizarFacturacion_` | Escribía "Estado entrega" en Facturación | ➖ | Ninguna pantalla del original lo mostraba |
| `Aviso Guia.gs` | Franja "FRÁGIL · EQUIPO MÉDICO · NO COLOCAR PESO ENCIMA" en la guía de envío | ✅ | Guía de envío de `Facturacion.tsx` |
| `vmRec*` (bandeja de recepción en Bodega, revisión de equipos por partes) | Llegada, revisión, Servicio Técnico, informe y cierre de importaciones | ⏭️ | Vuelta 10 (Importaciones y Recepción) |

Probado en la base de pruebas, dentro de una transacción que se deshace al final: encuesta como visitante anónimo (datos, validaciones, guardar, corregir, aviso al asesor con enlace a la cotización), serie sin revisar bloqueada, serie de la Bodega principal pasa a "Vendida", historial del CRM al despachar y al entregar.

---

## 9. Servicio Técnico — Issue #18

Pantalla: `ServicioTecnicoVista.html` (28 funciones de Servicio Técnico, más documentos técnicos `dt*` y la bandeja de
recepción `vmRec*`). Archivo: `ServicioTecnico.gs`.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmStInicial`, `vmStDetalle` | Pestañas (inventario con observaciones, por agendar, agendadas, en proceso, mis órdenes, finalizadas, equipos, técnicos) y detalle | ✅ | `ServicioTecnico.tsx` |
| `vmStCrearOrden`, `vmStAgendar`, `vmStIniciar` (GPS), `vmStEstado` | Crear, agendar, iniciar, esperar repuesto, cancelar con motivo | ✅ | `ServicioTecnico.tsx` |
| `stAvisarTecnico_` | Aviso al técnico asignado (correo) | ❌ → 🆕 | `app.tg_st_orden_tecnico`: aviso en la campana (interno por nombre, externo por su usuario o correo) |
| `vmStProtocolo`, `vmStProductos`, `vmStGuardarAvance`, `vmStSubirFoto` | Checklist, mediciones, repuestos, fotos, avance | ✅ | `ServicioTecnico.tsx` |
| `vmStRecepcion` | Recepción en taller con firma y comprobante | ✅ | `Recepcion` + `servicioInforme.ts` |
| `vmStFinalizar`, `vmStRegenerarInforme` | Cierre, repuestos que salen del inventario, aviso a Facturación, informe PDF | ✅ | `st_finalizar`, `descargarInforme` |
| `stEnviarInformeCorreo_` | Informe al cliente por correo | ⚠️ | Por WhatsApp y desde el enlace del cliente; el correo depende del Issue #23 |
| `vmStMensajeEnviado` | Mensajes de WhatsApp | ✅ + 🆕 | Ahora llevan el enlace de seguimiento, como el original |
| `vmServicioPublico` | Página del cliente: avance, pasos, novedades, garantía, documentos | ❌ → 🆕 | `servicio_publico` + página `/servicio/?c=` (`ServicioPublico.tsx`). El informe se genera en el navegador del cliente (sin las fotos, que están en un espacio privado) |
| `stToken_` | Código público de cada orden | ❌ → 🆕 | `app.tg_st_orden_token` |
| `vmStCotizar`, `vmStRespuestaCotizacion`, `vmServicioResponder` | Cotización de reparación y su aprobación | ➖ | En la versión 4 del original Servicio Técnico ya no cotiza ("la gestión comercial se realiza fuera de este módulo") |
| `vmStEquipos`, `vmStEquipoDetalle`, `vmStEquipoGuardar`, `vmStRegistrarEquipo`, `vmStVentas` | Hoja de vida del equipo, garantía, plan, registrar desde una factura | ✅ | `st_registrar_equipo`, `ServicioTecnico.tsx` |
| `vmStSincronizar`, `stDesdeEntrega_` | Equipos desde despachos y entregas; instalación o capacitación automática | ✅ | `st_sincronizar`, `lg_entregar` |
| `stProgramarPreventivos_` | Órdenes preventivas 15 días antes | ✅ | `st_programar_preventivos` |
| `vmStTecnicoGuardar` | Técnicos externos | ✅ | `st_tecnicos` |
| `vmStInventario*` | Inventario con observaciones, seguimiento y evidencias | ✅ | `st_incidencias_inventario` |
| `dt*` | Documentos técnicos | ✅ | Módulo propio (Marketing › Biblioteca) |
| `vmRec*` | Recepción de importaciones (resultado de Servicio Técnico) | ⏭️ | Vuelta 10 |

Probado en la base de pruebas, dentro de una transacción que se deshace al final: código creado solo, aviso al técnico (una sola vez), página pública como visitante anónimo, código inválido rechazado y sin acceso directo a las órdenes.

---

## 10. Importaciones, Artículos, Adquisiciones y Recepción — Issue #30

Pantallas: `ImportacionesVista.html` (tablero `vmTab*`), `ArticulosImportarVista.html` (`vmArt*`), y la bandeja de recepción
`vmRec*` dentro de Bodega, Servicio Técnico y Marketing. Los `vmImp*` de `Importaciones.gs` (flujo anterior con aprobación,
pagos, aduana y costeo) ya no los llama ninguna pantalla de la versión 4.

### Parte 1 · Recepción (`RecepcionImportacion.gs`, Issue #19)

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmRecBandeja` | Bandejas de Importación, Marketing, Bodega y Servicio Técnico | ❌ → 🆕 | `rec_bandeja` + `RecepcionImportaciones.tsx` (Bodega › Recepción de importaciones, Servicio Técnico › Importaciones, Marketing › Importaciones, Importaciones › Recepción) |
| `vmRecLlegada` | Bodega registra la llegada (etapa "En bodega") | ❌ → 🆕 | `rec_llegada` |
| `vmRecRevisar` | Revisión por partes: recibidas, aprobadas → INGRESO "Principal", con defecto → INGRESO "Por reparar" + orden a Servicio Técnico, faltantes; lo demás queda pendiente | ❌ → 🆕 | `rec_revisar` (una operación por revisión, sin duplicar si se reintenta) |
| `recEquipos_`, `recGuardarEquipos_`, `vmRecSubirEvidencia` | Serie y fotos por equipo (o fotos del lote), series sin repetir | ❌ → 🆕 | `app.rec_equipos`, `app.rec_guardar_equipos`, espacio privado `importaciones`, escáner con la cámara |
| `vmRecResultadoST`, `vmRecSubirAdjunto` | Servicio Técnico: reparadas vuelven a Bodega, no reparables con decisión pendiente; fotos y adjunto | ❌ → 🆕 | `rec_resultado_st` |
| `vmRecRevisarDevuelta` | Bodega revisa lo devuelto: TRASLADO "Por reparar" → "Principal" o nueva orden | ❌ → 🆕 | `rec_revisar_devuelta` |
| `vmRecIdentificar`, `vmRecSugerirCodigo` | Marketing identifica productos nuevos (existente o nuevo, código reservado, código interno, foto) | ❌ → 🆕 | `rec_identificar`, `rec_sugerir_codigo` |
| `vmRecEnviarMarketing` | Enviar el listado a Marketing | ⏭️ | Parte 2 (al confirmar la lista del tablero) |
| `vmRecCierreAutorizado` | Cierre con pendientes (Gerencia) | ❌ → 🆕 | `rec_cierre_autorizado` (permiso "Aprobar" en Importaciones) |
| `vmRecEliminarImportacion` | Quitar una importación sin revisiones (papelera) | ❌ → 🆕 | `rec_eliminar_importacion` |
| `vmRecHistorialLinea` | Equipos, operaciones y órdenes de una línea | ❌ → 🆕 | `rec_historial_linea` |
| `recActualizarRecepcion_` | Recepción completa cuando no queda nada pendiente | ❌ → 🆕 | `app.rec_actualizar_recepcion` |
| `vmRecGenerarInforme` | Informe PDF de la orden de Servicio Técnico | ⚠️ | Se adjunta el informe (PDF o foto) al registrar el resultado |
| `vmRecTrasladarCodigos`, `vmRecUsarCodigoImportacion` | Pasar el modelo de Importación al código interno de los productos | ⚠️ | Se hace al identificar cada producto; el traslado masivo queda para la parte 2 |
| `actualizarStockInventarioInt_` (regla de stock) | "Por reparar" no es stock disponible; va a "stock por reparar" | ⚠️ → ✅ | `app.stock_mov` en `recalcular_stock_producto` y `recalcular_stock_general`. Con esta regla el stock de los 1 448 productos coincide con sus movimientos (la regla anterior descuadraba EQM327 y MOBI053) |

Probado en la base de pruebas, dentro de una transacción que se deshace al final: revisión por partes, operación repetida
sin duplicar, stock y "por reparar" correctos en cada paso, orden a Servicio Técnico, resultado, traslado al volver, series
repetidas o ajenas rechazadas, permisos.

### Parte 2 · Tablero de Importaciones (`ImportacionesTablero.gs`, `PedidoImportacion.gs`)

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmTabInicio`, `tabResumen_`, `tabEtapa_` | Tablero con la etapa real e indicadores (en tránsito, en bodega, con novedades, en reparación, atrasadas) | ⚠️ → ✅ | `imp_tablero`: la etapa "En bodega"/"Ingresado" sale de la recepción; "Con novedades" y "En reparación" ya no son ceros fijos; la tarjeta muestra el avance |
| `vmTabCrear`, `vmTabEliminarBorrador` | Crear (copiando la última del proveedor) y eliminar borrador | ✅ | `NuevaImportacion`, eliminar con motivo |
| `vmTabCambios` (`op: linea`) | Productos existentes en la lista con guardado automático | ✅ | `Importaciones.tsx` |
| `vmTabCambios` (`op: nuevo`), `vmTabCodigosLibres`, `vmTabVerificarCodigo` | Equipo nuevo: prefijo, código deseado (verificado), descripción, modelo, marca, foto | ❌ → 🆕 | `imp_linea`, `imp_prefijos`, `imp_codigos_libres`, `imp_verificar_codigo` + formulario "Equipo nuevo" (antes decía "se está migrando") |
| Versión 4: agregar con lista confirmada | Solo agregar o aumentar cantidades hasta que ingrese al inventario, con nota en el historial | ❌ → 🆕 | `imp_linea` (no deja bajar cantidades con la lista confirmada) |
| `vmTabConfirmar` + `vmRecEnviarMarketing` | Reserva los códigos de los equipos nuevos y envía el listado a Marketing (vincula solos los que ya existen) | ⚠️ → ✅ | `imp_confirmar` (antes solo cambiaba la etapa) |
| `vmTabReabrir` | Reabrir solo si Bodega no revisó; libera los códigos no usados | ⚠️ → ✅ | `imp_reabrir` |
| `vmTabCambiarCodigo` | Cambiar el código reservado mientras Marketing no cree el producto | ❌ → 🆕 | `imp_cambiar_codigo` |
| `vmTabDetalle` (gráficos) | Avance por línea, daños, revisadas por día, días en Servicio Técnico, tasa de daño del proveedor, órdenes | ❌ → 🆕 | `imp_detalle` + pestaña Avance |
| `vmTabPanel`, `vmTabEquiposPanel` | Panel de proveedores (tasa de daño, días de llegada), productos más dañados, unidades por mes; todos los equipos con su stock | ❌ → 🆕 | `imp_panel`, `imp_equipos_panel` + vista Panel |
| `vmPapeleraListar`, `vmPapeleraRestaurar` | Papelera de importaciones | ❌ → 🆕 | `imp_papelera`, `imp_restaurar` |
| `vmTabSubirImagen`, `vmTabEditarProducto`, `vmTabImagenProducto` | Foto de un equipo nuevo; editar el producto desde Importaciones | ⚠️ | La foto se sube en "Equipo nuevo"; los productos existentes se editan en Inventario |
| `vmTabCatalogo` | Catálogo con fotos y datos para recomendar qué importar | ➖ | Está en Artículos (`art_analisis`); se revisa en la parte 3 |
| `vmTabVersiones` | Revisar cambios cada 30 s | ✅ | Tiempo real de Supabase |

Se corrigió el generador de códigos: con códigos de 3 cifras y otros más largos (EQM999 y EQM11815) recortaba el número al rellenar
con ceros; además un código liberado ahora se puede volver a reservar.

### Parte 3 · Artículos, Adquisiciones y Material de proveedores

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmArtInicial`, `vmArtDetalle` (ArticulosImportar) | Análisis de qué importar: ventas 90/180/365, stock, tránsito, cotizaciones, parámetros | ✅ | `Articulos.tsx` + `art_analisis` |
| `vmArtGuardarNota` | Nota por artículo | ✅ | `Articulos.tsx` (`imp_notas_articulos`) |
| `vmArtGuardarLista`, `vmArtEstadoLista`, copiar / terminar / revisar lista | Listas de pedido con autoguardado y estado | ✅ | `Articulos.tsx` (`imp_listas_pedido`) |
| `vmCatalogosIngreso`, `vmCrearProveedorIngreso`, `vmCrearProductoIngreso` (IngresosProveedores) | Ingreso de mercadería de proveedor | ✅ | `Adquisiciones.tsx` (ya revisado en el módulo 5; no se tocó) |
| `vmMatContexto` | Proveedores y equipos nuevos de las importaciones para armar la solicitud | ✅ | RPC `material_contexto` |
| `vmMatCrear` | Crear solicitud con código MS-AAAA-NNN y enlace temporal | ✅ | RPC `material_crear` + ventana "Nueva solicitud" en Marketing → Material de proveedores |
| `vmMatActualizar` | Estado, vencimiento, nota, productos abiertos/cerrados, qué se pide, agregar y quitar productos, código interno | ✅ | RPC `material_actualizar` + detalle de la solicitud |
| `vmMatArchivos` | Archivos recibidos por producto | ✅ | `MarketingExtra.tsx` (`material_archivos`) |
| `vmMatPdf` | PDF bilingüe (español / inglés / chino) con foto, modelo, código interno y lo que se pide | ✅ | Botón "Descargar PDF" |
| `vmMatPublico`, `matPorToken_`, `matExigirVigente_` | Página pública del proveedor sin cuenta | ✅ | `MaterialPublico.tsx` en `/material/?c=<código>` + RPC `material_publico` (anónima, solo si está abierta y vigente) |
| `vmMatIniciarSubida`, `vmMatSubirParte`, `matCarpeta_` | Subida directa a Google Drive por partes (hasta 1 GB), carpeta por solicitud y producto | ✅ | Función `drive` (`material_iniciar` / `material_registrar`) + `subirPorPartes` |
| `vmMatGuardarEnlace` | Pegar un enlace de descarga (WeTransfer, Drive…) | ✅ | RPC `material_guardar_enlace` |

Nota: la página pública ahora vive en la app (`/material/?c=`) en lugar de pasar por el proxy de Apps Script del sitio.
En QA la subida de archivos necesita que Google Drive esté conectado; el enlace de descarga funciona sin Drive.

## 11. Empleados y Solicitudes del personal — Issue #31

### Empleados (`Empleados.html`, `Data Empleados.gs`)
| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `getEmpleadosList`, `getEmpleadosListCompleta`, `guardarEmpleado`, `vmEmpleadoEliminar` | Directorio, ficha, alta, edición y papelera | ✅ | `Empleados.tsx` (ya existía) |
| `getAccesoEmpleado`, `guardarAccesoEmpleado`, `guardarAccesosModulos`, `vmAccDeEmpleado`, `vmAccGuardar`, `getRolesCRM`, `generarPasswordEmpleado` | Accesos, roles, permisos por acción y contraseña | ✅ | `Empleados.tsx` + función `empleados-cuenta` (no se tocó) |
| `mkfRolEmpleado`, `mkfGuardarRolEmpleado` | Rol en Marketing (directa / aprueba) | ✅ | `Empleados.tsx` (preferencias.marketing) |
| `vmPapeleraListar`, `vmPapeleraRestaurar` | Papelera de empleados | ✅ | `PapeleraEmp` |
| `vmEmpDatosLaborales_` (v4) | Fecha de ingreso, departamento, jornada, estado laboral, horario, saldo inicial y fecha de corte | ✅ nuevo | Sección "Datos laborales" + validación en la base (`app.tg_empleado_laboral`) con auditoría |
| Jefe inmediato por lista sin ciclos (v4) | Solo activos, no uno mismo, sin ciclos | ✅ nuevo | Lista filtrada en la ficha + bloqueo en la base |
| `subirFotoEmpleado` | Subir la foto desde un archivo | ✅ nuevo | Botón "Subir foto" (WebP, carpeta `empleados/` del almacenamiento de avatares) |

### Solicitudes del personal (`SolicitudesPersonal.gs`, `SolicitudesVista.html`) — módulo nuevo
| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmSolMiPerfil` | Mi Perfil: datos laborales, saldo, movimientos, mis solicitudes | ✅ | Vista `miperfil` (`SolicitudesPersonal.tsx`) + RPC `th_mi_perfil` |
| `vmSolCrear` | Vacaciones / Permiso / Horas con validaciones (saldo, solapes, máximo por tipo, 30 días de atraso, documento, excepción de saldo, envío sin duplicar) | ✅ | Formularios + RPC `th_sol_crear` |
| `vmSolDecidirJefe` | Jefe aprueba o rechaza (solo sus subordinados) | ✅ | RPC `th_sol_decidir_jefe` |
| `vmSolDecidirTTHH` | Validación final, excepción de saldo, horas autorizadas, validar sin jefe (excepcional) | ✅ | RPC `th_sol_decidir_tthh` |
| `solDescontar_` | Descuento único del saldo al aprobar | ✅ | `app.th_descontar` |
| `vmSolCancelar` | Cancelar (empleado/TTHH) y anular aprobada con reverso del saldo | ✅ | RPC `th_sol_cancelar` |
| `vmSolObservar`, `vmSolRegistrarHoras` | Observaciones; horas trabajadas / compensadas / verificadas para pago | ✅ | RPC `th_sol_observar`, `th_sol_registrar_horas` |
| `vmSolAjustarSaldo` | Ajuste justificado del saldo | ✅ | Pestaña Saldos + RPC `th_ajustar_saldo` |
| `vmSolTipoGuardar` | Tipos de permiso (no se borran, se desactivan) | ✅ | Pestaña Tipos + RPC `th_tipo_guardar` |
| `vmSolConfigGuardar` | Reglas de vacaciones (Art. 69, calendario/laborables, feriados, anticipación) | ✅ | Pestaña Configuración + `th_configuracion` |
| `vmSolBandeja`, `vmSolDetalle` | Bandeja jefe / TTHH con filtros, CSV y saldos; detalle con control de acceso | ✅ | Vista `solicitudes` + RPC `th_bandeja`, `th_sol_detalle` |
| `vmSolDocumento`, `solCarpeta_` | Documento de respaldo privado; el jefe no ve lo confidencial | ✅ | Almacenamiento privado `talento-humano` + RPC `th_sol_documento` |
| `solAuditar_` | Auditoría de cada acción | ✅ | Tabla `th_auditoria` + bitácora; pestaña Auditoría (administrador) |
| `solNotificar_`, `vmSolNotifLeidas` | Avisos internos en cada paso | ✅ | Campana de avisos (`notificaciones`) |
| `solNotificar_` (correo) | Copia por correo | ⚠️ | Falta un servicio de correo (pregunta en #23) |

Seguridad: antes la tabla `th_solicitudes` permitía que un jefe cambiara el estado directamente (aprobar sin TTHH y sin
descontar saldo) y le mostraba el motivo de permisos confidenciales. Ahora la tabla solo se lee (el empleado lo suyo,
Talento Humano todo) y todo cambio pasa por las funciones, que validan cada paso.

## 12. Talento Humano y Financiero — Issue #33
En el original los dos módulos son el tablero común de registros (`ModulosBase.gs`). Las hojas `TalentoHumano` y
`Financiero` del Excel nuevo están vacías (solo encabezados): no hay datos que pasar.

| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmModuloDatos` | Registros con indicadores (abiertos, pendientes, en proceso, completados, cancelados), búsqueda, filtros por prioridad y responsable, vencidos | ✅ | `Tablero.tsx` (tabla `tareas_modulo`, tiempo real) |
| `vmModuloGuardar` | Crear / editar (título, detalle, estado, prioridad, responsable, fecha compromiso) | ✅ | `Tablero.tsx` |
| `vmModuloEliminar` | Eliminar con motivo (queda en la Papelera) | ✅ | `Tablero.tsx` |
| `vmPapeleraListar`, `vmPapeleraRestaurar` | Papelera del módulo | ✅ | `Tablero.tsx` |
| `vmAccExigir_(modulo, 'eliminar')` | Eliminar y restaurar exigen el permiso "eliminar" | ✅ corregido | Antes bastaba con editar o ser el responsable: `app.tg_tareas_modulo_eliminar` |
| `vmModulosBaseLista`, `vmModulosBaseAccesos_` | Tarjetas en Mi Espacio y permisos por módulo | ✅ | `modulos.ts` + permisos `talento_humano` / `financiero` |

Las solicitudes del personal de Talento Humano están en el módulo 11 (Mi Perfil y Solicitudes).

## 13. Catálogos, Ofertas y Promociones — Issue #34
| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `getCatalogoDatos`, `getCatalogoImagenes`, `vmCatalogoRegistrar` | Catálogo PDF por segmento con asesor, portada y sala de exhibición; registro de catálogos generados | ✅ | `Catalogos.tsx` + `catalogoHtml.ts` (`catalogos_generados`) |
| `vmOfertasDatos`, `vmOfertasGuardar`, `vmOfertasEstado`, `vmOfertasCrearPlan`, `vmOfertasConfig` | Análisis de stock detenido, ofertas, pausar/reanudar/finalizar/cancelar, plan de liquidación, ajustes | ✅ | `Ofertas.tsx` (`of_analisis`, `ofertas`, `ofertas_config`) |
| `vmOfertasInteresados`, `vmOfertasImagen`, `vmOfertasLogos`, `vmOfertasTextosIA`, `vmOfertasObservacion*` | Interesados, arte, textos con IA, observaciones | ✅ | `Ofertas.tsx` (Kit, Interesados) |
| `prContexto`, `prSugerencias`, `prBuscarProductos`, `prGuardarCampana`, `prDetalle`, `prEnviar`, `prDevolver`, `prRechazar`, `prAprobar` | Campañas con aprobación | ✅ | Promociones nuevas (aprobación por producto, vista a pantalla completa) — no se tocaron |
| `prCancelar` | Cancelar; si estaba aprobada, sus ofertas se cancelan (solo quien aprueba) | ✅ corregido | RPC `cancelar_campana_promocion` (antes las ofertas seguían activas) |
| `prTablero` | Tablero en vivo: ventas por producto, día y asesor, hoy, capital inicial | ✅ nuevo | Botón "Tablero en vivo" + RPC `promo_tablero` |
| `prInteresados` | Clientes que cotizaron y no compraron, por asesor | ✅ nuevo | Botón "Interesados" + RPC `promo_interesados` (con WhatsApp) |
| `prInformeFinal` | Informe final en PDF | ✅ nuevo | "Informe final (PDF)" en el tablero (se descarga; el original lo guardaba en Drive) |
| `prImagen`, `prLogos` | Arte de la campaña | ➖ | El arte por producto está en Ofertas (Kit) |
| `prGuardarConfig` | Margen verde, antigüedad, sobrestock, días de preventa | ⚠️ | La campaña nueva usa los criterios por defecto de Ofertas (anotado en #34) |
| `prOfertasVigentes` | Ofertas activas y programadas | ✅ | `Ofertas.tsx` |

## 14. Dashboard Ejecutivo — Issue #35
| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `dashEjecutivo` | Ventana de 12 meses + período (Mes / 3 meses / Año / fechas): línea de tiempo, composición, actividad, embudo, proformas vs ventas, lectura ejecutiva, matriz de valor, 80/20, categorías, valor proformado vs vendido, asesores, efectividad, mapa y regiones, top clientes, clientes nuevos, canales, ventas del período | ✅ | `Dashboard.tsx` |
| `dashEjecutivoMarketing` | Lectura de marketing, contenido vs ventas, campañas y anuncios, próximos 14 días, ritmo, flujo y producción por responsable | ✅ | `Dashboard.tsx` |
| `dashEjecutivoPipeline` | Pipeline del CRM y salud comercial | ✅ | `Dashboard.tsx` |
| `dashGetSnapshot`, `dashGetVentasRapidas`, `dashGetClientesRapidos`, `dashGetPipelineRapido`, `dashForzarActualizacion` | Panel anterior | ➖ | Ninguna pantalla los llama |
| `mkfInformeDesempeno` (InformesDesempeno.gs) | Informe semanal / mensual en PDF | ✅ | Módulo 2 (`mkt_informe_comercial`) |
| `getExtendedDashboardStats` + `CHART_CATALOG` del CRM | 10 gráficos configurables del CRM: estado, asesor, tipo, cotizaciones 6 meses, ventas por mes, visitas, clientes nuevos, más cotizados, más vendidos, rendimiento por asesor | ✅ nuevo | Botón "Gráficos" del CRM (`CrmGraficos.tsx` + `crm_graficos`); agregar/quitar se recuerda en el equipo; alcance del asesor |

Nota: "Equipos más vendidos" no descuenta las notas de crédito como hacía el original (`ncApplied_`).

## 15. Seguridad, Base de Datos y Mi Espacio — Issue #36
| Función original | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| `vmSegInicial`, `vmSegRoles`, `vmSegGuardarRol`, `vmSegMatriz` | Usuarios, roles y matriz de permisos | ✅ | `Seguridad.tsx` (`seg_guardar_rol`, `seg_asignar_rol`) |
| `vmSegSesiones`, `vmSegCerrarSesion`, `vmSegCerrarSesionesDe`, `vmSegBloquear` | Sesiones activas, cerrar y bloquear | ✅ | `Seguridad.tsx` (`seg_cerrar_sesion`, `seg_cerrar_sesiones_de`, `seg_bloquear`) |
| `vmSegBitacora`, `vmSegBitacoraCsv` | Bitácora y exportación | ✅ | `Seguridad.tsx` (`bitacora`) |
| `vmSegRevision`, `vmSegMarcarRevision` | Revisión de privilegios | ✅ | `Seguridad.tsx` (`seg_revisiones`) |
| `vmSegConfirmarClave` | Confirmar contraseña antes de acciones delicadas | ✅ | `Seguridad.tsx`, `BaseDatos.tsx` (reautenticación) |
| `vmBdPanel`, `vmBdTabla`, `vmBdCrearTabla`, `vmBdEditarEsquema`, `vmBdGuardarRegistro`, `vmBdDesactivarRegistro` | Tablas propias | ✅ | `BaseDatos.tsx` |
| `vmBdImportarCsv`, `vmBdExportar`, `vmBdDuplicados`, `vmBdIntegridad`, `vmBdPermisos` | Herramientas de datos | ✅ | `BaseDatos.tsx` |
| `vmBdRespaldar`, `vmBdRespaldos`, `vmBdVerificarRespaldo`, `vmBdDescargarRespaldo`, `vmBdVistaRestauracion`, `vmBdRestaurar` | Respaldos y restauración | ✅ | `BaseDatos.tsx` (`respaldos`, `bd_registrar_respaldo`, `bd_marcar_verificado`) |
| `vmBdProgramar` | Respaldos automáticos diarios / semanales / mensuales | ⚠️ | Pregunta en #36 (Supabase ya guarda copias diarias del proyecto) |
| `vmBdGuardarModoDrive` | Compartir archivos de Drive público o solo dominio | ➖ | La app comparte con enlace (catálogo y clientes); anotado en #36 |
| `MiEspacio.html` (`cerrarSesionEmpleado`, personalizar, favoritos, acciones rápidas, barra fija) | Inicio y barra lateral | ✅ | `MiEspacio.tsx`, `Rail.tsx` |
| `Index.html` (`loginSoloCorreo`, `registrarUsuario`, `validarSesion`) | Inicio de sesión | ✅ | `Login.tsx` + Supabase Auth (con MFA) |
| `Index.html` (`getProducts`, `getCategories`, `getAllies`, `processQuote`, `processAppointment`, `processWhatsappLead`, `solicitarCambioAsesor`, `getMyAccessAndPricing`) | Catálogo público y formularios de la web | ➖ | Sitio público: Issue #2 |
| `getPermissionsMatrix`, `savePermissionsMatrix` | Matriz de permisos | ✅ | `Seguridad.tsx` |
| `ComercialMovil.html` | Cotizar desde el celular (Datos / Inventario / Carrito) | ✅ | `CrmDocumento.tsx` (responsive) |

## 16. Rendimiento, diseño y uso en el teléfono — Issue #37
| Revisión | Resultado | Dónde quedó |
|---|---|---|
| Carga por módulo | Todos los módulos se descargan al abrirlos; Inventario entraba en el archivo principal y 10 módulos lo arrastraban por la miniatura de imágenes | `inventarioUtil.tsx` + Inventario diferido: archivo principal de 563 KB a 455 KB (129 KB comprimido) |
| Consultas | Columnas específicas y límites en los listados; `select('*')` solo en dos lecturas de una fila | Sin cambios |
| Celular (390 px y 360 px) | 27 pantallas sin desplazamiento horizontal | Agenda (selector y barra) y Movimientos (barra) corregidos |
| Inventario en el celular | Buscador a la izquierda y menú ☰; buscador sin tildes ni mayúsculas | #32 |

## Documentos: logo oficial y encabezado de la proforma (17-nov-2026)

Pedido: el logo de la empresa (SVG enviado, el mismo de `LOGO_COLOR` / `public/logo-documento.png`) en todos los documentos, con el encabezado y el formato de la proforma; antes varios ponían "VIMEDIC" en texto.

| Documento | Antes | Ahora | Dónde |
|---|---|---|---|
| Proforma / comprobante de venta | Modelo | Sin cambios (es el modelo) | `proforma.tsx` |
| Acta de entrega + Carta de garantía + Anexo | Logo, línea navy | Encabezado y pie de la proforma, azul #055c9d | `documentosFacturacion.ts` |
| Guía de envío (etiqueta) | Logo + rótulo con borde | Logo + título azul + línea de la proforma | `htmlGuia` |
| Guía de despacho | "VIMEDIC" en texto | Encabezado de la proforma con logo (dentro del archivo), QR, cajas de cliente y entrega, pie | `Facturacion.tsx` (ModalGuiaDespacho) |
| Constancia de entrega | "VIMEDIC" en texto | Encabezado y pie de la proforma | `Logistica.tsx` |
| Informe técnico / recepción | Logo, colores navy | Encabezado de la proforma, azul de la proforma (FEMEDICS conserva su color) | `servicioInforme.ts` |
| Ficha técnica | "VIMEDIC" en texto | Encabezado y pie de la proforma | `MarketingIntegraciones.tsx` |
| Informe de desempeño (Marketing / Comercial) | Franja navy | Encabezado y pie de la proforma | `MarketingRevision.tsx` |
| Solicitud de material a proveedores | Franja con "VIMEDIC" en texto | Encabezado de la proforma (trilingüe) | `MarketingExtra.tsx` |
| Lista de productos en promoción / Ofertas y liquidación / Informe de campaña (jsPDF) | Franja con "VIMEDIC" en texto | `encabezadoPdf`: logo, título azul, línea azul | `MarketingExtra.tsx`, `Ofertas.tsx` |
| PDF de ofertas para clientes | Franja navy con logo blanco | Portada y cabecera blancas con logo a color, título azul y línea azul | `ofertasPdf.ts` |

Fuente única: `web/src/documentoMarca.ts` (`encabezadoDocHtml`, `pieDocHtml`, `encabezadoPdf`, `logoDocDataUrl`). FEMEDICS: sin logo propio, sale el nombre en azul como en la proforma. El catálogo y las piezas de Marketing (diseños) no se tocaron.

## Google Drive sin clave JSON: «Conectar con Google» (17-nov-2026)

Problema: Google Workspace bloquea descargar la clave JSON de la cuenta de servicio (política iam.disableServiceAccountKeyCreation), así que Marketing no podía subir nada a Drive. La app original no la necesitaba porque Apps Script usaba la cuenta de la empresa.

| Forma | Cómo | Dónde |
|---|---|---|
| Conectar con Google (recomendada) | Botón › elegir la cuenta › Permitir; se guarda un permiso permanente (refresh token) cifrado en Vault. Requiere una sola vez el ID y el secreto del cliente de OAuth (el mismo del inicio de sesión con Google, proyecto vimedic-crm) y agregar la URI de redirección | `supabase/functions/google-oauth`, `drive` (tokenOAuth), `TarjetaDrive`, `public/conexion-lista.html` |
| Script de Apps Script | Un script de la cuenta de la empresa entrega un permiso temporal (ScriptApp.getOAuthToken), como la app original | `drive` (tokenPuente), código en la tarjeta |
| Cuenta de servicio | Clave JSON, como antes | `drive` (tokenGoogle) |

Migración 20261117090000: proveedor google_app, función integracion_guardar_servicio (solo service_role) y arreglo de la restricción que no dejaba guardar meta_pixel / tiktok_pixel. Pruebas: supabase/tests/google_oauth_drive.sql (9/9).

## Módulo nuevo: Plantillas de documentos (17-nov-2026)

Pedido del usuario: editar los formatos de los documentos sin programar (ordenar arrastrando, agregar bloques, cambiar textos, logo y colores).

| Qué | Cómo | Dónde |
|---|---|---|
| Marca y pie | Logo (sube PNG/JPG/SVG o usa el oficial), color principal, color de la etiqueta, leyenda junto al título y pie; se aplica a todos los documentos | plantilla general, `documentoMarca.ts` |
| Diseño por bloques | Proforma, comprobante de venta, acta de entrega, carta de garantía, anexo de series, guía de despacho y constancia de entrega: título, lugar, partes del sistema (mover, ocultar, titular) y bloques libres (texto con **negrita** y {variables}, imagen, firma, línea, espacio) | `plantillas.ts`, `documentosFacturacion.ts`, `documentosEntrega.ts`, `proforma.tsx` |
| Vista previa en vivo | Con datos de ejemplo, armada con el mismo código que el documento real | `modulos/Plantillas.tsx` |
| Historial | Cada guardado es una versión (quién y cuándo); se puede volver a una anterior o al diseño original | tablas plantillas_documento y plantillas_documento_versiones, función plantilla_guardar |
| Permisos | Módulo `plantillas`: ver / editar (Empleados y Seguridad). Todos los empleados leen las plantillas para generar sus documentos | migración 20261117100000, pruebas supabase/tests/plantillas_documentos.sql (11/11) |

Sin plantilla guardada, cada documento sale igual que antes. Informe técnico, ficha técnica, guía de envío y listas de ofertas toman la marca (logo, colores, leyenda, pie) pero no tienen todavía edición por bloques.

## Marketing › Plan de trabajo (17-nov-2026)

Pedido: programar las actividades del personal de Marketing (completar el siguiente producto, hacer un video…) incluyendo completar los documentos técnicos del proveedor.

| Qué | Cómo | Dónde |
|---|---|---|
| Tipos de trabajo | Completar ficha, fotos, video (por tipo), ficha técnica, documentos del proveedor (manual / hoja de datos + certificado / registro), publicación, otra tarea | `MarketingPlan.tsx`, migración 20261117110000 |
| Asignar | Botón «Asignar tarea» o «Asignar» en Biblioteca › Por completar / Videos pendientes; aviso a la persona; no duplica tareas abiertas ni pide lo que el producto ya tiene | `mkt_plan_asignar` |
| Armar la semana | Sugiere los siguientes productos (visibles al público primero, cotizaciones, oferta vigente, nuevos con stock) y los reparte en días hábiles | `mkt_plan_sugerir` |
| Tablero semanal | Filas por persona, columnas por día y «Atrasadas»; arrastrar para reprogramar o cambiar de persona; vista de lista en celular | `mkt_plan`, `mkt_plan_mover` |
| Pasos y cierre | Pasos por tipo; se cierra sola cuando el producto cumple (con la moneda de la Agenda para la persona) o se termina a mano; cancelar con motivo | `mkt_plan_paso`, `mkt_plan_terminar`, `mkt_plan_cancelar`, `app.mkt_cerrar_cumplidas` |
| Agenda | Cada tarea es una actividad de la Agenda (origen marketing, delegada) con producto, tipo, pasos y punto de partida | columnas nuevas en actividades |
| Cumplimiento | Por persona en la semana: tareas, listas, % a tiempo, atrasadas | `MarketingPlan.tsx` |

Asignan: superadmin, Marketing › aprobar/administrar o el rol de Marketing «Coordinación». Pruebas: supabase/tests/marketing_plan.sql (20/20).

## Ofertas › Términos y condiciones (17-nov-2026)

| Qué | Cómo | Dónde |
|---|---|---|
| Términos generales | Vigencia (fecha de cada oferta), unidades limitadas, no acumulable, IVA, formas de pago, entrega, garantía, reserva, «no aplica para» y condiciones adicionales (una por línea); vista previa de cómo sale en la proforma | Ofertas › Términos (`TerminosOfertasEditor.tsx`), tabla ofertas_terminos |
| Términos por campaña | Se suman a los generales (los campos vacíos toman el texto general; los adicionales se suman); se activan por campaña | idem, `ofertas_terminos_guardar` |
| En la cotización | Si hay productos en oferta, casilla «Mostrar los términos y condiciones de las ofertas» (no se editan); al guardar se copia la versión vigente en cotizaciones.terminos_ofertas | `CrmDocumento.tsx`, `ofertasTerminos.ts` |
| En la proforma | Sección «Términos y condiciones de la promoción» (un grupo por campaña, con su vigencia); botón «Mostrar / Ocultar términos» en el visor que guarda la elección; la sección también se mueve u oculta en Plantillas de documentos | `proforma.tsx`, `plantillas.ts`, `Crm.tsx` |

Cotizaciones anteriores (sin copia) toman los términos actuales al abrir la proforma. Migración 20261117120000; pruebas supabase/tests/ofertas_terminos.sql (6/6).

## Bodega, Logística y Servicio Técnico por pasos + escáner por puesto (17-nov-2026)

| Qué | Cómo | Dónde |
|---|---|---|
| Bodega por pasos | El despacho se abre en 4 pasos: Pedido (qué se despacha, entrega, novedades, historial) → Productos y series (cada producto con sus series, escáner y la foto del equipo) → Fotos del envío (botones grandes: paquete cerrado, guía pegada, entrega al transportista, otro, video) → Despachar (lista de lo que falta, marcar lista, verificar, despachar). Abre en el paso que toca según el estado; las series se guardan solas al cambiar de paso | `Bodega.tsx`, `estilos/pasos.css` |
| Logística por pasos | Pedido y cliente (llamar, WhatsApp, mapa, a dónde va, productos, enlace de seguimiento) → Confirmar y programar (formulario agrupado: cuándo y cómo, quién recibe, cómo es el lugar, para terminar; guía del courier) → Entregar (acción según el estado: salir a ruta, registrar entrega, cliente confirmó, no se pudo entregar, incidencias) | `Logistica.tsx` |
| Servicio Técnico por pasos | La orden en trabajo va un tema por pantalla: Orden → Diagnóstico → Checklist → Mediciones (Temas / Asistentes en capacitaciones) → Trabajo y repuestos → Fotos → Cierre (recomendaciones, lo que falta y Finalizar). Se guarda al cambiar de paso; abre en el primer paso pendiente | `ServicioTecnico.tsx` |
| Escáner en cada módulo | Botón «Escanear» en Bodega, Logística y Servicio Técnico: lee el QR de la guía (o se escribe GD-, DSP-, ENT-, TRK-, orden, factura o serie) y abre el pedido ahí mismo | `EscanerPedido.tsx`, función `mod_escanear` (migración 20261117130000, pruebas supabase/tests/escaner_modulo.sql 5/5) |
| Escáner general por puesto | Con un solo puesto (módulo donde la persona edita) el pedido se abre directo en su módulo, sin importar la etapa. Con varios puestos se elige «Al escanear, abrir en…» (se recuerda en el teléfono) o «Solo mostrar el pedido» (comportamiento anterior) | `Escanear.tsx` |
| Velocidad | Los listados ya no traen historial, envíos, línea de tiempo ni el detalle del trabajo (se leen al abrir); el botón flotante del menú se oculta con una ficha abierta | `Bodega.tsx`, `Logistica.tsx`, `ServicioTecnico.tsx` |

## Facturación › Documentos en visor (17-nov-2026)

| Qué | Cómo | Dónde |
|---|---|---|
| Acta de entrega, guía de despacho y etiqueta de envío | Se generan en HTML al instante y se abren en un visor dentro de la app (vista A4, «Imprimir», «Descargar PDF», «Editar»), igual que la proforma. Antes se armaba un PDF y se subía a Drive antes de abrirlo en otra pestaña, y el navegador bloqueaba esa pestaña (había que generar dos veces) | `VisorDocumento.tsx`, `Facturacion.tsx` |
| Dónde se guardan | HTML en el bucket privado «despachos» (actas/ y guias/); «Ver acta / guía» lo abre en el visor. Las actas y guías anteriores en Drive (PDF) se siguen abriendo en otra pestaña | Migración 20261117140000; pruebas supabase/tests/facturacion_actas_storage.sql (4/4) |

## Inventario › Documentos técnicos con autorización (17-nov-2026)

| Qué | Cómo | Dónde |
|---|---|---|
| Ver documentos técnicos en Inventario | La ficha del producto muestra sus documentos técnicos (manual, hoja de datos, certificado, registro sanitario, otro) con tipo, versión y vencimiento (vencido / por vencer); de un mismo documento, la versión más reciente es la vigente | `Inventario.tsx` (DocumentosTecnicos) |
| Autorización | Empleados › «Ver documentos técnicos» (documentos_tecnicos › ver). La base de datos solo deja leerlos a quien la tiene, a Servicio Técnico y a Marketing (antes los leía cualquier módulo con productos). Se suben en Marketing › Multimedia (crear/editar de Documentos técnicos) | Migración 20261117150000; pruebas supabase/tests/documentos_tecnicos_ver.sql (6/6) |

## Ajustes 17-nov-2026 (tarde)

| Función | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| Observaciones en la ventana del producto | Texto completo en rojo (antes solo «pasa el cursor»): en pantalla grande arriba de los detalles, en el teléfono antes del precio; también en el panel lateral | ✅ | `web/src/modulos/Inventario.tsx` (`AvisoObs`) |
| Ficha técnica dentro de «Documentos técnicos» | La ficha actual del producto (`ficha_tecnica_url`, 349 productos) y sus versiones generadas (`fichas_tecnicas`, 35) se listan junto a manuales y certificados | ✅ | `Inventario.tsx` (`DocumentosTecnicos`) |
| Acta de una venta de FEMEDICS | Se cambian en el acta el Nº de factura, la cédula/RUC, «Entregado por» y el nombre y cargo de la firma de la Carta de Garantía; sale con el logo y el pie de FEMEDICS. Se guarda en `acta_datos.femedics`. Las actas de VIMEDIC no cambian | ✅ (nuevo, no estaba en el original) | `Facturacion.tsx` (`ModalActaGarantia`), `documentosFacturacion.ts`, `documentoMarca.ts`, `public/logo-femedics.svg` |

## Marketing › Plan de trabajo y Revisión (17-nov-2026, noche)

| Función | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| Equipo del plan | Solo empleados activos del área Marketing («Rol / Área» o «Departamento» en Empleados). Rol: el de Marketing (Asistente / Audiovisual) o, si no tiene, por el cargo. Quien coordina sin ser del área no sale | ✅ | `app.mkt_plan_equipo` en `20261117160000_marketing_plan_equipo_videos.sql` |
| Clic en el día de cada persona | Abre un formulario: Asistente → «Producto» (la app muestra lo que le falta y marca completar ficha / ficha técnica / documentos del proveedor; también fotos y publicación). Audiovisual → «Video»: producción (guion, preparación, grabación, respaldo) y edición (tomas, edición, revisión, subida), cada una en su día. «Otra tarea» para lo libre | ✅ | `MarketingPlan.tsx` (`FormularioDia`), `mkt_plan_estado_producto` |
| Trabajos nuevos | «Producción de video» y «Edición de video»; se cierran solas cuando aparece el video nuevo (del tipo pedido) en la galería | ✅ | `actividades.mkt_trabajo` (`produccion`, `edicion`), `app.mkt_trabajo_cumplido` |
| Revisión | La pestaña solo la ve quien coordina Marketing | ✅ | `Marketing.tsx` |

## Datos (17-nov-2026, noche): base de pruebas al día con `Web App Vimedic (3).xlsx`

Método: insertar lo que falta y actualizar solo lo que cambió en la app original, comparando por código (o por clave
natural en las tablas sin código). El mapeo se dedujo de lo ya cargado y se validó columna por columna antes de cada
carga; cada tabla se ensayó dentro de una transacción que se deshace. **No se borró nada creado en qa.**
Programas: `herramientas/excel_a_supabase/`.

| Tabla | Nuevos | Actualizados | Nota |
|---|---|---|---|
| `clientes` | 9 (7 VIMEDIC, 2 FEMEDICS) | 4 + 2 datos de venta | Asesor reasignado, teléfono, datos completados |
| `leads` | 3 (WhatsApp) | 25 | Contactos que la app original pasó a «Perdido» |
| `cotizaciones` | 47 (36 VIMEDIC, 11 FEMEDICS) | 9 | Seguimientos, estados, 1 cotización convertida en venta, 2 carritos |
| `interacciones` | 104 | — | Enlazadas a su cotización o lead y a su usuario |
| `facturas` | 11 (9 facturadas, 2 pendientes) | 5 | Actas, guías e historial generados en la app original. Sin crear pedidos de Bodega ni seguimientos |
| `movimientos_inventario` | 9 | — | Salidas de esas ventas (total = 7 050, igual que el Excel) |
| `productos` | — | 38 | Stock de 9 productos, 24 observaciones de Bodega, datos que estaban vacíos |
| `nota_credito_detalle` | 10 | — | |
| `marketing_cambios` | 51 (34 pendientes de revisión) | — | |
| `imp_unidades` / `imp_items` | 2 | 31 nombres | |
| `producto_galeria` / `fichas_tecnicas` | 26 / 4 | — | 4 productos tenían la galería vacía |
| `bitacora` / `catalogo_actividad` | 224 / 45 | — | |

No se cargó a propósito:
- 23 leads de «Clientes Potenciales Meta»: ya están en el CRM como contactos (su «ID CRM» es un `CON-…` existente).
- 8 despachos: Bodega empezó desde cero el 16-nov.
- 1 cliente (RUC 1791705726001): ya existe con otro código.
- 1 detalle de nota de crédito cuya nota no está en el Excel.
- 3 categorías del catálogo público (`iluminacion`, `hospitalario`, `rescate`): son agrupaciones de la web, distintas de las
  categorías de producto; crearlas o renombrar es decisión de negocio.
- «Marketing Enlaces» (2 580 enlaces de un solo uso de la app vieja; 924 sin vencer, ninguno usado).
- Empleados: sin empleados nuevos (Issue #24).
- No se pisaron: revisiones de Marketing hechas en qa, textos de productos editados en qa, leads con actividad más
  reciente en qa, fecha de envío de promociones (qa tiene su propio flujo de aprobación).

## Bodega Comercial y Bodega Técnica (18-nov)

| Función | Qué hace | Estado | Dónde quedó |
|---|---|---|---|
| Revisión de importación | Aprobado → Bodega Comercial; con defecto → Bodega Técnica (Servicio Técnico); reparado y aprobado → traslado Técnica → Comercial | ✅ | `rec_revisar`, `rec_revisar_devuelta` (sin cambios de lógica), textos en Recepción |
| Dos stocks | Stock comercial (lo que se vende) y stock total (Comercial + Técnica) | ✅ | Movimientos (ficha del producto), Inventario (detalle, solo quien ve la Técnica) |
| Movimientos por bodega | Etiqueta de bodega en cada movimiento, filtro y acumulado por bodega | ✅ | `v_movimientos.bodega`, `v_movimientos_saldo`, `mov_kpis(p_bodega)` |
| Traslado manual | Comercial ⇄ Técnica con motivo (permiso de edición en Bodega) | ✅ | `mov_trasladar`, Movimientos › Trasladar entre bodegas |
| Quién ve la Técnica | Movimientos, Servicio Técnico, Bodega, Importaciones, quien edita Inventario y administración | ✅ | `app.ve_bodega_tecnica()`, `inv_estado_stock` |
| Nota de crédito | Pregunta si ya se despachó: no → vuelve a la Bodega Comercial; sí → «Por verificar» y Bodega decide | ✅ | `nc_registrar(p_despachado)`, Bodega › Devoluciones (`bod_devoluciones_pendientes`, `nc_registrar_recepcion`) |
| Proveedor de importación | En Movimientos sale abreviado (HME) y la factura es la importación (PI-…) | ✅ | `app.abreviar_proveedor`, `rec_movimiento` |

Datos corregidos en pruebas: el traslado del EQM327 (estaba como SALIDA +1), 9 ventas que la carga del 17-nov dejó como
«no disponible», y los movimientos de importación con el nombre completo del proveedor. Con eso todos los productos
cuadran con sus movimientos. La función original de notas de crédito fallaba con devoluciones de unidades (creaba la
devolución antes que la nota); quedó corregida. Pruebas: `supabase/tests/bodegas_comercial_tecnica.sql` (21/21).

## Módulo Documentos técnicos (18-nov)
Tabla por producto (imagen, nombre, código y código interno) con ficha técnica, manual, certificado, registro sanitario y
videos/otros; avance de 4 requisitos; prioritarios primero (visibles en catálogo o importados); panel con todos los
documentos, acceso a cada uno y edición de tipo, nombre y observaciones. Permiso: «Documentos técnicos › ver» (editar
para cambiar). Base: `dt_avance` (migración `20261118150000_documentos_tecnicos_modulo.sql`).
