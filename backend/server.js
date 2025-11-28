// ===============================================
// BACKEND - Google Sheets storage (no database)
// ===============================================
// Env vars required:
// GOOGLE_SERVICE_ACCOUNT_EMAIL
// GOOGLE_PRIVATE_KEY (com quebras de linha ou com \\n)
// GOOGLE_SHEET_ID
// JWT_SECRET

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const ADMIN_EMAIL = 'marketing@bhseletronica.com.br';
const ADMIN_USERNAME = 'marketing';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'bhseletronica123';
const ADMIN_DEFAULT_PHONE = process.env.ADMIN_DEFAULT_PHONE || '0000000000';

const normalizeName = (val) =>
  (val || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_KEY) {
  console.error('Faltam variaveis: GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY');
  process.exit(1);
}

const auth = new google.auth.JWT(
  SERVICE_ACCOUNT_EMAIL,
  null,
  SERVICE_ACCOUNT_KEY,
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({ version: 'v4', auth });

app.use(cors());
app.use(express.json());

const SHEETS_CONFIG = {
  users: ['id', 'name', 'username', 'email', 'phone', 'password', 'role'],
  channels: ['id', 'name'],
  leads: [
    'id',
    'name',
    'email',
    'phone',
    'status',
    'owner',
    'ownerId',
    'campaign',
    'channel_id',
    'channel_name',
    'value',
    'first_contact',
    'next_contact',
    'notes',
    'created_at',
    'is_private',
  ],
};

const readSheet = async (sheetName) => {
  const range = `${sheetName}!A1:Z1000`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range }).catch((err) => {
    if (err.response?.status === 400) {
      return { data: { values: [] } };
    }
    throw err;
  });
  const values = res.data.values || [];
  if (!values.length) return { headers: [], rows: [] };
  const headers = values[0];
  const rows = values.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] ?? '';
    });
    return obj;
  });
  return { headers, rows };
};

const writeSheet = async (sheetName, headers, rows) => {
  const values = [headers, ...rows.map((row) => headers.map((h) => row[h] ?? ''))];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
};

const ensureHeaders = async () => {
  for (const [sheet, expectedHeaders] of Object.entries(SHEETS_CONFIG)) {
    const { headers, rows } = await readSheet(sheet);
    if (!headers.length) {
      await writeSheet(sheet, expectedHeaders, rows);
    } else if (headers.join(',') !== expectedHeaders.join(',')) {
      // regrava cabecalho mantendo dados existentes com as chaves conhecidas
      const normalizedRows = rows.map((row) => {
        const obj = {};
        expectedHeaders.forEach((h) => {
          obj[h] = row[h] ?? '';
        });
        return obj;
      });
      await writeSheet(sheet, expectedHeaders, normalizedRows);
    }
  }
};

const nextId = (items) => {
  const max = items.reduce((acc, item) => Math.max(acc, Number(item.id) || 0), 0);
  return String(max + 1);
};

const sanitizeUser = (user) => {
  const clone = { ...user };
  delete clone.password;
  return clone;
};

const isAdmin = (user) => user?.role === 'admin' || user?.email === ADMIN_EMAIL;

const authMiddleware = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Auth required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido' });
  }
};

// Carrega tabelas
const loadTable = async (name) => {
  const { headers, rows } = await readSheet(name);
  const expected = SHEETS_CONFIG[name] || headers;
  const normalizedHeaders = headers.length ? headers : expected;
  const items = rows.map((row) => {
    const obj = {};
    normalizedHeaders.forEach((h) => {
      obj[h] = row[h] ?? '';
    });
    return obj;
  });
  return { headers: normalizedHeaders, items };
};

const saveTable = async (name, items) => {
  const headers = SHEETS_CONFIG[name];
  await writeSheet(name, headers, items);
};

const ensureDefaultAdmin = async () => {
  const { items: users } = await loadTable('users');
  const exists = users.find((u) => (u.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase());
  if (!exists) {
    const id = nextId(users);
    const hashed = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10);
    users.push({
      id,
      name: 'Administrador',
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      phone: ADMIN_DEFAULT_PHONE,
      password: hashed,
      role: 'admin',
    });
    await saveTable('users', users);
    console.log('Usuario admin criado automaticamente:', ADMIN_EMAIL);
  }
};

