# Checklist de Diagnóstico - CRM CloudPanel

Execute estes comandos via SSH para diagnosticar o problema:

## 1️⃣ Verificar Backend

```bash
# Ver se o backend está rodando
pm2 status

# Se não estiver rodando, iniciar:
cd ~/htdocs/crm.bhseletrica.com.br/backend
pm2 start server.js --name crm-backend

# Ver logs do backend
pm2 logs crm-backend --lines 20

# Testar se a API responde
curl http://localhost:3001/api/ping
# Deve retornar: {"ok":true,"at":"..."}
```

## 2️⃣ Verificar Frontend

```bash
# Ver se o build existe
ls -la ~/htdocs/crm.bhseletrica.com.br/frontend/build/

# Se não existir, fazer build:
cd ~/htdocs/crm.bhseletrica.com.br/frontend
npm run build

# Verificar se criou os arquivos
ls -la build/
```

## 3️⃣ Verificar Nginx

```bash
# Testar configuração do Nginx
sudo nginx -t

# Ver configuração ativa
cat /etc/nginx/sites-enabled/crm.bhseletrica.com.br.conf

# Recarregar Nginx
sudo systemctl reload nginx

# Ver status do Nginx
sudo systemctl status nginx
```

## 4️⃣ Verificar DNS

```bash
# Testar se o domínio resolve
nslookup crm.bhseletrica.com.br

# Deve retornar: 76.13.80.171
```

## 5️⃣ Testar Acesso

```bash
# Testar se o servidor responde na porta 80
curl -I http://crm.bhseletrica.com.br

# Testar se a API responde
curl http://crm.bhseletrica.com.br/api/ping
```

## 6️⃣ Ver Logs de Erro

```bash
# Logs do Nginx
sudo tail -f /var/log/nginx/error.log

# Logs do sistema
sudo journalctl -xe
```

---

## 📋 Me Envie os Resultados

Execute cada seção e me mande:

1. **Resultado do `pm2 status`**
2. **Resultado do `curl http://localhost:3001/api/ping`**
3. **Resultado do `ls -la ~/htdocs/crm.bhseletrica.com.br/frontend/build/`**
4. **Resultado do `sudo nginx -t`**
5. **Resultado do `curl -I http://crm.bhseletrica.com.br`**

Com essas informações consigo identificar exatamente onde está o problema! 🔍
