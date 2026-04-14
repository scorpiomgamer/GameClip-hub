# GameClip-hub

Plataforma web para compartir clips de videojuegos con sistema de likes, comentarios filtrados y administración de usuarios y contenido.

## Descripción general

Puedes ejecutar el proyecto con **Flask (Python)** o con **Express (Node.js)**. Ambos usan el mismo archivo SQLite `gamecliphub.db`, el mismo esquema `database.sql` y el mismo algoritmo **bcrypt** para las contraseñas, de modo que puedes alternar entre uno y otro sin romper el inicio de sesión.

Funciones principales:

- Registro e inicio de sesión (roles **user** y **admin**).
- Subida de clips (mp4, webm, ogg).
- Likes y comentarios (moderación con `badwords.json`).
- Panel de administración: clips, usuarios y edición de usuarios no administradores.

## Requisitos

| Componente | Flask | Express (npm) |
|------------|-------|-----------------|
| Python | 3.11+ recomendado | — |
| Node.js | — | 18+ recomendado |
| pip / venv | Sí | — |
| npm | — | Sí |

Herramientas opcionales para inspeccionar la base de datos: [DB Browser for SQLite](https://sqlitebrowser.org/), extensión **SQLite** en VS Code, o la CLI `sqlite3` si la tienes instalada.

## Instalación

Clona el repositorio y entra en la carpeta del proyecto:

```bash
git clone https://github.com/scorpiomgamer/GameClip-hub.git
cd GameClip-hub
```

### Variables de entorno (`.env`)

Crea un archivo `.env` en la raíz (no lo subas a repositorios públicos):

```bash
PORT=3000
SESSION_SECRET=una_clave_larga_y_secreta
ADMIN_USER=admin
ADMIN_PASSWORD=admin123
```

| Variable | Uso |
|----------|-----|
| `PORT` | Puerto HTTP (por defecto 3000). |
| `SESSION_SECRET` | Firma de cookies de sesión (Flask y Express). |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Usuario administrador inicial si no existe en la BD. |
| `RESET_ADMIN_PASSWORD` | Opcional: pon `1` **una sola vez** para forzar que la contraseña del `ADMIN_USER` coincida con `ADMIN_PASSWORD` (útil si la BD quedó inconsistente). Quita la variable después. |

### Opción A — Flask (Python)

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Abre `http://127.0.0.1:3000` (o el puerto de `PORT`).

### Opción B — Express (Node)

```bash
npm install
npm start
```

Misma URL por defecto.

> **Importante:** no ejecutes Flask y Node a la vez en el **mismo puerto** y el **mismo archivo** `gamecliphub.db` sin coordinación; un solo proceso debe tener la BD abierta para evitar bloqueos de SQLite.

## Reinicio completo de la base de datos

Si quieres borrar todos los datos locales y empezar de cero:

1. Detén el servidor.
2. Ejecuta:

```bash
python reset_database.py
```

3. Vuelve a arrancar la app: se creará `gamecliphub.db` de nuevo según `database.sql` y el usuario admin según `.env`.

Si solo necesitas **arreglar la contraseña del admin** sin borrar clips, usa `RESET_ADMIN_PASSWORD=1` en `.env`, arranca una vez y luego elimina esa línea.

## Cómo ver la base de datos “en tiempo real”

SQLite es un archivo; los cambios se guardan al instante. Para verlos:

1. **DB Browser for SQLite**: abre `gamecliphub.db` → pestaña *Browse Data* → botón **Refresh** o menú para recargar tras cada acción en la web.
2. **VS Code**: instala una extensión SQLite, abre el archivo y usa refresco o vuelve a ejecutar la consulta.
3. **Línea de comandos** (si tienes `sqlite3`):

```bash
sqlite3 gamecliphub.db "SELECT id, username, role, created_at FROM users;"
```

Para monitorizar cambios repetidos en Windows PowerShell puedes repetir la consulta cada pocos segundos:

```powershell
while ($true) { Clear-Host; sqlite3 .\gamecliphub.db "SELECT * FROM clips ORDER BY id DESC LIMIT 5;"; Start-Sleep -Seconds 3 }
```

(Ajusta la ruta a `sqlite3` si no está en el PATH.)

## Estructura relevante

```text
GameClip-hub/
├── app.py              # Servidor Flask + plantillas Jinja (templates/)
├── server.js           # Servidor Express + vistas EJS (views/)
├── database.sql        # Esquema único de la BD
├── gamecliphub.db      # Generado al ejecutar (no versionar; está en .gitignore)
├── badwords.json       # Palabras filtradas en comentarios
├── reset_database.py   # Borra la BD local para recrearla
├── templates/          # HTML para Flask
├── views/              # EJS para Express
├── static/             # CSS/JS para Flask
└── public/             # Estáticos para Express
```

## Autenticación y contraseñas

- Las contraseñas se guardan con **bcrypt** (compatible entre Flask y Node).
- Si tenías hashes antiguos de **Werkzeug** (pbkdf2), el login en Flask los acepta una vez y **migra** el hash a bcrypt automáticamente.

## Flujo rápido en la web

1. Abre la raíz `/` para ver el listado de clips.
2. Regístrate en `/register` o entra en `/login`.
3. Sube un clip en `/clips/new` (requiere sesión).
4. Como **admin** (`ADMIN_USER` / `ADMIN_PASSWORD` tras instalación limpia), entra a `/admin` para gestionar clips y usuarios.

## Desarrollo

- Flask con recarga: `python app.py` (modo debug activado en el bloque `if __name__`).
- Node con recarga: `npm run dev` (requiere `nodemon`).

## Licencia

MIT (ver `package.json`).
