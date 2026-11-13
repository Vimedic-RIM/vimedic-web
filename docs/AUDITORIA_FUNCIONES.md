# Auditoría función por función: app original (Apps Script) → app nueva

Fuente: código de Apps Script versión 4 (`origen_appscript/Web App Vimedic (4).json`, 13-nov-2026).
Método: por cada pantalla se listan las funciones de servidor que llama (`google.script.run.*`) y sus
botones, pestañas y ventanas; se busca el equivalente en `web/src/modulos` y `supabase/` (sin suponer).

Estados: ✅ existe en la app nueva · 🆕 recuperado en esta auditoría · ⚠️ parcial · ❌ falta · ➖ no aplica.

## Orden de trabajo (acordado con el usuario)

1. ✅ CRM Vimedic y FEMEDICS
2. ⏭️ **Facturación** (siguiente)
3. Marketing
4. Carga del Excel actualizado (`datos_origen/Web App Vimedic (2).xlsx`) en vimedic-pruebas
5. Inventario y Movimientos
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
