#!/usr/bin/env bash
set -euo pipefail

BASE="/home/bhs-crm/htdocs/crm.bhseletrica.com.br"
export NVM_DIR="/home/bhs-crm/.nvm"

cd "$BASE"

if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

if command -v nvm >/dev/null 2>&1; then
  nvm use 22 >/dev/null 2>&1 || {
    nvm install 22 >/dev/null 2>&1
    nvm use 22 >/dev/null 2>&1
  }
fi

echo '=> git pull'
git fetch origin
git reset --hard origin/main

echo '=> backend install + restart'
cd "$BASE/backend"
npm install
pm2 delete crm-backend 2>/dev/null || true
pm2 start server.js --name crm-backend
pm2 save

echo '=> frontend install + build'
cd "$BASE/frontend"
npm install
npm run build
chmod -R 755 build

echo '=> deploy complete'