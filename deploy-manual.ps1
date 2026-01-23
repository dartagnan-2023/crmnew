# Manual Deploy Script for CRM
# Execute este script para fazer deploy manual no servidor VPS

Write-Host "🚀 Iniciando deploy manual do CRM..." -ForegroundColor Green
Write-Host ""

# Informações que você precisa fornecer
$VPS_HOST = Read-Host "Digite o IP ou hostname do VPS"
$VPS_USER = Read-Host "Digite o usuário SSH (ex: root)"

Write-Host ""
Write-Host "📝 Comandos que serão executados no servidor:" -ForegroundColor Yellow
Write-Host ""

$commands = @"
# Ir para o diretório da aplicação
cd /home/bhs-crm/htdocs/crm.bhseletrica.com.br

# Fazer backup do .env
cp backend/.env /tmp/backend.env.backup

# Atualizar código do GitHub
git config --global --add safe.directory /home/bhs-crm/htdocs/crm.bhseletrica.com.br
git reset --hard HEAD
git pull origin main

# Restaurar .env
cp /tmp/backend.env.backup backend/.env

# Atualizar backend
cd backend
rm -rf node_modules package-lock.json
su - bhs-crm -c "cd /home/bhs-crm/htdocs/crm.bhseletrica.com.br/backend && source ~/.nvm/nvm.sh && npm install"
su - bhs-crm -c "pm2 restart crm-backend"

# Atualizar frontend
cd ../frontend
su - bhs-crm -c "cd /home/bhs-crm/htdocs/crm.bhseletrica.com.br/frontend && source ~/.nvm/nvm.sh && npm install && npm run build"

# Recarregar Nginx
systemctl reload nginx

echo "✅ Deploy concluído com sucesso!"
"@

Write-Host $commands -ForegroundColor Cyan
Write-Host ""
Write-Host "Conectando ao servidor via SSH..." -ForegroundColor Green
Write-Host "Você precisará digitar a senha do servidor quando solicitado." -ForegroundColor Yellow
Write-Host ""

# Executar via SSH
ssh "$VPS_USER@$VPS_HOST" $commands
