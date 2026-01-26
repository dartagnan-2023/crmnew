#!/bin/bash
# Script de Deploy Automático - CRM BHS Eletrônica
# Execute como: bash deploy.sh

set -e  # Parar em caso de erro

echo "🚀 Iniciando deploy automático do CRM..."
echo ""

# Cores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Diretório de trabalho
DEPLOY_DIR="/home/bhs-crm/htdocs/crm.bhseletrica.com.br"
ZIP_FILE="/tmp/crm-deploy.zip"

# Verificar se o ZIP existe
if [ ! -f "$ZIP_FILE" ]; then
    echo -e "${RED}❌ Erro: Arquivo $ZIP_FILE não encontrado!${NC}"
    echo "Por favor, faça upload do crm-deploy.zip para /tmp/"
    exit 1
fi

echo -e "${BLUE}📦 Descompactando arquivos...${NC}"
cd "$DEPLOY_DIR"

# Fazer backup do .env se existir
if [ -f "backend/.env" ]; then
    echo "💾 Fazendo backup do .env..."
    cp backend/.env /tmp/.env.backup
fi

# Limpar diretório
echo "🧹 Limpando diretório..."
rm -rf backend frontend

# Descompactar
echo "📂 Extraindo arquivos..."
unzip -q "$ZIP_FILE" -d "$DEPLOY_DIR"

# Restaurar .env
if [ -f "/tmp/.env.backup" ]; then
    echo "♻️ Restaurando .env..."
    cp /tmp/.env.backup backend/.env
fi

# Corrigir permissões
echo "🔒 Corrigindo permissões..."
chmod -R 777 "$DEPLOY_DIR"

# Instalar backend
echo -e "${BLUE}⚙️ Instalando backend...${NC}"
cd "$DEPLOY_DIR/backend"

# Carregar NVM
export NVM_DIR="/home/bhs-crm/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

npm install --production

# Parar backend antigo
echo "🛑 Parando backend antigo..."
pm2 delete crm-backend 2>/dev/null || true

# Iniciar backend
echo -e "${GREEN}▶️ Iniciando backend...${NC}"
pm2 start server.js --name crm-backend
pm2 save

# Verificar backend
echo ""
echo -e "${GREEN}✅ Status do backend:${NC}"
pm2 status

# Build frontend
echo ""
echo -e "${BLUE}🎨 Buildando frontend...${NC}"
cd "$DEPLOY_DIR/frontend"

npm install
npm run build

# Corrigir permissões do build
chmod -R 755 build

# Recarregar Nginx
echo ""
echo -e "${BLUE}🔄 Recarregando Nginx...${NC}"
systemctl reload nginx

# Limpar
echo "🧹 Limpando arquivos temporários..."
rm -f "$ZIP_FILE"
rm -f /tmp/.env.backup

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Deploy concluído com sucesso!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "🌐 Acesse: http://crm.bhseletrica.com.br"
echo ""
echo "📊 Comandos úteis:"
echo "  - Ver logs: pm2 logs crm-backend"
echo "  - Reiniciar: pm2 restart crm-backend"
echo "  - Status: pm2 status"
echo ""
