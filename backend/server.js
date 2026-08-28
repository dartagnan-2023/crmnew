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
const { timingSafeEqual } = require('node:crypto');
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
const MAILRELAY_API_BASE = (process.env.MAILRELAY_API_BASE || '').replace(/\/+$/, '');
const MAILRELAY_API_KEY = process.env.MAILRELAY_API_KEY || '';
const OMNICHAT_API_BASE = (process.env.OMNICHAT_API_BASE || '').replace(/\/+$/, '');
const OMNICHAT_API_KEY = process.env.OMNICHAT_API_KEY || '';
const OMNICHAT_SEND_URL = (process.env.OMNICHAT_SEND_URL || '').trim();
const OMNICHAT_AUTH_HEADER = String(process.env.OMNICHAT_AUTH_HEADER || 'x-api-key').trim();
const OMNICHAT_REMINDER_MINUTES = Number(process.env.OMNICHAT_REMINDER_MINUTES || 30);
const FOLLOWUP_AUTORUN = ['1', 'true', 'sim', 'yes'].includes(
  String(process.env.FOLLOWUP_AUTORUN || 'true').toLowerCase().trim()
);
const FOLLOWUP_AUTORUN_INTERVAL_MINUTES = Math.max(
  1,
  Number(process.env.FOLLOWUP_AUTORUN_INTERVAL_MINUTES || 5) || 5
);
const CRM_PUBLIC_URL = (process.env.CRM_PUBLIC_URL || '').replace(/\/+$/, '');
const MCP_ACCESS_TOKEN = (process.env.MCP_ACCESS_TOKEN || process.env.MCP_BEARER_TOKEN || '').trim();
const MCP_SERVER_NAME = process.env.MCP_SERVER_NAME || 'bhs-crm';
const MCP_TIMEZONE = 'America/Sao_Paulo';
const MCP_SCHEMA_VERSION = '1.0.0';
const MCP_RATE_LIMIT_WINDOW_MS = Number(process.env.MCP_RATE_LIMIT_WINDOW_MS || 60000);
const MCP_RATE_LIMIT_MAX = Number(process.env.MCP_RATE_LIMIT_MAX || 120);
const mcpRateState = new Map();

