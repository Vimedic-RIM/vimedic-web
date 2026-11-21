# VIMEDIC — Contexto del proyecto para Claude Code

## Qué es
Sistema interno de VIMEDIC (importador y distribuidor de equipos médicos, Ecuador).
Se está migrando la "Web App Vimedic" de **Google Apps Script + Google Sheets** a un stack propio.
**Desde el 21-nov-2026 la app nueva está en producción en `app.vimedic.com.ec`.** La app de Apps Script queda solo
para consulta (su URL /exec sigue funcionando) y Google Sheets como respaldo. `qa.vimedic.com.ec` redirige a app.

FEMEDICS es distribuidor autorizado de la marca y comparte el sistema: las tablas con columna
`empresa` ('VIMEDIC' | 'FEMEDICS') separan sus datos.

## Arquitectura
| Parte | Servicio |
|---|---|
| Base de datos, login, tiempo real | Supabase (Postgres), región us-east-1 |
| App web | Cloudflare Pages: `main` → proyecto `vimedic-app` → **app.vimedic.com.ec**; `qa` → proyecto `vimedic-qa` → vimedic-qa.pages.dev (vista previa) |
| Documentos internos (PDF, facturas, contratos) | Google Drive — unidad compartida "VIMEDIC Sistema" vía cuenta de servicio |
| Imágenes del catálogo y videos | Cloudflare R2 (`media.vimedic.com.ec`) |
| App móvil sin conexión | Expo (React Native) + PowerSync, se distribuye como APK |
| Dominio, DNS, correo, web pública | Hostinger (NO tocar registros MX) |
| Facturación electrónica | Contífico (se guarda el número en `facturas.numero_contifico`) |
| Mensajería | Zernio (WhatsApp / redes) |

**Supabase: el proyecto `qwkziqjozfeemvjshvsp` (antes «vimedic-pruebas») ES PRODUCCIÓN desde el 21-nov-2026**
(datos reales, usuarios, Meta, Gmail, Zernio, cron, web pública). Todavía no hay base de pruebas aparte (pendiente).
Mientras tanto, sobre esa base:
- Pruebas de SQL solo dentro de `begin; … rollback;` (las de `supabase/tests/` ya lo hacen) y ensayo de cada migración en
  una transacción que se deshace antes del `db push`.
- Nada que mande correos, WhatsApp o publicaciones a clientes o asesores para «probar».
- Respaldo de datos antes de cambios grandes (`Documents/Vimedic/Respaldos_BD`, sin Docker: exportación por tabla).
- `supabase config push` NO: pisaría la clave del login con Google. Los ajustes de Auth se cambian en el panel.

## Reglas de la base de datos (obligatorias)
- Toda tabla nueva: `id uuid primary key default gen_random_uuid()` y después `select app.estandarizar('public.tabla');`
  → agrega `created_at`, `updated_at`, `deleted_at`, `creado_por`, trigger de `updated_at`, índice y RLS.
- Toda tabla nueva necesita políticas: `select app.aplicar_rls('public.tabla', array['modulo_ver'], array['modulo_editar']);`
  Ninguna tabla queda sin RLS.
- **Borrado lógico**: nunca `DELETE`; se hace `update ... set deleted_at = now()`. Las consultas filtran `deleted_at is null`.
- `codigo` = ID original de la hoja de cálculo (EQM113, PI-…, INT-…). Sirve para trazabilidad y para la migración.
- Cédula/RUC siempre como **texto** (`app.normalizar_identificacion` recupera el cero inicial).
- Dinero en `numeric(12,2)`. Fechas con hora en `timestamptz`; fechas sin hora en `date`.
- Nombres de tablas y columnas en español, `snake_case`, sin tildes ni ñ (`cumpleanos`, `campana`).
- Los IDs se generan en el cliente cuando hace falta (UUID) para que la app móvil cree registros sin conexión.
- Cambios de esquema SIEMPRE como nueva migración en `supabase/migrations/` (nunca editar una ya aplicada).

## Permisos
- Los permisos viven en `roles.permisos` (jsonb) + `empleados.permisos_extra`:
  `{"crm": ["ver","crear","editar","ver_todos"], "inventario": ["ver"]}`
