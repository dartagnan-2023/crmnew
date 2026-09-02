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

## 2026-09-02 — Claude (via Cowork) — Valor reprovado no card "Valor Fechado"

**O quê:** `buildBudgetStatsSummary` passa a acumular `valorReprovado` (soma de `budget_value` dos orçamentos com status `reprovado`), e o card "Valor Fechado" mostra esse valor ao lado da contagem: `N reprovados · R$ X`.

**Por quê:** O card mostrava só a quantidade de reprovados, sem valor, impedindo comparar fechado contra perdido.

**Decisão de qual campo somar:** usa `budget_value`, não `closed_value`. Verificado em produção antes de escrever o código: dos 1.101 orçamentos, 7 estão como reprovado; a soma de `budget_value` deles é R$ 10.687,93 e a soma de `closed_value` é R$ 0,00. Orçamento reprovado não fecha valor, então somar `closed_value` mostraria R$ 0,00 permanentemente. Registrado também em comentário no código.

**Impacto:** Aditivo. Nenhum campo existente foi alterado, nenhuma chamada de API, nenhuma escrita em planilha. O número obedece aos filtros do módulo, igual aos demais cards.

**Rollback:** `git revert <commit>`. Alteração de exibição em um único arquivo de frontend, sem efeito em dado gravado.

**Validação:** parser JSX OK e `react-scripts build` executado com sucesso antes do push. Conferência do número em produção após o deploy.

## 2026-09-02 — Claude (via Cowork) — Filtros de orçamentos e marcação de representante

**O quê:** Cinco alterações em `frontend/src/App.js`, todas no módulo de Orçamentos.

1. Opção fixa **"Representante"** na lista do campo *Orçamentista*, tanto no formulário quanto no filtro. Constantes `ESTIMATOR_REPRESENTANTE_ID = 'representante'` e `ESTIMATOR_REPRESENTANTE_LABEL`. Quando o orçamento entra por representante, o time marca essa opção; assim dá para contar depois quantos vieram por esse caminho.
2. Filtro de vendedor ganhou o modo **exclusão**: além de "Somente um vendedor", agora existe "Excluir um vendedor" (`exceto:<id>`), atendendo ao pedido "todos os vendedores, exceto Osnil".
3. Campos **Data inicial / Data final sempre visíveis** na barra de filtros. Antes só apareciam depois de escolher "Período personalizado" no seletor, e a equipe não encontrava o filtro por data. Preencher qualquer uma das datas troca o período para `custom` automaticamente.
4. Campo **Representante** movido do rodapé do modal para o lado de *Vendedor* e *Orçamentista*. Medição na tela real: o modal tem 1071px de conteúdo com 854px visíveis, e o campo começava em 845px — nascia na borda inferior.
5. Correção: **"Limpar filtros"** não zerava `budgetRepresentanteFilter`. Zera agora.

**Por quê:** Pedido direto da diretoria. Os itens 3 e 4 são de descoberta (a funcionalidade existia, ninguém achava); os itens 1 e 2 são funcionalidade nova; o item 5 é bug introduzido na entrega anterior.

**Impacto:**
- Nenhuma funcionalidade removida. Nenhuma alteração de backend, de planilha ou de contrato de API.
- A sentinela `'representante'` grava em `estimator_id`. Os ids reais dos usuários são numéricos ("1" a "6"), verificado em produção via `/api/users` — não há colisão.
- O backend grava `estimator_id`/`estimator_name` sem validar contra a tabela de usuários (`server.js` ~4374, ~4450), então a sentinela persiste sem erro.
- **Ponto de atenção:** `mcpNormalizeBudget` (`server.js` ~3224) monta `owner_id: budget.owner_id || budget.estimator_id`. Um orçamento sem vendedor e marcado como "Representante" sairia com `owner_id: "representante"` no payload do MCP. O MCP ainda não está conectado; anotado para quando for.
- Orçamentos **sem vendedor** continuam aparecendo no filtro "Todos, exceto X" — decisão explícita do usuário, registrada em comentário no código.

**Rollback:** `git revert <commit>`. Alteração restrita a um arquivo de frontend; reverter e reimplantar devolve a tela ao estado anterior sem tocar em dado gravado. Orçamentos já marcados como "Representante" manteriam `estimator_name: "Representante"` na planilha, visível na tabela, apenas sem a opção no seletor.

**Validação:**
- `@babel/parser` com plugin JSX: sintaxe OK. O teste foi provado válido injetando um `<th>` quebrado numa cópia — o parser acusou o erro (`node --check` não acusa, é falso positivo conhecido).
- **Build real** `react-scripts build` executado com sucesso (237.18 kB gzip); apenas os warnings de lint pré-existentes.
- Estado anterior verificado em produção antes de mexer: deploy `32ac76e` concluído com sucesso, bundle servido contendo o campo, 1.101 orçamentos com a coluna `representante` presente e 0 preenchidos.