const normalizeName = (val) =>
  (val || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const normalizePhone = (val) => (val || '').replace(/\D/g, '');
const normalizePhoneForWhatsapp = (val) => {
  let digits = normalizePhone(val);
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
};
const normalizeEmail = (val) => String(val || '').trim().toLowerCase();
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

const resolveChannelName = (lead, channels = []) => {
  if (lead.channel_name) return lead.channel_name;
  const channelId = String(lead.channel_id || '').trim();
  if (!channelId) return '';
  const matched = channels.find((channel) => String(channel.id || '').trim() === channelId);
  return matched?.name || '';
};

const deriveLeadSource = (lead, channels = []) => {
  const resolvedChannelName = resolveChannelName(lead, channels);
  const channel = normalizeName(resolvedChannelName);
  const campaign = normalizeName(lead.campaign);
  const explicitSource = normalizeName(lead.source);

  if (channel.includes('whatsapp')) return 'WhatsApp';
  if (channel.includes('landing')) return 'Landing Page';
  if (channel.includes('manychat')) return 'Manychat';
  if (channel.includes('meta') || channel.includes('facebook') || channel.includes('instagram')) return 'Meta Ads';
  if (channel.includes('google') || channel.includes('youtube')) return 'Google Ads';
  if (channel.includes('scraper') || channel.includes('captura')) return resolvedChannelName;
  if (channel.includes('organico') || channel.includes('organic')) return 'Orgânico';
  if (channel.includes('indicacao') || channel.includes('refer')) return 'Indicação';
  if (campaign.includes('meta')) return 'Meta Ads';
  if (campaign.includes('facebook') || campaign.includes('instagram')) return 'Meta Ads';
  if (campaign.includes('google')) return 'Google Ads';
  if (campaign.includes('organico') || campaign.includes('organic')) return 'Orgânico';
  if (campaign.includes('indicacao') || campaign.includes('refer')) return 'Indicação';
  if (explicitSource) return lead.source;
  if (resolvedChannelName) return resolvedChannelName;
  if (lead.campaign) return lead.campaign;
  return '';
};

const TEMPERATURE_ORDER = {
  frio: 0,
  morno: 1,
  quente: 2,
};

const SLA_MINUTES_BY_TEMPERATURE = {
  frio: 24 * 60,
  morno: 4 * 60,
  quente: 30,
};

const HOT_SOURCES = ['meta ads', 'google ads', 'landing page', 'manychat', 'indicacao', 'site'];
const WARM_SOURCES = ['organico', 'whatsapp'];
const COLD_SOURCES = ['scraper', 'captura', 'ferramenta de captura'];
const HOT_LEAD_STATUSES = ['negociacao', 'proposta'];
const WARM_LEAD_STATUSES = ['contato'];
const HOT_BUDGET_STATUSES = ['enviado', 'aprovado'];
const WARM_BUDGET_STATUSES = ['novo', 'em_orcamento'];

const normalizeTemperature = (value) => {
  const normalized = normalizeName(value);
  if (normalized === 'quente' || normalized === 'morno' || normalized === 'frio') return normalized;
  return '';
};

const upgradeTemperature = (current, next) => {
  const currentNormalized = normalizeTemperature(current) || 'frio';
  const nextNormalized = normalizeTemperature(next) || 'frio';
  return TEMPERATURE_ORDER[nextNormalized] > TEMPERATURE_ORDER[currentNormalized]
    ? nextNormalized
    : currentNormalized;
};

const addMinutesIso = (baseIso, minutes) => {
  const base = new Date(baseIso || new Date().toISOString());
  if (Number.isNaN(base.getTime())) return '';
  return new Date(base.getTime() + (Number(minutes) || 0) * 60 * 1000).toISOString();
};

const getLeadAutomationSource = (lead) =>
  deriveLeadSource(lead) || resolveChannelName(lead) || lead.campaign || lead.source || '';

const getInitialTemperatureBySource = (source) => {
  const normalized = normalizeName(source);
  if (!normalized) return 'morno';
  if (HOT_SOURCES.some((item) => normalized.includes(item))) return 'quente';
  if (WARM_SOURCES.some((item) => normalized.includes(item))) return 'morno';
  if (COLD_SOURCES.some((item) => normalized.includes(item))) return 'frio';
  return 'morno';
};

const getBudgetTemperatureHint = (status) => {
  const normalized = normalizeName(status);
  if (HOT_BUDGET_STATUSES.includes(normalized)) return 'quente';
  if (WARM_BUDGET_STATUSES.includes(normalized)) return 'morno';
  return '';
};

const getStatusTemperatureHint = (status) => {
  const normalized = normalizeName(status);
  if (HOT_LEAD_STATUSES.includes(normalized)) return 'quente';
  if (WARM_LEAD_STATUSES.includes(normalized)) return 'morno';
  return '';
};

const refreshLeadSlaFields = (lead, referenceIso, temperature) => {
  const normalizedTemperature = normalizeTemperature(temperature) || 'morno';
  const slaMinutes = SLA_MINUTES_BY_TEMPERATURE[normalizedTemperature] || SLA_MINUTES_BY_TEMPERATURE.morno;
  const baseIso = toIsoStringOrEmpty(referenceIso) || new Date().toISOString();
  lead.temperature = normalizedTemperature;
  lead.sla_minutes = String(slaMinutes);
  lead.last_activity_at = baseIso;
  lead.sla_due_at = addMinutesIso(baseIso, slaMinutes);
  return lead;
};

const applyLeadAutomationOnWrite = (lead, options = {}) => {
  const {
    nowIso = new Date().toISOString(),
    previousLead = null,
    budgetStatus = '',
    isCreate = false,
    manualTouch = false,
  } = options;

  const source = getLeadAutomationSource(lead);
  const initialTemperature = getInitialTemperatureBySource(source);
  const previousTemperature = normalizeTemperature(previousLead?.temperature);
  let nextTemperature = normalizeTemperature(lead.temperature) || previousTemperature || initialTemperature;
  let shouldResetSla = isCreate || manualTouch || !lead.sla_due_at || !lead.last_activity_at;

  const sourceChanged = previousLead && normalizeName(source) !== normalizeName(getLeadAutomationSource(previousLead));
  const statusChanged = previousLead && normalizeName(previousLead.status) !== normalizeName(lead.status);
  const budgetHint = getBudgetTemperatureHint(budgetStatus);
  const statusHint = getStatusTemperatureHint(lead.status);

  if (sourceChanged) {
    if (normalizeName(lead.status) === 'novo' && !statusHint && !budgetHint) {
      nextTemperature = initialTemperature;
    } else {
      nextTemperature = upgradeTemperature(nextTemperature, initialTemperature);
    }
    shouldResetSla = true;
  }

  if (statusHint) {
    const upgraded = upgradeTemperature(nextTemperature, statusHint);
    shouldResetSla = shouldResetSla || upgraded !== nextTemperature || statusChanged;
    nextTemperature = upgraded;
  }

  if (budgetHint) {
    const upgraded = upgradeTemperature(nextTemperature, budgetHint);
    shouldResetSla = shouldResetSla || upgraded !== nextTemperature;
    nextTemperature = upgraded;
  }

  if (!statusHint && !budgetHint && isCreate) {
    nextTemperature = initialTemperature;
  }

  if (shouldResetSla) {
    refreshLeadSlaFields(lead, nowIso, nextTemperature);
  } else {
    lead.temperature = nextTemperature;
    if (!lead.sla_minutes) lead.sla_minutes = String(SLA_MINUTES_BY_TEMPERATURE[nextTemperature] || SLA_MINUTES_BY_TEMPERATURE.morno);
    if (!lead.last_activity_at) lead.last_activity_at = toIsoStringOrEmpty(previousLead?.last_activity_at || lead.updated_at || lead.created_at || nowIso);
    if (!lead.sla_due_at) lead.sla_due_at = addMinutesIso(lead.last_activity_at, Number(lead.sla_minutes) || 0);
  }

  return lead;
};

const deriveSlaStatus = (lastActivityAt, slaMinutes, now = new Date()) => {
  const lastActivity = new Date(lastActivityAt || '');
  if (Number.isNaN(lastActivity.getTime())) {
    return { sla_status: 'normal', sla_due_at: '', sla_remaining_minutes: null };
  }

  const totalMinutes = Math.max(1, Number(slaMinutes) || SLA_MINUTES_BY_TEMPERATURE.morno);
  const totalMs = totalMinutes * 60 * 1000;
  const dueAt = new Date(lastActivity.getTime() + totalMs);
  const warningAt = new Date(lastActivity.getTime() + totalMs * 0.5);
  let slaStatus = 'normal';

  if (now >= dueAt) slaStatus = 'overdue';
  else if (now >= warningAt) slaStatus = 'warning';

  const remainingMinutes = Math.round((dueAt.getTime() - now.getTime()) / (60 * 1000));
  return {
    sla_status: slaStatus,
    sla_due_at: dueAt.toISOString(),
    sla_remaining_minutes: remainingMinutes,
  };
};

const hydrateLeadAutomationState = (lead, now = new Date()) => {
  const source = getLeadAutomationSource(lead);
  const status = normalizeName(lead.status);
  const lastActivityAt = toIsoStringOrEmpty(lead.last_activity_at || lead.updated_at || lead.created_at);
  const initialTemperature = getInitialTemperatureBySource(source);
  let runtimeTemperature = status === 'novo'
    ? initialTemperature
    : normalizeTemperature(lead.temperature) || initialTemperature;

  const statusHint = getStatusTemperatureHint(status);
  if (statusHint) runtimeTemperature = upgradeTemperature(runtimeTemperature, statusHint);

  const lastActivity = new Date(lastActivityAt || '');
  if (!Number.isNaN(lastActivity.getTime())) {
    const idleHours = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);
    if (!HOT_LEAD_STATUSES.includes(status) && runtimeTemperature === 'quente' && idleHours >= 72) {
      runtimeTemperature = 'morno';
    }
    if (!HOT_LEAD_STATUSES.includes(status) && runtimeTemperature === 'morno' && idleHours >= 48) {
      runtimeTemperature = 'frio';
    }
  }

  const runtimeSlaMinutes = SLA_MINUTES_BY_TEMPERATURE[runtimeTemperature] || SLA_MINUTES_BY_TEMPERATURE.morno;
  const sla = deriveSlaStatus(lastActivityAt, runtimeSlaMinutes, now);

  return {
    ...lead,
    source,
    temperature: runtimeTemperature,
    sla_minutes: runtimeSlaMinutes,
    last_activity_at: lastActivityAt,
    sla_due_at: sla.sla_due_at,
    sla_status: sla.sla_status,
    sla_remaining_minutes: sla.sla_remaining_minutes,
  };
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

const updateLeadFromBudgetEvent = async (leadId, budgetStatus) => {
  const targetId = String(leadId || '').trim();
  if (!targetId) return;
  await withTableLock('leads', async () => {
    const { items: leads } = await loadTable('leads', true);
    const idx = leads.findIndex((lead) => String(lead.id) === targetId);
    if (idx === -1) return;
    const nowIso = new Date().toISOString();
    const nextLead = { ...leads[idx], updated_at: nowIso };
    applyLeadAutomationOnWrite(nextLead, {
      nowIso,
      previousLead: leads[idx],
      budgetStatus,
    });
    leads[idx] = nextLead;
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
  let digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';

  // Remove country code when the number comes as +55XXXXXXXXXXX.
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.substring(2);
  }

  if (digits.startsWith('0') && digits.length >= 3) {
    digits = digits.substring(1);
  }

  if (digits.length < 2) return '';
  const ddd = digits.substring(0, 2);
  return DDD_REGION_MAP[ddd] || '';
};

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_USERS = process.env.SHEET_USERS || 'users';
const SHEET_LEADS = process.env.SHEET_LEADS || process.env.SHEET_NAME || 'leads';
const SHEET_BUDGETS = process.env.SHEET_BUDGETS || 'budgets';
const SHEET_AD_SPEND = process.env.SHEET_AD_SPEND || 'ad_spend';
const SHEET_CHANNELS = process.env.SHEET_CHANNELS || 'channels';
const SHEET_NEGATIVE_TERMS = process.env.SHEET_NEGATIVE_TERMS || 'negative_terms';
const SHEET_EMAIL_EVENTS = process.env.SHEET_EMAIL_EVENTS || 'email_events';
const SHEET_LEAD_INTERACTIONS = process.env.SHEET_LEAD_INTERACTIONS || 'lead_interactions';
const SHEET_FOLLOWUP_NOTIFICATIONS = process.env.SHEET_FOLLOWUP_NOTIFICATIONS || 'followup_notifications';
const SHEET_SETTINGS = process.env.SHEET_SETTINGS || 'settings';

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
app.use(express.json({ limit: '10mb' }));
app.use(monitoring);

const SHEETS_CONFIG = {
  users: ['id', 'name', 'username', 'email', 'phone', 'password', 'role'],
  channels: ['id', 'name'],
  settings: ['key', 'value', 'updated_at'],
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
    'channel_id',
    'channel_name',
    'platform',
    'campaign',
    'amount',
    'notes',
    'created_at',
    'updated_at',
  ],
  lead_interactions: [
    'id',
    'lead_id',
    'interaction_at',
    'channel',
    'operator',
    'notes',
    'created_at',
    'updated_at',
  ],
  followup_notifications: [
    'id',
    'reminder_key',
    'external_id',
    'type',
    'lead_id',
    'lead_name',
    'lead_company',
    'owner_id',
    'owner_name',
    'owner_phone',
    'phone',
    'notify_phone',
    'scheduled_at',
    'scheduled_date_key',
    'status',
    'attempts',
    'provider',
    'provider_message_id',
    'conversation_id',
    'message',
    'last_error',
    'created_at',
    'updated_at',
    'sent_at',
    'last_attempt_at',
    'executed_at',
    'error_msg',
    'last_synced_at',
    'canceled_at',
  ],
  email_events: [
    'id',
    'event_key',
    'lead_id',
    'subscriber_id',
    'campaign_id',
    'campaign_name',
    'event_type',
    'event_at',
    'email',
    'metadata',
    'created_at',
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
    'temperature',
    'sla_minutes',
    'sla_due_at',
    'last_activity_at',
    'mailrelay_subscriber_id',
    'last_email_open_at',
    'last_email_click_at',
    'email_open_count',
    'email_click_count',
    'email_unsubscribed',
    'last_email_campaign',
    'last_email_campaign_id',
    'last_email_event_at',
    'interactions_count',
    'last_interaction_at',
    'last_interaction_channel',
    'last_interaction_notes',
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
  const range = `${sheetName}!A:AZ`;
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
    const range = `${sheetName}!A${startRow}:AZ`;
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

const ensureSheetCapacity = async (sheetName, requiredRows, requiredColumns = 26) => {
  const ss = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = ss.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) return;

  const currentRows = sheet.properties.gridProperties.rowCount;
  const currentColumns = sheet.properties.gridProperties.columnCount || 26;
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

  if (currentColumns < requiredColumns) {
    const addColumns = requiredColumns - currentColumns + 5;
    console.log(`[GRID] Expandindo ${sheetName} de ${currentColumns} para ${currentColumns + addColumns} colunas...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          appendDimension: {
            sheetId: sheet.properties.sheetId,
            dimension: 'COLUMNS',
            length: addColumns,
          },
        }],
      },
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
  await ensureSheetCapacity(sheetName, values.length + 1, headers.length + 1);

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
    [SHEET_SETTINGS]: SHEETS_CONFIG.settings,
    [SHEET_NEGATIVE_TERMS]: SHEETS_CONFIG.negative_terms,
    [SHEET_BUDGETS]: SHEETS_CONFIG.budgets,
    [SHEET_AD_SPEND]: SHEETS_CONFIG.ad_spend,
    [SHEET_EMAIL_EVENTS]: SHEETS_CONFIG.email_events,
    [SHEET_LEAD_INTERACTIONS]: SHEETS_CONFIG.lead_interactions,
    [SHEET_FOLLOWUP_NOTIFICATIONS]: SHEETS_CONFIG.followup_notifications,
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

const getSettingValue = (items, key) =>
  String(items.find((item) => String(item.key || '').trim() === key)?.value || '').trim();

const upsertSettingRow = (items, key, value, updatedAt = new Date().toISOString()) => {
  const idx = items.findIndex((item) => String(item.key || '').trim() === key);
  const row = { key, value, updated_at: updatedAt };
  if (idx === -1) items.push(row);
  else items[idx] = row;
};

const getMailrelayConfig = async () => {
  let storedBase = '';
  let storedKey = '';
  try {
    const { items } = await loadTable('settings');
    storedBase = getSettingValue(items, 'mailrelay_api_base');
    storedKey = getSettingValue(items, 'mailrelay_api_key');
  } catch {
    // fallback silencioso para env se a aba ainda não existir por algum motivo
  }

  return {
    apiBase: (storedBase || MAILRELAY_API_BASE || '').replace(/\/+$/, ''),
    apiKey: storedKey || MAILRELAY_API_KEY || '',
    source: storedBase || storedKey ? 'crm' : MAILRELAY_API_BASE || MAILRELAY_API_KEY ? 'env' : 'none',
  };
};

const getOmnichatConfig = async () => {
  let storedSendUrl = '';
  let storedKey = '';
  let storedAuthHeader = '';
  let storedEnabled = '';
  let storedReminderMinutes = '';
  try {
    const { items } = await loadTable('settings');
    storedSendUrl = getSettingValue(items, 'omnichat_api_base') || getSettingValue(items, 'omnichat_send_url');
    storedKey = getSettingValue(items, 'omnichat_api_key');
    storedAuthHeader = getSettingValue(items, 'omnichat_auth_header');
    storedEnabled = getSettingValue(items, 'omnichat_enabled');
    storedReminderMinutes = getSettingValue(items, 'followup_reminder_minutes');
  } catch {
    // fallback silencioso para env
  }

  return {
    apiBase: (storedSendUrl || OMNICHAT_API_BASE || OMNICHAT_SEND_URL || '').replace(/\/+$/, ''),
    apiKey: storedKey || OMNICHAT_API_KEY || '',
    authHeader: storedAuthHeader || OMNICHAT_AUTH_HEADER || 'x-api-key',
    enabled: normalizeBool(
      storedEnabled !== '' ? storedEnabled : process.env.OMNICHAT_ENABLED || 'false'
    ),
    reminderMinutes: Math.max(
      1,
      Number(storedReminderMinutes || OMNICHAT_REMINDER_MINUTES || 30) || 30
    ),
    source: storedSendUrl || storedKey ? 'crm' : OMNICHAT_SEND_URL || OMNICHAT_API_KEY || OMNICHAT_API_BASE ? 'env' : 'none',
  };
};

const isMailrelayConfigured = async () => {
  const config = await getMailrelayConfig();
  return Boolean(config.apiBase && config.apiKey);
};

const mailrelayRequest = async (path, query = {}) => {
  const config = await getMailrelayConfig();
  if (!config.apiBase || !config.apiKey) {
    throw new Error('mailrelay_not_configured');
  }

  const url = new URL(`${config.apiBase}${path.startsWith('/') ? path : `/${path}`}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-AUTH-TOKEN': config.apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`mailrelay_http_${response.status}:${text.slice(0, 240)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    throw new Error(`mailrelay_invalid_content_type:${contentType}:${text.slice(0, 240)}`);
  }

  return response.json();
};

const extractMailrelayArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const candidates = [
    payload.data,
    payload.items,
    payload.results,
    payload.rows,
    payload.records,
    payload.collection,
    payload.sent_campaigns,
    payload.campaigns,
    payload.impressions,
    payload.clicks,
    payload.unsubscribe_events,
    payload.events,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  const nestedArray = Object.values(payload).find((value) => Array.isArray(value));
  return Array.isArray(nestedArray) ? nestedArray : [];
};

const pickFirstNonEmpty = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const buildLeadCardUrl = (lead) => {
  if (!CRM_PUBLIC_URL || !lead?.id) return '';
  return `${CRM_PUBLIC_URL}/?leadId=${encodeURIComponent(String(lead.id))}`;
};

const getFollowupDateKey = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatFollowupScheduledAtUtc = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').slice(0, 19);
};

const buildFollowupReminderKey = (leadId, scheduledDateKey, type = 'alert') =>
  `${String(leadId || '').trim()}::${String(scheduledDateKey || '').trim()}::${String(type || 'alert').trim()}`;

const resolveLeadOwnerContact = (lead, users = []) => {
  const ownerId = String(lead?.ownerId || lead?.user_id || lead?.owner_id || '').trim();
  const ownerName = normalizeName(lead?.owner || lead?.responsible_name || '');
  let user = null;

  if (ownerId) {
    user = users.find((item) => String(item.id || '').trim() === ownerId) || null;
  }

  if (!user && ownerName) {
    user =
      users.find((item) => normalizeName(item.name || '') === ownerName) ||
      users.find((item) => ownerName && normalizeName(item.name || '').includes(ownerName)) ||
      null;
  }

  if (!user) return null;

  const phone = normalizePhoneForWhatsapp(user.phone || user.mobile || '');
  if (!phone) return null;

  return {
    id: String(user.id || ''),
    name: String(user.name || lead?.owner || lead?.responsible_name || '').trim(),
    phone,
  };
};

const buildFollowupMessage = (lead, ownerContact, dueAt, cardUrl) => {
  const company = lead?.company || '-';
  const leadName = lead?.name || 'Lead';
  const status = lead?.status || '-';
  const ownerName = ownerContact?.name || lead?.owner || lead?.responsible_name || '-';
  const dueText = dueAt ? new Date(dueAt).toLocaleString('pt-BR', { timeZone: MCP_TIMEZONE }) : '-';
  const note = lead?.notes ? String(lead.notes).slice(0, 220) : '';
  const linkLine = cardUrl ? `Card: ${cardUrl}` : '';

  return [
    '*Lembrete de follow-up*',
    `Lead: ${leadName}`,
    `Empresa: ${company}`,
    `Responsável: ${ownerName}`,
    `Vencimento: ${dueText}`,
    `Status: ${status}`,
    note ? `Obs.: ${note}` : '',
    linkLine,
  ]
    .filter(Boolean)
    .join('\n');
};

const buildFollowupNotificationPayload = ({ lead, ownerContact, scheduledAt, message, externalId, cardUrl, type = 'alert' }) => ({
  type,
  external_id: String(externalId || ''),
  scheduled_at: formatFollowupScheduledAtUtc(scheduledAt),
  notify_phone: ownerContact?.phone || '',
  phone: lead?.phone || '',
  conversation_id: '',
  message,
  title: `Follow-up ${lead?.name || lead?.company || ''}`.trim(),
  lead_id: String(lead?.id || ''),
  lead_name: String(lead?.name || ''),
  lead_company: String(lead?.company || ''),
  owner_id: String(ownerContact?.id || ''),
  owner_name: String(ownerContact?.name || ''),
  card_url: cardUrl || '',
});

const normalizeOmnichatResponse = (response = null) => ({
  ok: Boolean(response?.ok),
  status: Number(response?.status || 0),
  data: response?.data || null,
  text: String(response?.text || ''),
});

const omnichatRequest = async (path, { method = 'GET', body = null, headers = {}, config = null } = {}) => {
  const resolvedConfig = config || (await getOmnichatConfig());
  if (!resolvedConfig.apiBase || !resolvedConfig.apiKey) {
    return { ok: false, status: 503, data: null, text: '', reason: 'omnichat_not_configured' };
  }

  const base = resolvedConfig.apiBase.replace(/\/+$/, '');
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);
  const finalHeaders = {
    Accept: 'application/json',
    ...headers,
  };
  const authHeader = String(resolvedConfig.authHeader || 'x-api-key').trim() || 'x-api-key';
  finalHeaders[authHeader] = resolvedConfig.apiKey;
  if (body !== null && body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    text,
  };
};

const scheduleOmnichatTask = async ({ payload, config = null }) => {
  const response = await omnichatRequest('/api/integrations/schedule', {
    method: 'POST',
    body: payload,
    config,
  });
  if (response.status === 404 && String(payload?.type || '').toLowerCase() === 'send_message') {
    const retryResponse = await omnichatRequest('/api/integrations/schedule', {
      method: 'POST',
      body: { ...payload, type: 'alert' },
      config,
    });
    return {
      ...normalizeOmnichatResponse(retryResponse),
      retried_as_alert: true,
    };
  }
  return normalizeOmnichatResponse(response);
};

const getOmnichatTaskStatus = async (externalId, config = null) => {
  const response = await omnichatRequest(`/api/integrations/schedule/${encodeURIComponent(String(externalId || '').trim())}`, {
    method: 'GET',
    config,
  });
  return normalizeOmnichatResponse(response);
};

const cancelOmnichatTask = async (externalId, config = null) => {
  const response = await omnichatRequest(`/api/integrations/schedule/${encodeURIComponent(String(externalId || '').trim())}`, {
    method: 'DELETE',
    config,
  });
  return normalizeOmnichatResponse(response);
};

const normalizeFollowupNotification = (item) => {
  const scheduledAt = toIsoStringOrEmpty(item?.scheduled_at || item?.due_at);
  const scheduledDateKey = String(item?.scheduled_date_key || getFollowupDateKey(scheduledAt || item?.next_contact || '') || '').trim();
  return {
    id: String(item?.id || ''),
    reminder_key: String(item?.reminder_key || '').trim(),
    external_id: String(item?.external_id || '').trim(),
    type: String(item?.type || 'alert').trim() || 'alert',
    lead_id: String(item?.lead_id || '').trim(),
    lead_name: String(item?.lead_name || '').trim(),
    lead_company: String(item?.lead_company || '').trim(),
    owner_id: String(item?.owner_id || '').trim(),
    owner_name: String(item?.owner_name || '').trim(),
    owner_phone: String(item?.owner_phone || '').trim(),
    phone: String(item?.phone || '').trim(),
    notify_phone: String(item?.notify_phone || '').trim(),
    scheduled_at: scheduledAt,
    scheduled_date_key: scheduledDateKey,
    status: String(item?.status || '').trim() || 'pending',
    attempts: Number(item?.attempts || 0),
    provider: String(item?.provider || 'omnichat').trim() || 'omnichat',
    provider_message_id: String(item?.provider_message_id || '').trim(),
    conversation_id: String(item?.conversation_id || '').trim(),
    message: String(item?.message || '').trim(),
    last_error: String(item?.last_error || item?.error_msg || '').trim(),
    created_at: toIsoStringOrEmpty(item?.created_at),
    updated_at: toIsoStringOrEmpty(item?.updated_at),
    sent_at: toIsoStringOrEmpty(item?.sent_at || item?.executed_at),
    executed_at: toIsoStringOrEmpty(item?.executed_at || item?.sent_at),
    error_msg: String(item?.error_msg || item?.last_error || '').trim(),
    last_attempt_at: toIsoStringOrEmpty(item?.last_attempt_at),
    last_synced_at: toIsoStringOrEmpty(item?.last_synced_at),
    canceled_at: toIsoStringOrEmpty(item?.canceled_at),
  };
};

const buildFollowupNotificationSummaryMap = (items = []) => {
  const map = new Map();
  items.forEach((item) => {
    const notification = normalizeFollowupNotification(item);
    if (!notification.reminder_key) return;
    map.set(notification.reminder_key, notification);
    if (notification.external_id) map.set(notification.external_id, notification);
    if (notification.lead_id && notification.scheduled_date_key) {
      map.set(
        buildFollowupReminderKey(notification.lead_id, notification.scheduled_date_key, notification.type),
        notification
      );
    }
  });
  return map;
};

const buildFollowupTaskMessage = (lead, ownerContact, scheduledAt, cardUrl) =>
  buildFollowupMessage(lead, ownerContact, scheduledAt, cardUrl);

const buildFollowupNotificationRow = ({
  existing = null,
  id,
  reminderKey,
  externalId,
  type = 'alert',
  lead,
  ownerContact,
  scheduledAt,
  scheduledDateKey,
  status = 'pending',
  attempts = 1,
  providerMessageId = '',
  conversationId = '',
  message = '',
  lastError = '',
  createdAt = '',
  updatedAt = '',
  sentAt = '',
  executedAt = '',
  lastAttemptAt = '',
  lastSyncedAt = '',
  canceledAt = '',
}) => ({
  ...(existing || {}),
  id: String(id || existing?.id || ''),
  reminder_key: String(reminderKey || existing?.reminder_key || ''),
  external_id: String(externalId || existing?.external_id || ''),
  type: String(type || existing?.type || 'alert'),
  lead_id: String(lead?.id || existing?.lead_id || ''),
  lead_name: String(lead?.name || existing?.lead_name || ''),
  lead_company: String(lead?.company || existing?.lead_company || ''),
  owner_id: String(ownerContact?.id || existing?.owner_id || ''),
  owner_name: String(ownerContact?.name || existing?.owner_name || ''),
  owner_phone: String(ownerContact?.phone || existing?.owner_phone || ''),
  phone: String(lead?.phone || existing?.phone || ''),
  notify_phone: String(ownerContact?.phone || existing?.notify_phone || ''),
  scheduled_at: String(formatFollowupScheduledAtUtc(scheduledAt) || existing?.scheduled_at || ''),
  scheduled_date_key: String(scheduledDateKey || existing?.scheduled_date_key || ''),
  status: String(status || existing?.status || 'pending'),
  attempts: String(attempts ?? existing?.attempts ?? 0),
  provider: 'omnichat',
  provider_message_id: String(providerMessageId || existing?.provider_message_id || ''),
  conversation_id: String(conversationId || existing?.conversation_id || ''),
  message: String(message || existing?.message || ''),
  last_error: String(lastError || existing?.last_error || ''),
  created_at: String(createdAt || existing?.created_at || ''),
  updated_at: String(updatedAt || existing?.updated_at || ''),
  sent_at: String(sentAt || existing?.sent_at || ''),
  executed_at: String(executedAt || existing?.executed_at || ''),
  error_msg: String(lastError || existing?.error_msg || ''),
  last_attempt_at: String(lastAttemptAt || existing?.last_attempt_at || ''),
  last_synced_at: String(lastSyncedAt || existing?.last_synced_at || ''),
  canceled_at: String(canceledAt || existing?.canceled_at || ''),
});

const upsertFollowupNotificationRow = (rows, item) => {
  const key = String(item?.reminder_key || '').trim();
  if (!key) return;
  const idx = rows.findIndex((row) => String(row.reminder_key || '').trim() === key || String(row.external_id || '').trim() === String(item.external_id || '').trim());
  if (idx === -1) rows.push(item);
  else rows[idx] = item;
};

const findLatestFollowupForLead = (notifications = [], leadId, scheduledDateKey = '') => {
  const normalizedLeadId = String(leadId || '').trim();
  const normalizedDateKey = String(scheduledDateKey || '').trim();
  const matches = notifications
    .map(normalizeFollowupNotification)
    .filter((item) => item.lead_id === normalizedLeadId && (!normalizedDateKey || item.scheduled_date_key === normalizedDateKey))
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime());
  return matches[0] || null;
};

