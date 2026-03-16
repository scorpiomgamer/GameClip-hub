# GameClip-hub

Plataforma web para compartir clips de videojuegos con sistema de likes, comentarios filtrados y administración básica de usuarios y contenido.

## Descripción general

GameClip-hub es una aplicación web full-stack construida con **Python (Flask)** y **SQLite** que permite a jugadores:

- Autenticarse como **usuario** o **administrador**.
- Subir clips de video (\*.mp4, \*.webm, \*.ogg) asociados a su cuenta.
- Dar **like** a clips de otros usuarios.
- Escribir **comentarios moderados automáticamente** mediante un filtro de lenguaje ofensivo.
- Gestionar (como administrador) usuarios y clips publicados desde un panel dedicado.

La interfaz está orientada a la comunidad gamer con tonos fríos y un estilo moderno pero no estridente.

## Stack tecnológico

- **Runtime**: Python 3
- **Framework web**: Flask
- **Motor de plantillas**: Jinja2 (integrado en Flask)
- **Base de datos**: SQLite (archivo local `gamecliphub.db`)
- **Sesiones**: Cookies firmadas con `SECRET_KEY` (Flask session)
- **Subida de archivos**: Werkzeug/Flask (almacenamiento en disco)
- **Hash de contraseñas**: `werkzeug.security` (`generate_password_hash`, `check_password_hash`)
- **Entorno**: variables en `.env`
- **Moderación**: lista de palabras en JSON (`badwords.json`)
- **Estilos**: CSS puro (layout responsive, tonos fríos)

## Estructura del proyecto

```text
GameClip-hub/
├─ app.py                 # Punto de entrada del servidor Flask
├─ gamecliphub.db        # Base de datos SQLite (se crea en tiempo de ejecución)
├─ .env                  # Configuración sensible (no subir en repositorios públicos)
├─ schema.sql            # Esquema SQL (DDL) de la base de datos
├─ badwords.json         # Lista configurable de palabras prohibidas (JSON)
├─ templates/            # Plantillas HTML (Jinja2)
│  ├─ base.html
│  ├─ index.html
│  ├─ login.html
│  ├─ register.html
│  ├─ new_clip.html
│  ├─ clip_detail.html
│  └─ admin.html
├─ static/               # Recursos estáticos
│  ├─ css/
│  │  └─ styles.css
│  └─ js/
│     └─ main.js
├─ uploads/              # Clips de video subidos por los usuarios
└─ README.md
```

## Modelo de datos

La aplicación utiliza una base de datos SQLite con el siguiente modelo relacional:

- **users**
  - `id` (INTEGER, PK, autoincrement)
  - `username` (TEXT, único, no nulo)
  - `password_hash` (TEXT, no nulo)
  - `role` (TEXT, `user` | `admin`)

- **clips**
  - `id` (INTEGER, PK, autoincrement)
  - `user_id` (INTEGER, FK → users.id)
  - `title` (TEXT, no nulo)
  - `filename` (TEXT, no nulo; referencia al archivo en `uploads/`)
  - `created_at` (DATETIME, default CURRENT_TIMESTAMP)

- **comments**
  - `id` (INTEGER, PK, autoincrement)
  - `clip_id` (INTEGER, FK → clips.id)
  - `user_id` (INTEGER, FK → users.id)
  - `content` (TEXT, no nulo; texto ya filtrado)
  - `created_at` (DATETIME, default CURRENT_TIMESTAMP)

- **likes**
  - `id` (INTEGER, PK, autoincrement)
  - `clip_id` (INTEGER, FK → clips.id)
  - `user_id` (INTEGER, FK → users.id)
  - `created_at` (DATETIME, default CURRENT_TIMESTAMP)
  - Índice único `(clip_id, user_id)` para evitar likes duplicados del mismo usuario.

La creación de tablas se realiza automáticamente al arrancar el servidor usando el script `schema.sql` (ejecutado desde `app.py`).

## Filtro de comentarios (lenguaje ofensivo)

Para mantener una comunidad libre de toxicidad, los comentarios pasan por una función de sanitización:

- Se define un conjunto de **palabras prohibidas** en español e inglés.
- Antes de insertar el comentario en la base de datos, el contenido se recorre y cada coincidencia se reemplaza por `****`.
- La lógica está implementada en la función `sanitize_comment(content)` de `app.py`, cargando palabras desde `badwords.json`.

Este enfoque es sencillo pero efectivo para proyectos académicos / de demostración. En entornos de producción se podrían integrar listas dinámicas, expresiones regulares más complejas o servicios externos de moderación.

## Autenticación y roles

- **Registro**:
  - Ruta `GET /register`: muestra formulario de alta.
  - Ruta `POST /register`: crea usuarios con rol `user`.
  - Las contraseñas se almacenan como `password_hash` usando hashing de Werkzeug.

- **Login**:
  - Ruta `GET /login`: formulario de acceso.
  - Ruta `POST /login`: valida credenciales contra la tabla `users`.
  - En caso de éxito, se almacena en la sesión: `id`, `username`, `role`.

