// ===============================================
// BACKEND - server.js (Google Sheets storage)
// ===============================================
// Dependencias:
// npm install express cors bcryptjs jsonwebtoken dotenv googleapis

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'seu_secret_key_super_seguro_aqui';
const ADMIN_EMAIL = 'marketing@bhseletronica.com.br';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'bhseletronica123';
const ADMIN_DEFAULT_PHONE = process.env.ADMIN_DEFAULT_PHONE || '0000000000';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : null;

if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_KEY) {
  console.error('Faltam variaveis GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL ou GOOGLE_PRIVATE_KEY');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

const sheetsClient = () => {
  const auth = new google.auth.JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: SERVICE_ACCOUNT_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
};

const SHEET_USERS = 'users';
const SHEET_LEADS = 'leads';
const SHEET_CHANNELS = 'channels';

const normalizeValue = (val) => {
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
};

// Helpers para Sheets
const readSheet = async (range) => {
  const client = sheetsClient();
  const res = await client.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
  return res.data.values || [];
};

const writeSheet = async (range, values) => {
  const client = sheetsClient();
  await client.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
};

const appendSheet = async (range, values) => {
  const client = sheetsClient();
  await client.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
};

// Inicializar headers e dados base
const ensureHeaders = async () => {
  const users = await readSheet(`${SHEET_USERS}!A1:F1`);
  if (!users.length) {
    await writeSheet(`${SHEET_USERS}!A1`, [
      ['id', 'name', 'phone', 'email', 'password', 'role', 'created_at'],
    ]);
  }
  const channels = await readSheet(`${SHEET_CHANNELS}!A1:C1`);
  if (!channels.length) {
    await writeSheet(`${SHEET_CHANNELS}!A1`, [['id', 'name', 'active', 'created_at']]);
  }
  const leads = await readSheet(`${SHEET_LEADS}!A1:R1`);
  if (!leads.length) {
    await writeSheet(`${SHEET_LEADS}!A1`, [
      [
        'id',
        'name',
        'contact',
        'owner',
        'owner_id',
        'origin',
        'stage_detail',
        'next_contact',
        'email',
        'phone',
        'channel_id',
        'campaign',
        'status',
        'value',
        'notes',
        'user_id',
        'is_private',
        'created_at',
        'updated_at',
      ],
    ]);
  }
};

const getUsers = async () => {
  const rows = await readSheet(`${SHEET_USERS}!A2:G`);
  return rows.map((r) => ({
    id: Number(r[0]),
    name: r[1],
    phone: r[2],
    email: r[3],
    password: r[4],
    role: r[5] || 'vendedor',
    created_at: r[6],
  }));
};

const saveUsers = async (users) => {
  const values = users.map((u) => [
    u.id,
    u.name,
    u.phone || '',
    u.email,
    u.password,
    u.role || 'vendedor',
    u.created_at || new Date().toISOString(),
  ]);
  await writeSheet(`${SHEET_USERS}!A2`, values);
};

const getChannels = async () => {
  const rows = await readSheet(`${SHEET_CHANNELS}!A2:D`);
  return rows.map((r) => ({
    id: Number(r[0]),
    name: r[1],
    active: r[2] === 'true' || r[2] === true || r[2] === 1,
    created_at: r[3],
  }));
};

const saveChannels = async (channels) => {
  const values = channels.map((c) => [
    c.id,
    c.name,
    c.active ? true : false,
    c.created_at || new Date().toISOString(),
  ]);
  await writeSheet(`${SHEET_CHANNELS}!A2`, values);
};

const getLeads = async () => {
  const rows = await readSheet(`${SHEET_LEADS}!A2:S`);
  return rows.map((r) => ({
    id: Number(r[0]),
    name: r[1],
    contact: r[2],
    owner: r[3],
    owner_id: r[4] ? Number(r[4]) : null,
    origin: r[5],
    stage_detail: r[6],
    next_contact: r[7],
    email: r[8],
    phone: r[9],
    channel_id: r[10] ? Number(r[10]) : null,
    campaign: r[11],
    status: r[12],
    value: r[13] ? Number(r[13]) : 0,
    notes: r[14],
    user_id: r[15] ? Number(r[15]) : null,
    is_private: r[16] === 'true' || r[16] === true || r[16] === 1,
    created_at: r[17],
    updated_at: r[18],
  }));
};

const saveLeads = async (leads) => {
  const values = leads.map((l) => [
    l.id,
    l.name,
    l.contact || '',
    l.owner || '',
    l.owner_id || '',
    l.origin || '',
    l.stage_detail || '',
    l.next_contact || '',
    l.email,
    l.phone || '',
    l.channel_id || '',
    l.campaign || '',
    l.status || 'novo',
    l.value || 0,
    l.notes || '',
    l.user_id || '',
    l.is_private ? true : false,
    l.created_at || new Date().toISOString(),
    l.updated_at || new Date().toISOString(),
  ]);
  await writeSheet(`${SHEET_LEADS}!A2`, values);
};

const nextId = (items) => (items.length ? Math.max(...items.map((i) => Number(i.id) || 0)) + 1 : 1);

// Bootstrap
(async () => {
  await ensureHeaders();
  // canais padrao
  const channels = await getChannels();
  if (!channels.length) {
    const base = ['Google Ads', 'Facebook Ads', 'Instagram Ads', 'LinkedIn Ads', 'TikTok Ads'];
    const now = new Date().toISOString();
    await saveChannels(base.map((name, idx) => ({ id: idx + 1, name, active: true, created_at: now })));
  }
  // admin padrao
  const users = await getUsers();
  const existingAdmin = users.find((u) => u.email === ADMIN_EMAIL);
  if (!existingAdmin) {
    const hashed = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10);
    users.push({
      id: nextId(users),
      name: 'Marketing',
      phone: ADMIN_DEFAULT_PHONE,
      email: ADMIN_EMAIL,
      password: hashed,
      role: 'admin',
      created_at: new Date().toISOString(),
    });
    await saveUsers(users);
    console.log('Admin padrao criado');
  } else if (existingAdmin.role !== 'admin' || !existingAdmin.phone) {
    existingAdmin.role = 'admin';
    existingAdmin.phone = existingAdmin.phone || ADMIN_DEFAULT_PHONE;
    await saveUsers(users);
  }
})();

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
  const users = await getUsers();
  const found = users.find((u) => u.id === req.user.id);
  if (!found || found.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem executar esta acao' });
  }
  next();
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
    const users = await getUsers();
    if (users.find((u) => u.email === email)) return res.status(400).json({ error: 'Email ja cadastrado' });
    const hashed = await bcrypt.hash(password, 10);
    const id = nextId(users);
    users.push({
      id,
      name,
      phone,
      email,
      password: hashed,
      role: 'vendedor',
      created_at: new Date().toISOString(),
    });
    await saveUsers(users);
    const token = jwt.sign({ id, email, name, phone, role: 'vendedor' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ message: 'Usuario criado com sucesso', token, user: { id, name, phone, email, role: 'vendedor' } });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha sao obrigatorios' });
    const users = await getUsers();
    const user = users.find((u) => u.email === email);
    if (!user) return res.status(401).json({ error: 'Credenciais invalidas' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Credenciais invalidas' });
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ message: 'Login realizado com sucesso', token, user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  const users = await getUsers();
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
  res.json({ id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role });
});

