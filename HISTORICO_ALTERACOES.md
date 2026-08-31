# Histórico de Alterações - CRM BHS

Registro de toda alteração feita no projeto, conforme regra interna: nada é alterado sem ficar documentado aqui.

Ordem: mais recente primeiro.

## Formato de cada entrada

- **Data / Autor** — quem fez
- **O quê** — a alteração
- **Por quê** — o motivo
- **Impacto** — o que pode quebrar
- **Rollback** — como desfazer
- **Validação** — como foi conferido

---

## 2026-08-31 — Claude (via Cowork) — Horário no follow-up do OmniChat

**O quê:** O agendamento de follow-up passou a ter horário, além da data.

- `frontend/src/App.js`: campo "Próximo contato (agenda)" virou `datetime-local`; helpers `resolveFollowupDate`, `followupToInput`, `followupToIso` e `formatFollowupBR`; o payload passa a enviar sempre ISO em UTC; listas exibem data e hora; a função de adiar preserva o horário.
- `backend/server.js`: helpers `zonedTimeToUtc` e `resolveFollowupInstant`; detecção de mudança de horário com cancelamento antes de reagendar; guarda que impede enviar vencidos.

**Por quê:** O campo só tinha data. Pior: `new Date('2026-09-05')` é lido como meia-noite **UTC**, e o OmniChat também lê `scheduled_at` como UTC (`new Date(str.replace(' ','T') + 'Z')`). Na prática os lembretes disparavam às **21h do dia anterior**.

**Decisões e o porquê:**

1. **UTC ponta a ponta.** O frontend converte o horário local do navegador para ISO UTC antes de enviar. O backend usa `Intl.DateTimeFormat` para resolver `America/Sao_Paulo` sem depender do fuso do VPS.
2. **Leads antigos (só data) assumem 09:00 local.** Configurável por `FOLLOWUP_DEFAULT_HOUR_LOCAL`. Corrige o disparo na véspera sem exigir reedição manual.
3. **Cancelar antes de reagendar.** O OmniChat deduplica por `external_id`: reenviar o mesmo id devolve `200 {duplicado:true}` e **mantém o horário antigo**. Sem `DELETE` antes, mudar o horário não teria efeito nenhum — e a tela mostraria um horário que não existe no OmniChat.
4. **Vencidos não são reenviados.** O OmniChat rejeita passado com 422 (guarda criada após o incidente de ago/2026, quando o CRM despejou 1.194 follow-ups vencidos). O CRM agora nem tenta, evitando erro a cada ciclo do autorun.

**Impacto:** Nenhuma mudança de schema. `next_contact` aceita os dois formatos, antigo e novo. Chave de deduplicação preservada por data, para não órfãos as notificações pendentes já existentes.

**Limitação conhecida:** se o lembrete já executou (`status` final), mudar o horário no mesmo dia não reagenda — comportamento que já existia antes desta alteração.

**Rollback:** `git revert <commit>`. Sem migração para desfazer.

**Validação executada:**

- `npm run build` do frontend: **exit 0**, 4 warnings de ESLint todos pré-existentes.
- 11 testes unitários das funções de fuso: todos passaram, incluindo a reprodução do bug antigo (21h da véspera).
- 14 asserções de integração **contra o código real** de `omnichat-backend/src/routes/integrations.js`, com SQLite temporário: todas passaram. Confirmaram empiricamente que reenviar o mesmo `external_id` mantém o horário antigo, e que cancelar-e-recriar grava o horário novo.

**Aviso sobre a validação documentada no projeto:** `node --check frontend/src/App.js`, listado no `CLAUDE_PROMPT.md` e no `CLAUDE_WORKSPACE_GUIDE.md`, **não valida este arquivo**. Testado: o comando retorna 0 mesmo com JSX propositalmente quebrado. Só `npm run build` valida o frontend de verdade.

---

## 2026-08-31 — Claude (via Cowork)

**O quê:** Criação deste arquivo de histórico. Nenhum código alterado.

**Por quê:** As instruções do projeto exigem uma memória onde toda alteração seja documentada e possa ser pesquisada em caso de dúvida. Esse registro não existia.

**Impacto:** Nenhum. Arquivo novo, na raiz, sem referência de código. Não altera build, backend, frontend nem deploy.

**Rollback:** `git revert <commit>` ou simplesmente apagar o arquivo.

**Validação:** Alteração entregue via branch, sem push direto na `main` — portanto sem acionar o deploy automático.

### Observações técnicas levantadas nesta data (nenhuma corrigida ainda)

1. **Push na `main` derruba produção.** O `deploy.yml` dispara em `push: branches: [main]` e o script no VPS executa `pm2 delete crm-backend` seguido de `pm2 start`, além de `systemctl restart nginx`. Todo commit na `main` é um deploy com janela de indisponibilidade. Não usar a `main` para testes.

2. **Ruído de CRLF no repositório.** Cerca de 39 arquivos aparecem como modificados no `git status` sem nenhuma mudança real de conteúdo (36.657 inserções contra 36.657 deleções; `git diff --ignore-cr-at-eol` retorna vazio). Consequência: **nunca usar `git add .`** neste repositório, sob risco de gerar um commit de dezenas de milhares de linhas que esconde alterações reais. Commitar sempre por caminho explícito. Normalizar isso é tarefa própria, ainda não feita.

3. **`backend/mcp-server.mjs` não está versionado.** Existe no disco como untracked. O `MCP_CLAUDE_SETUP.md` afirma que a implementação autoritativa do MCP é a de `backend/server.js`. Falta decidir se este arquivo entra no repositório ou é descartado.

4. **Divergência entre documentação e código no MCP.** O `MCP_CLAUDE_SETUP.md` orienta "não reutilize `API_KEY_LEADS`", mas `backend/server.js` aceita `API_KEY_LEADS` como token MCP válido via header. Ou a documentação ou o código precisa ser ajustado.

5. **Repositório é público.** O `MCP_CLAUDE_SETUP.md` expõe publicamente URLs, rotas, nomes de tools e limites de rate do CRM. O token real não está no repositório (correto), mas convém decidir se essa exposição é intencional.

6. **Documentação duplicada e divergente.** `CLAUDE.md` (presente apenas na cópia antiga do projeto) cita Manychat; `CLAUDE_WORKSPACE_GUIDE.md` cita OmniChat. Os dois descrevem o mesmo sistema.