const syncFollowupStatusByNotification = async (notification, config = null) => {
  if (!notification?.external_id) {
    return { synced: false, reason: 'missing_external_id' };
  }
  const response = await getOmnichatTaskStatus(notification.external_id, config);
  if (!response.ok) {
    return {
      synced: false,
      reason: `omnichat_http_${response.status}`,
      error: typeof response.data === 'object' ? JSON.stringify(response.data).slice(0, 240) : String(response.text || '').slice(0, 240),
    };
  }

  const payload = response.data && typeof response.data === 'object' ? response.data : {};
  return {
    synced: true,
    status: String(payload.status || notification.status || 'pending').toLowerCase(),
    executed_at: toIsoStringOrEmpty(payload.executed_at || payload.executedAt || ''),
    error_msg: String(payload.error_msg || payload.errorMsg || ''),
    conversation_id: String(payload.conversation_id || payload.conversationId || notification.conversation_id || ''),
  };
};

const syncFollowupSchedules = async ({ source = 'manual', syncOnly = false, leadId = '' } = {}) => {
  if (syncFollowupSchedules._running) {
    return { success: false, skipped: true, reason: 'already_running', source };
  }

  syncFollowupSchedules._running = true;
  const startedAt = new Date().toISOString();
  const targetLeadId = String(leadId || '').trim();
  try {
    const config = await getOmnichatConfig();
    if (!config.apiBase || !config.apiKey) {
      return { success: true, skipped: true, reason: 'omnichat_not_configured', source };
    }
    if (!config.enabled) {
      return { success: true, skipped: true, reason: 'omnichat_disabled', source };
    }

    return await withTableLock(SHEET_FOLLOWUP_NOTIFICATIONS, async () => {
      const [{ items: leadsRaw }, { items: users }, { items: notificationsRaw }] = await Promise.all([
        loadTable('leads', true),
        loadTable('users'),
        loadTable(SHEET_FOLLOWUP_NOTIFICATIONS, true),
      ]);

      const leads = Array.isArray(leadsRaw) ? leadsRaw : [];
      const usersList = Array.isArray(users) ? users : [];
      const notifications = Array.isArray(notificationsRaw) ? notificationsRaw.map(normalizeFollowupNotification) : [];
      const notificationMap = buildFollowupNotificationSummaryMap(notifications);
      const nowIso = new Date().toISOString();
      const now = new Date();
      const scopedLeads = targetLeadId
        ? leads.filter((lead) => String(lead.id || '').trim() === targetLeadId)
        : leads;
      if (targetLeadId && !scopedLeads.length) {
        return { success: true, skipped: true, reason: 'lead_not_found', source };
      }
      const scopedNotifications = targetLeadId
        ? notifications.filter((notification) => String(notification.lead_id || '').trim() === targetLeadId)
        : notifications;
      const summary = {
        success: true,
        source,
        started_at: startedAt,
        finished_at: nowIso,
        configured: true,
        enabled: true,
        scheduled: 0,
        canceled: 0,
        synced: 0,
        errors: 0,
        processed: 0,
      };

      const leadMap = new Map(scopedLeads.map((lead) => [String(lead.id || '').trim(), lead]));

      if (!syncOnly) {
        for (const lead of scopedLeads) {
          const nextContact = toIsoStringOrEmpty(lead?.next_contact || '');
          const scheduledDateKey = getFollowupDateKey(nextContact);
          const currentKey = buildFollowupReminderKey(lead.id, scheduledDateKey, 'alert');
          const existing = notificationMap.get(currentKey) || findLatestFollowupForLead(notifications, lead.id, scheduledDateKey);

          if (!nextContact) {
            if (existing && ['pending', 'processing'].includes(String(existing.status || '').toLowerCase())) {
              const cancelResult = await cancelOmnichatTask(existing.external_id, config);
              const updated = buildFollowupNotificationRow({
                existing,
                status: cancelResult.ok || cancelResult.status === 404 ? 'dismissed' : 'error',
                lastError: cancelResult.ok || cancelResult.status === 404 ? '' : cancelResult.reason || `omnichat_http_${cancelResult.status}`,
                canceledAt: nowIso,
                lastAttemptAt: nowIso,
                lastSyncedAt: nowIso,
                updatedAt: nowIso,
              });
              upsertFollowupNotificationRow(notifications, updated);
              notificationMap.set(updated.reminder_key, updated);
              if (updated.external_id) notificationMap.set(updated.external_id, updated);
              summary.canceled += 1;
              summary.processed += 1;
            }
            continue;
          }

          const ownerContact = resolveLeadOwnerContact(lead, usersList);
          const cardUrl = buildLeadCardUrl(lead);
          const message = buildFollowupTaskMessage(lead, ownerContact, nextContact, cardUrl);
          const scheduledAt = formatFollowupScheduledAtUtc(nextContact);
          const scheduledDateKeyKey = getFollowupDateKey(nextContact);
          const reminderKey = buildFollowupReminderKey(lead.id, scheduledDateKeyKey, 'alert');
          const alreadyFinal = existing && ['done', 'dismissed'].includes(String(existing.status || '').toLowerCase());

          if (existing && String(existing.status || '').toLowerCase() === 'pending') {
            summary.processed += 1;
            const syncResult = await syncFollowupStatusByNotification(existing, config);
            if (syncResult.synced) {
              const updated = buildFollowupNotificationRow({
                existing,
                status: syncResult.status,
                executedAt: syncResult.executed_at || existing.executed_at,
                conversationId: syncResult.conversation_id || existing.conversation_id,
                lastError: syncResult.error_msg || '',
                lastSyncedAt: nowIso,
                updatedAt: nowIso,
              });
              upsertFollowupNotificationRow(notifications, updated);
              notificationMap.set(updated.reminder_key, updated);
              if (updated.external_id) notificationMap.set(updated.external_id, updated);
              summary.synced += 1;
            } else {
              const updated = buildFollowupNotificationRow({
                existing,
                lastError: syncResult.error || syncResult.reason || 'sync_failed',
                lastSyncedAt: nowIso,
                updatedAt: nowIso,
              });
              upsertFollowupNotificationRow(notifications, updated);
              notificationMap.set(updated.reminder_key, updated);
              if (updated.external_id) notificationMap.set(updated.external_id, updated);
              summary.errors += 1;
            }
            continue;
          }

          if (alreadyFinal) {
            continue;
          }

          if (existing && String(existing.status || '').toLowerCase() === 'processing') {
            continue;
          }

          const rowId = nextId(notifications);
          const externalId = String(rowId);
          const newRow = buildFollowupNotificationRow({
            id: rowId,
            reminderKey,
            externalId,
            type: 'alert',
            lead,
            ownerContact,
            scheduledAt,
            scheduledDateKey: scheduledDateKeyKey,
            status: 'processing',
            attempts: Number(existing?.attempts || 0) + 1,
            message,
            createdAt: existing?.created_at || nowIso,
            updatedAt: nowIso,
            lastAttemptAt: nowIso,
            lastSyncedAt: nowIso,
          });
          upsertFollowupNotificationRow(notifications, newRow);
          notificationMap.set(newRow.reminder_key, newRow);
          notificationMap.set(newRow.external_id, newRow);

          const payload = buildFollowupNotificationPayload({
            lead,
            ownerContact,
            scheduledAt,
            message,
            externalId: newRow.external_id,
            cardUrl,
            type: 'alert',
          });
          const scheduleResult = await scheduleOmnichatTask({ payload, config });
          const nextRow = buildFollowupNotificationRow({
            existing: newRow,
            status: scheduleResult.ok || scheduleResult.status === 200 ? 'pending' : 'error',
            providerMessageId:
              (scheduleResult.data && typeof scheduleResult.data === 'object'
                ? String(pickFirstNonEmpty(scheduleResult.data.id, scheduleResult.data.schedule_id, scheduleResult.data.scheduleId) || '')
                : '') || '',
            conversationId:
              (scheduleResult.data && typeof scheduleResult.data === 'object'
                ? String(pickFirstNonEmpty(scheduleResult.data.conversation_id, scheduleResult.data.conversationId) || '')
                : '') || '',
            lastError: scheduleResult.ok || scheduleResult.status === 200 || scheduleResult.data?.duplicado
              ? ''
              : scheduleResult.data && typeof scheduleResult.data === 'object'
                ? String(pickFirstNonEmpty(scheduleResult.data.error_msg, scheduleResult.data.error, scheduleResult.data.message) || scheduleResult.reason || `omnichat_http_${scheduleResult.status}`)
                : scheduleResult.reason || `omnichat_http_${scheduleResult.status}`,
            sentAt: scheduleResult.ok || scheduleResult.status === 200 ? nowIso : '',
            lastAttemptAt: nowIso,
            lastSyncedAt: nowIso,
            updatedAt: nowIso,
          });
          upsertFollowupNotificationRow(notifications, nextRow);
          notificationMap.set(nextRow.reminder_key, nextRow);
          notificationMap.set(nextRow.external_id, nextRow);
          summary.processed += 1;
          if (scheduleResult.ok || scheduleResult.status === 200 || scheduleResult.data?.duplicado) summary.scheduled += 1;
          else summary.errors += 1;
        }
      }

      if (!targetLeadId) {
        for (const notification of scopedNotifications) {
          const status = String(notification.status || '').toLowerCase();
          if (!['pending', 'processing'].includes(status)) continue;
          summary.processed += 1;
          const syncResult = await syncFollowupStatusByNotification(notification, config);
          if (syncResult.synced) {
            const updated = buildFollowupNotificationRow({
              existing: notification,
              status: syncResult.status,
              executedAt: syncResult.executed_at || notification.executed_at,
              conversationId: syncResult.conversation_id || notification.conversation_id,
              lastError: syncResult.error_msg || '',
              lastSyncedAt: nowIso,
              updatedAt: nowIso,
            });
            upsertFollowupNotificationRow(notifications, updated);
            notificationMap.set(updated.reminder_key, updated);
            if (updated.external_id) notificationMap.set(updated.external_id, updated);
            summary.synced += 1;
          } else {
            const updated = buildFollowupNotificationRow({
              existing: notification,
              lastError: syncResult.error || syncResult.reason || 'sync_failed',
              lastSyncedAt: nowIso,
              updatedAt: nowIso,
            });
            upsertFollowupNotificationRow(notifications, updated);
            notificationMap.set(updated.reminder_key, updated);
            if (updated.external_id) notificationMap.set(updated.external_id, updated);
            summary.errors += 1;
          }
        }
      }

      const followupByLead = new Map();
      scopedNotifications.map(normalizeFollowupNotification).forEach((notification) => {
        if (!notification.lead_id) return;
        const current = followupByLead.get(notification.lead_id) || null;
        if (!current) {
          followupByLead.set(notification.lead_id, notification);
          return;
        }
        const currentTs = new Date(current.updated_at || current.created_at || 0).getTime();
        const nextTs = new Date(notification.updated_at || notification.created_at || 0).getTime();
        if (nextTs >= currentTs) followupByLead.set(notification.lead_id, notification);
      });

      const enrichedLeads = leadMap.size
        ? scopedLeads.map((lead) => {
            const followup = followupByLead.get(String(lead.id || '').trim()) || null;
            if (!followup) return lead;
            return {
              ...lead,
              followup_external_id: followup.external_id || '',
              followup_status: followup.status || '',
              followup_type: followup.type || '',
              followup_scheduled_at: followup.scheduled_at || '',
              followup_scheduled_date_key: followup.scheduled_date_key || '',
              followup_executed_at: followup.executed_at || '',
              followup_conversation_id: followup.conversation_id || '',
              followup_error_msg: followup.error_msg || followup.last_error || '',
            };
          })
        : scopedLeads;

      await saveTable(SHEET_FOLLOWUP_NOTIFICATIONS, notifications);
      return {
        ...summary,
        leads_updated: enrichedLeads.length,
      };
    });
  } finally {
    syncFollowupSchedules._running = false;
  }
};

