// ===============================================
// BACKEND - server.js
// ===============================================
// Dependencias:
// npm init -y
// npm install express cors bcryptjs jsonwebtoken sqlite3 dotenv

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'seu_secret_key_super_seguro_aqui';
const ADMIN_EMAIL = 'marketing@bhseletronica.com.br';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'bhseletronica123';
const ADMIN_DEFAULT_PHONE = process.env.ADMIN_DEFAULT_PHONE || '0000000000';

// Middlewares
app.use(cors());
app.use(express.json());

// Database Setup
const db = new sqlite3.Database('./crm.db', (err) => {
  if (err) console.error('Erro ao conectar ao banco:', err);
  else console.log('Conectado ao banco de dados SQLite');
});

// Utilitario para garantir colunas em tabelas existentes (migrations simples)
const ensureColumn = (table, columnName, definition) => {
  db.all(`PRAGMA table_info(${table})`, (err, rows) => {
    if (err) {
      console.error(`Erro ao inspecionar tabela ${table}:`, err);
      return;
    }
    const cols = rows.map((r) => r.name);
    if (!cols.includes(columnName)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`, (alterErr) => {
        if (alterErr) {
          console.error(`Erro ao adicionar coluna ${columnName} em ${table}:`, alterErr);
        }
      });
    }
  });
};

// Gancho futuro: estrutura basica de alerta de agenda via WhatsApp (nao envia nada agora)
const buildAgendaAlertPayload = (user, agendaItem) => ({
  userId: user?.id,
  phone: user?.phone,
  name: user?.name,
  agendaItem,
});

const normalizeValue = (val) => {
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
};

// Criar tabelas e dados padrao
db.serialize(() => {
  // Tabela de usuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'vendedor',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Garantir colunas extras em bancos ja existentes
  ensureColumn('users', 'phone', 'phone TEXT');

  // Tabela de canais
  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabela de leads
  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT,
      owner TEXT,
      origin TEXT,
      stage_detail TEXT,
      next_contact TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      channel_id INTEGER,
      campaign TEXT,
      status TEXT DEFAULT 'novo',
      value REAL DEFAULT 0,
      notes TEXT,
      user_id INTEGER,
      is_private INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Garantir colunas extras em bancos ja existentes
  ensureColumn('leads', 'contact', 'contact TEXT');
  ensureColumn('leads', 'owner', 'owner TEXT');
  ensureColumn('leads', 'origin', 'origin TEXT');
  ensureColumn('leads', 'stage_detail', 'stage_detail TEXT');
  ensureColumn('leads', 'next_contact', 'next_contact TEXT');
  ensureColumn('leads', 'is_private', 'is_private INTEGER DEFAULT 0');

  // Inserir canais padrao
  db.get('SELECT COUNT(*) as count FROM channels', (err, row) => {
    if (err) {
      console.error('Erro ao contar canais:', err);
      return;
    }
    if ((row?.count || 0) === 0) {
      const channels = ['Google Ads', 'Facebook Ads', 'Instagram Ads', 'LinkedIn Ads', 'TikTok Ads'];
      const stmt = db.prepare('INSERT INTO channels (name) VALUES (?)');
      channels.forEach((channel) => stmt.run(channel));
      stmt.finalize();
      console.log('Canais padrao inseridos');
    }
  });

  // Garantir admin padrao
  db.get('SELECT id, role, phone FROM users WHERE email = ?', [ADMIN_EMAIL], async (err, row) => {
    if (err) {
      console.error('Erro ao garantir admin padrao:', err);
      return;
    }

    if (row) {
      if (row.role !== 'admin') {
        db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', row.id]);
      }
      if (!row.phone) {
        db.run('UPDATE users SET phone = ? WHERE id = ?', [ADMIN_DEFAULT_PHONE, row.id]);
      }
      return;
    }

    try {
      const hashed = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10);
      db.run(
        'INSERT INTO users (name, phone, email, password, role) VALUES (?, ?, ?, ?, ?)',
        ['Marketing', ADMIN_DEFAULT_PHONE, ADMIN_EMAIL, hashed, 'admin'],
        function (insertErr) {
          if (insertErr) {
            console.error('Erro ao criar admin padrao:', insertErr);
          } else {
            console.log('Admin padrao criado para', ADMIN_EMAIL);
          }
        }
      );
    } catch (hashErr) {
      console.error('Erro ao gerar senha do admin padrao:', hashErr);
    }
  });
});

// Middleware de autenticacao
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token nao fornecido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalido' });
    }
    req.user = user;
    next();
  });
};

// Middleware para rotas de admin
const ensureAdmin = (req, res, next) => {
  db.get('SELECT role FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err || !row) {
      return res.status(403).json({ error: 'Permissao negada' });
    }
    if (row.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem executar esta acao' });
    }
    next();
  });
};

// ===============================================
// ROTAS DE AUTENTICACAO
// ===============================================

// Registro de novo usuario
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'Nome, email, telefone e senha sao obrigatorios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no minimo 6 caracteres' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao buscar usuario' });
      }
      if (row) {
        return res.status(400).json({ error: 'Email ja cadastrado' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      db.run(
        'INSERT INTO users (name, phone, email, password, role) VALUES (?, ?, ?, ?, ?)',
        [name, phone, email, hashedPassword, 'vendedor'],
        function (insertErr) {
          if (insertErr) {
            return res.status(500).json({ error: 'Erro ao criar usuario' });
          }

          const token = jwt.sign(
            { id: this.lastID, email, name, phone, role: 'vendedor' },
            JWT_SECRET,
            {
              expiresIn: '7d',
            }
          );

          res.status(201).json({
            message: 'Usuario criado com sucesso',
            token,
            user: { id: this.lastID, name, phone, email, role: 'vendedor' },
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, userRow) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao buscar usuario' });
      }
      if (!userRow) {
        return res.status(401).json({ error: 'Credenciais invalidas' });
      }

      const validPassword = await bcrypt.compare(password, userRow.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Credenciais invalidas' });
      }

      const token = jwt.sign(
        {
          id: userRow.id,
          email: userRow.email,
          name: userRow.name,
          phone: userRow.phone,
          role: userRow.role,
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        message: 'Login realizado com sucesso',
        token,
        user: {
          id: userRow.id,
          name: userRow.name,
          phone: userRow.phone,
          email: userRow.email,
          role: userRow.role,
        },
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Verificar token
app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get('SELECT id, name, phone, email, role FROM users WHERE id = ?', [req.user.id], (err, userRow) => {
    if (err || !userRow) {
      return res.status(404).json({ error: 'Usuario nao encontrado' });
    }
    res.json(userRow);
  });
});

// ===============================================
// ROTAS DE CANAIS
// ===============================================

// Listar canais
app.get('/api/channels', authenticateToken, (req, res) => {
  db.all('SELECT * FROM channels WHERE active = 1 ORDER BY name', (err, channels) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar canais' });
    }
    res.json(channels);
  });
});

// Criar canal
app.post('/api/channels', authenticateToken, (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Nome do canal e obrigatorio' });
  }

  db.run('INSERT INTO channels (name) VALUES (?)', [name], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Erro ao criar canal' });
    }
    res.status(201).json({ id: this.lastID, name, active: 1 });
  });
});

// Atualizar canal
app.put('/api/channels/:id', authenticateToken, (req, res) => {
  const { name, active } = req.body;
  const { id } = req.params;

  db.run('UPDATE channels SET name = ?, active = ? WHERE id = ?', [name, active, id], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Erro ao atualizar canal' });
    }
    res.json({ message: 'Canal atualizado com sucesso' });
  });
});

// Deletar canal (soft delete)
app.delete('/api/channels/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.run('UPDATE channels SET active = 0 WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ error: 'Erro ao deletar canal' });
    }
    res.json({ message: 'Canal deletado com sucesso' });
  });
});

// ===============================================
// ROTAS DE LEADS
// ===============================================

// Listar leads
app.get('/api/leads', authenticateToken, (req, res) => {
  const { status, search } = req.query;

  db.get('SELECT role FROM users WHERE id = ?', [req.user.id], (err, userRow) => {
    if (err || !userRow) {
      return res.status(500).json({ error: 'Erro ao identificar usuario' });
    }

    const isAdmin = userRow.role === 'admin';

    let query = `
      SELECT l.*, c.name as channel_name, u.name as user_name, COALESCE(l.owner, u.name) as responsible_name
      FROM leads l
      LEFT JOIN channels c ON l.channel_id = c.id
      LEFT JOIN users u ON l.user_id = u.id
      WHERE 1 = 1
    `;
    const params = [];

    if (!isAdmin) {
      query += ' AND (COALESCE(l.is_private, 0) = 0 OR l.user_id = ?)';
      params.push(req.user.id);
    }

    if (status && status !== 'todos') {
      query += ' AND l.status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (l.name LIKE ? OR l.email LIKE ? OR l.campaign LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY l.created_at DESC';

    db.all(query, params, (err2, leads) => {
      if (err2) {
        return res.status(500).json({ error: 'Erro ao buscar leads' });
      }
      res.json(leads);
    });
  });
});

// Criar lead
app.post('/api/leads', authenticateToken, (req, res) => {
  const {
    name,
    contact,
    owner,
    ownerId,
    origin,
    stage_detail,
    next_contact,
    email,
    phone,
    channel_id,
    campaign,
    status,
    value,
    notes,
    is_private,
  } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Nome e email sao obrigatorios' });
  }

  const numericValue = normalizeValue(value);

  const targetOwnerId = ownerId || req.user.id;

  const insertLead = (responsibleName, responsibleId) => {
    db.run(
      `
        INSERT INTO leads (
          name, contact, owner, origin, stage_detail, next_contact,
          email, phone, channel_id, campaign, status, value, notes, user_id, is_private
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        name,
        contact || null,
        responsibleName || null,
        origin || null,
        stage_detail || null,
        next_contact || null,
        email,
        phone,
        channel_id,
        campaign,
        status || 'novo',
        numericValue,
        notes,
        responsibleId || req.user.id,
        is_private ? 1 : 0,
      ],
      function (err) {
        if (err) {
          return res.status(500).json({ error: 'Erro ao criar lead' });
        }
        res.status(201).json({
          id: this.lastID,
          name,
          contact: contact || null,
          owner: responsibleName || null,
          origin: origin || null,
          stage_detail: stage_detail || null,
          next_contact: next_contact || null,
          email,
          phone,
          channel_id,
          campaign,
          status: status || 'novo',
          value: numericValue,
          notes,
          user_id: responsibleId || req.user.id,
          is_private: is_private ? 1 : 0,
        });
      }
    );
  };

  db.get('SELECT id, name FROM users WHERE id = ?', [targetOwnerId], (err, ownerRow) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao identificar responsavel' });
    }
    if (!ownerRow) {
      return insertLead(req.user.name, req.user.id);
    }
    return insertLead(owner || ownerRow.name, ownerRow.id);
  });
});

