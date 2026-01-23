#!/bin/bash
# Auto-deploy script triggered by webhook
# This script should be placed in /home/bhs-crm/htdocs/crm.bhseletrica.com.br/

set -e  # Exit on error

LOG_FILE="/home/bhs-crm/deploy.log"

echo "$(date): Deploy iniciado" >> "$LOG_FILE"

# Ir para o diretório da aplicação
cd /home/bhs-crm/htdocs/crm.bhseletrica.com.br

# Fazer backup do .env
cp backend/.env /tmp/backend.env.backup 2>/dev/null || true

# Atualizar código
git config --global --add safe.directory /home/bhs-crm/htdocs/crm.bhseletrica.com.br
git reset --hard HEAD
git pull origin main

echo "$(date): Código atualizado" >> "$LOG_FILE"

# Restaurar .env
cp /tmp/backend.env.backup backend/.env 2>/dev/null || true

# Atualizar backend
cd backend
rm -rf node_modules package-lock.json
su - bhs-crm -c "cd /home/bhs-crm/htdocs/crm.bhseletrica.com.br/backend && source ~/.nvm/nvm.sh && npm install --production"

echo "$(date): Backend atualizado" >> "$LOG_FILE"

# Reiniciar PM2
su - bhs-crm -c "pm2 restart crm-backend"

# Atualizar frontend
cd ../frontend
su - bhs-crm -c "cd /home/bhs-crm/htdocs/crm.bhseletrica.com.br/frontend && source ~/.nvm/nvm.sh && npm install && npm run build"

echo "$(date): Frontend buildado" >> "$LOG_FILE"

# Recarregar Nginx
systemctl reload nginx 2>/dev/null || true

echo "$(date): Deploy concluído com sucesso!" >> "$LOG_FILE"
