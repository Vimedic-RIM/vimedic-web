/* Avisa a la pantalla de Marketing › Configuración que terminó la autorización y cierra la ventana. */
(function () {
  var q = new URLSearchParams(location.search)
  var ok = q.get('ok') === '1', texto = q.get('texto') || '', cuenta = q.get('cuenta') || '', proveedor = q.get('p') || ''
  var nombres = { drive: 'Google Drive' }
  var nombre = nombres[proveedor] || 'La plataforma'
  document.getElementById('ico').textContent = ok ? '✅' : '⚠️'
  var t = document.getElementById('titulo')
  t.textContent = ok ? nombre + ' conectado' : 'No se pudo conectar'
  t.className = ok ? 'ok' : 'mal'
  document.getElementById('texto').textContent = texto
  if (cuenta) document.getElementById('cuenta').textContent = 'Cuenta: ' + cuenta
  var datos = { fuente: 'vimedic-oauth', proveedor: proveedor, ok: ok, texto: texto, cuenta: cuenta }
  try { if (window.opener) window.opener.postMessage(datos, location.origin) } catch (e) { /* sin ventana de origen */ }
  try { localStorage.setItem('vm_oauth_resultado', JSON.stringify(Object.assign({ t: Date.now() }, datos))) } catch (e) { /* sin almacenamiento */ }
  if (ok) setTimeout(function () { try { window.close() } catch (e) { /* la cierra la persona */ } }, 1500)
})()
