// ===============================================
// SCRIPT DE BACKUP AUTOMÁTICO - Google Sheets
// ===============================================
// Cria backups diários de todas as planilhas do CRM
// Uso: node scripts/backup-sheets.js

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SERVICE_ACCOUNT_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const TABLES = ['users', 'leads', 'channels', 'negative_terms'];

// Criar diretório de backups se não existir
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log(`📁 Diretório de backups criado: ${BACKUP_DIR}`);
}

const auth = new google.auth.JWT(
  SERVICE_ACCOUNT_EMAIL,
  null,
  SERVICE_ACCOUNT_KEY,
  ['https://www.googleapis.com/auth/spreadsheets.readonly']
);

const sheets = google.sheets({ version: 'v4', auth });

const backupGoogleSheets = async () => {
  console.log('🚀 Iniciando backup do Google Sheets...');
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const backup = {
    timestamp,
    version: '1.0.0',
    tables: {}
  };

  try {
    for (const table of TABLES) {
      console.log(`📊 Fazendo backup da tabela: ${table}`);
      
      const range = `${table}!A1:Z1000`;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range
      });

      const values = response.data.values || [];
      backup.tables[table] = {
        headers: values[0] || [],
        rows: values.slice(1),
        count: values.length - 1
      };

      console.log(`  ✅ ${backup.tables[table].count} registros salvos`);
    }

    // Salvar backup em JSON
    const filename = `backup-${timestamp}.json`;
    const filepath = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));

    // Estatísticas
    const totalRecords = Object.values(backup.tables).reduce(
      (sum, table) => sum + table.count,
      0
    );

    console.log('\n✅ Backup concluído com sucesso!');
    console.log(`📁 Arquivo: ${filename}`);
    console.log(`📊 Total de registros: ${totalRecords}`);
    console.log(`💾 Tamanho: ${(fs.statSync(filepath).size / 1024).toFixed(2)} KB`);

    // Limpar backups antigos (manter últimos 30 dias)
    cleanOldBackups();

    return filepath;
  } catch (error) {
    console.error('❌ Erro ao fazer backup:', error.message);
    throw error;
  }
};

const cleanOldBackups = () => {
  const files = fs.readdirSync(BACKUP_DIR);
  const now = Date.now();
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

  let deletedCount = 0;

  files.forEach(file => {
    if (!file.startsWith('backup-') || !file.endsWith('.json')) return;

    const filepath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filepath);

    if (stats.mtimeMs < thirtyDaysAgo) {
      fs.unlinkSync(filepath);
      deletedCount++;
    }
  });

  if (deletedCount > 0) {
    console.log(`🗑️  ${deletedCount} backup(s) antigo(s) removido(s)`);
  }
};

const restoreFromBackup = async (backupFile) => {
  console.log(`🔄 Restaurando backup: ${backupFile}`);
  
  const filepath = path.join(BACKUP_DIR, backupFile);
  if (!fs.existsSync(filepath)) {
    throw new Error(`Arquivo de backup não encontrado: ${backupFile}`);
  }

  const backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  console.log(`📅 Backup de: ${backup.timestamp}`);

  // ATENÇÃO: Implementar lógica de restauração conforme necessário
  console.log('⚠️  Restauração não implementada. Use este backup manualmente.');
  
  return backup;
};

// Executar backup se chamado diretamente
if (require.main === module) {
  backupGoogleSheets()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { backupGoogleSheets, restoreFromBackup };