// ===============================================
// CANAIS
// ===============================================
app.get('/api/channels', authenticateToken, async (_req, res) => {
  try {
    const channels = await getChannels();
    res.json(channels.filter((c) => c.active !== false));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar canais' });
  }
});

app.post('/api/channels', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome do canal e obrigatorio' });
  try {
    const channels = await getChannels();
    const id = nextId(channels);
    channels.push({ id, name, active: true, created_at: new Date().toISOString() });
    await saveChannels(channels);
    res.status(201).json({ id, name, active: true });
  } catch {
    res.status(500).json({ error: 'Erro ao criar canal' });
  }
});

app.put('/api/channels/:id', authenticateToken, async (req, res) => {
  const { name, active } = req.body;
  const { id } = req.params;
  try {
    const channels = await getChannels();
    const found = channels.find((c) => c.id === Number(id));
    if (!found) return res.status(404).json({ error: 'Canal nao encontrado' });
    found.name = name ?? found.name;
    if (typeof active !== 'undefined') found.active = !!active;
    await saveChannels(channels);
    res.json({ message: 'Canal atualizado com sucesso' });
  } catch {
    res.status(500).json({ error: 'Erro ao atualizar canal' });
  }
});

app.delete('/api/channels/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const channels = await getChannels();
    const found = channels.find((c) => c.id === Number(id));
    if (!found) return res.status(404).json({ error: 'Canal nao encontrado' });
    found.active = false;
    await saveChannels(channels);
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
    const users = await getUsers();
    const current = users.find((u) => u.id === req.user.id);
    const isAdmin = current?.role === 'admin';
    const leads = await getLeads();
    const channels = await getChannels();
    const filtered = leads
      .filter((l) => {
        if (!isAdmin && l.is_private && l.user_id !== req.user.id) return false;
        return true;
      })
      .filter((l) => {
        if (status && status !== 'todos') return l.status === status;
        return true;
      })
      .filter((l) => {
        if (search) {
          const s = search.toLowerCase();
          return (
            (l.name || '').toLowerCase().includes(s) ||
            (l.email || '').toLowerCase().includes(s) ||
            (l.campaign || '').toLowerCase().includes(s)
          );
        }
        return true;
      })
      .map((l) => ({
        ...l,
        channel_name: channels.find((c) => c.id === l.channel_id)?.name || null,
        responsible_name: l.owner || users.find((u) => u.id === l.user_id)?.name || null,
      }));
    res.json(filtered);
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

    const leads = await getLeads();
    const users = await getUsers();
    const responsibleId = ownerId || req.user.id;
    const responsibleUser = users.find((u) => u.id === responsibleId);
    const responsibleName = owner || responsibleUser?.name || req.user.name;

    const id = nextId(leads);
    const now = new Date().toISOString();
    const newLead = {
      id,
      name,
      contact: contact || '',
      owner: responsibleName || '',
      owner_id: responsibleId || '',
      origin: origin || '',
      stage_detail: stage_detail || '',
      next_contact: next_contact || '',
      email,
      phone: phone || '',
      channel_id: channel_id || '',
      campaign: campaign || '',
      status: status || 'novo',
      value: normalizeValue(value),
      notes: notes || '',
      user_id: responsibleId || '',
      is_private: !!is_private,
      created_at: now,
      updated_at: now,
    };
    leads.push(newLead);
    await saveLeads(leads);
    res.status(201).json(newLead);
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

    const leads = await getLeads();
    const users = await getUsers();
    const lead = leads.find((l) => l.id === Number(id));
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });

    const currentUser = users.find((u) => u.id === req.user.id);
    const isAdmin = currentUser?.role === 'admin';
    if (!isAdmin && lead.is_private && lead.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Lead privado de outro usuario' });
    }

    const responsibleId = ownerId || lead.user_id || req.user.id;
    const responsibleUser = users.find((u) => u.id === responsibleId);
    const responsibleName = owner || responsibleUser?.name || req.user.name;

    lead.name = name;
    lead.contact = contact || '';
    lead.owner = responsibleName || '';
    lead.owner_id = responsibleId || '';
    lead.origin = origin || '';
    lead.stage_detail = stage_detail || '';
    lead.next_contact = next_contact || '';
    lead.email = email;
    lead.phone = phone || '';
    lead.channel_id = channel_id || '';
    lead.campaign = campaign || '';
    lead.status = status;
    lead.value = normalizeValue(value);
    lead.notes = notes || '';
    lead.is_private = !!is_private;
    lead.user_id = responsibleId || '';
    lead.updated_at = new Date().toISOString();

    await saveLeads(leads);
    res.json({ message: 'Lead atualizado com sucesso' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar lead' });
  }
});

