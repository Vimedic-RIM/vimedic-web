# Excel de la app original → base de pruebas (sincronización incremental)

Programas usados el 17-nov-2026 para poner `vimedic-pruebas` al día con `datos_origen/Web App Vimedic (3).xlsx`.
Insertan lo que falta y actualizan solo lo que cambió en la app original, **sin borrar nada creado en qa**.
Solo se usan contra la base de pruebas (la CLI enlazada a `qwkziqjozfeemvjshvsp`).

## Cómo se usan (desde la raíz del repositorio)

Los archivos de trabajo (hojas volcadas, muestras de la base, salidas) van en una carpeta temporal; aquí la llamamos `$T`.
Copiar estos programas a `$T` y trabajar ahí.

1. Volcar el Excel: `JSZIP=$PWD/web/node_modules/jszip node $T/x3_volcar.cjs "datos_origen/<excel>.xlsx" $T/x3`
2. Referencias y códigos de la base: `npx supabase db query --remote --yes -o json -f $T/x3_ref.sql` (y `x3_codigos.sql`),
   guardando el resultado como `x3_ref.json` / `x3_codigos.json`.
3. Qué falta por tabla: `node $T/x3_diff.cjs $T`
4. Muestras de la base por tabla: `node $T/x3_muestra.cjs <n hoja> <tabla> 0 0` → consulta → `x3m/<nombre>.json`.
5. Cada `x3_cfg_<tabla>.cjs` deduce el mapeo comparando con lo que ya está cargado (`x3_aprender.cjs`), lo valida
   columna por columna, y deja `x3_out_<tabla>.json` con filas nuevas y cambios. `x3_sql.cjs` arma el SQL.
6. Siempre: ensayo dentro de `begin; … rollback;` y recién después `commit`.

## Reglas que aplican (aprendidas de las cargas anteriores)

- JSON escrito a mano en la hoja con comillas sin escapar: se repara (`repararJson`).
- Códigos que el Excel guardó como número (`6.3761191E7`, `13892.0`) y cédulas sin el cero inicial: se prueban varias formas.
- Teléfonos celulares de 9 dígitos → con 0 inicial. `#ERROR!` → vacío. Fechas: hora local de Ecuador.
- Cotizaciones: tipo vacío = «Histórico», «true» en estado de pago = «Pagado», «Eliminado» = Perdido y dado de baja,
  consumidor final (999) sin cliente; productos editados en qa (precio objetivo FEMEDICS) no se pisan.
- Facturas: se apagan durante la carga los disparadores de Bodega, seguimiento, bitácora y fecha de facturación
  (no se crean pedidos ni se envían mensajes); actas y guías generadas en qa no se pisan.
- Leads: se apagan reparto y aviso de Meta; si qa tiene actividad más reciente, no se pisa.
- Productos: stock, precios y observaciones de Bodega desde el Excel; textos y enlaces solo si en qa están vacíos.
- Marketing: no se tocan revisiones hechas en qa.
- Movimientos: «disponible» vacío queda vacío (no «falso»); un traslado guardado como `SALIDA` con cantidad positiva en
  «Principal» o «Por reparar» es un `INGRESO`. Proveedor de importación abreviado y la importación (PI-…) como factura
  (la migración `20261118120000_bodegas_comercial_tecnica.sql` lo aplica a lo que ya esté cargado).

## Documentos técnicos (18-nov)
`datos_origen/Documentos_Tecnicos_Drive.xlsx` (hoja «Listado único», 288 archivos de Drive de 121 productos) →
`documentos_tecnicos`. Volcar el Excel en `$T/dt` y correr `node $T/x3_documentos_tecnicos.cjs`: deja `dt_ensayo.sql`
(se deshace) y `dt_aplicar.sql`. Tipos: Certificado; Manual → Manual de usuario (o de servicio si el nombre lo dice);
Ficha técnica → Hoja de datos del fabricante; Video → Otro. No repite archivos (por id de Drive).
