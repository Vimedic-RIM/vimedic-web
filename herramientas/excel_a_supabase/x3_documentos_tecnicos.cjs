// Documentos técnicos del Excel (hoja «Listado único») → documentos_tecnicos en la base de pruebas.
const fs = require('fs'), S = __dirname
const h = require(S + '/dt/0.json')
const filas = []
const fecha = (s) => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T17:00:00Z` : null }
for (const r of h.filas) {
  const [cod, tipoO, obs, fnom, formato, archivo, url, carpeta, estado] = r.map((x) => (x == null ? '' : String(x).trim()))
  const m = url.match(/\/d\/([-\w]{20,})/); if (!cod || !m) continue
  const texto = (obs + ' ' + archivo).toLowerCase()
  const tipo = tipoO === 'Certificado' ? 'Certificado'
    : tipoO === 'Manual' ? (/servic|service|repair|mantenim|técnico de|tecnico de/.test(texto) ? 'Manual de servicio' : 'Manual de usuario')
    : tipoO === 'Ficha técnica' ? 'Hoja de datos del fabricante' : 'Otro'
  const nombre = [tipoO, obs].filter(Boolean).join(' – ') + (fnom ? ' · ' + fnom : '') + (formato ? ' (' + formato + ')' : '')
  filas.push({ codigo: 'DT-' + m[1], cod_producto: cod, tipo, nombre, drive_id: m[1], url, detalle: `Archivo: ${archivo} · Carpeta: ${carpeta} · ${estado}`, creado: fecha(fnom) })
}
const j = JSON.stringify(filas).replace(/'/g, "''")
const cuerpo = `
create temp table dt_in as select * from jsonb_to_recordset('${j}'::jsonb) as x(codigo text, cod_producto text, tipo text, nombre text, drive_id text, url text, detalle text, creado timestamptz);
create temp table dt_ok as
  select gen_random_uuid() id, i.codigo, p.id producto_id, i.tipo, i.nombre, i.drive_id, i.url, i.detalle, coalesce(i.creado, now()) creado
    from dt_in i join productos p on upper(p.codigo) = upper(i.cod_producto) and p.deleted_at is null
   where not exists (select 1 from documentos_tecnicos d where d.drive_id = i.drive_id or d.codigo = i.codigo);
insert into documentos_tecnicos (id, codigo, producto_id, tipo, nombre, drive_id, url, detalle, created_at, updated_at)
  select id, codigo, producto_id, tipo, nombre, drive_id, url, detalle, creado, now() from dt_ok;
select json_build_object('excel', (select count(*) from dt_in), 'cargados', (select count(*) from dt_ok),
  'ya_estaban', (select count(*) from dt_in i where exists (select 1 from documentos_tecnicos d where d.drive_id = i.drive_id and d.codigo is distinct from i.codigo)),
  'sin_producto', (select json_agg(distinct cod_producto) from dt_in i where not exists (select 1 from productos p where upper(p.codigo) = upper(i.cod_producto) and p.deleted_at is null)),
  'productos', (select count(distinct producto_id) from dt_ok), 'por_tipo', (select json_object_agg(tipo, n) from (select tipo, count(*) n from dt_ok group by 1) t),
  'total_tabla', (select count(*) from documentos_tecnicos where deleted_at is null),
  'ej', (select json_agg(x) from (select nombre, tipo from dt_ok order by random() limit 4) x));
`
fs.writeFileSync(S + '/dt_ensayo.sql', 'begin;' + cuerpo + 'rollback;\n')
fs.writeFileSync(S + '/dt_aplicar.sql', 'begin;' + cuerpo.replace(/select json_build_object\(/, 'commit;\nselect json_build_object(') )
console.log('filas', filas.length)
