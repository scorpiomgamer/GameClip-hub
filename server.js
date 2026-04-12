require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Base de datos SQLite: DDL en database.sql (única fuente de verdad)
const DB_PATH = path.join(__dirname, 'gamecliphub.db');
const SQL_PATH = path.join(__dirname, 'database.sql');

const db = new sqlite3.Database(DB_PATH);

function ensureDefaultAdmin() {
  const adminUsername = process.env.ADMIN_USER || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  db.get('SELECT * FROM users WHERE username = ?', [adminUsername], async (err, row) => {
    if (err) {
      console.error('Error comprobando usuario admin:', err);
      return;
    }
    if (!row) {
      try {
        const hash = await bcrypt.hash(adminPassword, 10);
        db.run(
          'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
          [adminUsername, hash, 'admin'],
          (insertErr) => {
            if (insertErr) {
              console.error('Error creando usuario admin:', insertErr);
            } else {
              console.log('Usuario admin por defecto creado.');
            }
          }
        );
      } catch (hashErr) {
        console.error('Error generando hash de admin:', hashErr);
      }
    }
  });
}

let initSql;
try {
  initSql = fs.readFileSync(SQL_PATH, 'utf8');
} catch (readErr) {
  console.error('No se pudo leer database.sql:', readErr);
  process.exit(1);
}

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.exec(initSql, (execErr) => {
    if (execErr) {
      console.error('Error ejecutando database.sql:', execErr);
      process.exit(1);
    }
    ensureDefaultAdmin();
  });
});

// Configuración de almacenamiento de clips con Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/ogg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de video (mp4, webm, ogg).'));
    }
  }
});

// Lista simple de palabras prohibidas (es/en)
const bannedWords = [
  'tonto', 'idiota', 'estupido', 'estúpido',
  'fuck', 'shit', 'bitch', 'asshole', 'bastard'
];

function sanitizeComment(content) {
  let sanitized = content;
  for (const word of bannedWords) {
    const regex = new RegExp(word, 'gi');
    sanitized = sanitized.replace(regex, '****');
  }
  return sanitized;
}

// Middlewares globales
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'gamecliphub_secret',
    resave: false,
    saveUninitialized: false
  })
);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Middleware para exponer usuario en vistas
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// Middleware de protección de rutas
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).send('Acceso restringido a administradores.');
  }
  next();
}

// Rutas
app.get('/', (req, res) => {
  db.all(
    `
    SELECT clips.*, users.username,
           (SELECT COUNT(*) FROM likes WHERE likes.clip_id = clips.id) AS likeCount,
           (SELECT COUNT(*) FROM comments WHERE comments.clip_id = clips.id) AS commentCount
    FROM clips
    JOIN users ON users.id = clips.user_id
    ORDER BY created_at DESC
    `,
    [],
    (err, clips) => {
      if (err) {
        console.error('Error obteniendo clips:', err);
        return res.status(500).send('Error interno del servidor.');
      }
      res.render('index', { clips });
    }
  );
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      console.error('Error en login:', err);
      return res.render('login', { error: 'Error interno. Intenta de nuevo.' });
    }
    if (!user) {
      return res.render('login', { error: 'Usuario o contraseña inválidos.' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('login', { error: 'Usuario o contraseña inválidos.' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.redirect('/');
  });
});

app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.render('register', { error: 'Usuario y contraseña son obligatorios.' });
  }
  bcrypt
    .hash(password, 10)
    .then((hash) => {
      db.run(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        [username, hash, 'user'],
        (err) => {
          if (err) {
            console.error('Error registrando usuario:', err);
            let message = 'Error al registrar usuario.';
            if (err.message.includes('UNIQUE')) {
              message = 'El nombre de usuario ya existe.';
            }
            return res.render('register', { error: message });
          }
          res.redirect('/login');
        }
      );
    })
    .catch((err) => {
      console.error('Error generando hash:', err);
      res.render('register', { error: 'Error interno. Intenta de nuevo.' });
    });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/clips/new', requireAuth, (req, res) => {
  res.render('new-clip', { error: null });
});

