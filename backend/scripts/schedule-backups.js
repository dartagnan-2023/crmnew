// ===============================================
// AGENDADOR DE BACKUPS AUTOMÁTICOS
// ===============================================
// Executa backups diários automaticamente
// Uso: node scripts/schedule-backups.js

const cron = require('node-cron');
const { backupGoogleSheets } = require('./backup-sheets');

console.log('🕐 Agendador de backups iniciado');
console.log('📅 Backups serão executados diariamente às 2h da manhã');

// Executar backup diário às 2h da manhã
cron.schedule('0 2 * * *', async () => {
    console.log('\n⏰ Executando backup agendado...');
    try {
        await backupGoogleSheets();
        console.log('✅ Backup agendado concluído\n');
    } catch (error) {
        console.error('❌ Erro no backup agendado:', error.message);
    }
}, {
    timezone: "America/Sao_Paulo"
});

// Manter o processo rodando
process.on('SIGINT', () => {
    console.log('\n👋 Encerrando agendador de backups...');
    process.exit(0);
});

console.log('✅ Agendador ativo. Pressione Ctrl+C para encerrar.\n');
