#!/bin/bash
# Deploy AUTOMÁTICO 100% - CRM BHS
set -e

echo "🚀 Deploy Automático - CRM BHS"

# Variáveis
DIR="/home/bhs-crm/htdocs/crm.bhseletrica.com.br"
ZIP="/tmp/crm-deploy.zip"

# Backup .env
[ -f "$DIR/backend/.env" ] && cp "$DIR/backend/.env" /tmp/.env.backup

# Limpar
cd "$DIR"
rm -rf backend frontend

# Extrair (ignorar warnings do Windows)
unzip -o -q "$ZIP" 2>/dev/null || true

# Verificar extração
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "❌ Erro na extração. Tentando método alternativo..."
    cd /tmp
    unzip -o "$ZIP"
    mv backend frontend "$DIR/"
fi

# Restaurar .env
[ -f "/tmp/.env.backup" ] && cp /tmp/.env.backup "$DIR/backend/.env"

# Permissões
chmod -R 777 "$DIR"

# Instalar e rodar como bhs-crm
su - bhs-crm << 'EOFUSER'
cd ~/htdocs/crm.bhseletrica.com.br/backend
source ~/.nvm/nvm.sh
npm install --production --silent
pm2 delete crm-backend 2>/dev/null || true
pm2 start server.js --name crm-backend
pm2 save
cd ../frontend
npm install --silent
npm run build
EOFUSER

# Recarregar Nginx
systemctl reload nginx

echo "✅ Deploy concluído!"
echo "🌐 http://crm.bhseletrica.com.br"