## 2026-09-01 — Claude (via Cowork) — Campo "Representante" nos orçamentos

**O quê:** Novo campo `representante` no orçamento. Opcional, preenchido à mão pelo orçamentista, com autocompletar dos valores já usados.

- `backend/server.js`: coluna `representante` em `SHEETS_CONFIG.budgets` (29ª); aceita em `POST /api/budgets` e `PUT /api/budgets/:id`; exposto no `hydrateBudget`; filtro `?representante=` e inclusão na busca textual da listagem.
- `frontend/src/App.js`: campo no formulário com `<datalist>`, coluna na tabela, filtro dedicado na barra, e inclusão na busca textual.

**Por quê:** Quando o negócio vem por representante externo, a empresa precisa registrar quem foi, para tirar métrica depois.

**Decisão de preenchimento:** texto livre **com autocompletar** dos representantes já registrados, em vez de lista fechada com tela de cadastro. Evita que "João Silva", "joao silva" e "J. Silva" virem três representantes na contagem, sem o custo de manter um cadastro.

**⚠️ A armadilha da importação, e como foi evitada.** Os orçamentos vêm de importação do ERP, e o import faz `{ ...budgets[existingIdx], ...payload }`. Se `representante` entrasse no `payload`, **toda reimportação apagaria o valor digitado**, porque a planilha do ERP não tem essa coluna. O campo foi deixado **de fora do payload de propósito**, com comentário no código explicando. Assim o espalhamento preserva o valor manual.

**⚠️ Segundo bug pego antes de subir:** `openEditBudgetModal` montava o formulário sem `representante`. Abrir um orçamento existente e salvar apagaria o valor. Corrigido.

**Migração da planilha:** automática. `ensureHeaders()` detecta o cabeçalho faltando no restart e reescreve a planilha `budgets` com a coluna nova, preservando os 384 registros (valor vazio nos existentes).

**Não entregue:** exportação para planilha. Verificado que **não existe exportação de orçamentos** no sistema — só a de contatos (leads). Adicionar a coluna exigiria criar a exportação inteira, que é feature própria.

**Rollback:** `git revert <commit>`. A coluna permanece na planilha, vazia e sem uso — inofensiva.

**Validação:** `node --check` OK no backend; `npm run build` exit 0, mesmos 4 warnings pré-existentes; confirmado que `representante` NÃO consta no payload de importação.

---

## 2026-09-01 — Claude (via Cowork) — Gravacao por linha em vez de reescrita total

**O quê:** Novo `saveSheetRow(sheetName, rowIndex, item)` que grava **uma linha** da planilha. Aplicado nas 4 rotas que alteram um único lead:

- `PUT /api/leads/:id` — edição de lead
- `POST /api/leads/:id/interactions` — registrar interação
- `PUT /api/leads/:id/interactions/:interactionId`
- `DELETE /api/leads/:id/interactions/:interactionId`

**Por quê:** `writeSheet` reenvia a planilha inteira a cada alteração. Com 2.260 leads e 44 colunas, mudar um campo enviava **99.440 células** e 5 chamadas de API. Era a causa do spinner demorado e dos HTTP 429 (cota do Google Sheets).

Medido: **99.440 células → 44** (2.260× menos) e **5 chamadas → 2**.

**A reescrita total não protegia nenhuma funcionalidade.** Ela existe porque uma função só resolvia todos os casos — criar, editar, excluir e recalcular. Foi conveniência de implementação, não requisito.

**Onde a reescrita total FOI mantida, porque ali ela é necessária:**

- `DELETE /api/leads/:id` — remover linha desloca todas as seguintes
- recálculo em massa de SLA — altera todos os leads
- criação de lead — acrescenta linha
- demais 12 pontos de `saveTable('leads')`

**Segurança — o ponto crítico.** Gravar por índice erra o alvo se a ordem da planilha mudar entre a leitura e a escrita. Antes de gravar, a função lê a célula de id da linha alvo e compara com o registro esperado. Qualquer divergência → devolve `false` **sem gravar nada**, e o chamador cai no gravador completo de sempre. O mesmo vale para erro de API, item sem id ou índice inválido.

Confirmado que não há concorrência externa: o script de backup usa escopo `spreadsheets.readonly`, e o PM2 roda instância única.

**Impacto:** Nenhuma funcionalidade perdida. Comportamento idêntico do ponto de vista do usuário, apenas mais rápido. Em qualquer anomalia, o caminho antigo assume.

**Rollback:** `git revert <commit>`. Sem migração de dados.

