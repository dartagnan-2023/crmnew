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

## 2026-08-31 — Claude (via Cowork) — Fase 1 do redesenho: tokens Deep Ocean

**O quê:** Aplicação da identidade visual `deep_ocean_professional` na camada de tokens. **Nenhum elemento mudou de lugar** — só cor, sombra e a extração das classes repetidas.

- `frontend/tailwind.config.js`: paleta `brand` remapeada para a escala Deep Ocean (era um indigo que nunca havia sido usado) + tokens `surface`, `surface-card`, `surface-low/mid/high`, `ink`, `ink-soft`, `ink-faint`, `line`, e sombras `card`/`lift` com tingimento azul.
- `frontend/src/index.css`: fundo do `body` e do `#root` de `#0f172a` (azul quase preto) para `#f7f9ff`; texto para `#181c20`.
- `frontend/src/App.js`: 12 constantes de estilo no topo (`UI_CARD`, `UI_LABEL`, `UI_INPUT`, …) substituindo **362 ocorrências** de `className` repetido; fundo da aplicação trocado de um multi-gradiente para `bg-surface`; **62 utilitários** `*-blue-*` remapeados para `*-brand-*`.

**Por quê:** Concentrar a aparência em poucos pontos. Medido antes: 919 ocorrências de `className`, 305 distintas, as 20 mais repetidas cobrindo 46% da interface. Agora, mudar o visual do sistema é editar 12 constantes e um arquivo de configuração.

**Cor primária `#006194`, decidida por medição.** O `DESIGN.md` do Stitch se contradiz: a prosa cita `#0284C7`, o config implementa `#006194`. Em contraste WCAG nos quatro usos reais, o `#0284C7` reprova em três (4,10:1 para texto branco sobre o botão, mínimo 4,5). O `#006194` passa em todos, pior caso 6,36:1.

**Impacto:** Somente apresentação. Nenhuma alteração de lógica, estado, requisição ou contrato de dados. Os tons escuros (`bg-slate-800/900`) das telas de login e do cabeçalho foram deixados intactos de propósito — entram nas fases seguintes.

**Rollback:** `git revert <commit>`. Sem migração, sem efeito em dados.

**Validação executada:**

- `npm run build`: **exit 0**, mesmos 4 warnings de ESLint pré-existentes.
- Inspeção do CSS compilado, confirmando que o Tailwind gerou as classes novas com os valores certos: `.bg-surface` → `rgb(247 249 255)`, `.border-line` → `rgb(191 199 210)`, `.text-ink-soft` → `rgb(63 72 80)`, `.bg-brand-600` → `rgb(0 97 148)`, `.shadow-card` → sombra tingida de azul. Paleta indigo antiga ausente do bundle.
- Baseline visual capturada antes do deploy (screenshots + cores computadas nas 4 abas) para comparação depois.

---

## 2026-08-31 — Claude (via Cowork) — Correção da documentação de validação

**O quê:** Corrigidos `CLAUDE_PROMPT.md` e `CLAUDE_WORKSPACE_GUIDE.md`. Nenhum código alterado.

- Removido `node --check frontend/src/App.js` da lista de validação obrigatória, com explicação do porquê.
- Acrescentada a regra de nunca usar `git add .` neste repositório.

**Por quê:** Os dois documentos mandavam validar o frontend com `node --check frontend/src/App.js`. Esse comando **não valida esse arquivo**. Teste feito em 31/08/2026: injetamos um erro grosseiro de JSX numa cópia do `App.js` e o comando retornou **0 (sucesso)**. O mesmo `node --check` rejeita corretamente um arquivo JSX pequeno e um arquivo com erro de JS puro — o problema é específico deste arquivo, que começa com `import`, é tratado como ESM e não passa por análise sintática completa.

O efeito prático era grave: qualquer pessoa (ou agente) seguindo o guia acreditava estar validando o frontend sem estar. Só `npm run build` valida.

Junto, documentada a armadilha do `git add .`: o repositório tem divergência de fim de linha em ~39 arquivos (36.657 inserções contra 36.657 deleções, e `git diff --ignore-cr-at-eol` vazio). Um `git add .` geraria commit de dezenas de milhares de linhas, escondendo alteração real no meio.

