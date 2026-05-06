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
const nodemailer = require('nodemailer');
require('dotenv').config();

// Importar middleware de monitoramento
const { monitoring, healthCheck, errorHandler } = require('./middleware/monitoring');

const app = express();

// Error handling global
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
  // Não sair violentamente, apenas logar. PM2 cuidará de reinicializar se necessário.
});
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const ADMIN_EMAIL = 'marketing@bhseletronica.com.br';
const ADMIN_USERNAME = 'marketing';
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'bhseletronica123';
const ADMIN_DEFAULT_PHONE = process.env.ADMIN_DEFAULT_PHONE || '0000000000';
const MANYCHAT_SECRET = process.env.MANYCHAT_SECRET || process.env.MANYCHAT_TOKEN || '';
const ALERT_API_KEY = process.env.ALERT_API_KEY || '';
const ALERT_LOOKAHEAD_MINUTES = Number(process.env.ALERT_LOOKAHEAD_MINUTES || 60);
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || '';
const ALERT_SMTP_HOST = process.env.ALERT_SMTP_HOST || '';
const ALERT_SMTP_PORT = Number(process.env.ALERT_SMTP_PORT || 587);
const ALERT_SMTP_SECURE = process.env.ALERT_SMTP_SECURE === 'true';
const ALERT_SMTP_USER = process.env.ALERT_SMTP_USER || '';
const ALERT_SMTP_PASS = process.env.ALERT_SMTP_PASS || '';
const ALERT_FROM = process.env.ALERT_FROM || '';
const ALERT_TO_DEFAULT = process.env.ALERT_TO_DEFAULT || '';
const API_KEY_LEADS = process.env.API_KEY_LEADS || '';

const normalizeName = (val) =>
  (val || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const normalizePhone = (val) => (val || '').replace(/\D/g, '');
const normalizeBool = (val) => {
  if (typeof val === 'boolean') return val;
  const normalized = String(val || '').toLowerCase().trim();
  return ['1', 'true', 'sim', 'yes'].includes(normalized);
};
const parseMoneyValue = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;

  let normalized = String(val).trim();
  if (!normalized) return 0;

  normalized = normalized.replace(/[^\d,.\-]/g, '');
  if (!normalized) return 0;

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toIsoStringOrEmpty = (val) => {
  if (!val) return '';
  const date = val instanceof Date ? val : new Date(val);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const normalizeListParam = (val) =>
  String(val || '')
    .split(',')
    .map((item) => normalizeName(item))
    .filter(Boolean);

const dateInRange = (value, from, to) => {
  if (!from && !to) return true;
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

const deriveLeadSource = (lead) => {
  const explicitSource = normalizeName(lead.source);
  if (explicitSource) return lead.source;

  const channel = normalizeName(lead.channel_name);
  const campaign = normalizeName(lead.campaign);

  if (channel.includes('whatsapp')) return 'WhatsApp';
  if (channel.includes('landing')) return 'Landing Page';
  if (channel.includes('manychat')) return 'Manychat';
  if (campaign.includes('meta')) return 'Meta Ads';
  if (campaign.includes('facebook') || campaign.includes('instagram')) return 'Meta Ads';
  if (campaign.includes('google')) return 'Google Ads';
  if (campaign.includes('organico') || campaign.includes('organic')) return 'Orgânico';
  if (campaign.includes('indicacao') || campaign.includes('refer')) return 'Indicação';
  if (lead.channel_name) return lead.channel_name;
  if (lead.campaign) return lead.campaign;
  return '';
};

const isCompetitorLead = (lead) => normalizeName(lead?.segment) === 'concorrente';

const hydrateBudgets = (budgets) =>
  budgets.map((budget) => ({
    ...budget,
    budget_value: parseMoneyValue(budget.budget_value),
    closed_value: parseMoneyValue(budget.closed_value),
    created_at: toIsoStringOrEmpty(budget.created_at),
    updated_at: toIsoStringOrEmpty(budget.updated_at || budget.created_at),
    requested_at: toIsoStringOrEmpty(budget.requested_at),
    sent_at: toIsoStringOrEmpty(budget.sent_at),
    closed_at: toIsoStringOrEmpty(budget.closed_at),
  }));

const hydrateBudget = (budget) => hydrateBudgets([budget])[0];
const hydrateAdSpendItems = (items) =>
  items.map((item) => ({
    ...item,
    amount: parseMoneyValue(item.amount),
  }));
const hydrateAdSpendItem = (item) => hydrateAdSpendItems([item])[0];

const markLeadAsCustomer = async (leadId) => {
  const targetId = String(leadId || '').trim();
  if (!targetId) return;
  await withTableLock('leads', async () => {
    const { items: leads } = await loadTable('leads', true);
    const idx = leads.findIndex((lead) => String(lead.id) === targetId);
    if (idx === -1) return;
    leads[idx].is_customer = true;
    leads[idx].updated_at = new Date().toISOString();
    await saveTable('leads', leads);
  });
};

const DDD_REGION_MAP = {
  '11': 'SP', '12': 'SP', '13': 'SP', '14': 'SP', '15': 'SP', '16': 'SP', '17': 'SP', '18': 'SP', '19': 'SP',
  '21': 'RJ', '22': 'RJ', '24': 'RJ',
  '27': 'ES', '28': 'ES',
  '31': 'MG', '32': 'MG', '33': 'MG', '34': 'MG', '35': 'MG', '37': 'MG', '38': 'MG',
  '41': 'PR', '42': 'PR', '43': 'PR', '44': 'PR', '45': 'PR', '46': 'PR',
  '47': 'SC', '48': 'SC', '49': 'SC',
  '51': 'RS', '53': 'RS', '54': 'RS', '55': 'RS',
  '61': 'DF',
  '62': 'GO', '64': 'GO',
  '63': 'TO',
  '65': 'MT', '66': 'MT',
  '67': 'MS',
  '68': 'AC',
  '69': 'RO',
  '71': 'BA', '73': 'BA', '74': 'BA', '75': 'BA', '77': 'BA',
  '79': 'SE',
  '81': 'PE', '87': 'PE',
  '82': 'AL',
  '83': 'PB',
  '84': 'RN',
  '85': 'CE', '88': 'CE',
  '86': 'PI', '89': 'PI',
  '91': 'PA', '92': 'AM', '93': 'PA', '94': 'PA', '95': 'RR', '96': 'AP', '97': 'AM', '98': 'MA', '99': 'MA'
};

const getRegionByPhone = (phone) => {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 2) return '';
  const ddd = digits.startsWith('0') ? digits.substring(1, 3) : digits.substring(0, 2);
  return DDD_REGION_MAP[ddd] || '';
};

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_USERS = process.env.SHEET_USERS || 'users';
const SHEET_LEADS = process.env.SHEET_LEADS || process.env.SHEET_NAME || 'leads';
const SHEET_BUDGETS = process.env.SHEET_BUDGETS || 'budgets';
const SHEET_AD_SPEND = process.env.SHEET_AD_SPEND || 'ad_spend';
const SHEET_CHANNELS = process.env.SHEET_CHANNELS || 'channels';
const SHEET_NEGATIVE_TERMS = process.env.SHEET_NEGATIVE_TERMS || 'negative_terms';

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
// Cache leve de leituras das planilhas (ms).
const CACHE_TTL_MS = Number(process.env.SHEETS_CACHE_TTL_MS || 2000); // Reduzido para 2s para mais frescor
const cache = {};

// Gerenciador de Travas (Mutex) por Tabela
const tableLocks = new Map();
const withTableLock = async (tableName, fn) => {
  while (tableLocks.get(tableName)) {
    await tableLocks.get(tableName);
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      tableLocks.delete(tableName);
    }
  })();
  tableLocks.set(tableName, promise);
  return promise;
};