// ===================== AUTH =====================
app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, password, username } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Dados obrigatorios faltando' });
  }
  const { items: users } = await loadTable('users');

  const emailLower = (email || '').toLowerCase();
  const usernameInput = (username || '').trim().toLowerCase();

  const emailExists = users.find((u) => (u.email || '').toLowerCase() === emailLower);
  if (emailExists) return res.status(400).json({ error: 'Email ja existe' });

  let finalUsername = usernameInput || emailLower.split('@')[0];
  let suffix = 1;
  while (users.find((u) => (u.username || '').toLowerCase() === finalUsername)) {
    finalUsername = `${usernameInput || emailLower.split('@')[0]}${suffix}`;
    suffix += 1;
  }

  const id = nextId(users);
  const hashed = await bcrypt.hash(password, 10);
  const user = {
    id,
    name,
    username: finalUsername,
    email,
    phone: phone || '',
    password: hashed,
    role: 'vendedor',
  };
  users.push(user);
  await saveTable('users', users);
  const token = jwt.sign(sanitizeUser(user), JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, login } = req.body; // login pode ser username ou email
  const loginValue = (login || email || '').trim();
  if (!loginValue || !password) return res.status(400).json({ error: 'Login e senha necessarios' });

  const { items: users } = await loadTable('users');
  const isEmail = loginValue.includes('@');
  const findUser = (u) => {
    if (isEmail) return (u.email || '').toLowerCase() === loginValue.toLowerCase();
    return (u.username || '').toLowerCase() === loginValue.toLowerCase();
  };
  const user = users.find(findUser);
  if (!user) return res.status(401).json({ error: 'Credenciais invalidas' });
  const ok = await bcrypt.compare(password, user.password || '');
  if (!ok) return res.status(401).json({ error: 'Credenciais invalidas' });
  const token = jwt.sign(sanitizeUser(user), JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  return res.json(req.user);
});

// ===================== USERS =====================
app.get('/api/users', authMiddleware, async (req, res) => {
  const { items: users } = await loadTable('users');
  return res.json(users.map(sanitizeUser));
});

app.put('/api/users/me', authMiddleware, async (req, res) => {
  const { name, email, phone, password } = req.body;
  const { items: users } = await loadTable('users');
  const userIdx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (userIdx === -1) return res.status(404).json({ error: 'Usuario nao encontrado' });
  if (name) users[userIdx].name = name;
  if (email) users[userIdx].email = email;
  if (phone) users[userIdx].phone = phone;
  if (password) users[userIdx].password = await bcrypt.hash(password, 10);
  await saveTable('users', users);
  return res.json(sanitizeUser(users[userIdx]));
});

app.post('/api/users', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { name, email, phone, password, role, username } = req.body;
  const { items: users } = await loadTable('users');
  const exists = users.find((u) => (u.email || '').toLowerCase() === (email || '').toLowerCase());
  if (exists) return res.status(400).json({ error: 'Usuario ja existe' });
  const existsUser = users.find((u) => (u.username || '').toLowerCase() === (username || '').toLowerCase());
  if (existsUser) return res.status(400).json({ error: 'Username ja existe' });
  const id = nextId(users);
  const hashed = await bcrypt.hash(password || '123456', 10);
  const user = {
    id,
    name,
    username: username || email?.split('@')[0] || `user${id}`,
    email,
    phone: phone || '',
    password: hashed,
    role: role || 'vendedor',
  };
  users.push(user);
  await saveTable('users', users);
  return res.json(sanitizeUser(user));
});

app.put('/api/users/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { name, email, phone, password, role, username } = req.body;
  const { items: users } = await loadTable('users');
  const idx = users.findIndex((u) => String(u.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Usuario nao encontrado' });
  if (username) {
    const clash = users.find(
      (u, i) => i !== idx && (u.username || '').toLowerCase() === username.toLowerCase()
    );
    if (clash) return res.status(400).json({ error: 'Username ja existe' });
    users[idx].username = username;
  }
  if (name) users[idx].name = name;
  if (email) users[idx].email = email;
  if (phone) users[idx].phone = phone;
  if (role) users[idx].role = role;
  if (password) users[idx].password = await bcrypt.hash(password, 10);
  await saveTable('users', users);
  return res.json(sanitizeUser(users[idx]));
});

app.delete('/api/users/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { items: users } = await loadTable('users');
  const filtered = users.filter((u) => String(u.id) !== String(req.params.id));
  await saveTable('users', filtered);
  return res.json({ success: true });
});