// Atualizar lead
app.put('/api/leads/:id', authenticateToken, (req, res) => {
  const {
    name,
    contact,
    owner,
    ownerId,
    origin,
    stage_detail,
    next_contact,
    email,
    phone,
    channel_id,
    campaign,
    status,
    value,
    notes,
    is_private,
  } = req.body;
  const { id } = req.params;

  db.get('SELECT role FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err || !row) {
      return res.status(500).json({ error: 'Erro ao identificar usuario' });
    }
    const isAdmin = row.role === 'admin';

    db.get('SELECT id, user_id, is_private FROM leads WHERE id = ?', [id], (leadErr, leadRow) => {
      if (leadErr) {
        return res.status(500).json({ error: 'Erro ao carregar lead' });
      }
      if (!leadRow) {
        return res.status(404).json({ error: 'Lead nao encontrado' });
      }
      if (!isAdmin && leadRow.is_private && leadRow.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Lead privado de outro usuario' });
      }

      const numericValue = normalizeValue(value);
      const targetOwnerId = ownerId || leadRow.user_id || req.user.id;

      const runUpdate = (responsibleName, responsibleId) => {
        const query = `
          UPDATE leads
          SET name = ?, contact = ?, owner = ?, origin = ?, stage_detail = ?, next_contact = ?,
              email = ?, phone = ?, channel_id = ?, campaign = ?,
              status = ?, value = ?, notes = ?, is_private = ?, updated_at = CURRENT_TIMESTAMP,
              user_id = ?
          WHERE id = ?
        `;

        const params = [
          name,
          contact || null,
          responsibleName || null,
          origin || null,
          stage_detail || null,
          next_contact || null,
          email,
          phone,
          channel_id,
          campaign,
          status,
          numericValue,
          notes,
          is_private ? 1 : 0,
          responsibleId || leadRow.user_id || req.user.id,
          id,
        ];

        db.run(query, params, function (updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Erro ao atualizar lead' });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Lead nao encontrado' });
          }
          res.json({ message: 'Lead atualizado com sucesso' });
        });
      };

      db.get('SELECT id, name FROM users WHERE id = ?', [targetOwnerId], (ownerErr, ownerRow) => {
        if (ownerErr) {
          return res.status(500).json({ error: 'Erro ao identificar responsavel' });
        }
        if (!ownerRow) {
          return runUpdate(req.user.name, req.user.id);
        }
        return runUpdate(owner || ownerRow.name, ownerRow.id);
      });
    });
  });
});