const cancelFollowupTasksForLead = async (lead, { source = 'delete' } = {}) => {
  if (!lead?.id) return { success: true, skipped: true, reason: 'missing_lead' };
  const config = await getOmnichatConfig();
  if (!config.apiBase || !config.apiKey || !config.enabled) {
    return { success: true, skipped: true, reason: 'omnichat_not_configured', source };
  }

  return await withTableLock(SHEET_FOLLOWUP_NOTIFICATIONS, async () => {
    const { items: notificationsRaw } = await loadTable(SHEET_FOLLOWUP_NOTIFICATIONS, true);
    const notifications = Array.isArray(notificationsRaw) ? notificationsRaw.map(normalizeFollowupNotification) : [];
    const nowIso = new Date().toISOString();
    let canceled = 0;
    let errors = 0;

    for (const notification of notifications) {
      if (String(notification.lead_id || '') !== String(lead.id || '')) continue;
      if (!['pending', 'processing'].includes(String(notification.status || '').toLowerCase())) continue;
      const cancelResult = await cancelOmnichatTask(notification.external_id, config);
      const updated = buildFollowupNotificationRow({
        existing: notification,
        status: cancelResult.ok || cancelResult.status === 404 ? 'dismissed' : 'error',
        lastError: cancelResult.ok || cancelResult.status === 404 ? '' : cancelResult.reason || `omnichat_http_${cancelResult.status}`,
        canceledAt: nowIso,
        lastAttemptAt: nowIso,
        lastSyncedAt: nowIso,
        updatedAt: nowIso,
      });
      upsertFollowupNotificationRow(notifications, updated);
      canceled += 1;
      if (!cancelResult.ok && cancelResult.status !== 404) errors += 1;
    }

    await saveTable(SHEET_FOLLOWUP_NOTIFICATIONS, notifications);
    return {
      success: true,
      canceled,
      errors,
      source,
    };
  });
};

const startFollowupReminderScheduler = () => {
  if (!FOLLOWUP_AUTORUN) return;
  const intervalMs = Math.max(5, FOLLOWUP_AUTORUN_INTERVAL_MINUTES) * 60 * 1000;
  setTimeout(() => {
    void syncFollowupSchedules({ source: 'startup', syncOnly: true }).catch((err) => {
      console.error('Erro na sincronizacao inicial de follow-up:', err);
    });
  }, 30000);
  setInterval(() => {
    void syncFollowupSchedules({ source: 'scheduler', syncOnly: true }).catch((err) => {
      console.error('Erro na sincronizacao agendada de follow-up:', err);
    });
  }, intervalMs);
  console.log(`📣 Follow-up automático habilitado a cada ${Math.max(5, FOLLOWUP_AUTORUN_INTERVAL_MINUTES)} minuto(s).`);
};
const extractMailrelayCampaign = (item) => {
  const id = String(
    pickFirstNonEmpty(item?.id, item?.campaign_id, item?.campaignId, item?.mailing_id, item?.mailingId) || ''
  ).trim();
  const name = String(
    pickFirstNonEmpty(item?.name, item?.title, item?.subject, item?.campaign_name, item?.campaignName) || ''
  ).trim();
  const sentAt = toIsoStringOrEmpty(
    pickFirstNonEmpty(item?.sent_at, item?.sentAt, item?.created_at, item?.createdAt, item?.date, item?.timestamp)
  );
  return { id, name, sent_at: sentAt, raw: item };
};

const extractMailrelayEvent = (item, eventType, campaign) => {
  const email = normalizeEmail(
    pickFirstNonEmpty(
      item?.email,
      item?.email_address,
      item?.subscriber_email,
      item?.subscriberEmail,
      item?.recipient_email,
      item?.recipientEmail,
      item?.to_email,
      item?.to,
      item?.address,
      item?.sent_email,
      item?.sentEmail,
      item?.subscriber?.email,
      item?.subscriber?.email_address,
      item?.recipient?.email,
      item?.contact?.email,
      item?.contact?.email_address,
      item?.subscriber_data?.email,
      item?.data?.email
    )
  );
  const subscriberId = String(
    pickFirstNonEmpty(
      item?.subscriber_id,
      item?.subscriberId,
      item?.subscriber?.id,
      item?.contact_id,
      item?.contact?.id,
      item?.subscriber_data?.id,
      item?.data?.subscriber_id
    ) || ''
  ).trim();
  const sentEmailId = String(
    pickFirstNonEmpty(item?.sent_email_id, item?.sentEmailId, item?.message_id, item?.messageId, item?.email_id, item?.emailId) || ''
  ).trim();
  const eventAt = toIsoStringOrEmpty(
    pickFirstNonEmpty(
      item?.event_at,
      item?.occurred_at,
      item?.timestamp,
      item?.created_at,
      item?.date,
      item?.opened_at,
      item?.clicked_at,
      item?.unsubscribed_at
    )
  ) || new Date().toISOString();

  const campaignId = String(campaign?.id || '').trim();
  const campaignName = String(campaign?.name || '').trim();
  const eventKey = [eventType, campaignId, email, subscriberId, eventAt].join('|');

  return {
    event_key: eventKey,
    subscriber_id: subscriberId,
    sent_email_id: sentEmailId,
    campaign_id: campaignId,
    campaign_name: campaignName,
    event_type: eventType,
    event_at: eventAt,
    email,
    metadata: JSON.stringify(item || {}),
  };
};

const syncMailrelayEngagementIntoLeads = async ({ campaignLimit = 50 } = {}) => {
  const [
    { items: leads },
    { items: emailEvents },
    { items: settingsItems },
  ] = await Promise.all([
    loadTable('leads', true),
    loadTable('email_events', true),
    loadTable('settings', true),
  ]);

  const campaignsPayload = await mailrelayRequest('/sent_campaigns', { limit: campaignLimit });
  const campaigns = extractMailrelayArray(campaignsPayload)
    .map(extractMailrelayCampaign)
    .filter((campaign) => campaign.id)
    .slice(0, campaignLimit);

  const leadByEmail = new Map();
  const leadBySubscriberId = new Map();
  leads.forEach((lead) => {
    const email = normalizeEmail(lead.email);
    if (email && !leadByEmail.has(email)) {
      leadByEmail.set(email, lead);
    }
    const subscriberId = String(lead.mailrelay_subscriber_id || '').trim();
    if (subscriberId && !leadBySubscriberId.has(subscriberId)) {
      leadBySubscriberId.set(subscriberId, lead);
    }
  });

  const existingEventKeys = new Set(emailEvents.map((item) => String(item.event_key || '').trim()).filter(Boolean));
  let eventsProcessed = 0;
  let leadsUpdated = 0;
  let duplicateEventsSkipped = 0;
  let missingIdentitySkipped = 0;
  const touchedLeadIds = new Set();
  const createdEvents = [];
  const nowIso = new Date().toISOString();
  const subscriberCache = new Map();
  const unmatchedEmails = new Set();
  const unmatchedSubscriberIds = new Set();

  const resolveSubscriberEmail = async (subscriberId) => {
    const normalizedId = String(subscriberId || '').trim();
    if (!normalizedId) return '';
    if (subscriberCache.has(normalizedId)) return subscriberCache.get(normalizedId);

    try {
      const payload = await mailrelayRequest(`/subscribers/${normalizedId}`);
      const email = normalizeEmail(
        pickFirstNonEmpty(
          payload?.email,
          payload?.email_address,
          payload?.subscriber?.email,
          payload?.subscriber?.email_address,
          payload?.data?.email
        )
      );
      subscriberCache.set(normalizedId, email);
      return email;
    } catch {
      subscriberCache.set(normalizedId, '');
      return '';
    }
  };

  for (const campaign of campaigns) {
    const [impressionsPayload, clicksPayload, unsubscribesPayload] = await Promise.all([
      mailrelayRequest(`/sent_campaigns/${campaign.id}/impressions`).catch(() => []),
      mailrelayRequest(`/sent_campaigns/${campaign.id}/clicks`).catch(() => []),
      mailrelayRequest(`/sent_campaigns/${campaign.id}/unsubscribe_events`).catch(() => []),
    ]);

    const normalizedEvents = [
      ...extractMailrelayArray(impressionsPayload).map((item) => extractMailrelayEvent(item, 'open', campaign)),
      ...extractMailrelayArray(clicksPayload).map((item) => extractMailrelayEvent(item, 'click', campaign)),
      ...extractMailrelayArray(unsubscribesPayload).map((item) => extractMailrelayEvent(item, 'unsubscribe', campaign)),
    ];

      for (const event of normalizedEvents) {
        let resolvedEmail = event.email;
        if (!resolvedEmail && event.subscriber_id) {
          resolvedEmail = await resolveSubscriberEmail(event.subscriber_id);
          if (resolvedEmail) event.email = resolvedEmail;
        }

        if (!resolvedEmail && !event.subscriber_id) {
          missingIdentitySkipped += 1;
          continue;
        }
        if (existingEventKeys.has(event.event_key)) {
          duplicateEventsSkipped += 1;
          continue;
        }
        existingEventKeys.add(event.event_key);
        eventsProcessed += 1;

        const lead =
          leadByEmail.get(resolvedEmail) ||
          leadBySubscriberId.get(String(event.subscriber_id || '').trim());
        if (!lead) {
          if (resolvedEmail) unmatchedEmails.add(resolvedEmail);
          else if (event.subscriber_id) unmatchedSubscriberIds.add(String(event.subscriber_id));
          continue;
        }

      event.id = nextId([...emailEvents, ...createdEvents]);
      event.lead_id = lead.id;
      event.created_at = nowIso;
      createdEvents.push(event);

        if (event.subscriber_id && !lead.mailrelay_subscriber_id) {
          lead.mailrelay_subscriber_id = event.subscriber_id;
          leadBySubscriberId.set(String(event.subscriber_id), lead);
        }

      const previousEventAt = new Date(lead.last_email_event_at || 0).getTime();
      const currentEventAt = new Date(event.event_at || 0).getTime();
      if (!previousEventAt || currentEventAt >= previousEventAt) {
        lead.last_email_event_at = event.event_at;
        lead.last_email_campaign = event.campaign_name || lead.last_email_campaign || '';
        lead.last_email_campaign_id = event.campaign_id || lead.last_email_campaign_id || '';
      }

      if (event.event_type === 'open') {
        lead.email_open_count = String((Number(lead.email_open_count) || 0) + 1);
        if (!lead.last_email_open_at || currentEventAt >= new Date(lead.last_email_open_at || 0).getTime()) {
          lead.last_email_open_at = event.event_at;
        }
      }

      if (event.event_type === 'click') {
        lead.email_click_count = String((Number(lead.email_click_count) || 0) + 1);
        if (!lead.last_email_click_at || currentEventAt >= new Date(lead.last_email_click_at || 0).getTime()) {
          lead.last_email_click_at = event.event_at;
        }
      }

      if (event.event_type === 'unsubscribe') {
        lead.email_unsubscribed = true;
      }

      lead.updated_at = nowIso;
      if (!touchedLeadIds.has(String(lead.id))) {
        touchedLeadIds.add(String(lead.id));
        leadsUpdated += 1;
      }
    }
  }

  if (createdEvents.length) {
    await saveTable('email_events', [...emailEvents, ...createdEvents]);
  }
  if (touchedLeadIds.size) {
    await saveTable('leads', leads);
  }

  const auditSummary = {
    synced_at: nowIso,
    campaign_limit: campaignLimit,
    campaigns_processed: campaigns.length,
    events_processed: eventsProcessed,
    email_events_created: createdEvents.length,
    leads_updated: leadsUpdated,
    duplicate_events_skipped: duplicateEventsSkipped,
    missing_identity_skipped: missingIdentitySkipped,
    unmatched_leads_count: unmatchedEmails.size + unmatchedSubscriberIds.size,
    unmatched_emails_sample: Array.from(unmatchedEmails).slice(0, 10),
    unmatched_subscriber_ids_sample: Array.from(unmatchedSubscriberIds).slice(0, 10),
  };
  upsertSettingRow(settingsItems, 'mailrelay_last_sync_summary', JSON.stringify(auditSummary), nowIso);
  await saveTable('settings', settingsItems);

  return {
    ...auditSummary,
  };
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

app.get('/api/mailrelay/status', ensureReadyMiddleware, authMiddleware, async (_req, res) => {
  const config = await getMailrelayConfig();
  const [{ items: leads }, { items: emailEvents }, { items: settingsItems }] = await Promise.all([
    loadTable('leads'),
    loadTable('email_events'),
    loadTable('settings'),
  ]);

  const leadsWithMailrelayData = leads.filter((lead) =>
    normalizeEmail(lead.email) &&
    (
      lead.mailrelay_subscriber_id ||
      lead.last_email_open_at ||
      lead.last_email_click_at ||
      Number(lead.email_open_count) > 0 ||
      Number(lead.email_click_count) > 0 ||
      normalizeBool(lead.email_unsubscribed)
    )
  ).length;

  let lastSync = null;
  const lastSyncRaw = getSettingValue(settingsItems, 'mailrelay_last_sync_summary');
  if (lastSyncRaw) {
    try {
      lastSync = JSON.parse(lastSyncRaw);
    } catch {
      lastSync = null;
    }
  }

  return res.json({
    configured: Boolean(config.apiBase && config.apiKey),
    api_base: config.apiBase || '',
    source: config.source,
    leads_with_engagement: leadsWithMailrelayData,
    email_events: emailEvents.length,
    last_sync: lastSync,
  });
});

app.get('/api/email-events', ensureReadyMiddleware, authMiddleware, async (_req, res) => {
  const { items } = await loadTable('email_events');
  const events = items
    .map((item) => ({
      ...item,
      id: item.id || '',
      lead_id: item.lead_id || '',
      subscriber_id: item.subscriber_id || '',
      campaign_id: item.campaign_id || '',
      campaign_name: item.campaign_name || '',
      event_type: item.event_type || '',
      event_at: item.event_at || '',
      email: item.email || '',
      metadata: item.metadata || '',
      created_at: item.created_at || '',
    }))
    .sort((a, b) => new Date(b.event_at || b.created_at || 0).getTime() - new Date(a.event_at || a.created_at || 0).getTime());
  return res.json(events);
});

app.post('/api/mailrelay/sync-engagement', ensureReadyMiddleware, authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  if (!(await isMailrelayConfigured())) {
    return res.status(400).json({ error: 'Mailrelay nao configurado' });
  }

  return withTableLock('settings', async () =>
    withTableLock('email_events', async () =>
      withTableLock('leads', async () => {
      const campaignLimit = Math.max(1, Math.min(100, Number(req.body?.campaignLimit || req.query?.campaignLimit || 50)));
      const summary = await syncMailrelayEngagementIntoLeads({ campaignLimit });
      return res.json({ success: true, ...summary });
      })
    )
  );
});