// ===================== CHANNELS =====================
app.get('/api/channels', authMiddleware, async (req, res) => {
  const { items: channels } = await loadTable('channels');
  return res.json(channels);
});

app.post('/api/channels', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' });
  const { items: channels } = await loadTable('channels');
  const id = nextId(channels);
  const channel = { id, name };
  channels.push(channel);
  await saveTable('channels', channels);
  return res.json(channel);
});

app.put('/api/channels/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { name } = req.body;
  const { items: channels } = await loadTable('channels');
  const idx = channels.findIndex((c) => String(c.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Canal nao encontrado' });
  if (name) channels[idx].name = name;
  await saveTable('channels', channels);
  return res.json(channels[idx]);
});

app.delete('/api/channels/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { items: channels } = await loadTable('channels');
  const filtered = channels.filter((c) => String(c.id) !== String(req.params.id));
  await saveTable('channels', filtered);
  return res.json({ success: true });
});

// ===================== LEADS =====================
// Admin enxerga tudo (ou filtra por userId se enviado).
// Não-admin vê todos os leads públicos e os privados dele.
// Fallback: se não houver ownerId, compara pelo nome do responsável.
const filterLeadsByUser = (leads, user, query) => {
  if (isAdmin(user)) {
    if (query.userId) return leads.filter((l) => String(l.ownerId) === String(query.userId));
    return leads; // padrão: todos
  }

  const userId = String(user.id);
  const userNameNorm = normalizeName(user.name);
  return leads.filter((l) => {
    const isPrivate = String(l.is_private || '') === 'true';
    const ownerMatchId = String(l.ownerId || l.user_id || '') === userId;
    const ownerMatchName = normalizeName(l.owner || l.responsible_name) === userNameNorm;

    const ownerMatches = ownerMatchId || ownerMatchName;

    if (isPrivate && !ownerMatches) return false;

    if (query.userId) {
      const target = String(query.userId);
      return (String(l.ownerId) === target || String(l.user_id || '') === target) && (!isPrivate || ownerMatches);
    }
    return ownerMatches || !isPrivate; // públicos aparecem para todos
  });
};

const hydrateLeads = (leads, channels) => {
  return leads.map((l) => {
    const channel = channels.find((c) => String(c.id) === String(l.channel_id));
    return {
      ...l,
      ownerId: l.ownerId || l.user_id || l.owner_id || '',
      value: Number(l.value || 0),
      channel_name: l.channel_name || channel?.name || '',
      created_at: l.created_at || '',
      is_private: String(l.is_private || '') === 'true',
    };
  });
};

app.get('/api/leads', authMiddleware, async (req, res) => {
  const [{ items: leads }, { items: channels }] = await Promise.all([
    loadTable('leads'),
    loadTable('channels'),
  ]);
  const filtered = filterLeadsByUser(hydrateLeads(leads, channels), req.user, req.query);
  return res.json(filtered);
});

app.post('/api/leads', authMiddleware, async (req, res) => {
  const {
    name,
    email,
    phone,
    status = 'novo',
    ownerId,
    owner,
    campaign = '',
    channel_id = '',
    value = 0,
    next_contact = '',
    notes = '',
    is_private = false,
    first_contact = '',
  } = req.body;

  if (!name || !email) return res.status(400).json({ error: 'Nome e email sao obrigatorios' });

  const [{ items: leads }, { items: users }] = await Promise.all([loadTable('leads'), loadTable('users')]);
  const id = nextId(leads);
  const ownerUser = users.find((u) => String(u.id) === String(ownerId)) || users.find((u) => String(u.id) === String(req.user.id));
  const channelName = req.body.channel_name || '';
  const now = new Date().toISOString();
  const lead = {
    id,
    name,
    email,
    phone: phone || '',
    status,
    owner: ownerUser?.name || owner || '',
    ownerId: ownerUser?.id || ownerId || '',
    campaign,
    channel_id,
    channel_name: channelName,
    value: Number(value || 0),
    first_contact: first_contact || '',
    next_contact: next_contact || '',
    notes: notes || '',
    created_at: now,
    is_private: Boolean(is_private),
  };
  leads.push(lead);
  await saveTable('leads', leads);
  return res.json(lead);
});