**Validação:** `node --check` OK. 16 asserções em teste isolado das funções, todas passando: conversão de coluna (0→A, 25→Z, 26→AA, 43→AR), faixa de gravação correta (`leads!A7:AR7`), 44 colunas enviadas, cache limpo, e as 5 proteções (id divergente, linha vazia, erro de API, item sem id, índice inválido) confirmadas como **não gravando nada**.

---

## 2026-08-31 — Claude (via Cowork) — Editor de lead: modal vira drawer

**O quê:** O editor de lead deixou de ser um modal centralizado e passou a ser um drawer que entra pela direita, como o `DESIGN.md` especifica.

- `frontend/src/App.js`: trocados **apenas os dois `div` de container** (linhas ~5822-5827). O conteúdo do formulário não foi tocado.
  - Fundo: `fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4` → `fixed inset-0 bg-ink/45 scrim-enter`
  - Caixa: `bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh]` → `fixed top-0 right-0 h-full w-full max-w-lg bg-surface-card border-l border-line shadow-2xl drawer-enter`
- `frontend/src/index.css`: keyframes `drawer-in` e `scrim-in`, com `prefers-reduced-motion` desligando a animação.

**Por quê:** É a primeira mudança estrutural do redesenho. Feita da forma mais contida possível: o formulário inteiro — 34 campos, 37 rótulos — continua exatamente como estava.

**Desvio consciente do DESIGN.md:** ele pede drawer de **400px**; ficou em **512px** (`max-w-lg`, a mesma largura do modal anterior). O formulário usa grade de 2 colunas dimensionada para 512px, e como `md:` responde à largura da *viewport* e não do container, estreitar para 400px espremeria as duas colunas em vez de empilhá-las. Refluir os 34 campos é tarefa própria.

**O que NÃO foi feito de propósito:** clicar no fundo não fecha o drawer. Seria o comportamento esperado, mas com 34 campos preenchidos um clique fora significaria perder o trabalho. Fica como decisão a tomar, não como esquecimento.

**Impacto:** Só apresentação e posicionamento. Nenhuma lógica de estado, validação ou salvamento foi tocada.

**Rollback:** `git revert <commit>`.

**Validação:** `npm run build` exit 0; keyframes e `prefers-reduced-motion` presentes no CSS. Baseline capturada antes da alteração (34 campos, 37 rótulos, caixa de 512px) para comparação depois do deploy.

---

## 2026-08-31 — Claude (via Cowork) — Estados semânticos (agenda, SLA, temperatura, pílulas)

**O quê:** Criados 4 estados semânticos no `tailwind.config.js` e migrados para eles todos os pastéis do Tailwind espalhados pelo `App.js`. **44 substituições**, zero `bg-*-50/100` restante.

Cada estado é um trio fundo / borda / tinta:

| Estado | Fundo | Borda | Tinta | Onde aparece |
|---|---|---|---|---|
| `info` | `#d3e6f5` | `#9cc6e6` | `#004b73` | temperatura fria, badge de engajamento |
| `ok` | `#cfe9da` | `#93cdb0` | `#0b6b45` | SLA normal, empresa preenchida, integrações ativas |
| `warn` | `#ffe3c4` | `#f0c393` | `#6b3b00` | temperatura morna, SLA em alerta, agenda de hoje, follow-up pendente |
| `risk` | `#ffd9d4` | `#f2b3ab` | `#93000a` | temperatura quente, SLA estourado, agenda vencida, erros |

**Por quê:** Esses tons carregavam significado (vencido, pendente, ganho), então não podiam simplesmente virar branco. Mas eram cores cruas do Tailwind, sem relação com o Deep Ocean. Agora o significado fica preservado e a cor passa a sair do sistema.

**Critério de escolha, medido nos dois eixos:**

1. Texto sobre o fundo tintado: mínimo 4,5:1 — obtido entre **5,10 e 7,57**.
2. Fundo tintado contra a superfície da página (`#f7f9ff`): mínimo 1,15:1 para o estado ser percebido — obtido entre **1,17 e 1,24**.

O segundo critério pegou um erro: a primeira paleta que montei tinha texto legível (5,71 a 8,60) mas fundos com apenas 1,03–1,09 de diferença da página — as linhas apareceriam praticamente brancas e o estado sumiria. Os tons foram escurecidos e remedidos.

**Impacto:** Só apresentação. Nenhuma regra de estado mudou — o que era vencido continua vencido.

**Rollback:** `git revert <commit>`.

**Validação:** `npm run build` exit 0; as 4 famílias geradas no CSS com os RGB corretos; nenhuma classe `bg-{emerald,cyan,violet,rose,amber,sky,red}-{50,100}` no bundle. CSS caiu de 5,82 para 5,67 kB.

---

## 2026-08-31 — Claude (via Cowork) — Painel de estatísticas da tela principal

