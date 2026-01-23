#!/bin/bash
# Deploy Manual do GitHub para VPS
# Execute este script no VPS como root

set -e  # Parar em caso de erro

echo "🚀 Iniciando deploy do GitHub..."

# Ir para o diretório
cd /home/bhs-crm/htdocs/crm.bhseletrica.com.br

# Limpar tudo
echo "🧹 Limpando diretório..."
rm -rf *
rm -rf .git

# Clonar do GitHub
echo "📥 Clonando do GitHub..."
git clone https://github.com/dartagnan-2023/crmnew.git temp
mv temp/* .
mv temp/.git . 2>/dev/null || true
rm -rf temp

# Verificar estrutura
echo "📁 Estrutura clonada:"
ls -la

# Instalar backend
echo "⚙️ Instalando backend..."
cd backend
npm install --production

# Parar backend antigo
echo "🛑 Parando backend antigo..."
pm2 delete crm-backend 2>/dev/null || true

# Iniciar backend
echo "▶️ Iniciando backend..."
pm2 start server.js --name crm-backend
pm2 save

# Verificar backend
echo "✅ Status do backend:"
pm2 status

# Build frontend
echo "🎨 Buildando frontend..."
cd ../frontend
npm install
npm run build

# Corrigir permissões
echo "🔒 Corrigindo permissões..."
chmod -R 755 build

# Recarregar Nginx
echo "🔄 Recarregando Nginx..."
systemctl reload nginx

echo ""
echo "✅ Deploy concluído com sucesso!"
echo "🌐 Acesse: http://crm.bhseletrica.com.br"
echo ""
