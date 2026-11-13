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
5. ⏭️ **Inventario y Movimientos** (siguiente)
6. Clientes
7. Agenda
8. Bodega y Logística
9. Servicio Técnico
10. Importaciones, Artículos, Adquisiciones y Recepción
11. Empleados y Solicitudes del personal (módulo nuevo de la versión 4)
12. Talento Humano y Financiero
13. Catálogos, Ofertas y Promociones
14. Dashboard Ejecutivo
15. Seguridad, Base de Datos y Mi Espacio
16. Rendimiento, diseño y uso en el teléfono

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
| `getExtendedDashboardStats` | Gráficos ampliados de FEMEDICS | ❌ | Pasa a la vuelta del Dashboard |
| `getClientAccessStatus`, `setClientAccess` | Acceso de clientes al catálogo | ❌ | Depende del catálogo público (#2) |
| `getMyRoleInfo`, `vmMisPermisosAcciones`, `vmEmpresaCall`, `vmRpc` | Infraestructura | ➖ | `mi_perfil`, RLS y parámetro `empresa` |

Además:
- Avisos internos (tabla `notificaciones`): había avisos guardados que nadie podía ver. Ahora salen en la campana de la barra lateral, en tiempo real.
- Diseño: se quitó una regla de Inventario que cortaba las tarjetas del CRM, y las ventanas grandes ya no quedan debajo de la barra lateral.
- Rendimiento: CRM, Facturación y Empleados se descargan solo al abrirlos (paquete inicial de 927 kB a 547 kB).

Para activar en el uso real (no se puede hacer desde la app):
- Zernio → Webhooks: apuntar a `https://<proyecto>.supabase.co/functions/v1/crm-mensajes?webhook=1` y guardar el secreto como `webhookSecret` en la integración de Zernio. Hacerlo solo al pasar a producción: hoy el webhook apunta a la app de Apps Script.
- Leads de Meta: falta la entrada automática (webhook de Meta Lead Ads). El reparto ya funciona con cualquier lead que entre con `origen_tipo = 'meta'`. Pasa a la vuelta de Marketing.

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
