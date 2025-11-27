// ===============================================
// BACKEND - server.js (Postgres/Supabase)
// ===============================================
// Dependencias:
// npm install express cors bcryptjs jsonwebtoken pg dotenv

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'seu_secret_key_super_seguro_aqui';
const ADMIN_EMAIL = 'marketing@bhseletronica.com.br';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'bhseletronica123';
const ADMIN_DEFAULT_PHONE = process.env.ADMIN_DEFAULT_PHONE || '0000000000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL nao definido. Configure a URL do Postgres/Supabase.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json());

const normalizeValue = (val) => {
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
};

const query = async (text, params = []) => {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
};

// Inicializar schema
const ensureSchema = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'vendedor',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT,
      owner TEXT,
      origin TEXT,
      stage_detail TEXT,
      next_contact DATE,
      email TEXT NOT NULL,
      phone TEXT,
      channel_id INTEGER REFERENCES channels(id),
      campaign TEXT,
      status TEXT DEFAULT 'novo',
      value REAL DEFAULT 0,
      notes TEXT,
      user_id INTEGER REFERENCES users(id),
      is_private BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Colunas idempotentes
  await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS value REAL DEFAULT 0;`);
  await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE;`);
  await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`);
};

const seedDefaults = async () => {
  const channels = ['Google Ads', 'Facebook Ads', 'Instagram Ads', 'LinkedIn Ads', 'TikTok Ads'];
  const count = await query('SELECT COUNT(*) AS count FROM channels');
  if (Number(count.rows[0].count) === 0) {
    for (const c of channels) {
      await query('INSERT INTO channels (name) VALUES ($1)', [c]);
    }
    console.log('Canais padrao inseridos');
  }

  const adminRow = await query('SELECT id, role, phone FROM users WHERE email = $1', [ADMIN_EMAIL]);
  if (adminRow.rowCount > 0) {
    const admin = adminRow.rows[0];
    if (admin.role !== 'admin') await query('UPDATE users SET role = $1 WHERE id = $2', ['admin', admin.id]);
    if (!admin.phone) await query('UPDATE users SET phone = $1 WHERE id = $2', [ADMIN_DEFAULT_PHONE, admin.id]);
    return;
  }

  const hashed = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10);
  await query(
    'INSERT INTO users (name, phone, email, password, role) VALUES ($1,$2,$3,$4,$5)',
    ['Marketing', ADMIN_DEFAULT_PHONE, ADMIN_EMAIL, hashed, 'admin']
  );
  console.log('Admin padrao criado para', ADMIN_EMAIL);
};

const bootstrap = async () => {
  await ensureSchema();
  await seedDefaults();
};

bootstrap().catch((err) => {
  console.error('Erro ao inicializar schema:', err);
  process.exit(1);
});

// Middlewares de auth
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token nao fornecido' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token invalido' });
    req.user = user;
    next();
  });
};

const ensureAdmin = async (req, res, next) => {
  try {
    const row = await query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    if (row.rowCount === 0 || row.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem executar esta acao' });
    }
    next();
  } catch {
    return res.status(403).json({ error: 'Permissao negada' });
  }
};

// ===============================================
// AUTENTICACAO
// ===============================================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'Nome, email, telefone e senha sao obrigatorios' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter no minimo 6 caracteres' });

    const existing = await query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) return res.status(400).json({ error: 'Email ja cadastrado' });

    const hashed = await bcrypt.hash(password, 10);
    const inserted = await query(
      'INSERT INTO users (name, phone, email, password, role) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [name, phone, email, hashed, 'vendedor']
    );
    const userId = inserted.rows[0].id;
    const token = jwt.sign({ id: userId, email, name, phone, role: 'vendedor' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Usuario criado com sucesso', token, user: { id: userId, name, phone, email, role: 'vendedor' } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha sao obrigatorios' });
    const userRow = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRow.rowCount === 0) return res.status(401).json({ error: 'Credenciais invalidas' });
    const user = userRow.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciais invalidas' });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ message: 'Login realizado com sucesso', token, user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const row = await query('SELECT id, name, phone, email, role FROM users WHERE id = $1', [req.user.id]);
    if (row.rowCount === 0) return res.status(404).json({ error: 'Usuario nao encontrado' });
    res.json(row.rows[0]);
  } catch {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ===============================================
// CANAIS
// ===============================================

app.get('/api/channels', authenticateToken, async (_req, res) => {
  try {
    const result = await query('SELECT * FROM channels WHERE active = TRUE ORDER BY name');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar canais' });
  }
});

app.post('/api/channels', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome do canal e obrigatorio' });
  try {
    const inserted = await query('INSERT INTO channels (name) VALUES ($1) RETURNING id,name,active', [name]);
    res.status(201).json(inserted.rows[0]);
  } catch {
    res.status(500).json({ error: 'Erro ao criar canal' });
  }
});

app.put('/api/channels/:id', authenticateToken, async (req, res) => {
  const { name, active } = req.body;
  const { id } = req.params;
  try {
    await query('UPDATE channels SET name=$1, active=$2 WHERE id=$3', [name, active, id]);
    res.json({ message: 'Canal atualizado com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar canal' });
  }
});

app.delete('/api/channels/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await query('UPDATE channels SET active=FALSE WHERE id=$1', [id]);
    res.json({ message: 'Canal deletado com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao deletar canal' });
  }
});

// ===============================================
// LEADS
// ===============================================

app.get('/api/leads', authenticateToken, async (req, res) => {
  const { status, search } = req.query;
  try {
    const roleRow = await query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    const isAdmin = roleRow.rows[0]?.role === 'admin';
    const params = [];
    let where = 'WHERE 1=1';

    if (!isAdmin) {
      params.push(req.user.id);
      where += ` AND (COALESCE(l.is_private, FALSE) = FALSE OR l.user_id = $${params.length})`;
    }
    if (status && status !== 'todos') {
      params.push(status);
      where += ` AND l.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      where += ` AND (l.name ILIKE $${params.length - 2} OR l.email ILIKE $${params.length - 1} OR l.campaign ILIKE $${params.length})`;
    }

    const result = await query(
      `
      SELECT l.*, c.name as channel_name, u.name as user_name, COALESCE(l.owner, u.name) as responsible_name
      FROM leads l
      LEFT JOIN channels c ON l.channel_id = c.id
      LEFT JOIN users u ON l.user_id = u.id
      ${where}
      ORDER BY l.created_at DESC
    `,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar leads' });
  }
});