app.get('/api/settings/mailrelay', ensureReadyMiddleware, authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const config = await getMailrelayConfig();
  return res.json({
    api_base: config.apiBase || '',
    api_key: '',
    configured: Boolean(config.apiBase && config.apiKey),
    source: config.source,
    has_api_key: Boolean(config.apiKey),
  });
});

app.put('/api/settings/mailrelay', ensureReadyMiddleware, authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { api_base = '', api_key = '' } = req.body || {};
  const normalizedBase = String(api_base || '').trim().replace(/\/+$/, '');
  const normalizedKey = String(api_key || '').trim();

  if (!normalizedBase) return res.status(400).json({ error: 'URL da API obrigatoria' });
  if (!normalizedKey) return res.status(400).json({ error: 'Chave da API obrigatoria' });

  return withTableLock('settings', async () => {
    const { items } = await loadTable('settings', true);
    const nowIso = new Date().toISOString();

    upsertSettingRow(items, 'mailrelay_api_base', normalizedBase, nowIso);
    upsertSettingRow(items, 'mailrelay_api_key', normalizedKey, nowIso);
    await saveTable('settings', items);

    return res.json({
      success: true,
      configured: true,
      api_base: normalizedBase,
      source: 'crm',
      has_api_key: true,
    });
  });
});

app.get('/api/settings/omnichat', ensureReadyMiddleware, authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const config = await getOmnichatConfig();
  return res.json({
    api_base: config.apiBase || '',
    api_key: '',
    auth_header: config.authHeader || 'x-api-key',
    enabled: Boolean(config.enabled),
    reminder_minutes: Number(config.reminderMinutes || 30),
    configured: Boolean(config.apiBase && config.apiKey),
    source: config.source,
    has_api_key: Boolean(config.apiKey),
  });
});

app.put('/api/settings/omnichat', ensureReadyMiddleware, authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const {
    api_base = '',
    send_url = '',
    api_key = '',
    auth_header = 'x-api-key',
    enabled = true,
    reminder_minutes = 30,
  } = req.body || {};

  const normalizedUrl = String(api_base || send_url || '').trim().replace(/\/+$/, '');
  const normalizedKey = String(api_key || '').trim();
  const normalizedAuthHeader = String(auth_header || 'x-api-key').trim() || 'x-api-key';
  const normalizedReminderMinutes = Math.max(1, Number(reminder_minutes || 30) || 30);

  if (!normalizedUrl) return res.status(400).json({ error: 'URL do envio obrigatoria' });
  if (!normalizedKey) return res.status(400).json({ error: 'Chave da API obrigatoria' });

  return withTableLock('settings', async () => {
    const { items } = await loadTable('settings', true);
    const nowIso = new Date().toISOString();

    upsertSettingRow(items, 'omnichat_api_base', normalizedUrl, nowIso);
    upsertSettingRow(items, 'omnichat_api_key', normalizedKey, nowIso);
    upsertSettingRow(items, 'omnichat_auth_header', normalizedAuthHeader, nowIso);
    upsertSettingRow(items, 'omnichat_enabled', normalizeBool(enabled) ? 'true' : 'false', nowIso);
    upsertSettingRow(items, 'followup_reminder_minutes', String(normalizedReminderMinutes), nowIso);
    await saveTable('settings', items);

    return res.json({
      success: true,
      configured: true,
      api_base: normalizedUrl,
      send_url: normalizedUrl,
      auth_header: normalizedAuthHeader,
      enabled: normalizeBool(enabled),
      reminder_minutes: normalizedReminderMinutes,
      source: 'crm',
      has_api_key: true,
    });
  });
});

app.get('/api/followups/notifications', ensureReadyMiddleware, authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const { items } = await loadTable(SHEET_FOLLOWUP_NOTIFICATIONS);
  return res.json(items.map(normalizeFollowupNotification));
});

app.post('/api/followups/run', ensureReadyMiddleware, authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });
  const summary = await syncFollowupSchedules({ source: 'manual', syncOnly: false });
  return res.json(summary);
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

app.post('/api/channels/unify-meta', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });

  return withTableLock('channels', async () =>
    withTableLock('leads', async () =>
      withTableLock('budgets', async () =>
        withTableLock('ad_spend', async () => {
          const [
            { items: channels },
            { items: leads },
            { items: budgets },
            { items: adSpendItems },
          ] = await Promise.all([
            loadTable('channels', true),
            loadTable('leads', true),
            loadTable('budgets', true),
            loadTable('ad_spend', true),
          ]);

          const isMetaLike = (value) => {
            const normalized = normalizeName(value);
            return normalized === 'instagram ads' || normalized === 'facebook ads' || normalized === 'meta ads';
          };

          let metaChannel = channels.find((channel) => normalizeName(channel.name) === 'meta ads');
          if (!metaChannel) {
            metaChannel = { id: nextId(channels), name: 'Meta Ads' };
            channels.push(metaChannel);
          }

          const oldChannelIds = channels
            .filter((channel) => isMetaLike(channel.name) && String(channel.id) !== String(metaChannel.id))
            .map((channel) => String(channel.id));

          let leadsUpdated = 0;
          leads.forEach((lead) => {
            const shouldMigrate =
              oldChannelIds.includes(String(lead.channel_id || '')) ||
              isMetaLike(lead.channel_name) ||
              isMetaLike(lead.source);
            if (!shouldMigrate) return;
            lead.channel_id = metaChannel.id;
            lead.channel_name = 'Meta Ads';
            if (!lead.source || isMetaLike(lead.source)) {
              lead.source = 'Meta Ads';
            }
            lead.updated_at = new Date().toISOString();
            leadsUpdated += 1;
          });

          let budgetsUpdated = 0;
          budgets.forEach((budget) => {
            if (!isMetaLike(budget.channel_name)) return;
            budget.channel_name = 'Meta Ads';
            budget.updated_at = new Date().toISOString();
            budgetsUpdated += 1;
          });

          let adSpendUpdated = 0;
          adSpendItems.forEach((entry) => {
            const shouldMigrate =
              oldChannelIds.includes(String(entry.channel_id || '')) ||
              isMetaLike(entry.channel_name) ||
              isMetaLike(entry.platform);
            if (!shouldMigrate) return;
            entry.channel_id = metaChannel.id;
            entry.channel_name = 'Meta Ads';
            entry.platform = 'Meta Ads';
            entry.updated_at = new Date().toISOString();
            adSpendUpdated += 1;
          });

          const dedupedChannels = channels.filter((channel, index, arr) => {
            if (String(channel.id) === String(metaChannel.id)) return true;
            if (!isMetaLike(channel.name)) return true;
            return arr.findIndex((item) => normalizeName(item.name) === normalizeName(channel.name)) === index;
          }).filter((channel) => {
            if (String(channel.id) === String(metaChannel.id)) return true;
            return !isMetaLike(channel.name);
          });

          await Promise.all([
            saveTable('channels', dedupedChannels),
            saveTable('leads', leads),
            saveTable('budgets', budgets),
            saveTable('ad_spend', adSpendItems),
          ]);

          return res.json({
            success: true,
            metaChannel,
            removedChannels: oldChannelIds.length,
            leadsUpdated,
            budgetsUpdated,
            adSpendUpdated,
          });
        })
      )
    )
  );
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

const hydrateLeads = (leads, channels, interactions = [], followups = []) => {
  const interactionSummary = buildLeadInteractionSummaryMap(interactions);
  const followupSummary = buildFollowupNotificationSummaryMap(followups);
  return leads.map((l) => {
    const channel = channels.find((c) => String(c.id) === String(l.channel_id));
    const createdAt = toIsoStringOrEmpty(l.created_at);
    const updatedAt = toIsoStringOrEmpty(l.updated_at || l.created_at);
    const lead = hydrateLeadAutomationState({
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
    });
    const enriched = attachLeadInteractionSummary(lead, interactionSummary.get(String(l.id)) || {});
    const nextContactKey = getFollowupDateKey(enriched.next_contact || '');
    const followup = followupSummary.get(buildFollowupReminderKey(enriched.id, nextContactKey, 'alert'))
      || followupSummary.get(String(enriched.id))
      || null;
    if (!followup) return enriched;
    return {
      ...enriched,
      followup_external_id: followup.external_id || '',
      followup_status: followup.status || '',
      followup_type: followup.type || '',
      followup_scheduled_at: followup.scheduled_at || '',
      followup_scheduled_date_key: followup.scheduled_date_key || '',
      followup_executed_at: followup.executed_at || '',
      followup_conversation_id: followup.conversation_id || '',
      followup_error_msg: followup.error_msg || followup.last_error || '',
    };
  });
};

const normalizeLeadInteraction = (item) => ({
  id: String(item?.id || ''),
  lead_id: String(item?.lead_id || '').trim(),
  interaction_at: toIsoStringOrEmpty(item?.interaction_at || item?.created_at),
  channel: String(item?.channel || '').trim(),
  operator: String(item?.operator || '').trim(),
  notes: String(item?.notes || '').trim(),
  created_at: toIsoStringOrEmpty(item?.created_at || item?.interaction_at),
  updated_at: toIsoStringOrEmpty(item?.updated_at || item?.created_at || item?.interaction_at),
});

const buildLeadInteractionSummaryMap = (interactions = []) => {
  const summary = new Map();

  interactions.forEach((item) => {
    const interaction = normalizeLeadInteraction(item);
    if (!interaction.lead_id) return;

    const current = summary.get(interaction.lead_id) || {
      interactions_count: 0,
      last_interaction_at: '',
      last_interaction_channel: '',
      last_interaction_notes: '',
      last_interaction_operator: '',
      _lastTs: Number.NEGATIVE_INFINITY,
    };

    current.interactions_count += 1;
    const interactionTs = new Date(interaction.interaction_at || interaction.created_at || '').getTime();
    if (Number.isFinite(interactionTs) && interactionTs >= current._lastTs) {
      current._lastTs = interactionTs;
      current.last_interaction_at = interaction.interaction_at || interaction.created_at || '';
      current.last_interaction_channel = interaction.channel || '';
      current.last_interaction_notes = interaction.notes || '';
      current.last_interaction_operator = interaction.operator || '';
    }

    summary.set(interaction.lead_id, current);
  });

  for (const [leadId, item] of summary.entries()) {
    delete item._lastTs;
    summary.set(leadId, item);
  }

  return summary;
};

const attachLeadInteractionSummary = (lead, summary = {}) => ({
  ...lead,
  interactions_count: String(summary.interactions_count || lead.interactions_count || 0),
  last_interaction_at: summary.last_interaction_at || lead.last_interaction_at || '',
  last_interaction_channel: summary.last_interaction_channel || lead.last_interaction_channel || '',
  last_interaction_notes: summary.last_interaction_notes || lead.last_interaction_notes || '',
  last_activity_at: summary.last_interaction_at || lead.last_activity_at || lead.updated_at || lead.created_at || '',
});

