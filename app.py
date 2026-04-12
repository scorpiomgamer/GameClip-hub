import json
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "gamecliphub.db"
UPLOAD_DIR = BASE_DIR / "uploads"
BADWORDS_PATH = BASE_DIR / "badwords.json"
SCHEMA_PATH = BASE_DIR / "database.sql"


def create_app() -> Flask:
    load_dotenv()

    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.config["SECRET_KEY"] = os.getenv("SESSION_SECRET", "gamecliphub_secret")
    app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200MB
    app.config["UPLOAD_FOLDER"] = str(UPLOAD_DIR)

    UPLOAD_DIR.mkdir(exist_ok=True)

    with app.app_context():
        init_db()
        ensure_default_admin()

    @app.before_request
    def load_current_user():
        g.current_user = session.get("user")

    @app.context_processor
    def inject_user():
        return {"current_user": g.get("current_user"), "now_year": datetime.now().year}

    @app.route("/")
    def index():
        db = get_db()
        clips = db.execute(
            """
            SELECT
              clips.id, clips.title, clips.filename, clips.created_at,
              users.username,
              (SELECT COUNT(*) FROM likes WHERE likes.clip_id = clips.id) AS likeCount,
              (SELECT COUNT(*) FROM comments WHERE comments.clip_id = clips.id) AS commentCount
            FROM clips
            JOIN users ON users.id = clips.user_id
            ORDER BY clips.created_at DESC
            """
        ).fetchall()
        return render_template("index.html", clips=clips)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "GET":
            return render_template("login.html")

        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        db = get_db()
        user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if not user or not check_password_hash(user["password_hash"], password):
            flash("Usuario o contraseña inválidos.", "error")
            return render_template("login.html"), 401

        session["user"] = {"id": user["id"], "username": user["username"], "role": user["role"]}
        return redirect(url_for("index"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "GET":
            return render_template("register.html")

        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not username or not password:
            flash("Usuario y contraseña son obligatorios.", "error")
            return render_template("register.html"), 400

        db = get_db()
        try:
            db.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                (username, generate_password_hash(password), "user"),
            )
            db.commit()
        except sqlite3.IntegrityError:
            flash("El nombre de usuario ya existe.", "error")
            return render_template("register.html"), 409

        return redirect(url_for("login"))

    @app.post("/logout")
    def logout():
        session.pop("user", None)
        return redirect(url_for("login"))

    @app.route("/clips/new")
    def new_clip():
        require_auth()
        return render_template("new_clip.html")

    @app.post("/clips")
    def create_clip():
        require_auth()
        title = request.form.get("title", "").strip()
        file = request.files.get("clip")
        if not title:
            flash("El título es obligatorio.", "error")
            return render_template("new_clip.html"), 400
        if not file or not file.filename:
            flash("Debes subir un archivo de video.", "error")
            return render_template("new_clip.html"), 400

        allowed_ext = {".mp4", ".webm", ".ogg"}
        ext = Path(file.filename).suffix.lower()
        if ext not in allowed_ext:
            flash("Solo se permiten archivos de video (mp4, webm, ogg).", "error")
            return render_template("new_clip.html"), 400

        safe = secure_filename(file.filename)
        unique = f"{int(datetime.utcnow().timestamp())}-{os.urandom(6).hex()}{Path(safe).suffix.lower()}"
        file_path = UPLOAD_DIR / unique
        file.save(file_path)

        db = get_db()
        db.execute(
            "INSERT INTO clips (user_id, title, filename) VALUES (?, ?, ?)",
            (g.current_user["id"], title, unique),
        )
        db.commit()
        return redirect(url_for("index"))

    @app.route("/clips/<int:clip_id>")
    def clip_detail(clip_id: int):
        db = get_db()
        clip = db.execute(
            """
            SELECT
              clips.*, users.username,
              (SELECT COUNT(*) FROM likes WHERE likes.clip_id = clips.id) AS likeCount
            FROM clips
            JOIN users ON users.id = clips.user_id
            WHERE clips.id = ?
            """,
            (clip_id,),
        ).fetchone()
        if not clip:
            abort(404)

        comments = db.execute(
            """
            SELECT comments.*, users.username
            FROM comments
            JOIN users ON users.id = comments.user_id
            WHERE comments.clip_id = ?
            ORDER BY comments.created_at ASC
            """,
            (clip_id,),
        ).fetchall()
        return render_template("clip_detail.html", clip=clip, comments=comments)

    @app.post("/clips/<int:clip_id>/like")
    def like_clip(clip_id: int):
        require_auth()
        db = get_db()
        db.execute(
            "INSERT OR IGNORE INTO likes (clip_id, user_id) VALUES (?, ?)",
            (clip_id, g.current_user["id"]),
        )
        db.commit()
        return redirect(url_for("clip_detail", clip_id=clip_id))

    @app.post("/clips/<int:clip_id>/comments")
    def add_comment(clip_id: int):
        require_auth()
        raw = request.form.get("content", "")
        sanitized = sanitize_comment(raw)
        db = get_db()
        db.execute(
            "INSERT INTO comments (clip_id, user_id, content) VALUES (?, ?, ?)",
            (clip_id, g.current_user["id"], sanitized),
        )
        db.commit()
        return redirect(url_for("clip_detail", clip_id=clip_id))

    @app.route("/admin")
    def admin_panel():
        require_admin()
        db = get_db()
        clips = db.execute(
            """
            SELECT clips.id, clips.title, clips.filename, clips.created_at, users.username
            FROM clips JOIN users ON users.id = clips.user_id
            ORDER BY clips.created_at DESC
            """
        ).fetchall()
        users = db.execute(
            "SELECT id, username, role, created_at FROM users ORDER BY username ASC"
        ).fetchall()
        return render_template("admin.html", clips=clips, users=users)

    @app.post("/admin/clips/<int:clip_id>/delete")
    def admin_delete_clip(clip_id: int):
        require_admin()
        db = get_db()
        clip = db.execute("SELECT filename FROM clips WHERE id = ?", (clip_id,)).fetchone()
        if clip:
            try:
                (UPLOAD_DIR / clip["filename"]).unlink(missing_ok=True)
            except Exception:
                pass
        db.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
        db.commit()
        return redirect(url_for("admin_panel"))

    @app.post("/admin/users/<int:user_id>/delete")
    def admin_delete_user(user_id: int):
        require_admin()
        if user_id == g.current_user["id"]:
            flash("No puedes eliminar tu propio usuario administrador.", "error")
            return redirect(url_for("admin_panel"))
        db = get_db()
        user = db.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if user and user["role"] == "admin":
            flash("No puedes eliminar otro administrador.", "error")
            return redirect(url_for("admin_panel"))
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        db.commit()
        return redirect(url_for("admin_panel"))
    
    @app.route("/admin/users/<int:user_id>/edit", methods=["GET", "POST"])
    def admin_edit_user(user_id: int):
        require_admin()
        db = get_db()
        user = db.execute("SELECT id, username, role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            flash("Usuario no encontrado.", "error")
            return redirect(url_for("admin_panel"))
        if user_id == g.current_user["id"]:
            flash("No puedes editar tu propio usuario de administrador.", "error")
            return redirect(url_for("admin_panel"))
        if user["role"] == "admin":
            flash("No puedes editar otro administrador.", "error")
            return redirect(url_for("admin_panel"))

        if request.method == "GET":
            return render_template("edit_user.html", user=user)

        new_username = request.form.get("username", "").strip()
        new_role = request.form.get("role", "").strip()
        if not new_username:
            flash("El nombre de usuario es obligatorio.", "error")
            return render_template("edit_user.html", user=user), 400
        if new_role not in {"user", "admin"}:
            flash("Rol inválido.", "error")
            return render_template("edit_user.html", user=user), 400

        try:
            db.execute(
                "UPDATE users SET username = ?, role = ? WHERE id = ?",
                (new_username, new_role, user_id),
            )
            db.commit()
        except sqlite3.IntegrityError:
            flash("El nombre de usuario ya existe.", "error")
            return render_template("edit_user.html", user=user), 409

        flash("Usuario actualizado exitosamente.", "success")
        return redirect(url_for("admin_panel"))
    
    
    def admin_edit_admin(user_id: int):
        require_admin()
        if user_id == g.current_user["id"]:
            flash("no puedes editar tu propio usuario de administrador.", 
                  "error")
        db=get_db()
        user = db.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if user and user["role"] == "admin":
            flash("No puedes editar otro administrador.", "error")
            return redirect(url_for("admin_panel"))
        db.execute("UPDATE FROM users WHERE id = ?", (user_id,))
        db.commit()
        return redirect(url_for("admin_panel"))        

    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename: str):
        return send_from_directory(UPLOAD_DIR, filename)

    return app


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


def init_db() -> None:
    DB_PATH.touch(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema)
    conn.commit()
    conn.close()


def ensure_default_admin() -> None:
    admin_user = os.getenv("ADMIN_USER", "admin")
    admin_password = os.getenv("ADMIN_PASSWORD", "admin123")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    existing = conn.execute("SELECT id FROM users WHERE username = ?", (admin_user,)).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (admin_user, generate_password_hash(admin_password), "admin"),
        )
        conn.commit()
    conn.close()


def require_auth() -> None:
    if not session.get("user"):
        abort(401)


def require_admin() -> None:
    u = session.get("user")
    if not u or u.get("role") != "admin":
        abort(403)


def load_badwords() -> list[str]:
    try:
        raw = json.loads(BADWORDS_PATH.read_text(encoding="utf-8"))
        words = raw.get("banned_words", [])
        return [w for w in words if isinstance(w, str) and w.strip()]
    except Exception:
        return []


def sanitize_comment(content: str) -> str:
    words = load_badwords()
    sanitized = content
    for w in words:
        pattern = re.compile(re.escape(w), flags=re.IGNORECASE)
        sanitized = pattern.sub("****", sanitized)
    return sanitized


app = create_app()


@app.teardown_appcontext
def close_db(_exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "3000")), debug=True)