app.post('/api/leads', authenticateToken, async (req, res) => {
  try {
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

    if (!name || !email) return res.status(400).json({ error: 'Nome e email sao obrigatorios' });

    const numericValue = normalizeValue(value);
    const targetOwnerId = ownerId || req.user.id;
    const ownerRow = await query('SELECT id,name FROM users WHERE id=$1', [targetOwnerId]);
    const responsibleName = owner || ownerRow.rows[0]?.name || req.user.name;
    const responsibleId = ownerRow.rowCount > 0 ? ownerRow.rows[0].id : req.user.id;

    const inserted = await query(
      `
      INSERT INTO leads (
        name, contact, owner, origin, stage_detail, next_contact,
        email, phone, channel_id, campaign, status, value, notes, user_id, is_private
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
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
        channel_id || null,
        campaign || null,
        status || 'novo',
        numericValue,
        notes || null,
        responsibleId,
        !!is_private,
      ]
    );
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar lead' });
  }
});

app.put('/api/leads/:id', authenticateToken, async (req, res) => {
  try {
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

    const roleRow = await query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    const isAdmin = roleRow.rows[0]?.role === 'admin';

    const leadRow = await query('SELECT id, user_id, is_private FROM leads WHERE id = $1', [id]);
    if (leadRow.rowCount === 0) return res.status(404).json({ error: 'Lead nao encontrado' });
    const lead = leadRow.rows[0];

    if (!isAdmin && lead.is_private && lead.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Lead privado de outro usuario' });
    }

    const numericValue = normalizeValue(value);
    const targetOwnerId = ownerId || lead.user_id || req.user.id;
    const ownerRow = await query('SELECT id,name FROM users WHERE id = $1', [targetOwnerId]);
    const responsibleName = owner || ownerRow.rows[0]?.name || req.user.name;
    const responsibleId = ownerRow.rowCount > 0 ? ownerRow.rows[0].id : req.user.id;

    const result = await query(
      `
      UPDATE leads
      SET name=$1, contact=$2, owner=$3, origin=$4, stage_detail=$5, next_contact=$6,
          email=$7, phone=$8, channel_id=$9, campaign=$10,
          status=$11, value=$12, notes=$13, is_private=$14, updated_at=NOW(), user_id=$15
      WHERE id=$16
      RETURNING *
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
        channel_id || null,
        campaign || null,
        status,
        numericValue,
        notes || null,
        !!is_private,
        responsibleId,
        id,
      ]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Lead nao encontrado' });
    res.json({ message: 'Lead atualizado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar lead' });
  }
});

app.delete('/api/leads/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const roleRow = await query('SELECT role FROM users WHERE id = $1', [req.user.id]);
    const isAdmin = roleRow.rows[0]?.role === 'admin';

    const leadRow = await query('SELECT id, user_id, is_private FROM leads WHERE id = $1', [id]);
    if (leadRow.rowCount === 0) return res.status(404).json({ error: 'Lead nao encontrado' });
    const lead = leadRow.rows[0];

    if (!isAdmin && lead.is_private && lead.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Lead privado de outro usuario' });
    }

    await query('DELETE FROM leads WHERE id = $1', [id]);
    res.json({ message: 'Lead deletado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar lead' });
  }
});

// ===============================================
// USUARIOS
// ===============================================

app.get('/api/users', authenticateToken, async (_req, res) => {
  try {
    const result = await query('SELECT id, name, phone, email, role FROM users ORDER BY name');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar usuarios' });
  }
});

