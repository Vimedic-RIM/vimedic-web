# Mapeo: hojas de Google Sheets → tablas de Supabase

Fuente: hoja de cálculo `Web App Vimedic` (73 pestañas) y el código de la app (`app.vimedic.com.ec`, v22).
Las columnas de atribución publicitaria (Origen, UTM…, GCLID, FBCLID, ID Campaña, Landing URL, Event ID,
Primer Contacto JSON, etc.) se agrupan en la columna `atribucion` (jsonb) de cada tabla.

## Usuarios y seguridad
| Hoja | Tabla | Nota |
|---|---|---|
| Empleados | `empleados` | Las ~30 columnas "X Acceso" pasan a `roles.permisos` + `empleados.permisos_extra` |
| Roles, PermisosRoles, Accesos | `roles` | Roles base ya cargados por la migración 010 |
| Asesores | `empleados` (`recibe_leads`, `orden_asignacion`) | |
| Sesiones | — | Lo reemplaza Supabase Auth |
| Bitácora | `bitacora` | |
| Papelera | — | Lo reemplaza `deleted_at` en cada tabla |
| Bodega, Financiero, TalentoHumano | `tareas_modulo` (columna `modulo`) | Las tres tienen la misma estructura |
| SOL Notificaciones | `notificaciones` | |
| _Esquemas_BD, _Respaldos_BD, Bases de Datos Notas | — | Postgres ya tiene esquema; respaldos por GitHub Action |

## Inventario y catálogo
| Hoja | Tabla | Nota |
|---|---|---|
| Productos | `productos` + `productos_costos` | Hoja principal (2 868 filas) |
| INVENTARIO | `productos` | Hoja anterior: solo para completar datos que falten (BLACK FRIDAY, STOCK MÍNIMO/MÁXIMO → `precios_promocion`, `stock_minimo`) |
| Catálogo Categorías | `categorias` | |
| Galería Productos | `producto_galeria` | |
| Proveedores | `proveedores` | |
| Fichas Técnicas | `fichas_tecnicas` | |
| Documentos Técnicos | `documentos_tecnicos` | |
| Clientes Notas Internas, notas de artículos | `notas_internas` | |
| Aliados | `aliados` | Logos para la web pública |

## Clientes y CRM
| Hoja | Tabla | Nota |
|---|---|---|
| Clientes, Clientes Femedics | `clientes` | `empresa` = VIMEDIC / FEMEDICS. Totales → vista `v_clientes_resumen` |
| Clientes_DatosVenta | `clientes.datos_venta` | |
| Sugerencias Clientes | `sugerencias_clientes` | |
| Contactos, LeadsWhatsApp, Citas, Clientes Potenciales Meta | `leads` (`origen_tipo`) | Se unen en una sola tabla |
| Cotizaciones, Cotizaciones Femedics | `cotizaciones` | "Carrito JSON" → `items` |
| Interacciones | `interacciones` | Se enlaza por RefID a lead / cotización / cliente |
| EtapasPipeline | `etapas_pipeline` | Ya cargada |
| Solicitudes Cambio Asesor | `solicitudes_cambio_asesor` | |
| Rutas, Viaticos | `rutas`, `viaticos` | |
| Mensajes, AsignacionMensajes | `mensajes`, `asignacion_conversaciones` | |
| Catálogos Generados, Catálogo Asesores - Actividad | `catalogos_generados`, `catalogo_actividad` | |

## Facturación
| Hoja | Tabla | Nota |
|---|---|---|
| Facturacion | `facturas` | |
| OPERACIONES | `facturas` / `ingresos_proveedor` | Hoja anterior: migrar solo operaciones que no estén en Facturacion |
| Ingresos | `ingresos_proveedor` | |
| Movimientos | `movimientos_inventario` | Kardex → vista `v_kardex` |
| NotasCredito, RecepcionesNC | `notas_credito` (`tipo`) | Misma estructura |
| DetalleNotasCredito | `nota_credito_detalle` | |

## Agenda y talento humano
| Hoja | Tabla |
|---|---|
| Proyectos | `proyectos` |
| Actividades | `actividades` (devolución, tiempo y avisos en jsonb) |
| MonedasAgenda, PremiosAgenda | `monedas_movimientos`, `premios_agenda` |
| SOL Solicitudes, SOL Tipos Permiso, SOL Vacaciones Movimientos | `th_solicitudes`, `th_tipos_permiso`, `th_vacaciones_movimientos` |

## Marketing
| Hoja | Tabla |
|---|---|
| Audiovisual | `audiovisual` |
| MK_PostMeta | `marketing_publicaciones` |
| Marketing Cambios, Marketing Enlaces | `marketing_cambios`, `marketing_enlaces` |
| Ofertas, Promo Campañas | `ofertas`, `promo_campanas` |
| Material Solicitudes, Material Archivos | `material_solicitudes`, `material_archivos` |
| Anuncios Activos | `anuncios_activos` |

## Importaciones
| Hoja | Tabla |
|---|---|
| Importaciones Expedientes | `imp_expedientes` |
| IMP Pedidos, IMP Items, IMP Unidades | `imp_pedidos`, `imp_items`, `imp_unidades` |
| IMP Códigos Reservados, IMP Listas Pedido | `imp_codigos_reservados`, `imp_listas_pedido` |
| IMP Recepción, IMP Órdenes ST | `imp_recepciones`, `imp_ordenes_st` |
| Codigos Faltantes | — (reporte; se puede generar con una consulta) |

## Bodega, logística y servicio técnico
| Hoja | Tabla |
|---|---|
| Despachos, Entregas, Encuestas | `despachos`, `entregas`, `encuestas` |
| Equipos, Ordenes Servicio, Técnicos | `st_equipos`, `st_ordenes`, `st_tecnicos` |
| Protocolos ST (en el código) | `st_protocolos` (ya cargada) |
| ST Incidencias Inventario | `st_incidencias_inventario` |

---

## Problemas de datos a corregir al migrar
Medidos sobre la copia de la hoja entregada el 8-nov-2026:

1. **Cédulas y RUC sin el cero inicial**: 306 clientes tienen 9 o 12 dígitos (p. ej. `602468860` → `0602468860`).
   En Facturacion, 2 551 cédulas están guardadas como número. `app.normalizar_identificacion` lo corrige.
2. **Clientes duplicados**: 32 IDs de cliente repetidos. Hay que unificarlos antes de cargar
   (el índice único `empresa + identificacion` lo exige).
3. **Asesores por nombre**: Asesor, Responsable, Facturado Por… guardan el nombre en texto.
   Al migrar se busca el empleado por nombre y se guarda su `id`; los que no coincidan quedan en un reporte.
4. **`#ERROR!` en PDF Factura URL**: 1 998 facturas. Se cargan como `null`.
5. **Stock negativo**: 80 productos. Revisar con Bodega antes de la carga final.
6. **IVA con valores mezclados** en Productos (`CON IVA`, `SI`, `NO`, `SIN IVA`) → `aplica_iva` booleano.
7. **Encabezados repetidos**: Empleados (Superadministrador ×4, Rol Marketing ×2…) y Actividades
   (Avisos Pendientes ×5, Enlace Meet ×2…). Se toma la primera columna con datos.
8. **Movimientos sin Id Operacion**: 1 075 de 6 998 (ingresos antiguos). Se migran sin factura asociada.
9. **Dos columnas para ocultar producto**: "Ocultal Producto" y "OCULTAR PRODUCTO" → `oculto`.
10. **Imágenes en Drive** (`drive.google.com/uc?export=view…`): se copian a R2 en WebP y se reemplaza `imagen_url`.