// Deletar lead
app.delete('/api/leads/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  db.get('SELECT role FROM users WHERE id = ?', [req.user.id], (err, row) => {
    if (err || !row) {
      return res.status(500).json({ error: 'Erro ao identificar usuario' });
    }
    const isAdmin = row.role === 'admin';

    db.get('SELECT id, user_id, is_private FROM leads WHERE id = ?', [id], (leadErr, leadRow) => {
      if (leadErr) {
        return res.status(500).json({ error: 'Erro ao carregar lead' });
      }
      if (!leadRow) {
        return res.status(404).json({ error: 'Lead nao encontrado' });
      }
      if (!isAdmin && leadRow.is_private && leadRow.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Lead privado de outro usuario' });
      }

      let query = 'DELETE FROM leads WHERE id = ?';
      const params = [id];

      if (!isAdmin && leadRow.user_id) {
        query += ' AND user_id = ?';
        params.push(req.user.id);
      }

      db.run(query, params, function (deleteErr) {
        if (deleteErr) {
          return res.status(500).json({ error: 'Erro ao deletar lead' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Lead nao encontrado' });
        }
        res.json({ message: 'Lead deletado com sucesso' });
      });
    });
  });
});

// ===============================================
// ROTAS DE USUARIOS
// ===============================================

// Listar usuarios
app.get('/api/users', authenticateToken, (req, res) => {
  db.all('SELECT id, name, phone, email, role FROM users ORDER BY name', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar usuarios' });
    }
    res.json(rows);
  });
});

