#!/bin/bash
set -eo pipefail

BASE=\"/home/bhs-crm/htdocs/crm.bhseletrica.com.br\"

cd \"\"

export NVM_DIR=\"C:\Users\Usuário/.nvm\"
if [ -s \"/nvm.sh\" ]; then
  source \"/nvm.sh\"
fi
if command -v nvm >/dev/null 2>&1; then
  nvm use 22 >/dev/null || (nvm install 22 >/dev/null && nvm use 22 >/dev/null)
fi

echo '-> git pull'
git pull --ff-only origin main

echo '-> backend install'
cd \"/backend\"
npm install

if pm2 list | grep -q crm-backend; then
  pm2 restart crm-backend
else
  pm2 start server.js --name crm-backend
fi
pm2 save

echo '-> frontend install + build'
cd \"/frontend\"
npm install
npm run build
chmod -R 755 build

echo '-> deploy complete'