- Acciones: `ver`, `crear`, `editar`, `eliminar`, `aprobar`, `exportar`, `ver_todos`, `ver_costos`, `respaldar`, `restaurar` (solo basedatos), `administrar`.
- Módulos: crm, clientes, femedics, inventario, movimientos, facturacion, agenda, empleados, dashboard,
  marketing, catalogos, ofertas, promociones, documentos_tecnicos, bodega, logistica, importaciones,
  servicio_tecnico, talento_humano, financiero, seguridad, plantillas (Plantillas de documentos).
- En SQL: `app.puede('crm','editar')`, `app.puede_alguno(array[...], 'ver')`, `app.es_superadmin()`, `app.empleado_id()`.
- En el frontend: `supabase.rpc('mi_perfil')` devuelve el empleado, su rol y sus permisos efectivos.
- CRM: un asesor ve solo sus leads/cotizaciones/clientes y los de su equipo; `ver_todos` ve todo.
- Los costos están en `productos_costos` (separado de `productos`) para que los asesores no los vean.

## Seguridad
- La `anon key` puede ir en el frontend. La `service_role` JAMÁS va en el frontend ni en el repositorio:
  solo en secretos de Edge Functions / Cloudflare / GitHub.
- Páginas públicas con token (seguimiento de despacho, material de proveedores, firma de servicio técnico,
  aprobación por correo) → Edge Function con service_role que valida el token. No crear políticas `anon` para eso.
- Lo único visible sin login: `v_catalogo_publico`, `categorias` activas y `aliados` activos.
- No guardar contraseñas ni tokens de sesión en tablas: el login es Supabase Auth.
  Al crear la cuenta en Auth, el trigger vincula al empleado por correo.

## Rendimiento (la razón de la migración)
- Nunca `select('*')` en listados: pedir solo las columnas necesarias.
- Paginar con `.range()` (25–50 filas).
- Búsquedas de texto: índices trigram en nombre/código de productos y clientes (`ilike '%texto%'`).
- Reportes y totales: vistas (`v_clientes_resumen`, `v_ventas_mensuales`, `v_embudo_crm`, `v_kardex`), no en el navegador.
- Tiempo real (Supabase Realtime) en facturas, cotizaciones, leads, mensajes, despachos… en lugar de consultar cada X segundos.
- Imágenes: WebP en R2, miniaturas en listados, `loading="lazy"`.

## Estructura del repositorio
```
supabase/migrations/   esquema SQL versionado (aplicar con `supabase db push`)
supabase/tests/        pruebas de RLS
supabase/functions/    Edge Functions (Drive, R2, Contífico, tokens públicos)
docs/MAPEO_HOJAS.md    qué hoja de Sheets va a qué tabla y problemas de datos detectados
```

## Forma de trabajar
- Idioma: español en código de negocio, comentarios, mensajes de commit y textos de la interfaz.
- Una rama por módulo (`migracion-catalogo`, `migracion-crm`…) → merge a `qa` → probar → merge a `main`.
- Antes de dar algo por terminado: ensayar la migración en una transacción que se deshace, aplicarla y correr `supabase/tests/`
  (todo sobre producción con cuidado, ver arriba, hasta que exista la base de pruebas aparte).
- Migrar un módulo a la vez; Google Sheets queda como respaldo hasta comparar los datos.
- Pedidos y seguimiento: cada cambio entra como un Issue en GitHub (ver `docs/FLUJO_DE_TRABAJO.md`).
- **Despliegue del front (web): automático.** Un push a `qa` publica en `vimedic-qa.pages.dev` (vista previa,
  `deploy-qa.yml`); un push/merge a `main` publica en **app.vimedic.com.ec** (`deploy-main.yml`, proyecto `vimedic-app`).
  Flujo: `qa` → revisar en vimedic-qa.pages.dev → pasar a `main` solo con lo revisado. Ojo: la vista previa usa la misma
  base de producción. Las Edge Functions y migraciones se aplican al único proyecto (producción) al desplegarlas.