// Criar usuario (somente admin)
app.post('/api/users', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { name, phone, email, password, role = 'vendedor' } = req.body;

    if (!name || !phone || !email || !password) {
      return res.status(400).json({ error: 'Nome, telefone, email e senha sao obrigatorios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    }

    db.get('SELECT id FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao buscar usuario' });
      }
      if (row) {
        return res.status(400).json({ error: 'Email ja cadastrado' });
      }

      const hashed = await bcrypt.hash(password, 10);
      const userRole = role === 'admin' ? 'admin' : 'vendedor';

      db.run(
        'INSERT INTO users (name, phone, email, password, role) VALUES (?, ?, ?, ?, ?)',
        [name, phone, email, hashed, userRole],
        function (insertErr) {
          if (insertErr) {
            return res.status(500).json({ error: 'Erro ao criar usuario' });
          }
          res.status(201).json({
            id: this.lastID,
            name,
            phone,
            email,
            role: userRole,
          });
        }
      );
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Excluir usuario (somente admin)
app.delete('/api/users/:id', authenticateToken, ensureAdmin, (req, res) => {
  const { id } = req.params;

  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'Nao e possivel remover o proprio usuario logado' });
  }

  db.get('SELECT role FROM users WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar usuario' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Usuario nao encontrado' });
    }
    if (row.role === 'admin') {
      return res.status(400).json({ error: 'Nao e possivel remover um administrador' });
    }

    db.run('UPDATE leads SET user_id = NULL WHERE user_id = ?', [id]);

    db.run('DELETE FROM users WHERE id = ?', [id], function (deleteErr) {
      if (deleteErr) {
        return res.status(500).json({ error: 'Erro ao excluir usuario' });
      }
      res.json({ message: 'Usuario removido com sucesso' });
    });
  });
});