app.use(cors());
app.use(express.json());
app.use(monitoring);

const SHEETS_CONFIG = {
  users: ['id', 'name', 'username', 'email', 'phone', 'password', 'role'],
  channels: ['id', 'name'],
  negative_terms: ['id', 'term', 'active', 'notes', 'created_at'],
  budgets: [
    'id',
    'external_id',
    'lead_id',
    'client_name',
    'company',
    'segment',
    'stage',
    'status',
    'loss_reason',
    'raw_status',
    'raw_loss_reason',
    'owner_id',
    'owner_name',
    'estimator_id',
    'estimator_name',
    'budget_value',
    'closed_value',
    'branch',
    'customer_order',
    'payment_terms',
    'requested_at',
    'sent_at',
    'closed_at',
    'created_at',
    'updated_at',
    'channel_name',
    'campaign',
    'notes',
  ],
  ad_spend: [
    'id',
    'date',
    'platform',
    'campaign',
    'amount',
    'notes',
    'created_at',
    'updated_at',
  ],
  leads: [
    'id',
    'name',
    'company',
    'segment',
    'email',
    'phone',
    'phone2',
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
    'source',
    'created_at',
    'updated_at',
    'is_private',
    'is_customer',
    'is_out_of_scope',
    'highlighted_categories',
    'customer_type',
    'cooling_reason',
  ],
};

const readSheet = async (sheetName, ignoreCache = false) => {
  if (!ignoreCache && cache[sheetName] && Date.now() - cache[sheetName].ts < CACHE_TTL_MS) {
    return cache[sheetName].data;
  }
  // Remove o limite forçado de 5000 para evitar erro de grid limits
  const range = `${sheetName}!A:Z`;
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
  const payload = { headers, rows };
  cache[sheetName] = { data: payload, ts: Date.now() };
  return payload;
};

const clearTrailingRows = async (sheetName, startRow) => {
  try {
    const range = `${sheetName}!A${startRow}:Z`;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range,
    });
  } catch (err) {
    // Se a linha inicial está além do limite atual da grid, não há nada para limpar
    if (err.message && err.message.includes('exceeds grid limits')) {
      return;
    }
    console.error(`[CLEAR] Erro ao limpar linhas em ${sheetName}:`, err.message);
  }
};