const buildLeadInteractionSummaryForLead = (interactions = [], leadId = '') => {
  const normalizedLeadId = String(leadId || '').trim();
  if (!normalizedLeadId) {
    return {
      interactions_count: 0,
      last_interaction_at: '',
      last_interaction_channel: '',
      last_interaction_notes: '',
      last_interaction_operator: '',
    };
  }

  return buildLeadInteractionSummaryMap(
    interactions.filter((item) => String(item?.lead_id || '').trim() === normalizedLeadId)
  ).get(normalizedLeadId) || {
    interactions_count: 0,
    last_interaction_at: '',
    last_interaction_channel: '',
    last_interaction_notes: '',
    last_interaction_operator: '',
  };
};

const recalculateStoredLeadAutomation = (lead, channels, now = new Date()) => {
  const resolvedChannelName = lead.channel_name || resolveChannelName(lead, channels);
  const hydrated = hydrateLeadAutomationState(
    {
      ...lead,
      ownerId: lead.ownerId || lead.user_id || lead.owner_id || '',
      value: parseMoneyValue(lead.value),
      channel_name: resolvedChannelName,
      source: deriveLeadSource({ ...lead, channel_name: resolvedChannelName }, channels),
      created_at: toIsoStringOrEmpty(lead.created_at),
      updated_at: toIsoStringOrEmpty(lead.updated_at || lead.created_at),
      is_private: normalizeBool(lead.is_private),
      is_customer: normalizeBool(lead.is_customer),
      is_out_of_scope: normalizeBool(lead.is_out_of_scope),
    },
    now
  );

  return {
    ...lead,
    ownerId: hydrated.ownerId || '',
    value: parseMoneyValue(hydrated.value),
    channel_name: hydrated.channel_name || '',
    source: hydrated.source || '',
    temperature: hydrated.temperature || '',
    sla_minutes: String(hydrated.sla_minutes || ''),
    sla_due_at: hydrated.sla_due_at || '',
    last_activity_at: hydrated.last_activity_at || '',
    created_at: hydrated.created_at || '',
    updated_at: hydrated.updated_at || '',
    is_private: normalizeBool(hydrated.is_private),
    is_customer: normalizeBool(hydrated.is_customer),
    is_out_of_scope: normalizeBool(hydrated.is_out_of_scope),
  };
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

const MCP_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];

const mcpConstantTimeEqual = (provided, expected) => {
  const left = Buffer.from(String(provided || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  const length = Math.max(left.length, right.length);
  if (length === 0) return false;
  const leftPadded = Buffer.alloc(length);
  const rightPadded = Buffer.alloc(length);
  left.copy(leftPadded);
  right.copy(rightPadded);
  return left.length === right.length && timingSafeEqual(leftPadded, rightPadded);
};

const mcpIsValidToken = (candidate, allowedTokens = [MCP_ACCESS_TOKEN, API_KEY_LEADS]) =>
  allowedTokens.some((token) => token && mcpConstantTimeEqual(candidate, token));

const mcpUnauthorized = (res) =>
  res
    .status(401)
    .set('WWW-Authenticate', 'Bearer realm="crm-mcp", error="invalid_token"')
    .json({ error: 'Unauthorized' });

const mcpResolveAccessToken = (req, { allowPathToken = false } = {}) => {
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (bearer && mcpIsValidToken(bearer)) return bearer;

  const apiKey = String(req.headers['x-api-key'] || '').trim();
  if (apiKey && mcpIsValidToken(apiKey)) return apiKey;

  if (!allowPathToken) return '';
  const pathToken = String(req.params.token || '').trim();
  if (pathToken && mcpConstantTimeEqual(pathToken, MCP_ACCESS_TOKEN)) return pathToken;
  return '';
};

const mcpAuthMiddleware = (req, res, next) => {
  const token = mcpResolveAccessToken(req, { allowPathToken: false });
  if (!token) return mcpUnauthorized(res);
  req.user = { id: 'mcp', name: 'MCP', username: 'mcp', role: 'admin' };
  req.mcpAccessToken = token;
  return next();
};

const mcpPathTokenMiddleware = (req, res, next) => {
  const token = mcpResolveAccessToken(req, { allowPathToken: true });
  if (!token) return mcpUnauthorized(res);
  req.user = { id: 'mcp', name: 'MCP', username: 'mcp', role: 'admin' };
  req.mcpAccessToken = token;
  return next();
};

const mcpRateLimitMiddleware = (req, res, next) => {
  const key = String(req.mcpAccessToken || '').trim();
  if (!key) return next();

  const now = Date.now();
  const current = mcpRateState.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + MCP_RATE_LIMIT_WINDOW_MS }
    : current;

  bucket.count += 1;
  mcpRateState.set(key, bucket);

  if (bucket.count > MCP_RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return res
      .status(429)
      .set('Retry-After', String(retryAfter))
      .json({ error: 'Too Many Requests' });
  }

  return next();
};

const mcpParseCursor = (cursor) => {
  if (!cursor) return 1;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    const page = Number(parsed?.page || 1);
    return Number.isFinite(page) && page > 0 ? page : 1;
  } catch {
    const page = Number(cursor);
    return Number.isFinite(page) && page > 0 ? page : 1;
  }
};

const mcpMakeCursor = (page) => Buffer.from(JSON.stringify({ page }), 'utf8').toString('base64url');

const mcpToListResponse = (items, { page, limit, total, filtersApplied, aggregates = null, dateField = 'updated_at' }) => {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasNext = page < totalPages;
  return {
    data: items,
    meta: {
      total,
      returned: items.length,
      has_more: hasNext,
      next_cursor: hasNext ? mcpMakeCursor(page + 1) : null,
      truncated: total > items.length,
      filters_applied: filtersApplied,
      generated_at: new Date().toISOString(),
      timezone: MCP_TIMEZONE,
      source: 'crm-bhs',
      schema_version: MCP_SCHEMA_VERSION,
      date_field: dateField,
      ...(aggregates ? { aggregates } : {}),
    },
  };
};

const mcpNormalizeLead = (lead) => ({
  id: String(lead.id || ''),
  cnpj: null,
  cpf: null,
  documento_raw: null,
  created_at: toIsoStringOrEmpty(lead.created_at),
  updated_at: toIsoStringOrEmpty(lead.updated_at || lead.created_at),
  name: lead.name || '',
  company: lead.company || '',
  razao_social: lead.company || '',
  nome_fantasia: lead.company || '',
  cidade: null,
  uf: null,
  email: lead.email || '',
  phone: lead.phone || '',
  source: lead.source || '',
  campaign: lead.campaign || '',
  channel: lead.channel_name || '',
  status: lead.status || '',
  temperature: lead.temperature || '',
  sla_status: lead.sla_status || '',
  sla_due_at: lead.sla_due_at || '',
  last_activity_at: lead.last_activity_at || '',
  owner_id: String(lead.ownerId || ''),
  owner: lead.owner || '',
  value: parseMoneyValue(lead.value),
  segment: lead.segment || '',
  region: lead.region || '',
  is_customer: normalizeBool(lead.is_customer),
  is_private: normalizeBool(lead.is_private),
  is_out_of_scope: normalizeBool(lead.is_out_of_scope),
  deleted_at: lead.deleted_at || '',
});

const mcpNormalizeBudget = (budget) => ({
  id: String(budget.id || ''),
  numero: String(budget.external_id || budget.id || ''),
  numero_erp: String(budget.customer_order || budget.external_id || ''),
  cnpj_cliente: null,
  cpf: null,
  documento_raw: null,
  razao_social: budget.company || budget.client_name || '',
  client_name: budget.client_name || '',
  company: budget.company || '',
  data_emissao: toIsoStringOrEmpty(budget.requested_at || budget.created_at),
  data_validade: '',
  data_ultima_interacao: toIsoStringOrEmpty(budget.updated_at || budget.sent_at || budget.created_at),
  updated_at: toIsoStringOrEmpty(budget.updated_at || budget.created_at),
  valor_total: parseMoneyValue(budget.budget_value),
  status: budget.status || '',
  status_raw: budget.raw_status || budget.status || '',
  motivo_perda: budget.loss_reason || budget.raw_loss_reason || '',
  responsavel: budget.owner_name || budget.estimator_name || '',
  owner_id: String(budget.owner_id || budget.estimator_id || ''),
  canal: budget.channel_name || '',
  qtd_itens: 0,
  itens: [],
  deleted_at: '',
  notes: budget.notes || '',
});

const mcpNormalizeEmailEvent = (event) => ({
  id: String(event.id || ''),
  lead_id: String(event.lead_id || ''),
  campaign_name: event.campaign_name || '',
  event_type: event.event_type || '',
  event_at: event.event_at || event.created_at || '',
  email: event.email || '',
  metadata: event.metadata || '',
});

const mcpFilterBudgets = (budgets, query) => {
  const dateField = String(query.date_field || 'ultima_interacao');
  const dateFrom = query.date_from ? new Date(query.date_from) : null;
  const dateTo = query.date_to ? new Date(query.date_to) : null;
  if (dateTo) dateTo.setUTCHours(23, 59, 59, 999);
  const updatedSince = query.updated_since ? new Date(query.updated_since) : null;
  const withoutInteractionSince = query.sem_interacao_desde ? new Date(query.sem_interacao_desde) : null;
  const statusFilter = normalizeListParam(query.status);
  const q = String(query.q || '').trim().toLowerCase();
  const ownerId = String(query.ownerId || '').trim();
  const responsavel = String(query.responsavel || '').trim().toLowerCase();
  const channel = String(query.channel || '').trim().toLowerCase();

  const filtered = budgets.filter((budget) => {
    const refMap = {
      emissao: budget.data_emissao,
      validade: budget.data_validade,
      ultima_interacao: budget.data_ultima_interacao,
      atualizacao: budget.updated_at,
    };
    const refDate = new Date(refMap[dateField] || budget.data_ultima_interacao || budget.updated_at || budget.data_emissao || '');
    if (dateFrom && refDate < dateFrom) return false;
    if (dateTo && refDate > dateTo) return false;
    if (statusFilter.length && !statusFilter.includes(normalizeName(budget.status))) return false;
    if (ownerId && String(budget.owner_id || '') !== ownerId) return false;
    if (responsavel && !normalizeName(budget.responsavel).includes(normalizeName(responsavel))) return false;
    if (channel && !normalizeName(budget.canal).includes(normalizeName(channel))) return false;
    if (updatedSince && new Date(budget.updated_at || '') < updatedSince) return false;
    if (withoutInteractionSince) {
      const lastInteraction = new Date(budget.data_ultima_interacao || budget.updated_at || budget.data_emissao || '');
      if (Number.isNaN(lastInteraction.getTime()) || lastInteraction > withoutInteractionSince) return false;
    }
    if (q) {
      const hay = [
        budget.numero,
        budget.numero_erp,
        budget.razao_social,
        budget.client_name,
        budget.company,
        budget.responsavel,
        budget.canal,
        budget.status_raw,
        budget.motivo_perda,
        budget.notes,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorted = filtered.sort((a, b) => {
    const dateDiff = new Date(b[dateField] || b.data_ultima_interacao || b.updated_at || b.data_emissao || 0).getTime() -
      new Date(a[dateField] || a.data_ultima_interacao || a.updated_at || a.data_emissao || 0).getTime();
    if (dateDiff !== 0) return dateDiff;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });

  return {
    items: sorted,
    filtersApplied: {
      date_from: query.date_from || null,
      date_to: query.date_to || null,
      date_field: dateField,
      status: statusFilter,
      ownerId: ownerId || null,
      responsavel: responsavel || null,
      channel: channel || null,
      sem_interacao_desde: query.sem_interacao_desde || null,
      updated_since: query.updated_since || null,
      q: q || null,
    },
  };
};

const mcpFilterEmailEvents = (events, query) => {
  const period = String(query.period || '30d');
  const eventType = String(query.eventType || 'all');
  const campaign = String(query.campaign || '').trim().toLowerCase();
  const leadId = String(query.leadId || '').trim();
  const q = String(query.q || '').trim().toLowerCase();
  const limitMap = { '7d': 7, '30d': 30, '90d': 90, '6m': 183, '12m': 365, all: null };
  const days = limitMap[period] ?? 30;
  const threshold = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;

  const filtered = events.filter((event) => {
    const eventAt = new Date(event.event_at || event.created_at || 0).getTime();
    if (threshold && eventAt < threshold) return false;
    if (eventType !== 'all' && normalizeName(event.event_type) !== normalizeName(eventType)) return false;
    if (campaign && !normalizeName(event.campaign_name).includes(normalizeName(campaign))) return false;
    if (leadId && String(event.lead_id || '') !== leadId) return false;
    if (q) {
      const hay = [event.email, event.campaign_name, event.event_type, event.metadata].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorted = filtered.sort((a, b) => new Date(b.event_at || b.created_at || 0).getTime() - new Date(a.event_at || a.created_at || 0).getTime());
  return {
    items: sorted,
    filtersApplied: {
      period,
      eventType,
      campaign: campaign || null,
      leadId: leadId || null,
      q: q || null,
    },
  };
};

const MCP_TOOLS = [
  {
    name: 'search_leads',
    description: 'Busca leads com paginação e filtros.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string' },
        ownerId: { type: 'string' },
        status: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        campaign: { type: 'string' },
        channel: { type: 'string' },
        created_from: { type: 'string' },
        created_to: { type: 'string' },
        updated_from: { type: 'string' },
        updated_to: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        cursor: { type: 'string' },
      },
    },
  },
  { name: 'get_lead', inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'list_budgets',
    description: 'Lista orçamentos com filtros e agregações.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        date_from: { type: 'string' },
        date_to: { type: 'string' },
        date_field: { type: 'string', enum: ['emissao', 'validade', 'ultima_interacao', 'atualizacao'], default: 'ultima_interacao' },
        status: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        ownerId: { type: 'string' },
        responsavel: { type: 'string' },
        channel: { type: 'string' },
        sem_interacao_desde: { type: 'string' },
        updated_since: { type: 'string' },
        q: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        cursor: { type: 'string' },
      },
    },
  },
  { name: 'get_budget', inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'list_email_events',
    description: 'Lista eventos de e-mail do Mailrelay que o CRM já armazena.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        period: { type: 'string', enum: ['7d', '30d', '90d', '6m', '12m', 'all'], default: '30d' },
        eventType: { type: 'string', enum: ['open', 'click', 'unsubscribe', 'all'], default: 'all' },
        campaign: { type: 'string' },
        leadId: { type: 'string' },
        q: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
        cursor: { type: 'string' },
      },
    },
  },
  { name: 'get_crm_summary', inputSchema: { type: 'object', additionalProperties: false, properties: { scope: { type: 'string', enum: ['all', 'mine'], default: 'all' } } } },
];

const mcpReadJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : null;
};

const mcpHandleTool = async (name, args = {}, user = { id: 'mcp', role: 'admin', name: 'MCP' }) => {
  if (name === 'search_leads') {
    const [{ items: leads }, { items: channels }] = await Promise.all([
      loadTable(SHEET_LEADS, true),
      loadTable(SHEET_CHANNELS, true),
    ]);
    const visible = filterLeadsByUser(hydrateLeads(leads, channels), user, args);
    const filtered = applyLeadFilters(visible, args);
    const page = mcpParseCursor(args.cursor);
    const limit = Math.max(1, Math.min(500, Number.parseInt(args.limit, 10) || 100));
    const paginated = paginateLeads(filtered, { page, limit });
    const items = (paginated?.items || filtered).slice(0, limit).map(mcpNormalizeLead);
    return mcpToListResponse(items, {
      page,
      limit,
      total: filtered.length,
      filtersApplied: {
        q: args.q || null,
        ownerId: args.ownerId || null,
        status: normalizeListParam(args.status),
        campaign: args.campaign || null,
        channel: args.channel || null,
        created_from: args.created_from || null,
        created_to: args.created_to || null,
        updated_from: args.updated_from || null,
        updated_to: args.updated_to || null,
      },
    });
  }

  if (name === 'get_lead') {
    const [{ items: leads }, { items: channels }] = await Promise.all([
      loadTable(SHEET_LEADS, true),
      loadTable(SHEET_CHANNELS, true),
    ]);
    const visible = filterLeadsByUser(hydrateLeads(leads, channels), user, {});
    const lead = visible.find((item) => String(item.id) === String(args.id));
    if (!lead) throw Object.assign(new Error('Lead nao encontrado'), { status: 404 });
    return mcpNormalizeLead(lead);
  }

  if (name === 'list_budgets') {
    const { items: budgets } = await loadTable(SHEET_BUDGETS, true);
    const normalized = hydrateBudgets(budgets).map(mcpNormalizeBudget);
    const { items, filtersApplied } = mcpFilterBudgets(normalized, args);
    const page = mcpParseCursor(args.cursor);
    const limit = Math.max(1, Math.min(500, Number.parseInt(args.limit, 10) || 100));
    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);
    const aggregates = {
      count: items.length,
      valor_total_soma: items.reduce((acc, item) => acc + Number(item.valor_total || 0), 0),
      valor_medio: items.length ? items.reduce((acc, item) => acc + Number(item.valor_total || 0), 0) / items.length : 0,
      valor_maior: items.length ? Math.max(...items.map((item) => Number(item.valor_total || 0))) : 0,
    };
    return mcpToListResponse(pageItems, {
      page,
      limit,
      total: items.length,
      filtersApplied,
      aggregates,
      dateField: args.date_field || 'ultima_interacao',
    });
  }

  if (name === 'get_budget') {
    const { items: budgets } = await loadTable(SHEET_BUDGETS, true);
    const budget = hydrateBudgets(budgets).map(mcpNormalizeBudget).find((item) => String(item.id) === String(args.id));
    if (!budget) throw Object.assign(new Error('Orcamento nao encontrado'), { status: 404 });
    return budget;
  }

  if (name === 'list_email_events') {
    const { items: events } = await loadTable(SHEET_EMAIL_EVENTS, true);
    const normalized = events
      .map(mcpNormalizeEmailEvent)
      .sort((a, b) => new Date(b.event_at || b.created_at || 0).getTime() - new Date(a.event_at || a.created_at || 0).getTime());
    const { items, filtersApplied } = mcpFilterEmailEvents(normalized, args);
    const page = mcpParseCursor(args.cursor);
    const limit = Math.max(1, Math.min(500, Number.parseInt(args.limit, 10) || 100));
    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);
    return mcpToListResponse(pageItems, {
      page,
      limit,
      total: items.length,
      filtersApplied,
      dateField: 'event_at',
    });
  }

  if (name === 'get_crm_summary') {
    const [{ items: leads }, { items: channels }, { items: budgets }, { items: events }] = await Promise.all([
      loadTable(SHEET_LEADS, true),
      loadTable(SHEET_CHANNELS, true),
      loadTable(SHEET_BUDGETS, true),
      loadTable(SHEET_EMAIL_EVENTS, true),
    ]);
    const visibleLeads = filterLeadsByUser(hydrateLeads(leads, channels), user, {});
    const visibleBudgets = hydrateBudgets(budgets);
    const normalizedEvents = events.map(mcpNormalizeEmailEvent);
    const stats = visibleLeads.reduce(
      (acc, lead) => {
        const status = normalizeName(lead.status);
        if (status === 'ganho') acc.ganhos += 1;
        if (status === 'perdido') acc.perdidos += 1;
        if (status === 'novo') acc.novos += 1;
        acc.total += 1;
        acc.valor_total += Number(lead.value || 0);
        return acc;
      },
      { total: 0, ganhos: 0, perdidos: 0, novos: 0, valor_total: 0 }
    );
    return {
      scope: args.scope === 'mine' ? 'mine' : 'all',
      totals: {
        leads: visibleLeads.length,
        budgets: visibleBudgets.length,
        email_events: normalizedEvents.length,
      },
      stats,
      budgets_aggregates: {
        count: visibleBudgets.length,
        valor_total_soma: visibleBudgets.reduce((acc, item) => acc + parseMoneyValue(item.budget_value), 0),
        valor_medio: visibleBudgets.length ? visibleBudgets.reduce((acc, item) => acc + parseMoneyValue(item.budget_value), 0) / visibleBudgets.length : 0,
        valor_maior: visibleBudgets.length ? Math.max(...visibleBudgets.map((item) => parseMoneyValue(item.budget_value))) : 0,
      },
      integrations: {
        mailrelay_available: Boolean(normalizedEvents.length),
      },
    };
  }

  throw Object.assign(new Error(`Unknown tool: ${name}`), { status: 404 });
};

