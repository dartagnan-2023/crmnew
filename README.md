# CRM - BHS Eletrônica

Sistema de gestão de leads e relacionamento com clientes.

## 🚀 Início Rápido

### Pré-requisitos
- Node.js 18+ 
- Conta Google Cloud com Service Account configurada
- Google Sheet criada

### Instalação

#### Backend
```bash
cd backend
npm install
cp .env.example .env
# Edite o .env com suas credenciais
npm start
```

#### Frontend
```bash
cd frontend
npm install
cp .env.example .env
# Edite o .env com a URL da API
npm start
```

## 📋 Funcionalidades

- ✅ Gestão de leads (criar, editar, excluir)
- ✅ Visualização Kanban e Lista
- ✅ Filtros avançados
- ✅ Estatísticas e dashboards
- ✅ Gestão de usuários e permissões
- ✅ Canais de origem
- ✅ Follow-ups e agenda
- ✅ Exportação CSV

## 🔧 Scripts Disponíveis

### Backend
```bash
npm start              # Iniciar servidor
npm run dev            # Modo desenvolvimento (nodemon)
npm run backup         # Backup manual do Google Sheets
npm run backup:schedule # Iniciar backups automáticos
npm run version:patch  # Incrementar versão patch (1.0.X)
npm run version:minor  # Incrementar versão minor (1.X.0)
npm run version:major  # Incrementar versão major (X.0.0)
```

### Frontend
```bash
npm start              # Iniciar em desenvolvimento
npm run build          # Build para produção
npm test               # Executar testes
```

## 📁 Estrutura do Projeto

```
crm-fresh/
├── backend/
│   ├── scripts/
│   │   ├── backup-sheets.js
│   │   └── schedule-backups.js
│   ├── middleware/
│   │   └── monitoring.js
│   ├── backups/           # Backups automáticos (gitignored)
│   ├── server.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   └── ...
│   └── package.json
└── README.md
```

## 🔒 Segurança

- Nunca commite o arquivo `.env`
- Use senhas fortes para JWT_SECRET
- Mantenha as credenciais do Google Cloud seguras
- Ative rate limiting em produção

## 📦 Backups

Backups automáticos são criados diariamente às 2h da manhã e armazenados em `backend/backups/`.

Para fazer backup manual:
```bash
cd backend
npm run backup
```

## 🐛 Troubleshooting

### Erro de autenticação Google Sheets
- Verifique se o Service Account tem permissão na planilha
- Confirme que GOOGLE_PRIVATE_KEY está com as quebras de linha corretas

### Porta já em uso
```bash
# Mudar porta no .env
PORT=3002
```

## 📝 Licença

Proprietário - BHS Eletrônica

## 👥 Suporte

Para suporte, entre em contato: marketing@bhseletronica.com.br