**O quê:** Os cards do painel "Estatísticas" (aba CRM) deixaram de ter fundo pastel e passaram ao mesmo padrão do `StatCard`: branco, borda `line`, sombra `card`, rótulo colorido e valor em `text-ink`.

Antes: menta, ciano, azul, lavanda, rosa e amarelo, cada um com uma sombra colorida própria (`shadow-[0_12px_36px_-20px_rgba(...)]` em 6 variações).

**Por quê:** Era o que sobrava de arco-íris na tela principal, e destoava do resto já migrado. Reportado pelo usuário com print.

**Mapeamento de tom nos rótulos** (mesmos 5 do `StatCard`, já conferidos em contraste):

- neutro `#3f4850` — Total de Leads, Empresas, cards de segmento
- azul `#006194` — Novos, Em contato, Taxa de Conversão
- verde `#0b6b45` — Valor Convertido
- vermelho `#ba1a1a` — Perdidos
- âmbar `#ac6200` — Em negociação

**Impacto:** Só apresentação. Os pastéis que restam no bundle pertencem às linhas da agenda e do follow-up, onde a cor indica estado (vencido, pendente) — não foram tocados.

**Rollback:** `git revert <commit>`.

**Validação:** `npm run build` exit 0; `bg-cyan-50/80`, `bg-violet-50/80` e `bg-brand-50/80` ausentes do CSS. Bundle de CSS caiu de 6,04 para 5,82 kB.

---

## 2026-08-31 — Claude (via Cowork) — StatCard em Deep Ocean

**O quê:** O componente `StatCard` (linha ~438) deixou de usar gradientes saturados e passou a card branco com borda fina, como o `DESIGN.md` especifica e como o protótipo aprovado mostra.

Antes: 5 gradientes (`from-slate-900 to-slate-700`, `from-brand-600 to-cyan-500`, `from-emerald-600 to-teal-500`, `from-amber-500 to-orange-500`, `from-rose-600 to-pink-500`), todos com texto branco.
Agora: `bg-surface-card border border-line shadow-card`, valor em `text-ink`, e o **código de cor migrado do fundo para o rótulo**.

**Por quê:** Esses gradientes coloriam o Dashboard inteiro (24 cards) e eram o que restava fora da identidade Deep Ocean. Tirar a cor do fundo e deixá-la só no rótulo preserva a distinção entre grupos de métrica sem transformar a tela num vitral — e devolve legibilidade ao número, que é o que importa num painel.

**Tons dos rótulos, conferidos em contraste sobre branco** (mínimo 4,5 para texto pequeno):

| Grupo | Cor | Contraste |
|---|---|---|
| contagens | `#3f4850` | 9,32 |
| taxas | `#006194` | 6,69 |
| valor convertido | `#0b6b45` | 6,56 |
| pipeline | `#ac6200` | 4,67 |
| investimento | `#ba1a1a` | 6,46 |

Valor em `#181c20` sobre branco: 17,13.

**Impacto:** Só apresentação. A API do componente (`label`, `value`, `helper`, `tone`) não mudou, então nenhuma chamada precisou ser tocada — 24 usos seguem funcionando.

**Rollback:** `git revert <commit>`.

**Validação:** `npm run build` exit 0; os 3 tons novos presentes no CSS e as 4 classes de gradiente antigas ausentes do bundle (CSS caiu de 6,2 para 6,04 kB).

---

## 2026-08-31 — Claude (via Cowork) — Cabeçalho e botão primário em Deep Ocean

**O quê:** Substituídos os gradientes cravados à mão que definiam a cor do topo do sistema. Só apresentação.

- Cabeçalho: era `linear-gradient(135deg, rgba(15,23,42,.98), rgba(30,41,59,.96), rgba(8,145,178,.88))` — azul-ardósia com ciano. Agora `#002c45 → #004b73 → #006194`, derivado de `brand-900/700/600`.
- Barra de estatísticas: mesma família, `#002c45 → #005886`. Trocada junto porque fica encostada no cabeçalho e destoaria.
- Botão "Novo Lead": era `linear-gradient(135deg, #2563eb, #0891b2)` com `rounded-xl`. Agora `bg-brand-600` sólido, `rounded-full`, como o DESIGN.md especifica para ação primária.

**Por quê:** A Fase 1 remapeou 62 utilitários `blue-*` para `brand-*`, mas não alcançou valores arbitrários (`bg-[linear-gradient(...)]`). Eram justamente esses que pintavam os elementos mais visíveis da tela, o que fez a Fase 1 passar quase despercebida.

**Impacto:** Nenhuma lógica tocada. Restam os gradientes por `tone` do `StatCard` e 370 utilitários `slate`/`gray`.

**Rollback:** `git revert <commit>`.

**Validação:** `npm run build` exit 0; `#002c45` presente 7x no CSS compilado.

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