// Atualizar dados do proprio usuario
app.put('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;

    if (!name || !phone || !email) {
      return res.status(400).json({ error: 'Nome, telefone e email sao obrigatorios' });
    }

    // Garantir email unico
    db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.id], async (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao validar email' });
      }
      if (row) {
        return res.status(400).json({ error: 'Email ja cadastrado' });
      }

      const updates = [name, phone, email];
      let setClause = 'name = ?, phone = ?, email = ?';

      if (password) {
        if (password.length < 6) {
          return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
        }
        const hashed = await bcrypt.hash(password, 10);
        setClause += ', password = ?';
        updates.push(hashed);
      }

      updates.push(req.user.id);

      db.run(`UPDATE users SET ${setClause} WHERE id = ?`, updates, function (updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Erro ao atualizar usuario' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Usuario nao encontrado' });
        }

        db.get('SELECT id, name, phone, email, role FROM users WHERE id = ?', [req.user.id], (getErr, updated) => {
          if (getErr || !updated) {
            return res.status(500).json({ error: 'Erro ao carregar usuario atualizado' });
          }

          const token = jwt.sign(
            { id: updated.id, email: updated.email, name: updated.name, phone: updated.phone, role: updated.role },
            JWT_SECRET,
            { expiresIn: '7d' }
          );

          res.json({ message: 'Dados atualizados', user: updated, token });
        });
      });
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// Atualizar usuario (admin pode editar qualquer um)
app.put('/api/users/:id', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;
    const { id } = req.params;

    if (!name || !phone || !email) {
      return res.status(400).json({ error: 'Nome, telefone e email sao obrigatorios' });
    }

    const targetId = Number(id);
    if (!targetId) {
      return res.status(400).json({ error: 'ID invalido' });
    }

    db.get('SELECT id FROM users WHERE id = ?', [targetId], (findErr, found) => {
      if (findErr || !found) {
        return res.status(404).json({ error: 'Usuario nao encontrado' });
      }

      db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, targetId], async (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Erro ao validar email' });
        }
        if (row) {
          return res.status(400).json({ error: 'Email ja cadastrado' });
        }

        const updates = [name, phone, email];
        let setClause = 'name = ?, phone = ?, email = ?';
        const newRole = role === 'admin' ? 'admin' : 'vendedor';
        setClause += ', role = ?';
        updates.push(newRole);

        if (password) {
          if (password.length < 6) {
            return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
          }
          const hashed = await bcrypt.hash(password, 10);
          setClause += ', password = ?';
          updates.push(hashed);
        }

        updates.push(targetId);

        db.run(`UPDATE users SET ${setClause} WHERE id = ?`, updates, function (updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Erro ao atualizar usuario' });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Usuario nao encontrado' });
          }

          db.get('SELECT id, name, phone, email, role FROM users WHERE id = ?', [targetId], (getErr, updated) => {
            if (getErr || !updated) {
              return res.status(500).json({ error: 'Erro ao carregar usuario atualizado' });
            }
            res.json({ message: 'Usuario atualizado', user: updated });
          });
        });
      });
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ===============================================
// ESTATISTICAS
// ===============================================