app.post('/clips', requireAuth, upload.single('clip'), (req, res) => {
  const { title } = req.body;
  if (!req.file) {
    return res.render('new-clip', { error: 'Debes subir un archivo de video.' });
  }

  db.run(
    'INSERT INTO clips (user_id, title, filename) VALUES (?, ?, ?)',
    [req.session.user.id, title, req.file.filename],
    (err) => {
      if (err) {
        console.error('Error guardando clip:', err);
        return res.render('new-clip', { error: 'Error al guardar el clip.' });
      }
      res.redirect('/');
    }
  );
});

app.get('/clips/:id', (req, res) => {
  const clipId = req.params.id;
  db.get(
    `
    SELECT clips.*, users.username,
           (SELECT COUNT(*) FROM likes WHERE likes.clip_id = clips.id) AS likeCount
    FROM clips
    JOIN users ON users.id = clips.user_id
    WHERE clips.id = ?
    `,
    [clipId],
    (err, clip) => {
      if (err || !clip) {
        console.error('Error obteniendo clip:', err);
        return res.status(404).send('Clip no encontrado.');
      }
      db.all(
        `
        SELECT comments.*, users.username
        FROM comments
        JOIN users ON users.id = comments.user_id
        WHERE comments.clip_id = ?
        ORDER BY created_at ASC
        `,
        [clipId],
        (commentErr, comments) => {
          if (commentErr) {
            console.error('Error obteniendo comentarios:', commentErr);
            return res.status(500).send('Error obteniendo comentarios.');
          }
          res.render('clip-detail', { clip, comments });
        }
      );
    }
  );
});

app.post('/clips/:id/like', requireAuth, (req, res) => {
  const clipId = req.params.id;
  db.run(
    'INSERT OR IGNORE INTO likes (clip_id, user_id) VALUES (?, ?)',
    [clipId, req.session.user.id],
    (err) => {
      if (err) {
        console.error('Error dando like:', err);
      }
      res.redirect('/clips/' + clipId);
    }
  );
});

app.post('/clips/:id/comments', requireAuth, (req, res) => {
  const clipId = req.params.id;
  const rawContent = req.body.content || '';
  const sanitized = sanitizeComment(rawContent);

  db.run(
    'INSERT INTO comments (clip_id, user_id, content) VALUES (?, ?, ?)',
    [clipId, req.session.user.id, sanitized],
    (err) => {
      if (err) {
        console.error('Error guardando comentario:', err);
      }
      res.redirect('/clips/' + clipId);
    }
  );
});

// Panel simple de administración
app.get('/admin', requireAdmin, (req, res) => {
  db.all(
    `
    SELECT clips.id, clips.title, clips.filename, users.username
    FROM clips
    JOIN users ON users.id = clips.user_id
    ORDER BY clips.created_at DESC
    `,
    [],
    (err, clips) => {
      if (err) {
        console.error('Error obteniendo clips para admin:', err);
        return res.status(500).send('Error interno.');
      }
      db.all(
        'SELECT id, username, role FROM users ORDER BY username ASC',
        [],
        (userErr, users) => {
          if (userErr) {
            console.error('Error obteniendo usuarios:', userErr);
            return res.status(500).send('Error interno.');
          }
          res.render('admin', { clips, users });
        }
      );
    }
  );
});

app.get('/admin/users/:id/edit', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) {
    return res.status(404).send('Usuario no encontrado.');
  }
  db.get('SELECT id, username, role FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      console.error('Error cargando usuario:', err);
      return res.status(500).send('Error interno.');
    }
    if (!user) {
      return res.status(404).send('Usuario no encontrado.');
    }
    if (user.role === 'admin') {
      return res.status(403).send('No puedes editar cuentas de administrador desde aquí.');
    }
    res.render('admin-edit-user', { user, error: null });
  });
});