**Impacto:** Nenhum. Apenas markdown. Não altera build, backend, frontend nem o comportamento do deploy.

**Rollback:** `git revert <commit>`.

**Validação:** `node --check backend/server.js` (inalterado, continua válido) e conferência visual dos dois arquivos. Não há código para buildar.

---

## 2026-08-31 — Claude (via Cowork) — Horário no follow-up do OmniChat

**O quê:** O agendamento de follow-up passou a aceitar horário, além da data. **Vale apenas para follow-ups novos ou reeditados. Leads antigos ficam exatamente como estão.**

- `frontend/src/App.js`: campo "Próximo contato (agenda)" virou `datetime-local`; helpers `resolveFollowupDate`, `followupToInput`, `followupToIso`, `formatFollowupBR`; o payload passa a enviar sempre ISO em UTC.
- `backend/server.js`: detecção de mudança de horário com cancelamento antes de reagendar; guarda contra envio de vencidos; teto de reagendamentos por ciclo.

**Por quê:** O campo só tinha data. O OmniChat lê `scheduled_at` como UTC (`new Date(str.replace(' ','T') + 'Z')`), então uma data pura virava meia-noite UTC — 21h do dia anterior em Brasília.

**Decisões e o porquê:**

1. **UTC ponta a ponta.** O frontend converte o horário local do navegador para ISO UTC antes de enviar. O backend não faz nenhuma conversão de fuso — não precisa, e assim não depende do fuso configurado no VPS.
2. **Leads antigos não são tocados.** Decisão do dono do produto. Quem tem só data continua com o comportamento atual, inclusive o disparo às 21h da véspera. A migração acontece naturalmente quando alguém editar o lead. Consequência importante: **não há migração em massa**, e portanto nenhum risco de estourar o limite do OmniChat.
3. **Na tela, lead antigo mostra só a data.** Sem hora inventada: exibir "09:00" para um lembrete que dispara 21h da véspera seria mentir para o operador.
4. **Cancelar antes de reagendar.** O OmniChat deduplica por `external_id`: reenviar o mesmo id devolve `200 {duplicado:true}` e **mantém o horário antigo**. Sem `DELETE` antes, mudar o horário não teria efeito — e a tela mostraria um horário inexistente no OmniChat.
5. **Vencidos não são enviados.** O OmniChat rejeita passado com 422. O CRM agora nem tenta, evitando erro a cada ciclo do autorun (5 min).
6. **Teto de 4 reagendamentos por ciclo** (`FOLLOWUP_MAX_RESCHEDULES_PER_RUN`). Medido: o OmniChat aceita exatamente 100 agendamentos pendentes por hora e devolve 429 no 101º. 4 por ciclo × 12 ciclos/hora = 48/hora, deixando ~52/hora livres para o fluxo normal. É seguro contra qualquer alteração em lote (importação, edição em massa).

**Impacto:** Sem mudança de schema. `next_contact` aceita os dois formatos. Chave de deduplicação preservada por data, para não orfanar notificações pendentes.

**Limitação conhecida:** se o lembrete já executou, mudar o horário no mesmo dia não reagenda — comportamento anterior a esta alteração.

**Rollback:** `git revert <commit>`. Sem migração para desfazer.

**Validação executada:**

- `npm run build` do frontend: **exit 0**, 4 warnings de ESLint todos pré-existentes.
- Integração **contra o código real** de `omnichat-backend/src/routes/integrations.js`, com SQLite temporário: todas as asserções passaram. Confirmado empiricamente que (a) reenviar o mesmo `external_id` mantém o horário antigo, (b) cancelar-e-recriar grava o novo, (c) vencido devolve 422, (d) **lead antigo grava exatamente o mesmo valor que o código anterior gravava**.
- Limite de 100/hora do OmniChat medido na prática: primeiro 429 na 101ª tentativa.

**Aviso sobre a validação documentada no projeto:** `node --check frontend/src/App.js`, listado no `CLAUDE_PROMPT.md` e no `CLAUDE_WORKSPACE_GUIDE.md`, **não valida este arquivo**. Testado: retorna 0 mesmo com JSX propositalmente quebrado. Só `npm run build` valida o frontend.

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
