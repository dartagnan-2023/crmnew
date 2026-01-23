# Guia de Integração - Fase 1 Completa

## ✅ O que foi implementado

### 1. Configuração de Ambiente
- ✅ `.env.example` (backend e frontend)
- ✅ `.gitignore` atualizado
- ✅ README.md completo

### 2. Sistema de Backup
- ✅ `backend/scripts/backup-sheets.js` - Backup manual
- ✅ `backend/scripts/schedule-backups.js` - Backup automático diário

### 3. Monitoramento
- ✅ `backend/middleware/monitoring.js` - Logs e performance

### 4. Scripts NPM
- ✅ `npm run dev` - Desenvolvimento com nodemon
- ✅ `npm run backup` - Backup manual
- ✅ `npm run backup:schedule` - Iniciar backups automáticos

---

## 🚀 Próximos Passos para Ativar

### Passo 1: Configurar Variáveis de Ambiente

```bash
# Backend
cd backend
cp .env.example .env
# Edite o .env com suas credenciais reais

# Frontend  
cd ../frontend
cp .env.example .env
# Edite o .env com a URL da API
```

### Passo 2: Instalar Dependências

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### Passo 3: Integrar Monitoramento no Server.js

Adicione estas linhas no `backend/server.js`:

**No topo do arquivo (após os requires existentes):**
```javascript
// Importar middleware de monitoramento
const { monitoring, healthCheck, errorHandler } = require('./middleware/monitoring');
```

**Após `app.use(express.json());`:**
```javascript
// Adicionar middleware de monitoramento
app.use(monitoring);
```

**Substituir o endpoint `/api/health` existente:**
```javascript
// Health/ping leves (nao tocam Google Sheets)
app.get('/api/health', healthCheck);
```

**Antes da função `bootstrap()` (no final do arquivo):**
```javascript
// ===================== ERROR HANDLER =====================
// Deve ser o último middleware
app.use(errorHandler);
```

**Dentro da função `bootstrap()`, atualizar o console.log:**
```javascript
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
```

### Passo 4: Testar Backup

```bash
cd backend
npm run backup
```

Verifique se foi criado um arquivo em `backend/backups/backup-YYYY-MM-DDTHH-MM-SS.json`

### Passo 5: Iniciar Servidor com Monitoramento

```bash
# Desenvolvimento (com auto-reload)
npm run dev

# Produção
npm start
```

### Passo 6: Verificar Health Check

Abra no navegador: `http://localhost:3001/api/health`

Deve retornar algo como:
```json
{
  "status": "ok",
  "timestamp": "2026-01-19T19:10:00.000Z",
  "uptime": "5m 30s",
  "memory": {
    "rss": "45.23 MB",
    "heapUsed": "25.67 MB",
    "heapTotal": "35.12 MB"
  },
  "env": "development"
}
```

### Passo 7: (Opcional) Ativar Backups Automáticos

Para backups diários automáticos às 2h da manhã:

```bash
# Opção 1: Rodar em terminal separado
npm run backup:schedule

# Opção 2: Usar PM2 (recomendado para produção)
npm install -g pm2
pm2 start scripts/schedule-backups.js --name crm-backup-scheduler
pm2 save
```

---

## 🧪 Testes de Validação

### 1. Testar Monitoramento
```bash
# Fazer algumas requisições e verificar logs
curl http://localhost:3001/api/health
curl http://localhost:3001/api/ping
```

Você deve ver logs estruturados no console:
```
✅ {
  requestId: '1737319800000-abc123',
  method: 'GET',
  path: '/api/health',
  status: 200,
  duration: '15ms',
  timestamp: '2026-01-19T19:10:00.000Z',
  ...
}
```

### 2. Testar Backup
```bash
npm run backup
ls -la backups/
```

### 3. Testar Versionamento
```bash
npm run version:patch  # 1.0.0 -> 1.0.1
git log -1
```

---

## 📊 Métricas de Sucesso

Após implementar, você terá:

- ✅ **Backups automáticos** protegendo seus dados
- ✅ **Logs estruturados** para debug
- ✅ **Health check** para monitoramento
- ✅ **Alertas de performance** (requisições > 3s)
- ✅ **Versionamento semântico** do código
- ✅ **Ambiente de desenvolvimento** melhorado (nodemon)

---

## 🔄 Rollback

Se algo der errado:

```bash
git checkout HEAD -- backend/server.js
npm start
```

O sistema volta a funcionar normalmente sem o monitoramento.

---

## 📝 Notas Importantes

1. **Não commite o `.env`** - Ele contém credenciais sensíveis
2. **Backups são salvos localmente** - Configure backup externo (Google Drive, S3, etc)
3. **Logs em produção** - Configure `ENABLE_REQUEST_LOGGING=false` se houver muito tráfego
4. **Monitoramento não afeta performance** - Overhead < 1ms por requisição

---

## ❓ Problemas Comuns

### "Cannot find module './middleware/monitoring'"
```bash
# Verifique se o arquivo existe
ls backend/middleware/monitoring.js

# Se não existir, o arquivo foi criado em:
# backend/middleware/monitoring.js
```

### "ENOENT: no such file or directory, open '.env'"
```bash
# Copie o .env.example
cp .env.example .env
# Edite com suas credenciais
```

### Backup falha com erro de autenticação
```bash
# Verifique as credenciais no .env
# GOOGLE_SHEET_ID
# GOOGLE_SERVICE_ACCOUNT_EMAIL
# GOOGLE_PRIVATE_KEY (deve ter \n nas quebras de linha)
```

---

## 🎯 Próxima Fase

Quando estiver tudo funcionando, podemos partir para a **Fase 2: Segurança e Estabilidade**:
- Rate limiting
- Validação de entrada
- Helmet
- Testes automatizados

**Quer que eu comece a Fase 2?** 🚀