app.put('/api/leads/:id', authMiddleware, async (req, res) => {
  const {
    name,
    email,
    phone,
    status,
    ownerId,
    owner,
    campaign,
    channel_id,
    channel_name,
    value,
    next_contact,
    notes,
    is_private,
    first_contact,
  } = req.body;

  const [{ items: leads }, { items: users }] = await Promise.all([loadTable('leads'), loadTable('users')]);
  const idx = leads.findIndex((l) => String(l.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Lead nao encontrado' });

  if (!isAdmin(req.user) && String(leads[idx].ownerId) !== String(req.user.id)) {
    return res.status(403).json({ error: 'Sem permissao' });
  }

  if (name) leads[idx].name = name;
  if (email) leads[idx].email = email;
  if (phone) leads[idx].phone = phone;
  if (status) leads[idx].status = status;
  if (campaign !== undefined) leads[idx].campaign = campaign;
  if (channel_id !== undefined) leads[idx].channel_id = channel_id;
  if (channel_name !== undefined) leads[idx].channel_name = channel_name;
  if (value !== undefined) leads[idx].value = Number(value);
  if (first_contact !== undefined) leads[idx].first_contact = first_contact;
  if (next_contact !== undefined) leads[idx].next_contact = next_contact;
  if (notes !== undefined) leads[idx].notes = notes;
  if (is_private !== undefined) leads[idx].is_private = Boolean(is_private);

  if (ownerId || owner) {
    const ownerUser = users.find((u) => String(u.id) === String(ownerId));
    leads[idx].ownerId = ownerUser?.id || ownerId || leads[idx].ownerId;
    leads[idx].owner = ownerUser?.name || owner || leads[idx].owner;
  }

  await saveTable('leads', leads);
  return res.json(leads[idx]);
});

app.delete('/api/leads/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { items: leads } = await loadTable('leads');
  const filtered = leads.filter((l) => String(l.id) !== String(req.params.id));
  await saveTable('leads', filtered);
  return res.json({ success: true });
});

// ===================== STATS =====================
app.get('/api/stats', authMiddleware, async (req, res) => {
  const [{ items: leads }, { items: channels }] = await Promise.all([
    loadTable('leads'),
    loadTable('channels'),
  ]);
  const filtered = filterLeadsByUser(hydrateLeads(leads, channels), req.user, req.query);
  const total = filtered.length;
  const negotiationStatuses = ['negociacao', 'proposta'];
  const statusCount = filtered.reduce(
    (acc, lead) => {
      const status = (lead.status || '').toLowerCase();
      acc[status] = (acc[status] || 0) + 1;
      if (status === 'ganho') acc.valorTotal += Number(lead.value || 0);
      if (status === 'perdido') acc.valorPerdido += Number(lead.value || 0);
      if (negotiationStatuses.includes(status)) {
        acc.qtdNegociacao += 1;
        acc.valorNegociacao += Number(lead.value || 0);
      }
      return acc;
    },
    { valorTotal: 0, valorPerdido: 0, qtdNegociacao: 0, valorNegociacao: 0 }
  );
  const ganhos = statusCount.ganho || 0;
  const taxaConversao = total ? Math.round((ganhos / total) * 100) : 0;
  return res.json({
    total,
    novos: statusCount.novo || 0,
    ganhos,
    perdidos: statusCount.perdido || 0,
    valorPerdido: statusCount.valorPerdido || 0,
    qtdNegociacao: statusCount.qtdNegociacao || 0,
    valorNegociacao: statusCount.valorNegociacao || 0,
    taxaConversao,
    valorTotal: statusCount.valorTotal || 0,
  });
});

const bootstrap = async () => {
  await ensureHeaders();
  await ensureDefaultAdmin();
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
};

bootstrap().catch((err) => {
  console.error('Erro ao iniciar servidor:', err);
  process.exit(1);
});
