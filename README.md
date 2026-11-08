# VIMEDIC — Base de datos en Supabase

Esquema inicial para migrar la Web App Vimedic (Apps Script + Google Sheets) a Supabase.
65 tablas, 6 vistas, 255 políticas de seguridad y datos iniciales (roles, etapas del CRM, protocolos de servicio técnico).

## Contenido
| Archivo | Qué hace |
|---|---|
| `supabase/migrations/…0100_base.sql` | Utilidades, empleados, roles, permisos, bitácora, archivos |
| `…0200_inventario.sql` | Productos, costos, categorías, galería, proveedores, fichas y documentos técnicos |
| `…0300_clientes_crm.sql` | Clientes, leads, cotizaciones, interacciones, rutas, viáticos, mensajes |
| `…0400_facturacion.sql` | Facturas, ingresos, movimientos de inventario, notas de crédito |
| `…0500_agenda_talento.sql` | Proyectos, actividades, monedas, permisos y vacaciones |
| `…0600_marketing.sql` | Audiovisual, cambios de fichas, ofertas, campañas, material de proveedores |
| `…0700_importaciones.sql` | Expedientes, pedidos, ítems, unidades, recepción, órdenes ST |
| `…0800_operaciones_servicio_tecnico.sql` | Despachos, entregas, encuestas, equipos, órdenes de servicio |
| `…0900_seguridad_rls.sql` | Políticas de seguridad por módulo y por asesor, `mi_perfil()` |
| `…1000_vistas_realtime_semillas.sql` | Catálogo público, resúmenes, kardex, tiempo real, datos iniciales |
| `supabase/tests/rls_permisos.sql` | Prueba que cada rol vea solo lo que le corresponde |
| `docs/MAPEO_HOJAS.md` | Qué hoja va a qué tabla y problemas de datos a corregir |
| `CLAUDE.md` | Contexto y reglas para Claude Code |

## Cómo aplicarlo en el Supabase de PRUEBAS

### Opción A — Supabase CLI (recomendada)
```bash
# 1. Copia esta carpeta dentro de tu repositorio vimedic-web
# 2. En la terminal de VS Code, dentro del repo:
npx supabase login
npx supabase init            # si pregunta, NO sobrescribas la carpeta migrations
npx supabase link --project-ref <ref-del-proyecto-vimedic-pruebas>
npx supabase db push         # aplica las 10 migraciones en orden
```
El `project-ref` está en Supabase → Project Settings → General.

### Opción B — Editor SQL del panel
Abre cada archivo de `supabase/migrations/` **en orden** (0100, 0200, … 1000), pega su contenido en
Supabase → SQL Editor y ejecútalo.

## Después de aplicarlo
1. **Crea tu usuario superadministrador** (SQL Editor):
   ```sql
   insert into public.empleados (email, nombre, es_superadmin, rol_id)
   values ('direccion.marketing@vimedic.com.ec', 'Tu nombre', true,
           (select id from public.roles where nombre = 'Superadministrador'));
   ```
2. En Authentication → Users → **Add user**, crea la cuenta con ese mismo correo.
   Se vincula sola con el empleado.
3. Activa en Authentication → Providers el inicio con correo (y Google si lo quieres).
4. Corre la prueba de seguridad (solo en pruebas):
   `psql "<cadena de conexión de pruebas>" -f supabase/tests/rls_permisos.sql`

## Verificado
Las 10 migraciones se aplicaron sin errores en PostgreSQL 16 y la prueba de seguridad confirmó:
- un asesor ve solo sus leads; su supervisor ve los de todo el equipo
- un asesor ve productos pero no costos, y no puede crear productos ni borrar registros
- nadie puede darse permisos a sí mismo
- un vendedor de FEMEDICS no ve ni crea datos de VIMEDIC
- un empleado no puede aprobar su propia solicitud de permiso; su jefe sí
- sin iniciar sesión solo se ve el catálogo público y las categorías

## Siguiente paso
Script de migración de datos (Sheets → Supabase) que corrija los problemas listados en `docs/MAPEO_HOJAS.md`
(cédulas sin cero, clientes duplicados, asesores por nombre, imágenes a R2), empezando por el catálogo.
