# Cómo trabajamos entre dos personas

Reglas prácticas para que los pedidos, los cambios de código y los de base de datos no se crucen.
Las reglas de base de datos y de ramas ya están en `CLAUDE.md`; esto es el flujo del día a día.

## 1. Todo pedido es un Issue

Antes de pedirle algo a Claude Code (o de ponerse a programar a mano), se abre un Issue en GitHub:
[github.com/Vimedic-RIM/vimedic-web/issues](https://github.com/Vimedic-RIM/vimedic-web/issues/new/choose)

- Se le pone la etiqueta `módulo: …` que corresponda (crm, inventario, marketing…).
- Si es un error, `bug`. Si es algo nuevo, `enhancement`.
- Si es urgente, `prioridad: urgente`.

Así el otro ve en un vistazo qué se está pidiendo y en qué módulo, sin tener que preguntar por chat.

## 2. Antes de empezar: avisar y jalar

- Se asigna el Issue a quien lo va a trabajar (o se comenta "lo tomo yo").
- `git pull` antes de tocar nada. Si el Issue toca un módulo que el otro también estaba tocando, se habla antes de seguir.

## 3. Mientras se trabaja

- Cambios chicos y propios: directo a la rama `qa`.
- Cambios grandes, o que tocan algo que el otro también usa: una rama con el nombre del Issue
  (`git checkout -b 42-arregla-dashboard`), y un Pull Request hacia `qa` para que el otro vea el diff
  antes de fusionar.
- Las migraciones de base de datos siempre se aplican (`supabase db push`) **y** se suben a GitHub
  en la misma sesión. Nunca una migración aplicada sin su archivo subido.

## 4. Al terminar

- `git push` antes de cerrar la laptop. No dejar commits solo en la máquina (ya pasó una vez).
- Se le pone al Issue la etiqueta `listo para probar` y se comenta qué URL de despliegue probar
  (la que da `wrangler pages deploy`, o `qa.vimedic.com.ec` una vez esté actualizado).
- El otro prueba, comenta en el Issue qué encontró, y si está bien, se cierra el Issue o se le pone
  `a producción` si ya puede pasar a `main`.

## 5. Pasar a producción (`main`)

Solo con acuerdo de los dos — así lo pide `CLAUDE.md`. Se juntan los Issues con `a producción`,
se revisan una vez más en `qa`, y recién ahí se fusiona `qa` → `main`.

## 6. Etiquetas disponibles

| Etiqueta | Para qué |
|---|---|
| `módulo: *` | En qué parte de la app es (una por módulo) |
| `bug` / `enhancement` / `question` | Qué tipo de pedido es |
| `prioridad: urgente` / `prioridad: normal` | Qué tan rápido hace falta |
| `listo para probar` | Ya está desplegado en qa, falta que el otro lo pruebe |
| `a producción` | Probado, falta el acuerdo para pasar a main |
| `bloqueado` | Depende de algo externo (DNS, Google Cloud, una clave de API…) |

## 7. Secretos y claves

Las claves de Zernio, Gemini y Drive viven en la base de datos (Vault), no en archivos: las ve
cualquiera con permiso de administrar Marketing, sin tener que compartirlas por chat.
El `.env.local` (URL y clave anónima de Supabase) no cambia entre los dos; si alguna vez cambia,
se avisa directo, porque no está en git.