app.post('/api/users', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { name, phone, email, password, role = 'vendedor' } = req.body;
    if (!name || !phone || !email || !password) return res.status(400).json({ error: 'Nome, telefone, email e senha sao obrigatorios' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });

    const existing = await query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) return res.status(400).json({ error: 'Email ja cadastrado' });

    const hashed = await bcrypt.hash(password, 10);
    const userRole = role === 'admin' ? 'admin' : 'vendedor';
    const inserted = await query(
      'INSERT INTO users (name, phone, email, password, role) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,phone,email,role',
      [name, phone, email, hashed, userRole]
    );
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar usuario' });
  }
});

app.delete('/api/users/:id', authenticateToken, ensureAdmin, async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'Nao e possivel remover o proprio usuario logado' });
  try {
    const row = await query('SELECT role FROM users WHERE id = $1', [id]);
    if (row.rowCount === 0) return res.status(404).json({ error: 'Usuario nao encontrado' });
    if (row.rows[0].role === 'admin') return res.status(400).json({ error: 'Nao e possivel remover um administrador' });
    await query('UPDATE leads SET user_id = NULL WHERE user_id = $1', [id]);
    await query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'Usuario removido com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao excluir usuario' });
  }
});

app.put('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !phone || !email) return res.status(400).json({ error: 'Nome, telefone e email sao obrigatorios' });

    const existing = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
    if (existing.rowCount > 0) return res.status(400).json({ error: 'Email ja cadastrado' });

    const updates = [name, phone, email];
    let setClause = 'name = $1, phone = $2, email = $3';
    let idx = 4;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
      const hashed = await bcrypt.hash(password, 10);
      updates.push(hashed);
      setClause += `, password = $${idx++}`;
    }
    updates.push(req.user.id);

    await query(`UPDATE users SET ${setClause} WHERE id = $${idx}`, updates);
    const updated = await query('SELECT id, name, phone, email, role FROM users WHERE id = $1', [req.user.id]);
    const user = updated.rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ message: 'Dados atualizados', user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/users/:id', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;
    const { id } = req.params;
    if (!name || !phone || !email) return res.status(400).json({ error: 'Nome, telefone e email sao obrigatorios' });

    const targetId = Number(id);
    if (!targetId) return res.status(400).json({ error: 'ID invalido' });

    const found = await query('SELECT id FROM users WHERE id = $1', [targetId]);
    if (found.rowCount === 0) return res.status(404).json({ error: 'Usuario nao encontrado' });

    const existing = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, targetId]);
    if (existing.rowCount > 0) return res.status(400).json({ error: 'Email ja cadastrado' });

    const updates = [name, phone, email];
    let setClause = 'name = $1, phone = $2, email = $3, role = $4';
    let idx = 5;
    const newRole = role === 'admin' ? 'admin' : 'vendedor';
    updates.push(newRole);

    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
      const hashed = await bcrypt.hash(password, 10);
      setClause += `, password = $${idx++}`;
      updates.push(hashed);
    }
    updates.push(targetId);

    await query(`UPDATE users SET ${setClause} WHERE id = $${idx}`, updates);
    const updated = await query('SELECT id, name, phone, email, role FROM users WHERE id = $1', [targetId]);
    res.json({ message: 'Usuario atualizado', user: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ===============================================
// ESTATISTICAS
// ===============================================

app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const isAdminQuery = req.query.scope === 'all' && req.user?.role === 'admin';
    const targetUserId = req.user.role === 'admin' && req.query.userId ? Number(req.query.userId) : req.user.id;

    const whereUser = isAdminQuery ? '' : 'WHERE user_id = $1';
    const params = isAdminQuery ? [] : [targetUserId];

    const total = await query(`SELECT COUNT(*) AS count FROM leads ${whereUser}`, params);
    const novos = await query(
      `SELECT COUNT(*) AS count FROM leads ${whereUser ? `${whereUser} AND status = 'novo'` : "WHERE status = 'novo'"}`,
      params
    );
    const convertidos = await query(
      `SELECT COUNT(*) AS count FROM leads ${whereUser ? `${whereUser} AND status = 'ganho'` : "WHERE status = 'ganho'"}`,
      params
    );
    const valorTotal = await query(
      `SELECT COALESCE(SUM(value),0) AS total FROM leads ${
        whereUser ? `${whereUser} AND status = 'ganho'` : "WHERE status = 'ganho'"
      }`,
      params
    );

    const stats = {
      total: Number(total.rows[0].count || 0),
      novos: Number(novos.rows[0].count || 0),
      convertidos: Number(convertidos.rows[0].count || 0),
      valorTotal: Number(valorTotal.rows[0].total || 0),
    };
    stats.taxaConversao = stats.total > 0 ? ((stats.convertidos / stats.total) * 100).toFixed(1) : 0;
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao calcular estatisticas' });
  }
});

// ===============================================
// STATUS
// ===============================================
app.get('/', (_req, res) => {
  res.send(`
    <html>
      <head><title>CRM Backend API</title></head>
      <body style="font-family: sans-serif; padding: 24px;">
        <h1>CRM Backend API</h1>
        <p>Servidor rodando. API pronta.</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