app.get('/api/stats', authenticateToken, (req, res) => {
  const isAdminQuery = req.query.scope === 'all' && req.user?.role === 'admin';
  const targetUserId = req.user.role === 'admin' && req.query.userId ? Number(req.query.userId) : req.user.id;

  const filterClause = isAdminQuery ? '' : 'WHERE user_id = ?';
  const params = isAdminQuery ? [] : [targetUserId];

  const queries = {
    total: `SELECT COUNT(*) as count FROM leads ${filterClause}`,
    novos: `SELECT COUNT(*) as count FROM leads ${filterClause ? `${filterClause} AND status = 'novo'` : "WHERE status = 'novo'"}`,
    convertidos: `SELECT COUNT(*) as count FROM leads ${filterClause ? `${filterClause} AND status = 'ganho'` : "WHERE status = 'ganho'"}`,
    valorTotal: `SELECT SUM(value) as total FROM leads ${filterClause ? `${filterClause} AND status = 'ganho'` : "WHERE status = 'ganho'"}`,
  };

  const stats = {};
  let completed = 0;

  Object.keys(queries).forEach((key) => {
    db.get(queries[key], params, (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Erro ao calcular estatisticas' });
      }
      if (key === 'valorTotal') {
        stats[key] = row?.total || 0;
      } else {
        stats[key] = row?.count || 0;
      }

      completed++;
      if (completed === Object.keys(queries).length) {
        stats.taxaConversao = stats.total > 0 ? ((stats.convertidos / stats.total) * 100).toFixed(1) : 0;
        res.json(stats);
      }
    });
  });
});

// Performance por campanha
app.get('/api/campaigns/performance', authenticateToken, (req, res) => {
  const query = `
    SELECT 
      campaign,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'ganho' THEN 1 ELSE 0 END) as convertidos,
      SUM(CASE WHEN status = 'ganho' THEN value ELSE 0 END) as valor
    FROM leads
    WHERE user_id = ? AND campaign IS NOT NULL AND campaign != ''
    GROUP BY campaign
    ORDER BY total DESC
  `;

  db.all(query, [req.user.id], (err, campaigns) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar performance' });
    }
    res.json(campaigns);
  });
});

// Rota simples para visualizar o backend no navegador
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>CRM Backend API</title>
        <style>
          body { font-family: sans-serif; padding: 24px; background: #0f172a; color: #e5e7eb; }
          .card { max-width: 640px; margin: 0 auto; background: #020617; border-radius: 16px; padding: 24px; box-shadow: 0 25px 50px -12px rgba(15,23,42,0.8); border: 1px solid #1e293b; }
          h1 { font-size: 24px; margin-bottom: 12px; }
          p { font-size: 14px; margin: 6px 0; }
          code { background: #020617; padding: 2px 6px; border-radius: 4px; color: #38bdf8; }
          ul { margin-top: 12px; padding-left: 18px; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>CRM Backend API</h1>
          <p>Servidor rodando. Esta API e usada pelo frontend React.</p>
          <p>Acesse a interface do sistema em <code>http://localhost:3000</code> (frontend).</p>
          <ul>
            <li>Leads: <code>GET /api/leads</code></li>
            <li>Usuarios: <code>GET /api/users</code></li>
            <li>Canais: <code>GET /api/channels</code></li>
          </ul>
        </div>
      </body>
    </html>
  `);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// ===============================================
// ARQUIVO .env (exemplo)
// ===============================================
// PORT=3001
// JWT_SECRET=seu_secret_key_super_seguro_mude_isso_em_producao