const mcpHandleRpcRequest = async (req, res) => {
  const message = req.body && typeof req.body === 'object' ? req.body : await mcpReadJson(req).catch(() => null);
  if (!message || typeof message !== 'object') {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON body' } });
  }

  const { id, method, params } = message;
  try {
    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSIONS[0],
          serverInfo: { name: MCP_SERVER_NAME, version: '1.0.0' },
          capabilities: { tools: { listChanged: false } },
        },
      });
    }

    if (method === 'initialized') {
      return res.status(204).end();
    }

    if (method === 'ping') {
      return res.json({ jsonrpc: '2.0', id, result: {} });
    }

    if (method === 'tools/list') {
      return res.json({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const result = await mcpHandleTool(toolName, toolArgs, req.user);
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      });
    }

    return res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unsupported method: ${method}` },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      jsonrpc: '2.0',
      id,
      error: {
        code: error.status === 404 ? -32601 : -32000,
        message: error.message || 'Internal error',
      },
    });
  }
};

const mcpHandleInfoRequest = (_req, res) =>
  res.json({
    ok: true,
    name: MCP_SERVER_NAME,
    transport: 'streamable-http',
    endpoint: '/api/mcp',
    schema_version: MCP_SCHEMA_VERSION,
    health: '/api/mcp/healthz',
  });

const mcpHandleTokenEndpoint = async (req, res) => {
  if (req.method === 'GET') return mcpHandleInfoRequest(req, res);
  if (req.method === 'POST') return mcpHandleRpcRequest(req, res);
  return res.status(405).set('Allow', 'GET, POST').json({ error: 'Method Not Allowed' });
};

app.get('/api/mcp', mcpHandleInfoRequest);
app.get('/api/mcp/healthz', (_req, res) => {
  return res.json({
    ok: true,
    name: MCP_SERVER_NAME,
    uptime: process.uptime(),
    at: new Date().toISOString(),
  });
});

app.all(['/api/mcp/k', '/api/mcp/k/'], mcpAuthMiddleware, mcpRateLimitMiddleware, mcpHandleTokenEndpoint);
app.all('/api/mcp/k/:token', mcpPathTokenMiddleware, mcpRateLimitMiddleware, mcpHandleTokenEndpoint);
app.post('/api/mcp', mcpAuthMiddleware, mcpRateLimitMiddleware, mcpHandleRpcRequest);
app.post('/api/mcp/k/:token', mcpPathTokenMiddleware, mcpRateLimitMiddleware, mcpHandleRpcRequest);

app.get('/api/leads', apiKeyLeadsMiddleware, async (req, res) => {
  const [{ items: leads }, { items: channels }, { items: interactions }, { items: followups }] = await Promise.all([
    loadTable(SHEET_LEADS),
    loadTable(SHEET_CHANNELS),
    loadTable(SHEET_LEAD_INTERACTIONS),
    loadTable(SHEET_FOLLOWUP_NOTIFICATIONS),
  ]);
  const visible = filterLeadsByUser(hydrateLeads(leads, channels, interactions, followups), req.user, req.query);
  const filtered = applyLeadFilters(visible, req.query);
  const paginated = paginateLeads(filtered, req.query);
  return res.json(paginated || filtered);
});

app.get('/api/leads/:id', apiKeyLeadsMiddleware, async (req, res) => {
  const [{ items: leads }, { items: channels }, { items: interactions }, { items: followups }] = await Promise.all([
    loadTable('leads'),
    loadTable('channels'),
    loadTable(SHEET_LEAD_INTERACTIONS),
    loadTable(SHEET_FOLLOWUP_NOTIFICATIONS),
  ]);
  const filtered = filterLeadsByUser(hydrateLeads(leads, channels, interactions, followups), req.user, req.query);
  const lead = filtered.find((l) => String(l.id) === String(req.params.id));
  if (!lead) {
    return res.status(404).json({ error: 'Lead nao encontrado' });
  }
  return res.json(lead);
});

app.get('/api/leads/:id/interactions', apiKeyLeadsMiddleware, async (req, res) => {
  const leadId = String(req.params.id || '').trim();
  const { items } = await loadTable(SHEET_LEAD_INTERACTIONS, true);
  const interactions = items
    .map(normalizeLeadInteraction)
    .filter((item) => item.lead_id === leadId)
    .sort((a, b) => new Date(b.interaction_at || b.created_at || 0).getTime() - new Date(a.interaction_at || a.created_at || 0).getTime());
  return res.json({
    lead_id: leadId,
    total: interactions.length,
    items: interactions,
  });
});

app.post('/api/leads/:id/interactions', authMiddleware, async (req, res) => {
  const leadId = String(req.params.id || '').trim();
  const channel = String(req.body?.channel || '').trim();
  const notes = String(req.body?.notes || '').trim();
  const interactionAt = toIsoStringOrEmpty(req.body?.interaction_at) || new Date().toISOString();

  if (!leadId) return res.status(400).json({ error: 'Lead obrigatorio' });
  if (!channel) return res.status(400).json({ error: 'Canal obrigatorio' });

  return withTableLock('lead_interactions', async () => {
    const [
      { items: interactions },
      { items: leads },
      { items: channels },
    ] = await Promise.all([
      loadTable(SHEET_LEAD_INTERACTIONS, true),
      loadTable('leads', true),
      loadTable('channels'),
    ]);

    const idx = leads.findIndex((lead) => String(lead.id) === leadId);
    if (idx === -1) return res.status(404).json({ error: 'Lead nao encontrado' });

    const nowIso = new Date().toISOString();
    const interaction = {
      id: nextId(interactions),
      lead_id: leadId,
      interaction_at: interactionAt,
      channel,
      operator: req.user?.name || req.user?.username || '',
      notes,
      created_at: nowIso,
      updated_at: nowIso,
    };

    interactions.push(interaction);
    await saveTable(SHEET_LEAD_INTERACTIONS, interactions);

    const currentLead = { ...leads[idx] };
    const nextCount = (Number(currentLead.interactions_count) || 0) + 1;
    currentLead.interactions_count = String(nextCount);
    currentLead.last_interaction_at = interactionAt;
    currentLead.last_interaction_channel = channel;
    currentLead.last_interaction_notes = notes;
    currentLead.last_activity_at = interactionAt;
    currentLead.updated_at = nowIso;
    leads[idx] = currentLead;
    await saveTable('leads', leads);

    const [hydratedLead] = hydrateLeads([currentLead], channels, interactions);
    return res.json({
      success: true,
      interaction: normalizeLeadInteraction(interaction),
      lead: hydratedLead,
    });
  });
});

app.put('/api/leads/:id/interactions/:interactionId', authMiddleware, async (req, res) => {
  const leadId = String(req.params.id || '').trim();
  const interactionId = String(req.params.interactionId || '').trim();
  const channel = String(req.body?.channel || '').trim();
  const notes = String(req.body?.notes || '').trim();
  const interactionAt = toIsoStringOrEmpty(req.body?.interaction_at) || new Date().toISOString();

  if (!leadId) return res.status(400).json({ error: 'Lead obrigatorio' });
  if (!interactionId) return res.status(400).json({ error: 'Interacao obrigatoria' });
  if (!channel) return res.status(400).json({ error: 'Canal obrigatorio' });

  return withTableLock('lead_interactions', async () => {
    const [
      { items: interactions },
      { items: leads },
      { items: channels },
    ] = await Promise.all([
      loadTable(SHEET_LEAD_INTERACTIONS, true),
      loadTable('leads', true),
      loadTable('channels'),
    ]);

    const interactionIdx = interactions.findIndex(
      (item) => String(item.id) === interactionId && String(item.lead_id) === leadId
    );
    if (interactionIdx === -1) {
      return res.status(404).json({ error: 'Interacao nao encontrada' });
    }

    const nowIso = new Date().toISOString();
    interactions[interactionIdx] = {
      ...interactions[interactionIdx],
      interaction_at: interactionAt,
      channel,
      notes,
      updated_at: nowIso,
    };

    const leadIdx = leads.findIndex((lead) => String(lead.id) === leadId);
    if (leadIdx === -1) return res.status(404).json({ error: 'Lead nao encontrado' });

    const summary = buildLeadInteractionSummaryForLead(interactions, leadId);
    leads[leadIdx] = {
      ...leads[leadIdx],
      interactions_count: String(summary.interactions_count || 0),
      last_interaction_at: summary.last_interaction_at || '',
      last_interaction_channel: summary.last_interaction_channel || '',
      last_interaction_notes: summary.last_interaction_notes || '',
      last_activity_at: summary.last_interaction_at || leads[leadIdx].last_activity_at || leads[leadIdx].updated_at || leads[leadIdx].created_at || '',
      updated_at: nowIso,
    };

    await saveTable(SHEET_LEAD_INTERACTIONS, interactions);
    await saveTable('leads', leads);

    const [hydratedLead] = hydrateLeads([leads[leadIdx]], channels, interactions);
    return res.json({
      success: true,
      interaction: normalizeLeadInteraction(interactions[interactionIdx]),
      lead: hydratedLead,
    });
  });
});

app.delete('/api/leads/:id/interactions/:interactionId', authMiddleware, async (req, res) => {
  const leadId = String(req.params.id || '').trim();
  const interactionId = String(req.params.interactionId || '').trim();

  if (!leadId) return res.status(400).json({ error: 'Lead obrigatorio' });
  if (!interactionId) return res.status(400).json({ error: 'Interacao obrigatoria' });

  return withTableLock('lead_interactions', async () => {
    const [
      { items: interactions },
      { items: leads },
      { items: channels },
    ] = await Promise.all([
      loadTable(SHEET_LEAD_INTERACTIONS, true),
      loadTable('leads', true),
      loadTable('channels'),
    ]);

    const interactionIdx = interactions.findIndex(
      (item) => String(item.id) === interactionId && String(item.lead_id) === leadId
    );
    if (interactionIdx === -1) {
      return res.status(404).json({ error: 'Interacao nao encontrada' });
    }

    interactions.splice(interactionIdx, 1);

    const leadIdx = leads.findIndex((lead) => String(lead.id) === leadId);
    if (leadIdx === -1) return res.status(404).json({ error: 'Lead nao encontrado' });

    const summary = buildLeadInteractionSummaryForLead(interactions, leadId);
    const nowIso = new Date().toISOString();
    leads[leadIdx] = {
      ...leads[leadIdx],
      interactions_count: String(summary.interactions_count || 0),
      last_interaction_at: summary.last_interaction_at || '',
      last_interaction_channel: summary.last_interaction_channel || '',
      last_interaction_notes: summary.last_interaction_notes || '',
      last_activity_at: summary.last_interaction_at || leads[leadIdx].last_activity_at || leads[leadIdx].updated_at || leads[leadIdx].created_at || '',
      updated_at: nowIso,
    };

    await saveTable(SHEET_LEAD_INTERACTIONS, interactions);
    await saveTable('leads', leads);

    const [hydratedLead] = hydrateLeads([leads[leadIdx]], channels, interactions);
    return res.json({
      success: true,
      lead: hydratedLead,
    });
  });
});

app.post('/api/leads/recalculate-automation', authMiddleware, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Apenas admin' });

  return withTableLock('leads', async () => {
    const [{ items: leads }, { items: channels }] = await Promise.all([
      loadTable('leads', true),
      loadTable('channels'),
    ]);

    const now = new Date();
    let changed = 0;

    const recalculated = leads.map((lead) => {
      const nextLead = recalculateStoredLeadAutomation(lead, channels, now);
      const before = JSON.stringify({
        channel_name: lead.channel_name || '',
        source: lead.source || '',
        temperature: lead.temperature || '',
        sla_minutes: String(lead.sla_minutes || ''),
        sla_due_at: lead.sla_due_at || '',
        last_activity_at: lead.last_activity_at || '',
      });
      const after = JSON.stringify({
        channel_name: nextLead.channel_name || '',
        source: nextLead.source || '',
        temperature: nextLead.temperature || '',
        sla_minutes: String(nextLead.sla_minutes || ''),
        sla_due_at: nextLead.sla_due_at || '',
        last_activity_at: nextLead.last_activity_at || '',
      });
      if (before !== after) changed += 1;
      return nextLead;
    });

    await saveTable('leads', recalculated);
    return res.json({
      success: true,
      total: leads.length,
      changed,
    });
  });
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
    const [{ items: leads }, { items: users }, { items: channels }] = await Promise.all([
      loadTable('leads', true), // ignora cache para inserção
      loadTable('users'),      // cache ok para usuários
      loadTable('channels'),
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
    const channelName = req.body.channel_name || resolveChannelName({ channel_id }, channels) || '';
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
      source: req.body.source || deriveLeadSource({ channel_id, channel_name: channelName, campaign }, channels),
      interactions_count: '0',
      last_interaction_at: '',
      last_interaction_channel: '',
      last_interaction_notes: '',
      created_at: now,
      updated_at: now,
      is_private: normalizeBool(is_private),
      is_customer: normalizeBool(is_customer),
      is_out_of_scope: normalizeBool(is_out_of_scope),
      highlighted_categories: highlighted_categories || '',
      customer_type: customer_type || '',
      cooling_reason: cooling_reason || '',
    };
    applyLeadAutomationOnWrite(lead, { nowIso: now, isCreate: true });
    leads.push(lead);
    await saveTable('leads', leads);
    const followupSync = await syncFollowupSchedules({ source: 'lead-create', leadId: lead.id });
    const [
      { items: leadsAfter },
      { items: channelsAfter },
      { items: interactionsAfter },
      { items: followupsAfter },
    ] = await Promise.all([
      loadTable('leads', true),
      loadTable('channels'),
      loadTable(SHEET_LEAD_INTERACTIONS),
      loadTable(SHEET_FOLLOWUP_NOTIFICATIONS),
    ]);
    const hydrated = hydrateLeads(leadsAfter, channelsAfter, interactionsAfter, followupsAfter);
    const [hydratedLead] = hydrated.filter((item) => String(item.id) === String(lead.id));
    return res.json({
      ...(hydratedLead || lead),
      followup_sync: followupSync,
    });
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
    const [{ items: leads }, { items: users }, { items: channels }] = await Promise.all([
      loadTable('leads', true), // ignora cache
      loadTable('users'),
      loadTable('channels'),
    ]);
    const idx = leads.findIndex((l) => String(l.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Lead nao encontrado' });
    const previousLead = { ...leads[idx] };

    const leadOwnerId = leads[idx].ownerId || leads[idx].user_id || leads[idx].owner_id || '';
    const ownerMatchId = String(leadOwnerId) === String(req.user.id);
    const ownerNames = [req.user.name, req.user.username]
      .filter(Boolean)
      .map((val) => normalizeName(val));
    const ownerNormalized = normalizeName(leads[idx].owner || leads[idx].responsible_name);
    const ownerMatchName = ownerNames.some((name) => name && ownerNormalized === name);
    const isOwner = ownerMatchId || ownerMatchName;

    const hasOtherChanges = (() => {
      const current = previousLead;
      if (name !== undefined && String(name) !== String(current.name || '')) return true;
      if (email !== undefined && String(email || '') !== String(current.email || '')) return true;
      if (phone !== undefined && String(phone || '') !== String(current.phone || '')) return true;
      if (phone2 !== undefined && String(phone2 || '') !== String(current.phone2 || '')) return true;
      if (status !== undefined && String(status || '') !== String(current.status || '')) return true;
      if (ownerId !== undefined && String(ownerId || '') !== String(current.ownerId || current.user_id || current.owner_id || '')) {
        return true;
      }
      if (owner !== undefined && String(owner || '') !== String(current.owner || current.responsible_name || '')) {
        return true;
      }
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

    const channelIdChanged =
      channel_id !== undefined && String(channel_id || '') !== String(previousLead.channel_id || '');
    const channelNameChanged =
      channel_name !== undefined && String(channel_name || '') !== String(previousLead.channel_name || '');
    const campaignChanged =
      campaign !== undefined && String(campaign || '') !== String(previousLead.campaign || '');

    if (name) leads[idx].name = name;
    if (company !== undefined) leads[idx].company = company;
    if (segment !== undefined) leads[idx].segment = segment;
    if (email) leads[idx].email = email;
    if (phone) leads[idx].phone = phone;
    if (phone2 !== undefined) leads[idx].phone2 = phone2;
    if (status) leads[idx].status = status;
    if (campaign !== undefined) leads[idx].campaign = campaign;
    if (channel_id !== undefined) leads[idx].channel_id = channel_id;
    if (channel_name !== undefined) {
      leads[idx].channel_name = channel_name || resolveChannelName({ channel_id: leads[idx].channel_id }, channels);
    } else if (channelIdChanged) {
      leads[idx].channel_name = resolveChannelName({ channel_id: leads[idx].channel_id }, channels);
    }
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

    if (source === undefined && (channelIdChanged || channelNameChanged || campaignChanged || !leads[idx].source)) {
      leads[idx].source = deriveLeadSource(leads[idx], channels);
    }
    const nowIso = new Date().toISOString();
    leads[idx].updated_at = nowIso;
    applyLeadAutomationOnWrite(leads[idx], {
      nowIso,
      previousLead,
      manualTouch: hasOtherChanges,
    });

    await saveTable('leads', leads);
    const followupSync = await syncFollowupSchedules({ source: 'lead-update', leadId: req.params.id });
    const [
      { items: leadsAfter },
      { items: channelsAfter },
      { items: interactionsAfter },
      { items: followupsAfter },
    ] = await Promise.all([
      loadTable('leads', true),
      loadTable('channels'),
      loadTable(SHEET_LEAD_INTERACTIONS),
      loadTable(SHEET_FOLLOWUP_NOTIFICATIONS),
    ]);
    const hydrated = hydrateLeads(leadsAfter, channelsAfter, interactionsAfter, followupsAfter);
    const [hydratedLead] = hydrated.filter((item) => String(item.id) === String(req.params.id));
    return res.json({
      ...(hydratedLead || leads[idx]),
      followup_sync: followupSync,
    });
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

    const followupCancel = await cancelFollowupTasksForLead(lead, { source: 'lead-delete' });
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
    return res.json({ success: true, removed: leads.length - afterSave.length, followup_cancel: followupCancel });
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
    if (budget.lead_id) {
      await updateLeadFromBudgetEvent(budget.lead_id, budget.status);
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
    if (budgets[idx].lead_id) {
      await updateLeadFromBudgetEvent(budgets[idx].lead_id, budgets[idx].status);
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
        if (budgets[existingIdx].lead_id) {
          await updateLeadFromBudgetEvent(budgets[existingIdx].lead_id, budgets[existingIdx].status);
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
      if (budget.lead_id) {
        await updateLeadFromBudgetEvent(budget.lead_id, budget.status);
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
    channel_id = '',
    channel_name = '',
    platform = '',
    campaign = '',
    amount = 0,
    notes = '',
  } = req.body || {};

  if (!date) {
    return res.status(400).json({ error: 'Data obrigatoria' });
  }
  if (!channel_id && !channel_name && !platform) {
    return res.status(400).json({ error: 'Canal obrigatorio' });
  }

  return withTableLock('ad_spend', async () => {
    const { items } = await loadTable('ad_spend', true);
    const id = nextId(items);
    const now = new Date().toISOString();
    const entry = {
      id,
      date,
      channel_id: channel_id || '',
      channel_name: channel_name || platform || '',
      platform: platform || channel_name || '',
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
    channel_id,
    channel_name,
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
    if (channel_id !== undefined) items[idx].channel_id = channel_id || '';
    if (channel_name !== undefined) items[idx].channel_name = channel_name || '';
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

app.get('/api/stats/sla', authMiddleware, async (req, res) => {
  const [{ items: leads }, { items: channels }] = await Promise.all([
    loadTable('leads'),
    loadTable('channels'),
  ]);
  const visible = filterLeadsByUser(hydrateLeads(leads, channels), req.user, req.query)
    .filter((lead) => !isCompetitorLead(lead));
  const filtered = applyLeadFilters(visible, req.query);
  const overdueByOwnerMap = new Map();
  const byTemperatureMap = new Map();

  filtered.forEach((lead) => {
    const owner = lead.owner || 'Sem responsável';
    const temperature = normalizeTemperature(lead.temperature) || 'frio';
    const status = normalizeName(lead.status);
    const item = byTemperatureMap.get(temperature) || { total: 0, ganhos: 0, overdue: 0 };

    item.total += 1;
    if (status === 'ganho') item.ganhos += 1;
    if (lead.sla_status === 'overdue') {
      item.overdue += 1;
      overdueByOwnerMap.set(owner, (overdueByOwnerMap.get(owner) || 0) + 1);
    }

    byTemperatureMap.set(temperature, item);
  });

  const sortEntries = (map) =>
    Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

  const conversionByTemperature = ['quente', 'morno', 'frio'].map((temperature) => {
    const stats = byTemperatureMap.get(temperature) || { total: 0, ganhos: 0, overdue: 0 };
    return {
      temperature,
      total: stats.total,
      ganhos: stats.ganhos,
      overdue: stats.overdue,
      taxaConversao: stats.total ? Math.round((stats.ganhos / stats.total) * 100) : 0,
    };
  });

  return res.json({
    total: filtered.length,
    overdueTotal: conversionByTemperature.reduce((sum, item) => sum + item.overdue, 0),
    overdueByOwner: sortEntries(overdueByOwnerMap),
    conversionByTemperature,
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
      source: 'Manychat',
      interactions_count: '0',
      last_interaction_at: '',
      last_interaction_channel: '',
      last_interaction_notes: '',
      created_at: now,
      updated_at: now,
      is_private: false,
    };

    applyLeadAutomationOnWrite(lead, { nowIso: now, isCreate: true });

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
    startFollowupReminderScheduler();
  }).catch((err) => {
    console.error('❌ Erro ao preparar storage:', err);
  });
};

bootstrap().catch((err) => {
  console.error('Erro ao iniciar servidor:', err);
  process.exit(1);
});
