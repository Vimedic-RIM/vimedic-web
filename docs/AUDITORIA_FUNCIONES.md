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
11. ⏭️ **Empleados y Solicitudes del personal** (siguiente; módulo nuevo de la versión 4)
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

## 10. Importaciones, Artículos, Adquisiciones y Recepción — Issue #30 (en curso)

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