app.post('/admin/users/:id', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) {
    return res.status(404).send('Usuario no encontrado.');
  }
  const username = (req.body.username || '').trim();
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const password = (req.body.password || '').trim();

  const renderError = (userRow, message) => {
    res.render('admin-edit-user', { user: userRow, error: message });
  };

  if (!username) {
    return db.get('SELECT id, username, role FROM users WHERE id = ?', [userId], (e, user) => {
      if (e || !user) {
        return res.status(404).send('Usuario no encontrado.');
      }
      if (user.role === 'admin') {
        return res.status(403).send('No puedes editar cuentas de administrador desde aquí.');
      }
      renderError(user, 'El nombre de usuario es obligatorio.');
    });
  }

  db.get('SELECT id, username, role FROM users WHERE id = ?', [userId], (err, target) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error interno.');
    }
    if (!target) {
      return res.status(404).send('Usuario no encontrado.');
    }
    if (target.role === 'admin') {
      return res.status(403).send('No puedes editar cuentas de administrador desde aquí.');
    }

    db.get(
      'SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?',
      [username, userId],
      (dupErr, dup) => {
        if (dupErr) {
          console.error(dupErr);
          return res.status(500).send('Error interno.');
        }
        if (dup) {
          return renderError({ ...target, username, role }, 'Ese nombre de usuario ya está en uso.');
        }

        const afterUpdate = (updateErr) => {
          if (updateErr) {
            console.error(updateErr);
            return renderError({ ...target, username, role }, 'No se pudo guardar. Intenta de nuevo.');
          }
          if (req.session.user.id === userId) {
            req.session.user.username = username;
            req.session.user.role = role;
          }
          res.redirect('/admin');
        };

        if (password.length > 0) {
          bcrypt
            .hash(password, 10)
            .then((hash) => {
              db.run(
                'UPDATE users SET username = ?, role = ?, password_hash = ? WHERE id = ?',
                [username, role, hash, userId],
                afterUpdate
              );
            })
            .catch((hErr) => {
              console.error(hErr);
              renderError({ ...target, username, role }, 'Error al cifrar la contraseña.');
            });
        } else {
          db.run('UPDATE users SET username = ?, role = ? WHERE id = ?', [username, role, userId], afterUpdate);
        }
      }
    );
  });
});

app.post('/admin/clips/:id/delete', requireAdmin, (req, res) => {
  const clipId = req.params.id;
  db.get('SELECT filename FROM clips WHERE id = ?', [clipId], (err, row) => {
    if (err) {
      console.error('Error buscando clip:', err);
      return res.redirect('/admin');
    }
    if (!row) {
      return res.redirect('/admin');
    }
    const filePath = path.join(__dirname, 'uploads', row.filename);
    db.run('DELETE FROM clips WHERE id = ?', [clipId], (delErr) => {
      if (delErr) {
        console.error('Error eliminando clip:', delErr);
      } else {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== 'ENOENT') {
            console.error('Error borrando archivo del clip:', unlinkErr);
          }
        });
      }
      res.redirect('/admin');
    });
  });
});

app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (Number.isNaN(userId)) {
    return res.redirect('/admin');
  }
  if (userId === req.session.user.id) {
    return res.redirect('/admin');
  }
  db.get('SELECT role FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) {
      console.error('Error comprobando usuario:', err);
      return res.redirect('/admin');
    }
    if (!row || row.role === 'admin') {
      return res.redirect('/admin');
    }
    db.run('DELETE FROM users WHERE id = ?', [userId], (delErr) => {
      if (delErr) {
        console.error('Error eliminando usuario:', delErr);
      }
      res.redirect('/admin');
    });
  });
});

app.listen(PORT, () => {
  console.log(`GameClip-hub escuchando en http://localhost:${PORT}`);
});