const ensureSheetCapacity = async (sheetName, requiredRows) => {
  const ss = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = ss.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) return;

  const currentRows = sheet.properties.gridProperties.rowCount;
  if (currentRows < requiredRows) {
    const addRows = requiredRows - currentRows + 500; // Adiciona margem de folga
    console.log(`[GRID] Expandindo ${sheetName} de ${currentRows} para ${currentRows + addRows} linhas...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          appendDimension: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            length: addRows
          }
        }]
      }
    });
  }
};

const ensureSheetExists = async (sheetName) => {
  const ss = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = ss.data.sheets.find((s) => s.properties.title === sheetName);
  if (existing) return;

  console.log(`[INIT] Criando aba ausente: ${sheetName}...`);
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName,
              },
            },
          },
        ],
      },
    });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || '';
    if (message.includes(`A sheet with the name "${sheetName}" already exists`)) {
      return;
    }
    throw err;
  }
};

const writeSheet = async (sheetName, headers, rows) => {
  const values = [headers, ...rows.map((row) => headers.map((h) => row[h] ?? ''))];

  await ensureSheetExists(sheetName);

  // Garante que a planilha tem espaço suficiente
  await ensureSheetCapacity(sheetName, values.length + 1);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
  // Limpa linhas residuais abaixo do novo tamanho para evitar "fantasmas" em exclusao
  await clearTrailingRows(sheetName, rows.length + 2);
  delete cache[sheetName];
};

const ensureHeaders = async () => {
  const configs = {
    [SHEET_USERS]: SHEETS_CONFIG.users,
    [SHEET_CHANNELS]: SHEETS_CONFIG.channels,
    [SHEET_NEGATIVE_TERMS]: SHEETS_CONFIG.negative_terms,
    [SHEET_BUDGETS]: SHEETS_CONFIG.budgets,
    [SHEET_AD_SPEND]: SHEETS_CONFIG.ad_spend,
    [SHEET_LEADS]: SHEETS_CONFIG.leads,
  };

  for (const [sheet, expectedHeaders] of Object.entries(configs)) {
    const { headers, rows } = await readSheet(sheet);
    if (!headers.length) {
      console.log(`[INIT] Criando headers para ${sheet}...`);
      await writeSheet(sheet, expectedHeaders, rows);
    } else {
      // Verifica se todos os headers esperados existem (mesmo que com nomes levemente diferentes)
      const canonicalHeaders = headers.map(h => normalizeName(h));
      const missing = expectedHeaders.filter(h => !canonicalHeaders.includes(normalizeName(h)));

      if (missing.length > 0) {
        console.log(`[WARN] Headers da planilha ${sheet} incompletos. Faltando: ${missing.join(', ')}. Normalizando...`);
        const normalizedRows = rows.map((oldRow) => {
          const newRow = {};
          // Mapeamento extra de nomes comuns em português
          const aliasMap = {
            'id': ['id', 'ID'],
            'name': ['name', 'nome', 'contato'],
            'company': ['company', 'empresa', 'cliente'],
            'status': ['status', 'situacao', 'estagio'],
            'owner': ['owner', 'dono', 'responsavel', 'vendedor'],
            'ownerId': ['ownerid', 'owner_id', 'user_id', 'id_vendedor', 'responsible_id'],
            'is_private': ['is_private', 'privado', 'particular'],
            'is_out_of_scope': ['is_out_of_scope', 'fora_de_escopo', 'descartado'],
          };

          expectedHeaders.forEach((h) => {
            let val = oldRow[h];
            if (val === undefined || val === '') {
              const aliases = aliasMap[h] || [h];
              for (const alias of aliases) {
                const canonicalAlias = normalizeName(alias);
                const foundKey = Object.keys(oldRow).find(key => normalizeName(key) === canonicalAlias);
                if (foundKey) {
                  val = oldRow[foundKey];
                  break;
                }
              }
            }
            newRow[h] = val || '';
          });
          return newRow;
        });
        await writeSheet(sheet, expectedHeaders, normalizedRows);
      }
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

// Permite autenticar POST /api/leads via X-API-Key (opcional, sem expiração)
const apiKeyLeadsMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || '';
  if (API_KEY_LEADS && apiKey && apiKey === API_KEY_LEADS) {
    req.user = { id: 'api-key', role: 'admin', name: 'API Key' };
    return next();
  }
  return authMiddleware(req, res, next);
};

const apiKeyAlertsMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || '';
  if (ALERT_API_KEY && apiKey && apiKey === ALERT_API_KEY) {
    req.user = { id: 'api-key', role: 'admin', name: 'API Key Alerts' };
    return next();
  }
  return authMiddleware(req, res, next);
};

const shouldAlertLead = (lead, now, windowMs) => {
  const badStatuses = ['ganho', 'perdido'];
  const status = (lead.status || '').toLowerCase();
  if (badStatuses.includes(status)) return false;
  if (!lead.next_contact) return false;
  const d = new Date(lead.next_contact);
  if (Number.isNaN(d.getTime())) return false;
  const t = d.getTime();
  const nowTs = now.getTime();
  const limit = nowTs + windowMs;
  return t <= limit; // inclui vencidos (t < agora) e próximos dentro da janela
};

const formatLeadsSummary = (leads) => {
  return leads
    .map(
      (l) =>
        `- ${l.name} (${l.phone || '-'}) | Status: ${l.status || '-'} | Responsável: ${l.owner || l.responsible_name || '-'
        } | Próx.: ${l.next_contact || '-'}`
    )
    .join('\n');
};

const sendAlertEmail = async (leads) => {
  if (!ALERT_SMTP_HOST || !ALERT_SMTP_USER || !ALERT_SMTP_PASS || !ALERT_FROM || !ALERT_TO_DEFAULT) {
    return { sent: false, reason: 'smtp_not_configured' };
  }
  const transporter = nodemailer.createTransport({
    host: ALERT_SMTP_HOST,
    port: ALERT_SMTP_PORT,
    secure: ALERT_SMTP_SECURE,
    auth: { user: ALERT_SMTP_USER, pass: ALERT_SMTP_PASS },
  });
  const subject = `Alertas de follow-up (${leads.length})`;
  const text = `Leads com follow-up vencido ou próximo:\n\n${formatLeadsSummary(leads)}`;
  await transporter.sendMail({
    from: ALERT_FROM,
    to: ALERT_TO_DEFAULT,
    subject,
    text,
  });
  return { sent: true };
};

const sendAlertWebhook = async (leads) => {
  if (!ALERT_WEBHOOK_URL) return { sent: false, reason: 'webhook_not_configured' };
  const payload = {
    run_at: new Date().toISOString(),
    leads,
  };
  const res = await fetch(ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { sent: false, reason: `webhook_http_${res.status}` };
  return { sent: true };
};

// Carrega tabelas
const loadTable = async (name, ignoreCache = false) => {
  const { headers, rows } = await readSheet(name, ignoreCache);
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

let initPromise = null;
let initStarted = false;
let initFinished = false;
let initError = null;

const ensureInitialized = () => {
  if (initFinished) return Promise.resolve();
  if (initPromise) return initPromise;
  initStarted = true;
  initPromise = (async () => {
    await ensureHeaders();
    await ensureDefaultAdmin();
    initFinished = true;
  })().catch((err) => {
    initError = err;
    initPromise = null;
    throw err;
  });
  return initPromise;
};

const ensureReadyMiddleware = async (req, res, next) => {
  try {
    await ensureInitialized();
    return next();
  } catch (err) {
    console.error('Erro de inicializacao:', err);
    return res.status(500).json({ error: 'Falha ao preparar storage' });
  }
};

// ===================== AUTH =====================
app.post('/api/auth/register', ensureReadyMiddleware, async (req, res) => {
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

app.post('/api/auth/login', ensureReadyMiddleware, async (req, res) => {
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

// Health/ping leves (nao tocam Google Sheets)
app.get('/api/health', (req, res) => {
  if (!initStarted) ensureInitialized().catch(() => { });
  res.json({
    ok: true,
    ready: initFinished,
    initStarted,
    initError: Boolean(initError),
    uptime: process.uptime(),
    at: new Date().toISOString(),
  });
});

app.get('/api/ping', (req, res) => {
  if (!initStarted) ensureInitialized().catch(() => { });
  res.json({ ok: true, at: new Date().toISOString(), ready: initFinished });
});

app.get('/api/debug/config', (req, res) => {
  res.json({
    ok: true,
    sheetId: SHEET_ID ? 'CONNECTED' : 'MISSING',
    leadsColumns: SHEETS_CONFIG.leads,
    envPort: PORT,
  });
});

// Middleware global (exceto health/ping) para garantir inicializacao
app.use('/api', (req, res, next) => {
  if (req.path === '/ping' || req.path === '/health') return next();
  return ensureReadyMiddleware(req, res, next);
});

// ===================== USERS =====================
// ===================== USERS =====================
app.get('/api/users', authMiddleware, async (req, res) => {
  const { items: users } = await loadTable(SHEET_USERS);
  console.log(`[DEBUG] /api/users called by ${req.user.name} (Role: ${req.user.role}). Total in sheet: ${users.length}`);
  const sanitized = users.map(sanitizeUser);
  return res.json(sanitized);
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
  return withTableLock('users', async () => {
    await saveTable('users', users);
    return res.json(sanitizeUser(users[userIdx]));
  });
});

app.post('/api/users', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { name, email, phone, password, role, username } = req.body;
  return withTableLock('users', async () => {
    const { items: users } = await loadTable('users', true);
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
  return withTableLock('users', async () => {
    await saveTable('users', users);
    return res.json(sanitizeUser(users[idx]));
  });
});

app.delete('/api/users/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  return withTableLock('users', async () => {
    const { items: users } = await loadTable('users', true);
    const filtered = users.filter((u) => String(u.id) !== String(req.params.id));
    await saveTable('users', filtered);
    return res.json({ success: true });
  });
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
  return withTableLock('channels', async () => {
    const { items: channels } = await loadTable('channels', true);
    const id = nextId(channels);
    const channel = { id, name };
    channels.push(channel);
    await saveTable('channels', channels);
    return res.json(channel);
  });
});

app.put('/api/channels/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { name } = req.body;
  return withTableLock('channels', async () => {
    const { items: channels } = await loadTable('channels', true);
    const idx = channels.findIndex((c) => String(c.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Canal nao encontrado' });
    if (name) channels[idx].name = name;
    await saveTable('channels', channels);
    return res.json(channels[idx]);
  });
});

app.delete('/api/channels/:id', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  return withTableLock('channels', async () => {
    const { items: channels } = await loadTable('channels', true);
    const filtered = channels.filter((c) => String(c.id) !== String(req.params.id));
    await saveTable('channels', filtered);
    return res.json({ success: true });
  });
});

// ===================== NEGATIVE TERMS =====================
app.get('/api/negative-terms', apiKeyLeadsMiddleware, async (_req, res) => {
  const { items } = await loadTable('negative_terms');
  return res.json(items);
});

app.post('/api/negative-terms', apiKeyLeadsMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { term, active = true, notes = '' } = req.body;
  if (!term) return res.status(400).json({ error: 'Termo obrigatorio' });
  return withTableLock('negative_terms', async () => {
    const { items } = await loadTable('negative_terms', true);
    const id = nextId(items);
    const now = new Date().toISOString();
    const row = { id, term, active: normalizeBool(active), notes, created_at: now };
    items.push(row);
    await saveTable('negative_terms', items);
    return res.json(row);
  });
});

app.put('/api/negative-terms/:id', apiKeyLeadsMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { term, active, notes } = req.body;
  return withTableLock('negative_terms', async () => {
    const { items } = await loadTable('negative_terms', true);
    const idx = items.findIndex((t) => String(t.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Termo nao encontrado' });
    if (term !== undefined) items[idx].term = term;
    if (active !== undefined) items[idx].active = normalizeBool(active);
    if (notes !== undefined) items[idx].notes = notes;
    await saveTable('negative_terms', items);
    return res.json(items[idx]);
  });
});

app.delete('/api/negative-terms/:id', apiKeyLeadsMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  return withTableLock('negative_terms', async () => {
    const { items } = await loadTable('negative_terms', true);
    const filtered = items.filter((t) => String(t.id) !== String(req.params.id));
    await saveTable('negative_terms', filtered);
    return res.json({ success: true });
  });
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
  const userNames = [user.name, user.username].filter(Boolean).map((val) => normalizeName(val));
  const uname = normalizeName(user.name);

  // Se for representante, vê os leads dele ou os públicos.
  if (user.role === 'representante') {
    return leads.filter((l) => {
      const isPrivate = normalizeBool(l.is_private);
      const isOutOfScope = normalizeBool(l.is_out_of_scope);
      if (isOutOfScope) return false;

      const ownerMatchId = String(l.ownerId || l.user_id || l.owner_id || '') === userId;
      const ownerNormalized = normalizeName(l.owner || l.responsible_name || l.responsavel);
      const ownerMatchName = userNames.some((name) => name && ownerNormalized === name);

      return ownerMatchId || ownerMatchName || !isPrivate;
    });
  }

  // Vendedor (Ines): Assume visão ampla por padrão, especialmente para novos leads.
  return leads.filter((l) => {
    const isPrivate = normalizeBool(l.is_private);
    const isOutOfScope = normalizeBool(l.is_out_of_scope);

    const ownerMatchId = String(l.ownerId || l.user_id || l.owner_id || '') === userId;
    const ownerNormalized = normalizeName(l.owner || l.responsible_name || l.responsavel || l.vendedor);
    const ownerMatchName = userNames.some((name) => name && (ownerNormalized.includes(name) || name.includes(ownerNormalized)));

    // Especial: Leads do segmento ou status 'rep comercial' são sempre visíveis para vendedores.
    const segNorm = normalizeName(l.segment);
    const statNorm = normalizeName(l.status);
    const isRepComercial = segNorm.includes('rep comercial') || segNorm.includes('rep_comercial') ||
      statNorm.includes('rep comercial') || statNorm.includes('rep_comercial');

    const ownerMatches = ownerMatchId || ownerMatchName;

    // Se estiver fora de escopo, só mostramos se for dono ou for um "Rep Comercial" solicitado.
    if (isOutOfScope && !ownerMatches && !isRepComercial) return false;

    // Se houver filtro de usuário específico (ex: selecionei um representante)
    if (query.userId) {
      const target = String(query.userId);
      const isTarget = (String(l.ownerId) === target || String(l.user_id || '') === target);
      return isTarget && (!isPrivate || ownerMatches);
    }

    // Por padrão (sem filtros extras), vendedores veem seus leads, leads sem dono (públicos) e todos os 'rep comercial'.
    return ownerMatches || !isPrivate || isRepComercial;
  });
};

const hydrateLeads = (leads, channels) => {
  return leads.map((l) => {
    const channel = channels.find((c) => String(c.id) === String(l.channel_id));
    const createdAt = toIsoStringOrEmpty(l.created_at);
    const updatedAt = toIsoStringOrEmpty(l.updated_at || l.created_at);
    return {
      ...l,
      ownerId: l.ownerId || l.user_id || l.owner_id || '',
      value: parseMoneyValue(l.value),
      channel_name: l.channel_name || channel?.name || '',
      source: deriveLeadSource({ ...l, channel_name: l.channel_name || channel?.name || '' }),
      created_at: createdAt,
      updated_at: updatedAt,
      is_private: normalizeBool(l.is_private),
      is_customer: normalizeBool(l.is_customer),
      is_out_of_scope: normalizeBool(l.is_out_of_scope),
      region: getRegionByPhone(l.phone || l.phone2),
    };
  });
};

const applyLeadFilters = (leads, query) => {
  const createdFrom = toIsoStringOrEmpty(query.created_from || query.createdAtFrom || query.date_from);
  const createdToBase = toIsoStringOrEmpty(query.created_to || query.createdAtTo || query.date_to);
  const updatedFrom = toIsoStringOrEmpty(query.updated_from || query.updatedAtFrom);
  const updatedToBase = toIsoStringOrEmpty(query.updated_to || query.updatedAtTo);
  const createdFromDate = createdFrom ? new Date(createdFrom) : null;
  const createdToDate = createdToBase ? new Date(createdToBase) : null;
  const updatedFromDate = updatedFrom ? new Date(updatedFrom) : null;
  const updatedToDate = updatedToBase ? new Date(updatedToBase) : null;

  if (createdToDate) createdToDate.setUTCHours(23, 59, 59, 999);
  if (updatedToDate) updatedToDate.setUTCHours(23, 59, 59, 999);

  const statusFilter = normalizeListParam(query.status);
  const campaignFilter = normalizeListParam(query.campaign);
  const channelFilter = normalizeListParam(query.channel || query.channel_name);
  const ownerIds = String(query.ownerId || '')
    .split(',')
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return leads.filter((lead) => {
    if (!dateInRange(lead.created_at, createdFromDate, createdToDate)) return false;
    if (!dateInRange(lead.updated_at, updatedFromDate, updatedToDate)) return false;
    if (statusFilter.length && !statusFilter.includes(normalizeName(lead.status))) return false;
    if (campaignFilter.length && !campaignFilter.includes(normalizeName(lead.campaign))) return false;
    if (
      channelFilter.length &&
      !channelFilter.includes(normalizeName(lead.channel_name)) &&
      !channelFilter.includes(normalizeName(lead.channel_id))
    ) {
      return false;
    }
    if (ownerIds.length && !ownerIds.includes(String(lead.ownerId || '').trim())) return false;
    return true;
  });
};

const paginateLeads = (leads, query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(500, Number.parseInt(query.limit || query.per_page, 10) || 100));
  const shouldPaginate = query.page !== undefined || query.limit !== undefined || query.per_page !== undefined;

  if (!shouldPaginate) return null;

  const total = leads.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const items = leads.slice(start, start + limit);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
    },
  };
};

app.get('/api/leads', apiKeyLeadsMiddleware, async (req, res) => {
  const [{ items: leads }, { items: channels }] = await Promise.all([
    loadTable(SHEET_LEADS),
    loadTable(SHEET_CHANNELS),
  ]);
  const visible = filterLeadsByUser(hydrateLeads(leads, channels), req.user, req.query);
  const filtered = applyLeadFilters(visible, req.query);
  const paginated = paginateLeads(filtered, req.query);
  return res.json(paginated || filtered);
});

app.get('/api/leads/:id', apiKeyLeadsMiddleware, async (req, res) => {
  const [{ items: leads }, { items: channels }] = await Promise.all([
    loadTable('leads'),
    loadTable('channels'),
  ]);
  const filtered = filterLeadsByUser(hydrateLeads(leads, channels), req.user, req.query);
  const lead = filtered.find((l) => String(l.id) === String(req.params.id));
  if (!lead) {
    return res.status(404).json({ error: 'Lead nao encontrado' });
  }
  return res.json(lead);
});

app.post('/api/leads', apiKeyLeadsMiddleware, async (req, res) => {
  const {
    name,
    email,
    phone,
    phone2,
    status = 'novo',
    ownerId,
    owner,
    campaign = '',
    channel_id = '',
    value = 0,
    next_contact = '',
    notes = '',
    is_private = false,
    is_customer = false,
    is_out_of_scope = false,
    first_contact = '',
    company = '',
    segment = '',
    highlighted_categories = '',
    customer_type = '',
    cooling_reason = '',
  } = req.body;

  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone sao obrigatorios' });

  return withTableLock('leads', async () => {
    const [{ items: leads }, { items: users }] = await Promise.all([
      loadTable('leads', true), // ignora cache para inserção
      loadTable('users'),      // cache ok para usuários
    ]);
    const id = nextId(leads);
    const isRepresentante = req.user.role === 'representante';
    const hasOwnerInput = Boolean(ownerId || owner);
    let ownerUser;

    if (isRepresentante) {
      // Representante sempre cadastra para si mesmo
      ownerUser = users.find((u) => String(u.id) === String(req.user.id));
    } else {
      ownerUser =
        users.find((u) => String(u.id) === String(ownerId)) ||
        users.find((u) => String(u.id) === String(req.user.id));
      if (!hasOwnerInput) {
        ownerUser =
          users.find((u) => String(u.id) === '2') ||
          users.find((u) => (u.username || u.name || '').toLowerCase().includes('ines')) ||
          ownerUser;
      }
    }
    const channelName = req.body.channel_name || '';
    const now = new Date().toISOString();

    const normalizedPhone = normalizePhone(phone);
    const normalizedPhone2 = normalizePhone(phone2);
    if (!normalizedPhone) return res.status(400).json({ error: 'Informe telefone com DDD' });
    const normalizedEmail = (email || '').toLowerCase();
    const duplicate = leads.find((l) => {
      const leadPhone = normalizePhone(l.phone);
      const leadPhone2 = normalizePhone(l.phone2);
      const phoneMatch = normalizedPhone && (leadPhone === normalizedPhone || leadPhone2 === normalizedPhone);
      const phone2Match =
        normalizedPhone2 && (leadPhone === normalizedPhone2 || leadPhone2 === normalizedPhone2);
      const emailMatch = normalizedEmail && (l.email || '').toLowerCase() === normalizedEmail;
      return phoneMatch || phone2Match || emailMatch;
    });
    if (duplicate) return res.status(409).json({ error: 'Lead ja existe (email/telefone duplicado)' });

    const lead = {
      id,
      name,
      company: company || '',
      segment: segment || '',
      email,
      phone: phone || '',
      phone2: phone2 || '',
      status,
      owner: ownerUser?.name || owner || '',
      ownerId: ownerUser?.id || ownerId || '',
      campaign,
      channel_id,
      channel_name: channelName,
      value: parseMoneyValue(value),
      first_contact: first_contact || '',
      next_contact: next_contact || '',
      notes: notes || '',
      source: req.body.source || deriveLeadSource({ channel_name: channelName, campaign }),
      created_at: now,
      updated_at: now,
      is_private: normalizeBool(is_private),
      is_customer: normalizeBool(is_customer),
      is_out_of_scope: normalizeBool(is_out_of_scope),
      highlighted_categories: highlighted_categories || '',
      customer_type: customer_type || '',
      cooling_reason: cooling_reason || '',
    };
    leads.push(lead);
    await saveTable('leads', leads);
    return res.json(lead);
  });
});

// Executa alerta de follow-up (via X-API-Key ou JWT)
app.post('/api/alerts/run', apiKeyAlertsMiddleware, async (req, res) => {
  const windowMs = ALERT_LOOKAHEAD_MINUTES * 60 * 1000;
  const now = new Date();
  const [{ items: leads }, { items: channels }] = await Promise.all([
    loadTable('leads'),
    loadTable('channels'),
  ]);
  const hydrated = hydrateLeads(leads, channels);
  const candidates = hydrated.filter((l) => shouldAlertLead(l, now, windowMs));
  if (!candidates.length) {
    return res.json({ alerts: 0, email: 'skipped', webhook: 'skipped' });
  }

  let emailResult = { sent: false, reason: 'not_attempted' };
  let webhookResult = { sent: false, reason: 'not_attempted' };
  try {
    emailResult = await sendAlertEmail(candidates);
  } catch (err) {
    console.error('Erro ao enviar alerta por email:', err);
    emailResult = { sent: false, reason: 'email_error' };
  }
  try {
    webhookResult = await sendAlertWebhook(candidates);
  } catch (err) {
    console.error('Erro ao enviar alerta via webhook:', err);
    webhookResult = { sent: false, reason: 'webhook_error' };
  }

  return res.json({
    alerts: candidates.length,
    email: emailResult,
    webhook: webhookResult,
  });
});

app.put('/api/leads/:id', authMiddleware, async (req, res) => {
  const {
    name,
    email,
    phone,
    phone2,
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
    is_customer,
    is_out_of_scope,
    first_contact,
    company,
    segment,
    highlighted_categories,
    customer_type,
    cooling_reason,
    source,
  } = req.body;

  return withTableLock('leads', async () => {
    const [{ items: leads }, { items: users }] = await Promise.all([
      loadTable('leads', true), // ignora cache
      loadTable('users'),
    ]);
    const idx = leads.findIndex((l) => String(l.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Lead nao encontrado' });

    const leadOwnerId = leads[idx].ownerId || leads[idx].user_id || leads[idx].owner_id || '';
    const ownerMatchId = String(leadOwnerId) === String(req.user.id);
    const ownerNames = [req.user.name, req.user.username]
      .filter(Boolean)
      .map((val) => normalizeName(val));
    const ownerNormalized = normalizeName(leads[idx].owner || leads[idx].responsible_name);
    const ownerMatchName = ownerNames.some((name) => name && ownerNormalized === name);
    const isOwner = ownerMatchId || ownerMatchName;

    const hasOtherChanges = (() => {
      const current = leads[idx];
      if (name !== undefined && String(name) !== String(current.name || '')) return true;
      if (email !== undefined && String(email || '') !== String(current.email || '')) return true;
      if (phone !== undefined && String(phone || '') !== String(current.phone || '')) return true;
      if (phone2 !== undefined && String(phone2 || '') !== String(current.phone2 || '')) return true;
      if (status !== undefined && String(status || '') !== String(current.status || '')) return true;
      if (campaign !== undefined && String(campaign || '') !== String(current.campaign || '')) return true;
      if (channel_id !== undefined && String(channel_id || '') !== String(current.channel_id || '')) return true;
      if (
        channel_name !== undefined &&
        String(channel_name || '') !== String(current.channel_name || '')
      ) {
        return true;
      }
      if (value !== undefined && parseMoneyValue(value) !== parseMoneyValue(current.value)) return true;
      if (first_contact !== undefined && String(first_contact || '') !== String(current.first_contact || '')) {
        return true;
      }
      if (next_contact !== undefined && String(next_contact || '') !== String(current.next_contact || '')) {
        return true;
      }
      if (notes !== undefined && String(notes || '') !== String(current.notes || '')) return true;
      if (company !== undefined && String(company || '') !== String(current.company || '')) return true;
      if (segment !== undefined && String(segment || '') !== String(current.segment || '')) return true;
      if (source !== undefined && String(source || '') !== String(current.source || '')) return true;
      if (
        is_private !== undefined &&
        normalizeBool(is_private) !== normalizeBool(current.is_private)
      ) {
        return true;
      }
      if (
        is_customer !== undefined &&
        normalizeBool(is_customer) !== normalizeBool(current.is_customer)
      ) {
        return true;
      }
      if (
        is_out_of_scope !== undefined &&
        normalizeBool(is_out_of_scope) !== normalizeBool(current.is_out_of_scope)
      ) {
        return true;
      }
      return false;
    })();

    // Novo: Se for representante, só pode editar o que ele enxerga (seus próprios leads)
    if (req.user.role === 'representante' && !isOwner) {
      return res.status(403).json({ error: 'Acesso negado: voce so pode editar seus proprios leads' });
    }

    // Todos os usuários autenticados (exceto representantes) podem editar qualquer lead (incluindo reatribuir),
    // conforme regra do CRM.

    if (name) leads[idx].name = name;
    if (company !== undefined) leads[idx].company = company;
    if (segment !== undefined) leads[idx].segment = segment;
    if (email) leads[idx].email = email;
    if (phone) leads[idx].phone = phone;
    if (phone2 !== undefined) leads[idx].phone2 = phone2;
    if (status) leads[idx].status = status;
    if (campaign !== undefined) leads[idx].campaign = campaign;
    if (channel_id !== undefined) leads[idx].channel_id = channel_id;
    if (channel_name !== undefined) leads[idx].channel_name = channel_name;
    if (value !== undefined) leads[idx].value = parseMoneyValue(value);
    if (first_contact !== undefined) leads[idx].first_contact = first_contact;
    if (next_contact !== undefined) leads[idx].next_contact = next_contact;
    if (notes !== undefined) leads[idx].notes = notes;
    if (source !== undefined) leads[idx].source = source;
    if (is_private !== undefined) leads[idx].is_private = normalizeBool(is_private);
    if (is_customer !== undefined) leads[idx].is_customer = normalizeBool(is_customer);
    if (is_out_of_scope !== undefined) leads[idx].is_out_of_scope = normalizeBool(is_out_of_scope);
    if (highlighted_categories !== undefined) leads[idx].highlighted_categories = highlighted_categories;
    if (customer_type !== undefined) leads[idx].customer_type = customer_type;
    if (cooling_reason !== undefined) leads[idx].cooling_reason = cooling_reason;

    if (ownerId || owner) {
      const ownerUser = users.find((u) => String(u.id) === String(ownerId));
      leads[idx].ownerId = ownerUser?.id || ownerId || leads[idx].ownerId;
      leads[idx].owner = ownerUser?.name || owner || leads[idx].owner;
    }

    if (!leads[idx].source) {
      leads[idx].source = deriveLeadSource(leads[idx]);
    }
    leads[idx].updated_at = new Date().toISOString();

    await saveTable('leads', leads);
    return res.json(leads[idx]);
  });
});

app.delete('/api/leads/:id', authMiddleware, async (req, res) => {
  const targetId = String(req.params.id || '').trim();
  return withTableLock('leads', async () => {
    const { items: leads } = await loadTable('leads', true);
    const lead = leads.find((l) => String(l.id || '').trim() === targetId);
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' });

    // Novo: Se for representante, só pode excluir o que ele enxerga (seus próprios leads)
    if (req.user.role === 'representante') {
      const userId = String(req.user.id);
      const userNames = [req.user.name, req.user.username].filter(Boolean).map((val) => normalizeName(val));
      const leadOwnerId = lead.ownerId || lead.user_id || lead.owner_id || '';
      const ownerMatchId = String(leadOwnerId) === userId;
      const ownerNormalized = normalizeName(lead.owner || lead.responsible_name);
      const ownerMatchName = userNames.some((name) => name && ownerNormalized === name);
      const isOwner = ownerMatchId || ownerMatchName;

      if (!isOwner) {
        return res.status(403).json({ error: 'Acesso negado: voce so pode excluir seus proprios leads' });
      }
    }

    const filtered = leads.filter((l) => String(l.id || '').trim() !== targetId);
    await saveTable('leads', filtered);

    // Releitura imediata para garantir persistencia real na planilha
    const { items: afterSave } = await loadTable('leads');
    const stillThere = afterSave.find((l) => String(l.id || '').trim() === targetId);
    if (stillThere) {
      console.error(
        `Falha ao excluir lead ${targetId}: ainda presente apos salvar. antes=${leads.length} depois=${afterSave.length}`
      );
      return res.status(500).json({ error: 'Falha ao excluir lead na planilha. Tente novamente.' });
    }

    console.log(`Lead ${targetId} removido. Antes: ${leads.length}, depois: ${afterSave.length}`);
    return res.json({ success: true, removed: leads.length - afterSave.length });
  });
});

// ===================== BUDGETS =====================
app.get('/api/budgets', authMiddleware, async (_req, res) => {
  const { items: budgets } = await loadTable('budgets');
  return res.json(hydrateBudgets(budgets));
});

app.post('/api/budgets', authMiddleware, async (req, res) => {
  const {
    external_id = '',
    lead_id = '',
    client_name = '',
    company = '',
    segment = '',
    stage = '',
    status = 'novo',
    loss_reason = '',
    raw_status = '',
    raw_loss_reason = '',
    owner_id = '',
    owner_name = '',
    estimator_id = '',
    estimator_name = '',
    budget_value = 0,
    closed_value = 0,
    branch = '',
    customer_order = '',
    payment_terms = '',
    requested_at = '',
    sent_at = '',
    closed_at = '',
    channel_name = '',
    campaign = '',
    notes = '',
  } = req.body || {};

  if (!client_name && !company) {
    return res.status(400).json({ error: 'Cliente ou empresa obrigatorio' });
  }

  return withTableLock('budgets', async () => {
    const { items: budgets } = await loadTable('budgets', true);
    const id = nextId(budgets);
    const now = new Date().toISOString();
    const ownerIdFinal = owner_id || req.user.id || '';
    const ownerNameFinal = owner_name || req.user.name || '';
    const budget = {
      id,
      external_id: external_id || '',
      lead_id: lead_id || '',
      client_name: client_name || '',
      company: company || '',
      segment: segment || '',
      stage: stage || '',
      status: status || 'novo',
      loss_reason: loss_reason || '',
      raw_status: raw_status || '',
      raw_loss_reason: raw_loss_reason || '',
      owner_id: ownerIdFinal,
      owner_name: ownerNameFinal,
      estimator_id: estimator_id || '',
      estimator_name: estimator_name || '',
      budget_value: parseMoneyValue(budget_value),
      closed_value: parseMoneyValue(closed_value),
      branch: branch || '',
      customer_order: customer_order || '',
      payment_terms: payment_terms || '',
      requested_at: requested_at || now,
      sent_at: sent_at || '',
      closed_at: closed_at || '',
      created_at: now,
      updated_at: now,
      channel_name: channel_name || '',
      campaign: campaign || '',
      notes: notes || '',
    };
    budgets.push(budget);
    await saveTable('budgets', budgets);
    if (normalizeName(budget.status) === 'aprovado' && budget.lead_id) {
      await markLeadAsCustomer(budget.lead_id);
    }
    return res.json(hydrateBudget(budget));
  });
});

app.put('/api/budgets/:id', authMiddleware, async (req, res) => {
  const {
    external_id,
    lead_id,
    client_name,
    company,
    segment,
    stage,
    status,
    loss_reason,
    raw_status,
    raw_loss_reason,
    owner_id,
    owner_name,
    estimator_id,
    estimator_name,
    budget_value,
    closed_value,
    branch,
    customer_order,
    payment_terms,
    requested_at,
    sent_at,
    closed_at,
    channel_name,
    campaign,
    notes,
  } = req.body || {};

  return withTableLock('budgets', async () => {
    const { items: budgets } = await loadTable('budgets', true);
    const idx = budgets.findIndex((budget) => String(budget.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Orcamento nao encontrado' });

    if (external_id !== undefined) budgets[idx].external_id = external_id || '';
    if (lead_id !== undefined) budgets[idx].lead_id = lead_id || '';
    if (client_name !== undefined) budgets[idx].client_name = client_name || '';
    if (company !== undefined) budgets[idx].company = company || '';
    if (segment !== undefined) budgets[idx].segment = segment || '';
    if (stage !== undefined) budgets[idx].stage = stage || '';
    if (status !== undefined) budgets[idx].status = status || 'novo';
    if (loss_reason !== undefined) budgets[idx].loss_reason = loss_reason || '';
    if (raw_status !== undefined) budgets[idx].raw_status = raw_status || '';
    if (raw_loss_reason !== undefined) budgets[idx].raw_loss_reason = raw_loss_reason || '';
    if (owner_id !== undefined) budgets[idx].owner_id = owner_id || '';
    if (owner_name !== undefined) budgets[idx].owner_name = owner_name || '';
    if (estimator_id !== undefined) budgets[idx].estimator_id = estimator_id || '';
    if (estimator_name !== undefined) budgets[idx].estimator_name = estimator_name || '';
    if (budget_value !== undefined) budgets[idx].budget_value = parseMoneyValue(budget_value);
    if (closed_value !== undefined) budgets[idx].closed_value = parseMoneyValue(closed_value);
    if (branch !== undefined) budgets[idx].branch = branch || '';
    if (customer_order !== undefined) budgets[idx].customer_order = customer_order || '';
    if (payment_terms !== undefined) budgets[idx].payment_terms = payment_terms || '';
    if (requested_at !== undefined) budgets[idx].requested_at = requested_at || '';
    if (sent_at !== undefined) budgets[idx].sent_at = sent_at || '';
    if (closed_at !== undefined) budgets[idx].closed_at = closed_at || '';
    if (channel_name !== undefined) budgets[idx].channel_name = channel_name || '';
    if (campaign !== undefined) budgets[idx].campaign = campaign || '';
    if (notes !== undefined) budgets[idx].notes = notes || '';
    budgets[idx].updated_at = new Date().toISOString();

    await saveTable('budgets', budgets);
    if (normalizeName(budgets[idx].status) === 'aprovado' && budgets[idx].lead_id) {
      await markLeadAsCustomer(budgets[idx].lead_id);
    }
    return res.json(hydrateBudget(budgets[idx]));
  });
});

app.delete('/api/budgets/:id', authMiddleware, async (req, res) => {
  return withTableLock('budgets', async () => {
    const { items: budgets } = await loadTable('budgets', true);
    const filtered = budgets.filter((budget) => String(budget.id) !== String(req.params.id));
    await saveTable('budgets', filtered);
    return res.json({ success: true });
  });
});

app.post('/api/budgets/import', authMiddleware, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    return res.status(400).json({ error: 'Nenhum item para importar' });
  }

  return withTableLock('budgets', async () => {
    const { items: budgets } = await loadTable('budgets', true);
    let created = 0;
    let updated = 0;
    const errors = [];
    const imported = [];

    for (const [index, rawItem] of items.entries()) {
      const externalId = String(rawItem?.external_id || '').trim();
      const company = String(rawItem?.company || '').trim();
      const clientName = String(rawItem?.client_name || '').trim();

      if (!externalId) {
        errors.push({ index, error: 'external_id ausente' });
        continue;
      }
      if (!company && !clientName) {
        errors.push({ index, external_id: externalId, error: 'Cliente/empresa ausente' });
        continue;
      }

      const now = new Date().toISOString();
      const payload = {
        external_id: externalId,
        lead_id: rawItem.lead_id || '',
        client_name: clientName,
        company,
        segment: rawItem.segment || '',
        stage: rawItem.stage || '',
        status: rawItem.status || 'novo',
        loss_reason: rawItem.loss_reason || '',
        raw_status: rawItem.raw_status || '',
        raw_loss_reason: rawItem.raw_loss_reason || '',
        owner_id: rawItem.owner_id || '',
        owner_name: rawItem.owner_name || '',
        estimator_id: rawItem.estimator_id || '',
        estimator_name: rawItem.estimator_name || '',
        budget_value: parseMoneyValue(rawItem.budget_value),
        closed_value: parseMoneyValue(rawItem.closed_value),
        branch: rawItem.branch || '',
        customer_order: rawItem.customer_order || '',
        payment_terms: rawItem.payment_terms || '',
        requested_at: rawItem.requested_at || now,
        sent_at: rawItem.sent_at || '',
        closed_at: rawItem.closed_at || '',
        channel_name: rawItem.channel_name || '',
        campaign: rawItem.campaign || '',
        notes: rawItem.notes || '',
      };

      const existingIdx = budgets.findIndex((budget) => String(budget.external_id || '').trim() === externalId);

      if (existingIdx >= 0) {
        budgets[existingIdx] = {
          ...budgets[existingIdx],
          ...payload,
          id: budgets[existingIdx].id,
          created_at: budgets[existingIdx].created_at || now,
          updated_at: now,
        };
        updated += 1;
        imported.push(budgets[existingIdx]);
        if (normalizeName(budgets[existingIdx].status) === 'aprovado' && budgets[existingIdx].lead_id) {
          await markLeadAsCustomer(budgets[existingIdx].lead_id);
        }
        continue;
      }

      const budget = {
        id: nextId(budgets),
        ...payload,
        created_at: now,
        updated_at: now,
      };
      budgets.push(budget);
      created += 1;
      imported.push(budget);
      if (normalizeName(budget.status) === 'aprovado' && budget.lead_id) {
        await markLeadAsCustomer(budget.lead_id);
      }
    }

    await saveTable('budgets', budgets);
    return res.json({
      success: true,
      created,
      updated,
      errors,
      imported: imported.slice(0, 20).map(hydrateBudget),
      totalReceived: items.length,
    });
  });
});

// ===================== AD SPEND =====================
app.get('/api/ad-spend', authMiddleware, async (_req, res) => {
  const { items } = await loadTable('ad_spend');
  return res.json(hydrateAdSpendItems(items));
});

app.post('/api/ad-spend', authMiddleware, async (req, res) => {
  const {
    date = '',
    platform = '',
    campaign = '',
    amount = 0,
    notes = '',
  } = req.body || {};

  if (!date) {
    return res.status(400).json({ error: 'Data obrigatoria' });
  }
  if (!platform) {
    return res.status(400).json({ error: 'Plataforma obrigatoria' });
  }

  return withTableLock('ad_spend', async () => {
    const { items } = await loadTable('ad_spend', true);
    const id = nextId(items);
    const now = new Date().toISOString();
    const entry = {
      id,
      date,
      platform: platform || '',
      campaign: campaign || '',
      amount: parseMoneyValue(amount),
      notes: notes || '',
      created_at: now,
      updated_at: now,
    };
    items.push(entry);
    await saveTable('ad_spend', items);
    return res.json(hydrateAdSpendItem(entry));
  });
});

app.put('/api/ad-spend/:id', authMiddleware, async (req, res) => {
  const {
    date,
    platform,
    campaign,
    amount,
    notes,
  } = req.body || {};

  return withTableLock('ad_spend', async () => {
    const { items } = await loadTable('ad_spend', true);
    const idx = items.findIndex((entry) => String(entry.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Lancamento nao encontrado' });

    if (date !== undefined) items[idx].date = date || '';
    if (platform !== undefined) items[idx].platform = platform || '';
    if (campaign !== undefined) items[idx].campaign = campaign || '';
    if (amount !== undefined) items[idx].amount = parseMoneyValue(amount);
    if (notes !== undefined) items[idx].notes = notes || '';
    items[idx].updated_at = new Date().toISOString();

    await saveTable('ad_spend', items);
    return res.json(hydrateAdSpendItem(items[idx]));
  });
});

app.delete('/api/ad-spend/:id', authMiddleware, async (req, res) => {
  return withTableLock('ad_spend', async () => {
    const { items } = await loadTable('ad_spend', true);
    const filtered = items.filter((entry) => String(entry.id) !== String(req.params.id));
    await saveTable('ad_spend', filtered);
    return res.json({ success: true });
  });
});

// ===================== STATS =====================
app.get('/api/stats', authMiddleware, async (req, res) => {
  const [{ items: leads }, { items: channels }] = await Promise.all([
    loadTable('leads'),
    loadTable('channels'),
  ]);
  const filtered = filterLeadsByUser(hydrateLeads(leads, channels), req.user, req.query)
    .filter((lead) => !isCompetitorLead(lead));
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

// ===================== MANYCHAT WEBHOOK =====================
// Simples endpoint para receber leads do Manychat sem exigir login do app.
// Protegido por token em MANYCHAT_SECRET.
app.post('/api/webhook/manychat', async (req, res) => {
  if (!MANYCHAT_SECRET) return res.status(500).json({ error: 'MANYCHAT_SECRET nao configurado' });
  const { secret, name, phone, email } = req.body || {};
  if (!secret || secret !== MANYCHAT_SECRET) return res.status(401).json({ error: 'Token invalido' });
  if (!phone && !email) return res.status(400).json({ error: 'Informe phone ou email' });

  return withTableLock('leads', async () => {
    const [{ items: leads }, { items: users }] = await Promise.all([
      loadTable('leads', true),
      loadTable('users'),
    ]);

    // Novos leads de Manychat devem ir somente para a Ines
    const chosen =
      users.find((u) => String(u.id) === '2') ||
      users.find((u) => (u.username || u.name || '').toLowerCase().includes('ines')) ||
      null;

    const id = nextId(leads);
    const now = new Date().toISOString();
    const lead = {
      id,
      name: name || 'Lead Manychat',
      email: email || '',
      phone: phone || '',
      status: 'novo',
      owner: chosen?.name || '',
      ownerId: chosen?.id || '',
      campaign: 'manychat',
      channel_id: '',
      channel_name: 'Manychat',
      value: 0,
      first_contact: now,
      next_contact: '',
      notes: 'Capturado via Manychat',
      created_at: now,
      is_private: false,
    };

    leads.push(lead);
    await saveTable('leads', leads);
    return res.json({ success: true, lead });
  });
});

// ===================== ERROR HANDLER =====================
app.use(errorHandler);

const bootstrap = async () => {
  console.log(`🚀 Iniciando servidor na porta ${PORT}...`);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor escutando em 0.0.0.0:${PORT}`);
    console.log(`🔗 Health check: http://127.0.0.1:${PORT}/api/health`);
  });
  // Inicializa planilhas e admin em segundo plano (não bloqueia start)
  console.log('📦 Iniciando inicialização do storage (Google Sheets)...');
  ensureInitialized().then(() => {
    console.log('✅ Storage inicializado com sucesso.');
  }).catch((err) => {
    console.error('❌ Erro ao preparar storage:', err);
  });
};

bootstrap().catch((err) => {
  console.error('Erro ao iniciar servidor:', err);
  process.exit(1);
});