- **Sesiones**:
  - Gestionadas con sesión de Flask (cookie firmada).
  - Se utiliza `SESSION_SECRET` desde `.env` como `SECRET_KEY`.

- **Roles**:
  - **user**: puede subir clips, ver clips, dar like y comentar.
  - **admin**: además puede acceder al panel `/admin` para gestionar (eliminar) clips y usuarios.

Al arrancar la aplicación se verifica si existe un usuario administrador con el nombre configurado en `ADMIN_USER`; en caso contrario se crea uno con las credenciales definidas en `.env`.

## Publicación de clips y comentarios de usuario

- **Subida de clips**:
  - Ruta `GET /clips/new`: formulario de publicación.
  - Ruta `POST /clips`: recibe `title` y el archivo de video.
  - El archivo se almacena en `uploads/` usando un nombre único.
  - El registro del clip se guarda en la tabla `clips` enlazando al usuario autenticado.

- **Likes**:
  - Ruta `POST /clips/:id/like`: añade un like si no existe previamente para ese usuario y clip.

- **Comentarios**:
  - Ruta `POST /clips/:id/comments`: procesa el contenido, lo filtra con `sanitizeComment` y lo inserta en `comments`.
  - Los comentarios se muestran en la vista de detalle del clip (`/clips/:id`) junto con el autor y la fecha.

Estas funcionalidades constituyen la **publicación de usuario** y actúan como una **captura de participación del usuario** en la plataforma (clips, likes, comentarios).

## Configuración e instalación

### Requisitos previos

- Python 3.11+ recomendado.
- pip (incluido con Python).

### Pasos de instalación

```bash
cd GameClip-hub
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

### Configuración de entorno

Crear un archivo `.env` en la raíz con el siguiente contenido (valores de ejemplo):

```bash
PORT=3000
SESSION_SECRET=gamecliphub_secret
ADMIN_USER=admin
ADMIN_PASSWORD=admin123
```

- `PORT`: puerto HTTP donde se ejecutará el servidor.
- `SESSION_SECRET`: clave para firmar las cookies de sesión.
- `ADMIN_USER` y `ADMIN_PASSWORD`: credenciales del usuario administrador inicial.

### Ejecución en desarrollo

```bash
.\.venv\Scripts\activate
python app.py
```

El servidor se levantará por defecto en `http://localhost:3000`.

### Ejecución en producción simple

```bash
npm start
```

## Flujos principales

### Flujo de usuario estándar

1. El visitante accede a `http://localhost:3000/` y ve el feed de clips.
2. Si no está autenticado:
   - Puede registrarse en `/register`.
   - O iniciar sesión en `/login`.
3. Una vez autenticado:
   - Puede subir clips desde `/clips/new`.
   - Puede dar like y comentar en la vista de detalle `/clips/:id`.

### Flujo de administrador

1. Inicia sesión con las credenciales configuradas en `.env`.
2. Accede al panel `/admin`.
3. Desde allí puede:
   - Ver el listado de clips y eliminarlos.
   - Ver el listado de usuarios y eliminar usuarios no administradores.

## Comentarios en el código

Para facilitar la lectura y comprensión por parte de otros desarrolladores:

- Se han añadido **comentarios descriptivos** en los puntos clave del código servidor (`app.py`) y en el JavaScript de cliente (`static/js/main.js`).
- Estos comentarios explican la intención de las funciones, el propósito de los middlewares y las decisiones de diseño más relevantes.

## Buenas prácticas y consideraciones

- **Seguridad**:
  - Nunca se almacenan contraseñas en claro; siempre se usa `bcrypt`.
  - Las rutas críticas utilizan middlewares `requireAuth` y `requireAdmin`.
  - El fichero `.env` no debe subirse a repositorios públicos.

- **Escalabilidad**:
  - El uso de SQLite es suficiente para entornos locales o demostraciones. En producción se podría migrar a PostgreSQL, MySQL u otro motor relacional manteniendo la misma estructura de tablas.
  - Los archivos de video se almacenan en sistema de ficheros; una evolución natural sería moverlos a un servicio de almacenamiento de objetos (S3, Cloud Storage, etc.).

- **UX/UI**:
  - Interfaz con tonos fríos, oscuros y acentos cian/azules inspirados en la estética gamer moderna.
  - Diseño responsive preparado para escritorio y dispositivos móviles.

## Uso con Git y GitHub

Pasos sugeridos para versionar este proyecto en GitHub con el repositorio `GameClip-hub`:

```bash
cd GameClip-hub
git init
git add .
git commit -m "Inicializa GameClip-hub con backend Express, vistas EJS y sistema de clips"
git branch -M main
git remote add origin git@github.com:<TU_USUARIO>/GameClip-hub.git
git push -u origin main
```

> Sustituye `<TU_USUARIO>` por tu nombre de usuario real de GitHub.

Con esto, el origen remoto quedará configurado y podrás seguir realizando commits iterativos para nuevas funcionalidades.

