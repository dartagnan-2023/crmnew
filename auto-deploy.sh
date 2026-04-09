#!/usr/bin/env bash
# Auto-deploy atualizado para o CRM BHS
set -euo pipefail

BASE_DIR="/home/bhs-crm/htdocs/crm.bhseletrica.com.br"
LOG_FILE="/home/bhs-crm/deploy.log"

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

log() {
  echo "$(timestamp): $1" | tee -a "$LOG_FILE"
}

log "Deploy automático iniciado (script moderno)."

cd "$BASE_DIR"
log "Executando deploy como bhs-crm..."
su - bhs-crm -c "cd $BASE_DIR && ./deploy.sh"

log "Recarregando Nginx..."
sudo /home/bhs-crm/deploy-root.sh

log "Deploy automático concluído com sucesso."