app.delete('/api/leads/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const leads = await getLeads();
    const users = await getUsers();
    const lead = leads.find((l) => l.id === Number(id));
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });
    const currentUser = users.find((u) => u.id === req.user.id);
    const isAdmin = currentUser?.role === 'admin';
    if (!isAdmin && lead.is_private && lead.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Lead privado de outro usuario' });
    }
    const filtered = leads.filter((l) => l.id !== Number(id));
    await saveLeads(filtered);
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
    const users = await getUsers();
    res.json(users.map(({ password, ...u }) => u));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar usuarios' });
  }
});

app.post('/api/users', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { name, phone, email, password, role = 'vendedor' } = req.body;
    if (!name || !phone || !email || !password) {
      return res.status(400).json({ error: 'Nome, telefone, email e senha sao obrigatorios' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    const users = await getUsers();
    if (users.find((u) => u.email === email)) return res.status(400).json({ error: 'Email ja cadastrado' });
    const hashed = await bcrypt.hash(password, 10);
    const id = nextId(users);
    const user = {
      id,
      name,
      phone,
      email,
      password: hashed,
      role: role === 'admin' ? 'admin' : 'vendedor',
      created_at: new Date().toISOString(),
    };
    users.push(user);
    await saveUsers(users);
    res.status(201).json({ id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuario' });
  }
});

app.delete('/api/users/:id', authenticateToken, ensureAdmin, async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) return res.status(400).json({ error: 'Nao e possivel remover o proprio usuario logado' });
  try {
    const users = await getUsers();
    const user = users.find((u) => u.id === Number(id));
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
    if (user.role === 'admin') return res.status(400).json({ error: 'Nao e possivel remover um administrador' });
    const leads = await getLeads();
    leads.forEach((l) => {
      if (l.user_id === user.id) l.user_id = null;
    });
    await saveLeads(leads);
    const filtered = users.filter((u) => u.id !== user.id);
    await saveUsers(filtered);
    res.json({ message: 'Usuario removido com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir usuario' });
  }
});

app.put('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !phone || !email) return res.status(400).json({ error: 'Nome, telefone e email sao obrigatorios' });
    const users = await getUsers();
    const me = users.find((u) => u.id === req.user.id);
    if (!me) return res.status(404).json({ error: 'Usuario nao encontrado' });
    if (users.find((u) => u.email === email && u.id !== me.id)) return res.status(400).json({ error: 'Email ja cadastrado' });
    me.name = name;
    me.phone = phone;
    me.email = email;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
      me.password = await bcrypt.hash(password, 10);
    }
    await saveUsers(users);
    const token = jwt.sign(
      { id: me.id, email: me.email, name: me.name, phone: me.phone, role: me.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ message: 'Dados atualizados', user: { id: me.id, name: me.name, phone: me.phone, email: me.email, role: me.role }, token });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

app.put('/api/users/:id', authenticateToken, ensureAdmin, async (req, res) => {
  try {
    const { name, phone, email, password, role } = req.body;
    const { id } = req.params;
    if (!name || !phone || !email) return res.status(400).json({ error: 'Nome, telefone e email sao obrigatorios' });
    const users = await getUsers();
    const user = users.find((u) => u.id === Number(id));
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
    if (users.find((u) => u.email === email && u.id !== user.id)) return res.status(400).json({ error: 'Email ja cadastrado' });
    user.name = name;
    user.phone = phone;
    user.email = email;
    user.role = role === 'admin' ? 'admin' : 'vendedor';
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
      user.password = await bcrypt.hash(password, 10);
    }
    await saveUsers(users);
    res.json({ message: 'Usuario atualizado', user: { id: user.id, name: user.name, phone: user.phone, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// ===============================================
// ESTATISTICAS
// ===============================================
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const users = await getUsers();
    const current = users.find((u) => u.id === req.user.id);
    const isAdmin = current?.role === 'admin';
    const targetUserId = isAdmin && req.query.scope === 'all' ? null : req.user.id;

    const leads = await getLeads();
    const filtered = leads.filter((l) => {
      if (targetUserId === null) return true;
      return l.user_id === targetUserId;
    });

    const total = filtered.length;
    const novos = filtered.filter((l) => l.status === 'novo').length;
    const convertidos = filtered.filter((l) => l.status === 'ganho').length;
    const valorTotal = filtered
      .filter((l) => l.status === 'ganho')
      .reduce((sum, l) => sum + (Number(l.value) || 0), 0);
    const taxaConversao = total > 0 ? ((convertidos / total) * 100).toFixed(1) : 0;

    res.json({ total, novos, convertidos, valorTotal, taxaConversao });
  } catch (err) {
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
        <p>Servidor rodando com Google Sheets.</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
