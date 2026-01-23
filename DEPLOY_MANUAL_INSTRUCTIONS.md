# Instruções para Deploy Manual

## Problema Identificado

O GitHub Actions não consegue conectar ao servidor VPS via SSH (erro: `dial tcp ***:22: i/o timeout`). Isso pode ser devido a:
- Firewall bloqueando conexões do GitHub Actions
- IP do GitHub Actions não está na whitelist do servidor
- Configuração de rede do VPS

## Solução: Deploy Manual

Como o deploy automático não está funcionando, você tem duas opções:

### Opção 1: Executar Script PowerShell (Recomendado)

1. Abra o PowerShell como Administrador
2. Navegue até o diretório do projeto:
   ```powershell
   cd c:\tmp\crm-fresh
   ```
3. Execute o script de deploy manual:
   ```powershell
   .\deploy-manual.ps1
   ```
4. Digite as credenciais do servidor quando solicitado

### Opção 2: Conectar via SSH Manualmente

Se você tiver acesso SSH ao servidor, execute os seguintes comandos diretamente:

```bash
# Conectar ao servidor
ssh seu-usuario@seu-servidor

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
```

## Verificação Pós-Deploy

Após executar o deploy manual:

1. Aguarde 1-2 minutos para o build completar
2. Acesse https://crm.bhseletrica.com.br/
3. Faça hard refresh (Ctrl+Shift+R)
4. Abra o modal "Novo Lead"
5. Verifique se os três novos campos aparecem:
   - **Tipo de Cliente** (botões A/B/C)
   - **Categorias em destaque** (8 chips)
   - **Motivo de esfriamento** (4 chips)

## Correção do GitHub Actions (Opcional)

Para corrigir o deploy automático no futuro, você precisará:

1. Verificar o firewall do VPS e permitir conexões SSH do GitHub Actions
2. Ou configurar um webhook alternativo
3. Ou usar um runner self-hosted no próprio VPS
