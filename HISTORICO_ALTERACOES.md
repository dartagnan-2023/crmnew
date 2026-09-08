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

## 2026-09-08 — Claude (via Cowork) — Gráficos de evolução mensal deixam de obedecer ao filtro de data

**O quê:** os 6 gráficos de "por mês / evolução" do Dashboard passaram a olhar sempre os últimos 6 meses, ignorando o recorte de data. Arquivo: `frontend/src/App.js`.

São eles: **Entradas por mês**, **Evolução do valor convertido** e **Evolução do pipeline ativo** (sub-aba Leads); **Solicitações por mês**, **Valor orçado por mês** e **Valor fechado por mês** (sub-aba Orçamentos).

### O defeito

Esses gráficos montam **seis meses fixos, pré-preenchidos com zero**, e depois despejam neles apenas os registros que passaram pelo **filtro de período**. Com o padrão em 30 dias, só os dois meses mais recentes podiam ter número — os outros quatro apareciam como zero. **Não eram zero: eram mês filtrado para fora, exibido como se nada tivesse acontecido.**

**Reportado pelo usuário**, que viu abril, maio, junho e julho zerados e perguntou se havia algo errado. Havia.

**Origem, sem rodeios:** a construção é anterior a esta sessão — conferida em `f416ac0` e em `32e489a`, onde o padrão do período era `90d`. Com 90 dias o mesmo defeito escondia 2 meses em vez de 4, e por isso passava despercebido. A mudança do padrão para `30d`, feita nesta mesma data a pedido do usuário, **não criou o defeito, mas o tornou impossível de ignorar**. Deveria ter sido notado no momento em que o padrão foi alterado.

### A correção

O filtro do Dashboard foi partido em duas partes, porque os filtros são conjuntivos e separá-los não muda o resultado de quem aplica as duas:

- `leadPassaFiltrosDoDashboard` e `orcamentoPassaFiltrosDoDashboard` (escopo de módulo) concentram tudo **menos** a regra de data: vendedor, canal, segmento, campanha e follow-up.
- `dashboardLeadsBase` e `dashboardBudgetsBase` aplicam só essa parte. Alimentam os gráficos de evolução mensal.
- `dashboardFilteredLeads` e `dashboardMediaBudgets` continuam sendo a base **com** o recorte de data, e continuam alimentando todos os cartões de número e todos os demais gráficos, exatamente como antes.

Os três mapas mensais de cada memo saíram do laço filtrado por data e ganharam um laço próprio sobre a base sem data. O balde `monthlyMap.has(key)` já limita aos seis meses, então não é preciso nenhum filtro de data ali — e é justamente esse o ponto.

**Aviso na tela.** Cada um dos 6 cartões ganhou a linha: *"Sempre os últimos 6 meses. Este gráfico não segue o filtro de período; os demais filtros valem."* Sem isso, o operador veria abril no gráfico e abril fora dos cartões e não saberia em quem confiar.

### Decisão e alternativas descartadas

Escolha do dono do produto entre quatro opções. As descartadas:

- **Janela do gráfico acompanhar o período** (30 dias vira semanas, 90 vira 3 meses). Mais coerente, mas é uma reforma nos 6 gráficos.
- **Só avisar na tela e não mexer no cálculo.** Rápido, mas o gráfico continuaria inútil no padrão de 30 dias.
- **Voltar o padrão para 90 dias.** Uma linha, mas só troca 4 meses zerados por 2. Não corrige nada.

**Impacto:** nenhuma mudança de dado, de rota ou de schema — só de agregação no frontend. Os cartões de número não mudaram de comportamento. Quem filtra por vendedor, canal, segmento ou campanha continua vendo o gráfico responder a esses filtros.

**Rollback:** `git revert <commit>`.

**Nota de apuração, sobre um segundo sintoma:** o "Evolução do valor convertido" aparecia zerado inclusive em agosto e setembro. **Não é defeito.** O cartão "Taxa de Conversão" da mesma tela mostrava **0% e "0 ganhos"** no período — conferido em captura do próprio usuário. O gráfico só soma lead com status "ganho", então R$ 0,00 era a verdade. Vale registrar, porém, que esse gráfico lança o valor no mês em que o lead foi **criado**, e não no mês em que fechou: num ciclo de venda longo, um lead criado em julho e ganho em setembro cai em julho. Isso não foi alterado nesta correção.

**Validação executada:**

- `npm run build`: **exit 0**, os mesmos 4 warnings pré-existentes, comparados linha a linha. Nenhum warning novo.

**Publicação:** o deploy do commit `52af4da` (execução #199) **falhou no passo "Aguardar SSH do VPS responder"** — a porta 22 do VPS não respondeu em 6 tentativas. O passo de publicação foi pulado e **produção não foi alterada**, continuando no `4cfa224`. É a terceira ocorrência do mesmo problema intermitente (as duas primeiras em 02/09/2026, que motivaram a criação desse próprio passo de espera). Não tem relação com o código desta alteração. Reenviado em seguida.
- **Teste de ponta a ponta pelo navegador**, com backend real (camada do Sheets substituída por duplo em memória) e base semeada com 49 leads e 18 orçamentos distribuídos em 6 meses:
  - **Período 30 dias x 12 meses:** os cartões mudaram (17 leads / R$ 11.000 contra 49 leads / R$ 21.000) e os três gráficos de evolução ficaram **idênticos**, com os seis meses preenchidos. É exatamente o comportamento pretendido.
  - **Filtro que não é de data ainda vale:** filtrando por campanha, "Entradas por mês" foi de 5/7/9/11/13/4 para 3/4/5/6/7/2 e o pipeline caiu pela metade em todos os meses. O cartão foi de 17 para 9. Ou seja, a separação **não** desligou os outros filtros.
  - **Sub-aba Orçamentos:** "Solicitações por mês" passou a mostrar os seis meses (3 por mês, batendo com a semente) e as três notas aparecem.
  - Zero erros de console em todos os testes.

## 2026-09-08 — Claude (via Cowork) — Interações do cliente no orçamento

**O quê:** o orçamento passou a ter registro de interações, igual ao que o lead já tinha. Arquivos: `backend/server.js` e `frontend/src/App.js`.

Antes desta data **não existia nada disso no orçamento**. Conferido: a tabela `budgets` tem 29 colunas e nenhuma guarda interação; o único campo livre é `notes` ("Observações"). Foi verificado também, nos 186 commits que já tocaram o `App.js`, que o card do orçamento **nunca** teve um bloco de interações — ou seja, não houve remoção; é funcionalidade nova.

### O que foi feito

**Backend**

- Aba nova `budget_interactions` (`id`, `budget_id`, `interaction_at`, `channel`, `operator`, `notes`, `created_at`, `updated_at`), declarada em `SHEETS_CONFIG` e no `ensureHeaders`. É criada sozinha no boot, pelo `ensureSheetExists`.
- Quatro rotas, espelho das do lead: `GET`, `POST`, `PUT` e `DELETE` em `/api/budgets/:id/interactions`. Todas com `authMiddleware`, mesma proteção das demais rotas de orçamento.
- Helpers `normalizeBudgetInteraction`, `buildBudgetInteractionSummaryMap`, `buildBudgetInteractionSummaryForBudget` e `sortInteractionsDesc`, ao lado dos equivalentes do lead.
- `hydrateBudgets` ganhou um **segundo argumento opcional** com as interações e passou a devolver `interactions_count`, `last_interaction_at`, `last_interaction_channel` e `last_interaction_notes`. Quem chama sem o segundo argumento continua funcionando, com contador zerado.
- `GET /api/budgets` passou a ler as duas abas.

**Frontend**

- Bloco "Interações com o cliente" dentro do card do orçamento, com data e hora, canal (com sugestões), observação, totais e histórico recolhível — o mesmo desenho do bloco do lead.
- O bloco **só aparece ao editar**. Em "Novo Orçamento" ele não é renderizado, porque não há onde pendurar a interação antes de o orçamento existir. É a mesma regra do lead.
- Bloco separado "Contatos do lead de origem", **somente leitura**, quando o orçamento tem `lead_id` preenchido.
- Contador discreto "N int." ao lado do nome do cliente na lista, exibido só quando há pelo menos uma interação. Sem coluna nova, sem mexer na largura da tabela.

### Decisões e o porquê

1. **Armazenamento próprio, não reaproveitar o do lead.** A importação do ERP não preenche `lead_id` e não existe nenhuma rotina que ligue orçamento a lead automaticamente — o campo é preenchido à mão. Reaproveitar o histórico do lead deixaria o bloco inútil na maioria dos orçamentos. Além disso, mesmo quando há vínculo, as duas conversas são coisas diferentes: a do lead é a captação, a do orçamento é a negociação daquela proposta.

2. **O resumo NÃO virou coluna na aba `budgets`.** É calculado na leitura, a partir da aba de interações. Motivos, nesta ordem:
   - acrescentar coluna faz o `ensureHeaders` **reescrever a aba `budgets` inteira** no próximo boot — operação cara e arriscada sobre dado de produção;
   - sem coluna, a reimportação do ERP não tem como apagar o histórico, nem por descuido;
   - registrar uma interação passa a ser **uma** escrita, e não duas.

3. **Histórico do lead somente leitura.** Escolha do dono do produto entre três opções. A alternativa de gravar nos dois lugares foi descartada e não recomendada: inflaria o contador do lead e misturaria duas histórias de forma irreversível.

4. **Publicar o backend antes do frontend.** As rotas novas passam a existir antes de a tela chamá-las. O caminho inverso deixaria uma janela em que a tela chamaria rota inexistente.

**Impacto:** nenhuma coluna nova em aba existente; nenhuma rota existente mudou de contrato (apenas ganhou campos a mais na resposta de `GET /api/budgets`). A aba `budget_interactions` é criada na primeira subida do backend. Antes de existir, `GET /api/budgets` se comporta exatamente como antes — `readSheet` devolve vazio no HTTP 400 do Sheets.

**Ressalva conhecida:** `saveTable`/`loadTable` procuram o schema por `SHEETS_CONFIG[nome]`. Se alguém definir a variável de ambiente `SHEET_BUDGET_INTERACTIONS` com um nome diferente de `budget_interactions`, a gravação quebra. É exatamente o mesmo comportamento que já existe para `SHEET_LEAD_INTERACTIONS` e demais abas; não foi alterado para não introduzir inconsistência. **Não definir essa variável.**

**Rollback:** `git revert` dos dois commits. A aba `budget_interactions` pode ficar na planilha sem efeito nenhum — nada mais a lê. Nenhuma migração para desfazer, porque nenhuma coluna de aba existente foi tocada.

**Validação executada:**

- `npm run build` do frontend: **exit 0**, 4 warnings de ESLint — os mesmos 4 de antes, comparados linha a linha. **Nenhum warning novo**, o que confirma que todo estado e função criados estão em uso.
- **Backend real executado**, com a camada do Google Sheets substituída por um duplo em memória. Onze verificações: GET vazio, POST sem canal (400), POST em orçamento inexistente (404), dois POSTs válidos, GET ordenado do mais recente para o mais antigo, contador em `GET /api/budgets`, PUT, DELETE, GET final e chamada sem token (401).
- **Prova de que a reimportação do ERP não apaga nada:** com duas interações gravadas, foi rodado `POST /api/budgets/import` reenviando o mesmo `external_id` com valor e status diferentes. Resultado: valor atualizado de 7.500 para 8.900, `notes` sobrescrito pelo ERP, `representante` preservado e **as duas interações intactas**, com o contador ainda em 2.
- **Prova de que a aba `budgets` não é reescrita:** com a planilha semeada com os 29 cabeçalhos exatos de produção, o boot **não** emitiu o aviso `[WARN] Headers da planilha budgets incompletos`. O único registro de criação foi `[INIT] Criando aba ausente: budget_interactions`.
- **Teste de ponta a ponta pelo navegador** (Chromium/Playwright), com o frontend compilado falando com esse backend real, nos dois temas: o bloco aparece, o histórico expande, o bloco do lead vinculado aparece separado e rotulado, registrar uma interação pela tela levou o total de 2 para 3 e o contador da lista de "2 int." para "3 int." na hora. **Zero erros de console.**
- Testes unitários dos helpers de resumo, incluindo data inválida, orçamento sem interação, interação órfã sem `budget_id` e chamada de `hydrateBudgets` sem o segundo argumento.

**Observação levantada, não corrigida:** o botão "Registrar interação" usa `bg-slate-900 text-white`, copiado do bloco do lead. No tema escuro o botão quase não se separa do fundo — o texto continua legível, mas a borda do botão some. É um padrão que já existe no sistema inteiro (o "Cadastrar" da lista de orçamentos é igual). Não foi alterado aqui para manter o bloco idêntico ao do lead, como pedido. Corrigir é uma linha, e deve valer para os dois lugares ao mesmo tempo.

## 2026-09-04 — Claude (via Cowork) — Dashboard em sub-abas e qualidade dos gráficos

**O quê:** duas mudanças publicadas juntas, a pedido do usuário. Arquivos: `frontend/src/App.js` e `frontend/src/index.css`.

### 1. Sub-abas no Dashboard

O Dashboard tinha três seções empilhadas numa página só — Leads, Orçamentos e Mídia paga — e chegar em Mídia paga exigia rolar por 22 cartões e 10 gráficos. Viraram três sub-abas numa barra, com contador de volume ao lado de cada nome. Os filtros ficam **acima** da barra porque valem para as três: trocar de sub-aba não obriga ninguém a refiltrar.

**Migração dos 9 gráficos de orçamento.** A seção Orçamentos do Dashboard tinha 4 cartões e **zero gráficos**, enquanto a aba Orçamentos tinha nove. Os nove migraram para a sub-aba (funil, orçado x fechado por mês, perdas por motivo, aprovação por vendedor, por orçamentista, por representante, solicitações por mês, orçamentos por vendedor e por orçamentista). A aba Orçamentos fica com filtros, os 4 cartões do próprio filtro, e a lista com cadastrar/editar/excluir. A regra que ficou: **Dashboard analisa, abas operacionais fazem.**

Para os gráficos migrados responderem aos filtros do Dashboard e não aos da aba de origem, o memo `budgetDashboardData` passou a consumir `dashboardMediaBudgets` em vez de `budgetFilteredItems`. Conferido antes: os 10 usos de `budgetDashboardData` eram todos os gráficos migrados, nenhum outro consumidor.

### 2. Qualidade dos gráficos

**Geometria do gráfico de linha — o defeito mais grave.** `MiniLineChart` desenhava num `viewBox="0 0 100 100"` (um quadrado) sem `preserveAspectRatio`. O navegador encaixava o quadrado na altura e centralizava: medido em produção, o desenho ocupava **112px dentro de um svg de 355px**, ou seja **32%** da largura. Agora o viewBox tem a proporção do espaço real, `preserveAspectRatio="none"` estica de verdade e `vectorEffect="non-scaling-stroke"` mantém o traço com espessura constante. Medido depois: **96%**. Afeta 11 gráficos.

Junto: os valores ficavam numa grade de três colunas, então com 6 pontos quebravam em duas linhas e "jul" caía embaixo de "abr" — não havia correspondência entre o ponto e o rótulo. Viraram **eixo**, um rótulo por ponto, alinhados. O rótulo direto passou a marcar só o **pico e o último ponto**; um número em cada ponto é ruído e não se lê.

**Pontas da barra.** `MiniBarChart` usava `rounded-full`, arredondando também a ponta esquerda — o que descola a barra da linha de base e impõe largura mínima igual à altura. No funil, valores de 0,7% e 1,6% eram desenhados **do mesmo tamanho**: a barra superestimava o pequeno e apagava a diferença. Agora a ponta esquerda é reta, só a ponta do dado é arredondada, e há largura mínima de 2px para que valor diferente de zero sempre apareça. Rótulo e valor passaram para a mesma linha da barra, o que quase dobra quantas categorias cabem na mesma altura.

**Paleta de gráficos por tema.** As cores estavam cravadas em `CHART_COLORS` e **reprovavam no tema escuro**: o azul `#006194` dava 2,48:1 e o vermelho `#a4262c` dava 2,28:1 contra o cartão `#1a1f25`, sendo 3:1 o mínimo para marca de gráfico. Isso passou na publicação do modo escuro porque naquele dia foi medido o contraste do **texto**, elemento por elemento, e não o das **barras**. Agora os quatro papéis são variáveis CSS com um conjunto por tema, buscado com o validador até passar: `#0067b7`, `#007c3d`, `#cc3336`, `#cb7a00`. Duas ressalvas medidas e aceitas: o azul fica em 2,86:1 e a separação risco/positivo para daltonismo fica em ΔE 7,2 — as duas só são aceitáveis **porque** todo gráfico agora traz o valor escrito e o nome no eixo, então a cor deixou de ser o único canal. Está anotado no `index.css`: se os rótulos saírem, isto vira reprovação.

**Rótulos do StatCard.** O rótulo era pintado por um `tone` com hexadecimal cravado. Medido contra o cartão escuro: verde 2,53:1, vermelho 2,57:1, âmbar 3,55:1 — todos abaixo do mínimo de 4,5 para texto. E, mesmo no claro, aquela cor era decoração: verde, âmbar e vermelho não queriam dizer bom, atenção e ruim. Agora o rótulo é neutro sempre, e existe a variante `alerta` com tarja lateral para **um** cartão por painel — o mesmo recurso da tela de Leads.

**Hover e visão em tabela.** Nenhum dos gráficos tinha as duas coisas. Cada barra e cada ponto ganhou `title` com categoria e valor, e cada gráfico ganhou um alternador **"ver como tabela"** que troca o desenho pela mesma informação em texto. Serve de acessibilidade (quem não distingue as cores chega ao valor) e de uso real (copiar para planilha).

**Sobras de cor crua corrigidas de passagem:** `bg-emerald-600` com texto branco dava 3,77:1 e reprovava **nos dois temas, desde antes** — os três botões viraram contorno. `text-red-600` dava 3,43:1 no escuro e passou a usar o token `risk-ink`. E `bg-slate-900` no botão "Lançar Ads" era um preto fixo que quase encostava no fundo do cartão escuro; virou o azul da marca, já que é a ação principal daquele cabeçalho.

### 3. Período padrão

O padrão passou de 90 para **30 dias** nas duas telas (`dashboardPeriod` e `budgetPeriod`), por decisão do usuário. As demais opções continuam: 90 dias, 6 meses, 12 meses, personalizado e tudo.

**Registro de um alarme falso meu:** eu havia relatado que "últimos 90 dias" devolvia 468 numa tela e 855 noutra, sugerindo inconsistência. Não havia. O seletor do Dashboard estava em **30 dias** e o 468 é a contagem correta de 30 dias — bate exatamente com o cálculo independente. As duas telas já usavam a mesma regra de campo de data (`requested_at` com queda para `created_at`). O erro foi meu, por comparar o cartão de 30 com uma conta de 90.

**Impacto:** apresentação apenas. Nenhuma conta de indicador foi alterada, nenhuma chamada de API, nenhum campo. Backend intocado. Todos os 22 cartões e 23 gráficos continuam existindo — o que mudou foi onde ficam e como são desenhados.

**Rollback:** `git revert` do commit. Cópia anterior a esta alteração guardada em `App.js.2026-09-04-pre-redesign.backup` (estado do início do dia) — para voltar só esta mudança, o revert é o caminho.

**Validação:** `react-scripts build` completo (mesmas quatro advertências de lint anteriores, nenhuma nova). Geometria medida no navegador: uso da largura passou de **32% para 96%**. Contraste WCAG medido elemento por elemento, nas **três sub-abas e nos dois temas**: **zero reprovações** nas seis combinações — antes eram 4 no escuro e 1 no claro. Estrutura conferida: sub-aba Leads com 10 gráficos, Orçamentos com 9, Mídia paga com 4, e a aba Orçamentos mantendo a lista.

**Limite conhecido:** o rótulo do eixo x é distribuído em faixas de largura igual, enquanto os pontos têm um respiro nas bordas. Nos extremos há um pequeno desalinhamento entre o rótulo e o ponto. Perceptível só se for procurado.

## 2026-09-04 — Claude (via Cowork) — Modo escuro

**O quê:** Tema escuro no sistema inteiro, com controle de três estados (Claro / Escuro / Automático) no menu do usuário. Quatro arquivos: `frontend/tailwind.config.js`, `frontend/src/index.css`, `frontend/public/index.html` e `frontend/src/App.js`.

**Como funciona:** as cores do tema deixaram de ser hexadecimais fixos no `tailwind.config.js` e passaram a ser **variáveis CSS** no formato `rgb(var(--c-x) / <alpha-value>)`. O formato de canais separados por espaço é o que preserva os usos com opacidade que já existiam (`bg-risk/25`, `bg-ok/60`, `bg-warn-line/60`). Assim o tema é uma troca de valores no `index.css`, não uma segunda classe em cada elemento — os **326 usos de token que já existiam viraram tema escuro sem uma única edição**.

O tema é resolvido em JavaScript e estampado como `data-theme` no `<html>`. Por isso o CSS precisa apenas de um bloco claro e um escuro, sem duplicar a paleta numa media query. Quem escolhe "Automático" tem o `data-theme` trocado pelo próprio JS quando o sistema operacional muda, via listener em `matchMedia`. A escolha é guardada em `localStorage`, por navegador — decisão do usuário, para não mexer no backend.

Há um script curto em `public/index.html` que aplica o tema **antes do primeiro desenho**. Sem ele, quem usa o modo escuro veria a tela clara por uma fração de segundo a cada carregamento, porque o React só roda depois. Fica fora do bundle exatamente por causa dessa ordem.

**Varredura:** havia **394 cores cruas** fora do sistema de tokens (`bg-white`, `text-slate-900`, `border-slate-200` e afins). O perigo não era ficarem claras — era o oposto: um `text-slate-900` dentro de um contêiner que vira escuro dá texto preto em fundo preto. Foram convertidas **349** delas para tokens, no arquivo inteiro e não só na tela de Leads, porque meia varredura é a situação perigosa: o usuário abriria o drawer de edição e o encontraria ilegível. As que sobraram (botões escuros sólidos com texto branco, véus de modal em preto, alguns verdes) são legíveis nos dois temas.

**Separação de `brand-600` em dois papéis:** a marca era usada tanto como **preenchimento de botão** quanto como **cor de texto e link** (21 lugares). No escuro os dois papéis puxam para lados opostos: o preenchimento precisa escurecer para o texto branco em cima continuar legível, e o texto precisa clarear para ser legível sobre o fundo escuro. Criado o token `brand-ink` só para texto/link — no claro é o mesmo `#006194`, no escuro vira `#7bc2ff`.

**A paleta escura:** cinza de viés frio, matiz medida entre **208 e 214 graus** e saturação entre 15 e 19 por cento — a pedido explícito do usuário, que não queria o cinza arroxeado comum nesses temas (violeta ficaria entre 260 e 290 graus). Fundo `#12161a`, cartão `#1a1f25`, linha `#3b4650`.

**Correção de acessibilidade encontrada no caminho:** o token `ink-faint`, usado no texto secundário, era `#707881` e dava **4,06:1** sobre `surface-low` e 3,85:1 sobre `surface-mid` — abaixo do mínimo de 4,5 para texto. **Isso já estava errado antes do modo escuro.** Passou para `#666d75`, que dá 4,51:1 no pior caso.

**Defeito corrigido:** o véu do drawer de lead usava `bg-ink/45`. No tema claro isso dá um véu preto, correto; no escuro a tinta é quase branca e o véu **clareava a tela inteira**. Passou para `bg-black/55`, como os outros quatro modais do sistema. Só foi encontrado porque a verificação varreu o DOM procurando fundos claros no tema escuro, em vez de confiar na inspeção visual do print.

**Impacto:** apresentação apenas. Nenhuma chamada de API, regra de negócio ou campo alterado. Backend intocado. Quem não mexer em nada continua vendo o tema claro, porque o padrão é "Automático" e a maioria das máquinas está em claro.

**Ordem de publicação — importante para a próxima vez:** os quatro arquivos moram em quatro pastas diferentes e o editor web do GitHub publica uma pasta por vez, o que obriga a quatro commits e quatro deploys. Foram feitos **em sequência, esperando cada deploy terminar**, porque dois deploys simultâneos executariam `git reset --hard` e `npm run build` ao mesmo tempo na mesma pasta do VPS. E o `tailwind.config.js` recebeu **valores de reserva** em cada variável (`var(--c-x, 247 249 255)`) para que, chegando antes do `index.css`, o sistema continuasse idêntico ao que já estava no ar em vez de ficar sem cor nenhuma até o deploy seguinte.

**Rollback:** `git revert` dos quatro commits, ou reenvio dos arquivos anteriores. O `App.js` anterior a esta data está em `App.js.2026-09-04-pre-redesign.backup`, na raiz de `crmnew-temp`.

**Validação:** `react-scripts build` completo; verificação automatizada de **contraste WCAG elemento por elemento, nas quatro abas e nos dois temas**. Resultado na tela de Leads: **zero reprovações em ambos**. Restam 13 reprovações nas outras três abas, todas anteriores a esta alteração: rótulos com hexadecimal cravado no código (`#0b6b45` em "Valor Convertido", `#ba1a1a` em "Leads quentes", `#ac6200` em "Pipeline Ativo"), que não sabem trocar de tema; e os botões verdes "Importar planilha" e "Baixar relatório em Excel", que dão 3,77:1 com texto branco e **reprovam nos dois temas, desde antes**.

**Pendente:** aplicar às abas Dashboard, Orçamentos e E-mail marketing a mesma regra de cor da tela de Leads, o que resolveria essas 13 reprovações. Não feito — são abas ainda não revisadas com o usuário.

## 2026-09-04 — Claude (via Cowork) — Reformulação da tela principal (Leads)

**O quê:** Reformulação visual completa da aba CRM em `frontend/src/App.js`, aprovada por mockup antes da execução. Seis decisões:

1. **Temperatura deixou de usar matiz.** `LeadTemperatureBadge` usava vermelho para "Quente" e âmbar para "Morno" — exatamente as cores que `LeadSlaBadge` usa para atraso, na mesma célula. Vermelho significava "lead bom" e "prazo estourado" ao mesmo tempo. A temperatura virou um medidor de 3 barras em tinta neutra; o SLA passou a ser a única coisa colorida da linha. O SLA "no prazo" também perdeu o verde: é o estado esperado e não precisa disputar atenção.
2. **Fundo cheio virou tarja lateral de 3px.** No card de follow-up **toda** linha era `bg-warn` — fixo no código, sem condição — com 425 itens. Na agenda, os 1.201 vencidos pintavam a linha inteira de `bg-risk`. Agora: tarja de 3px e data em vermelho, fundo neutro.
3. **Cabeçalho enxuto.** O hero com gradiente, título de 4xl, saudação, quatro botões e as abas em segunda faixa ocupava cerca de 200px. Virou uma barra de 52px: marca, abas sublinhadas e menu do usuário. Perfil, Canais, Unificar Meta Ads e Sair entraram no menu — o Sair perdeu o vermelho sólido, que era a cor mais forte da tela. O menu usa `<details>` nativo, sem estado novo no componente.
4. **Painel de números.** A barra escura com três pílulas coloridas e os 15 cards em quatro cores viraram quatro KPIs (vencidos, novos sem contato, em negociação, conversão) com um só recebendo cor — o de vencidos, que é clicável e filtra a lista. O resto ficou atrás de "ver todos os números", reaproveitando o estado `showStats` que já existia.
5. **Tabela.** Removido o fundo `bg-ok/60` que pintava de verde toda linha com empresa preenchida (2.226 de 2.244 leads, ou seja, a tabela inteira). Nome e Empresa viraram uma coluna só; a empresa só aparece quando difere do nome, e o perfil só quando existe (antes "Sem perfil" era texto em quase toda linha). "Interações: N" deixou de ser pílula. As ações viraram botões com alvo maior, e **Excluir saiu de junto de Editar**, separado por divisória e vermelho apenas no hover.
6. **Um estilo de botão por papel.** Havia seis estilos na mesma tela (preto, azul, verde, azul claro, cinza, vermelho). Agora: um azul sólido por área para a ação principal, contorno para o resto, Lista/Kanban como chave de dois estados, e vermelho reservado para destruir.

**Correções de defeito incluídas:**

- **Centavos truncados.** Os cards de estatística usavam `.toLocaleString('pt-BR')` sem casas decimais, mostrando `R$ 156.647,2`. Passaram a usar `formatCurrencyBR`, que já existia no arquivo e já fazia isso certo.
- **Minutos ilegíveis.** O SLA mostrava `1160 min atrasado`. Nova função `formatSlaDuration`: acima de 60 minutos vira hora, acima de 24 horas vira dia.

**Impacto:** camada de apresentação apenas. Nenhuma chamada de API, regra de negócio ou campo foi alterado. Backend intocado. Todas as funções da tela foram preservadas — os 12 filtros, seleção em massa, Lista/Kanban, exportar, novo lead, copiar WhatsApp, ações rápidas da agenda (Feito/+1d/+3d), selos de e-mail, os 15 números do painel, e as quatro abas.

**Rollback:** `git revert` do commit correspondente, ou reenvio de `App.js.2026-09-04-pre-redesign.backup` (md5 `986f835d9867ebe4fd67d1f631dafb85`, blob sha `6bc633a0e765bc40dd2612f26ed58e18b6c258ef`), guardado na raiz de `crmnew-temp` — a extensão `.backup` já é ignorada pelo `.gitignore`. Commit base: `32e489a`.

**Validação:** `react-scripts build` completo rodado no container (compilou, mesmas quatro advertências de lint que já existiam antes — `stats`, `agendaOwnerFilter`, `canEdit` e uma dependência de `useMemo`; nenhuma nova). Tela renderizada e conferida com API simulada, em Lista e em Kanban, sem erro de página nem de console. Publicação feita fora do horário comercial, a pedido, porque **todo** deploy reinicia o PM2 e reescreve a pasta `build`.

**Limite conhecido:** na coluna "Situação", linhas com SLA estourado quebram em duas alturas porque a pílula de atraso é larga. Legível, mas deixa a altura das linhas irregular. Corrigir exigiria uma coluna separada para as interações — não feito.

## 2026-09-03 — Claude (via Cowork) — Cache de leitura das planilhas: 2s -> 25s

**O quê:** Em `backend/server.js`, `CACHE_TTL_MS` passou de 2000 para 25000 ms. Uma linha, com o override por variável de ambiente `SHEETS_CACHE_TTL_MS` mantido.

**Por quê:** A cota do Google Sheets é de cerca de **60 requisições de leitura por minuto por usuário**. Contagem real por rota, verificada no código: `GET /api/leads` faz 4 leituras (leads, canais, interações, follow-ups), `GET /api/stats` faz 2, `GET /api/budgets` faz 1. A tela atualiza sozinha a cada 30 segundos, ou seja, cerca de 8 leituras por minuto por usuário aberto. Isso dava um **teto prático de aproximadamente 7 usuários simultâneos sem ninguém salvando nada** — depois disso, HTTP 429. Com o cache em 2 segundos e o ciclo da tela em 30, o cache praticamente nunca acertava: cada usuário pagava a leitura inteira. Em 25 segundos, usuários simultâneos passam a compartilhar a mesma leitura e o teto deixa de existir na prática.

**Por que 25 e não 30:** fica logo abaixo do ciclo da tela, então o dado exibido nunca é mais velho do que já seria com o poll de 30 segundos.

**Impacto — e por que NÃO há risco de perder gravação:** todas as rotas de escrita chamam `loadTable(..., true)`, que ignora o cache e força leitura fresca da planilha. Foi auditado rota por rota (exemplos conferidos: `PUT /api/budgets/:id` -> 2 leituras frescas, 0 do cache; `PUT /api/leads/:id` -> 1 fresca, 0 do cache). Além disso, `writeSheet` e `saveSheetRow` invalidam o cache da tabela após gravar. O único efeito da mudança é a **idade do dado exibido**, que já era limitada pelo ciclo de 30 segundos da tela.

**Efeito colateral aceito:** uma alteração feita direto na planilha do Google (fora do CRM) pode demorar até 25 segundos a mais para aparecer. Antes eram até 2 segundos.

**Rollback:** duas opções. (1) Sem deploy: definir `SHEETS_CACHE_TTL_MS=2000` no `.env` do servidor e reiniciar o PM2. (2) Com deploy: `git revert` do commit correspondente.

**Validação:** `node --check` no arquivo antes de publicar; conferência de md5 entre a cópia local e a publicada; deploy acompanhado até o fim; e medição de latência em produção depois de no ar.

**Limite conhecido:** isto reduz o **consumo de cota**, não o custo de cada leitura. `readSheet` continua lendo o intervalo `A:AZ` (52 colunas) independentemente da largura real da tabela, e toda gravação continua relendo a planilha inteira antes de gravar. Reduzir o intervalo lido é o próximo ganho de performance disponível, ainda não executado.

## 2026-09-03 — Claude (via Cowork) — Ambiente local quebrado e rota de publicação alternativa

**Não é alteração de código.** Registro operacional, para não se perder o diagnóstico.

**O quê:** O ambiente Linux isolado do Claude Desktop (`device_bash`) parou de subir nesta máquina. Erro constante: `Workspace unavailable. The isolated Linux environment on this device failed to start.` Persistiu após reinício completo do aplicativo. Consequência: não é possível rodar `git`, `npm` nem qualquer comando diretamente no `crmnew-temp`.

**O que continua funcionando:** a ponte com a máquina está de pé — listar diretórios, ler arquivos (`device_stage_files`) e escrever arquivos (`device_commit_files`) funcionam normalmente. O container na nuvem clona o repositório do GitHub, edita e roda o build completo. O que falta é apenas executar comandos na máquina do usuário.

**Rota de publicação sem o ambiente Linux:**
1. Ler o arquivo da máquina do usuário (stage) ou do clone do GitHub no container.
2. Editar e validar no container (parser JSX + `react-scripts build`).
3. Escrever de volta na máquina do usuário (commit de arquivo).
4. Publicar pelo **GitHub web**, na sessão autenticada do navegador do usuário — commit direto na `main`, que dispara o deploy.
5. Conferir o deploy pela API do GitHub e o resultado em produção pelo navegador.

**Limite conhecido:** o terminal do Windows não serve de alternativa. O sistema concede terminais e IDEs apenas em modo *click* — dá para ver e clicar, não para digitar. Foi verificado, não presumido.

**Limpeza de git executada nesta data** (pelo usuário, a pedido, porque exigia shell): removidos `.git/packed-refs.lock` e `.git/refs/remotes/origin/teste-permissao-workflow.lock`, apagada a ref órfã `refs/remotes/origin/teste-permissao-workflow` e atualizada a `main` local. Esses arquivos eram resíduo de comandos anteriores cujo shell não conseguia apagar arquivos, e travariam o próximo `fetch`/`push`.

**Estado verificado após a limpeza:** `main` local, `claude/fase1-tokens`, `origin/main` local e `main` no GitHub — todos em `7bf57d6`. `App.js` local com md5 idêntico ao publicado. Produção no ar servindo `main.9e3d0e79.js`.

**Pendência:** o ambiente Linux do Claude Desktop. Provável causa de raiz: componente de virtualização (WSL2/Hyper-V) da máquina. Não diagnosticado a fundo — exigiria comando administrativo, que não foi executado.

## 2026-09-02 — Claude (via Cowork) — Deploy: espera da porta SSH antes de publicar

**O quê:** Novo passo `Aguardar SSH do VPS responder` em `.github/workflows/deploy.yml`, entre o checkout e o deploy. Testa a porta 22 do VPS até 6 vezes, com 30s de intervalo (até cerca de 3 minutos), e só libera o deploy quando a porta responder. Se não responder nas 6 tentativas, o job falha com mensagem explícita de que **produção não foi alterada**, porque o deploy nem chegou a começar.

**Por quê:** Duas falhas em 02/09/2026 com `dial tcp ***:22: i/o timeout`, ambas resolvidas por reexecução manual do job. O site seguia respondendo em 443 nas duas vezes, ou seja, o VPS estava no ar e apenas a porta 22 ficou inacessível a partir dos runners do GitHub. Sem o passo novo, cada ocorrência exigia alguém percebendo a falha e reexecutando na mão — e, se ninguém percebesse, o deploy simplesmente não acontecia.

**Limite conhecido:** cobre falha de **conexão**, que é o modo observado. **Não** cobre queda no meio de um deploy já iniciado — para isso seria preciso reestruturar o workflow (mover o script para arquivo e usar `script_path` com um segundo passo condicional), tarefa maior e de risco mais alto, não executada.

**Como foi publicado — registrar para a próxima vez:** o push por linha de comando foi **recusado pelo GitHub**: `refusing to allow a Personal Access Token to create or update workflow .github/workflows/deploy.yml without workflow scope`. O token "CRM - Claude" tem permissão de Contents, não de Workflows. Com autorização explícita do usuário, o commit foi feito pelo **editor web do GitHub** na sessão dele. Depois disso, o arquivo publicado foi conferido contra a cópia local: **md5 idêntico** (`9d2a7df01db756eaa954a501cfd41294`), `diff` vazio e YAML válido com os três passos na ordem certa.

**Pendência RESOLVIDA no mesmo dia:** o usuário concedeu **Workflows: Read and write** ao token (a tela do GitHub exigiu confirmação de identidade por e-mail, feita por ele — Claude não digita código de autenticação nem senha). Verificado empurrando uma alteração no `deploy.yml` para um branch descartável `teste-permissao-workflow`: o push foi **aceito**. O branch foi apagado do GitHub (confirmado: HTTP 404) e o arquivo local voltou ao md5 original `9d2a7df01db756eaa954a501cfd41294`. O teste usou branch justamente para **não tocar na `main`** e não disparar deploy — conferido: os runs continuam sendo apenas os da `main`. Alterações futuras em pipeline já podem ser publicadas direto por linha de comando.

**Rollback:** `git revert 9b3ea85` — mas o revert também precisará ser publicado pelo editor web, pela mesma restrição de escopo.

**Validação:** YAML validado localmente antes do commit; conferência de md5 contra o arquivo publicado; e o **próprio deploy seguinte exercitou o passo novo**: `Aguardar SSH do VPS responder -> success (0s)` (porta respondeu na primeira tentativa), `Deploy to VPS -> success (117s)`, job concluído com sucesso.

## 2026-09-02 — Claude (via Cowork) — Correção: "sem motivo" contaminava o gráfico de perdas

**O quê:** Em `budgetDashboardData`, a condição que deveria excluir orçamentos sem motivo de perda era `normalizeOptionValue(lossReason) !== 'sem motivo'` (com espaço), enquanto o fallback atribuído logo acima é `'sem_motivo'` (com underscore). `normalizeOptionValue` não troca underscore por espaço, então a condição era **sempre verdadeira** e todo orçamento sem motivo entrava no gráfico de perdas como se fosse um motivo. Passou a comparar contra `['sem_motivo', 'sem motivo', '']`.

**Terceira ocorrência da mesma família de bug hoje**, depois de `nao_feito` e `sem_perfil`: valor de fallback com underscore comparado contra texto com espaço.

**Gravidade medida em produção, no momento da correção:** a barra `sem_motivo` trazia **781 orçamentos e R$ 3.078.302,79** — várias vezes a soma de todos os motivos reais juntos (Prazo R$ 16.528,00; Preço R$ 9.167,13; Sem retorno R$ 1.725,46; Outros R$ 1.282,79; Escopo R$ 20,00). O gráfico de perdas era ilegível: uma barra cheia e cinco fatias invisíveis.

**Por que só apareceu agora:** o defeito é antigo e já estava visível como contagem (`sem_motivo 787`), mas passava despercebido entre números de mesma ordem de grandeza. Ao passar a barra para **valor**, a distorção ficou impossível de ignorar. Foi encontrado na conferência em produção da etapa 2, não em revisão de código.

**Impacto:** O gráfico "Perdas por motivo" passa a mostrar apenas motivos reais. Nenhum dado deixou de existir — orçamento sem motivo simplesmente não é mais contado como motivo.

**Rollback:** `git revert <commit>`.

**Validação:** parser JSX OK, build com sucesso (238.99 kB, +7 B) e conferência dos motivos em produção após o deploy.

## 2026-09-02 — Claude (via Cowork) — Gráficos, etapa 2: análise de orçamentos

**Correção de premissa registrada:** eu havia dito ao usuário que "a seção Orçamentos não tem nenhum gráfico". Isso vale para a **aba Dashboard**; a **aba Orçamentos** já tinha 6 gráficos, alimentados por `budgetDashboardData` e pelos filtros do módulo. A etapa 2 reformou esses 6 e acrescentou 3, em vez de duplicar gráficos numa aba nova.

**Perguntas que a diretoria escolheu responder** (as quatro): onde o orçamento trava, quanto entra x quanto fecha, quem produz e quem fecha, por que perdemos.

**Dados novos em `budgetDashboardData`:** `estimatedMonthlyMap` (valor orçado por mês da solicitação), `lossValueMap` (valor orçado perdido por motivo), e três mapas de desempenho por pessoa (`total`, `aprovados`, `valorOrcado`, `valorFechado`) para vendedor, orçamentista e representante, via o helper `acumularDesempenho`. Saídas novas: `estimatedEvolution`, `aprovacaoPorVendedor`, `aprovacaoPorOrcamentista`, `aprovacaoPorRepresentante`.

**Gráficos, um por pergunta:**

1. **Funil de orçamentos** — substitui "Status dos orçamentos". Agora em ordem de funil (`BUDGET_STATUS_OPTIONS`), com etapa zerada visível. Antes vinha ordenado por volume, o mesmo defeito do funil de leads. `statusMap` passou a ser chaveado pelo status normalizado.
2. **Valor orçado e valor fechado por mês** — duas séries rotuladas no mesmo card, substituindo o card que mostrava só o fechado. O rótulo diz explicitamente a base temporal de cada série: orçado pelo **mês da solicitação**, fechado pelo **mês do fechamento**. São recortes diferentes e o card não deixa isso implícito.
3. **Perdas por motivo** — a barra passou a ser o **valor orçado perdido**, com a quantidade entre parênteses no rótulo. Antes era só contagem, sem peso financeiro. Usa `showZeros` para o motivo não sumir quando o valor for zero.
4. **Aprovação por vendedor / por orçamentista / por representante** — três gráficos novos. Barra = taxa de aprovação; rótulo = nome e total de orçamentos.

**Decisão registrada — ordenação da taxa de aprovação:** os três gráficos de aprovação são ordenados por **volume**, não pela taxa. Ordenar pela taxa colocaria no topo quem tem 1 orçamento e 1 aprovação (100%), o que engana a leitura. O total vai no rótulo exatamente para que a taxa nunca seja lida sozinha. Está escrito em comentário no código e em nota sob o gráfico.

**Nota sobre o valor perdido:** usa `budget_value`, não `closed_value`, pela mesma razão já registrada — orçamento reprovado não fecha valor.

**Preservado:** "Solicitações por mês", "Orçamentos por vendedor" e "Orçamentos por orçamentista" continuam existindo, agora na paleta unificada. Nenhum gráfico foi eliminado sem substituto que contenha a mesma informação.

**Impacto:** Somente leitura, tudo calculado em memória a partir de `budgetFilteredItems` — os gráficos respeitam os filtros do módulo, inclusive o de exclusão de vendedor. Nenhuma escrita, nenhuma chamada de API nova.

**Rollback:** `git revert <commit>`.

**Validação:** parser JSX OK e `react-scripts build` com sucesso (238.98 kB, +677 B). Conferência em produção após o deploy.

## 2026-09-02 — Claude (via Cowork) — Gráficos, etapa 1: correção dos 14 já existentes

**Contexto:** O Dashboard já tinha 14 gráficos. O pedido de "representar melhor os números" foi tratado primeiro como correção do que existe, e só depois como criação (etapa 2, gráficos de orçamento).

**O quê:**

1. **`MiniBarChart` parou de esconder dados.** O componente cortava a lista nos 6 primeiros e descartava qualquer item com valor zero, sem nada na tela indicando isso. Medido antes da correção: "Leads por canal" exibia 6 canais enquanto o filtro do CRM lista 11. Agora o corte continua (legibilidade), mas o restante vira uma barra **"Outros (N)"** somada e o rodapé declara o total de itens. Novas props: `limit`, `showZeros`, `aggregateRest`.
2. **"Taxa por temperatura" recebeu `aggregateRest={false}`.** Somar porcentagens numa barra "Outros" produziria número sem significado. Esse gráfico só corta, nunca agrega.
3. **"Funil por status" passou a sair em ordem de funil.** Estava ordenado por volume, o que colocava *Perdido* entre *Proposta enviada* e *Novo* — um funil fora de ordem é ranking, não funil. Agora segue a ordem de `STATUS_OPTIONS` (Novo → Em contato → Proposta enviada → Negociação → Ganho → Perdido), com status zerado visível em vez de sumir. Status desconhecido aparece no fim, nunca é descartado.
4. **`statusMap` passou a ser chaveado pelo status normalizado**, para casar com os `value` de `STATUS_OPTIONS` na montagem do funil.
5. **Rótulo cru corrigido.** "Perfis de cliente" exibia `sem_perfil`. O código usa `lead.segment || 'sem_perfil'` como fallback, mas em `SEGMENT_OPTIONS` esse caso é `{ value: '', label: 'Sem perfil' }`, então a busca nunca casava. Mesma família do bug do `nao_feito`.
6. **Legendas nos cards de duas séries.** "Investimento x Leads" e "ROAS estimado x fechado" empilhavam dois gráficos sem nada dizendo qual era qual — identidade apenas pela cor, e sem legenda. Novo componente `ChartSeriesLabel` nomeia cada série.
7. **Paleta unificada e validada.** As cores eram 7 hexadecimais chumbados (`#2563eb`, `#e11d48`, `#dc2626`, `#7c3aed`, `#f97316`, `#059669`, `#0f766e`), anteriores ao Deep Ocean. Agora existe `CHART_COLORS`, atribuída por **função do dado**: `volume` `#006194`, `positivo` `#0f8a5f`, `risco` `#a4262c`, `atencao` `#b26a00`.

**Como a paleta foi escolhida:** rodada no validador de paleta (não escolhida a olho). Os quatro tons passam em faixa de luminosidade, piso de croma, separação para daltonismo (protan/deutan/tritan, pior par ΔE 8,0 sob `--pairs all`) e contraste contra a superfície do card. O par vermelho↔verde fica em ΔE 8,8, acima do alvo de 8, e mesmo assim nunca depende só de cor: toda barra carrega rótulo de texto ao lado. **Não trocar essas cores sem revalidar** — está escrito em comentário no código.

**Impacto:** Nenhum cálculo de métrica alterado, exceto onde o resultado exibido estava errado por construção (ordem do funil e itens ocultos). Nenhuma leitura de API, nenhuma escrita. Números que antes não apareciam passam a aparecer — é esperado que o Dashboard mostre mais linhas em "Leads por canal" e "Campanhas".

**Rollback:** `git revert <commit>`.

**Validação:** parser JSX OK, `react-scripts build` com sucesso (238.3 kB, +436 B), validador de paleta com todos os checks em PASS. Conferência visual em produção após o deploy.

## 2026-09-02 — Claude (via Cowork) — Remoção de dois cards duplicados na seção Mídia paga

**O quê:** Removidos os cards **"CPL"** e **"Orçamento estimado"** do Dashboard, e a segunda fileira da seção de mídia foi dissolvida: "Estimado por lead" e "Fechado por lead" passaram para a mesma grade dos demais, agora como `StatCard` (antes eram `div` com `UI_CARD`/`UI_STAT`, sem linha de apoio e com rótulo de cor diferente). A seção Mídia paga foi de 8 para 6 cards, em uma única grade.

**Por quê:** Duplicidade pura, autorizada pelo usuário. `CPL` já aparecia no rodapé do card "Leads gerados" (`CPL R$ X`) e `estimatedReturn` já era o rodapé do card "ROAS estimado". Dois números idênticos em dois lugares da mesma seção.

**Rodapés novos:** "Estimado por lead" recebeu `Orçado ÷ leads gerados` e "Fechado por lead" recebeu `Fechado ÷ leads gerados`, que é literalmente o cálculo em `App.js` linhas 2167-2168 (`estimatedReturn / leadsGenerated` e `closedReturn / leadsGenerated`). Conferido no código antes de escrever o rótulo.

**Impacto:** Nenhum cálculo alterado. Nenhum dado deixou de existir — os dois valores removidos continuam visíveis nos rodapés dos cards onde já apareciam. Bundle diminuiu 67 B.

**Rollback:** `git revert <commit>`.

**Validação:** parser JSX OK e `react-scripts build` com sucesso (237.87 kB, -67 B).

**Próximo passo combinado com o usuário (ainda não iniciado):** revisar a representação visual dos números do Dashboard — gráficos de barra, pizza e afins no lugar de parte dos cards.

## 2026-09-02 — Claude (via Cowork) — Dashboard: separação entre Leads, Orçamentos e Mídia paga

**O quê:** Reorganização visual das 6 fileiras de cards do topo da aba Dashboard. Antes eram 24 cards empilhados em 6 grids idênticos, sem título, com as naturezas intercaladas: fileira 1 lead, 2 orçamento, 3 mídia, 4 e 5 lead de novo, 6 mídia. Agora estão em três seções com cabeçalho e linha divisória:

- **Leads** (Comercial) — Leads Totais, Taxa de Conversão, Valor Convertido, Pipeline Ativo, Prospects, Clientes, Perdidos, Follow-up vencido, Leads quentes, mornos, frios, SLA estourado.
- **Orçamentos** (Orçamentação) — Orçamentos, Taxa de Aprovação, Valor Orçado, Valor Fechado.
- **Mídia paga** (Marketing) — Investimento, Leads gerados, ROAS estimado, ROAS fechado, CPL, Orçamento estimado, Estimado por lead, Fechado por lead.

**Por quê:** Pedido do usuário a partir de print da tela: "o que é lead e o que é orçamento tem que ficar separado".

**Impacto:** Puramente de layout. **Nenhum card foi removido, nenhum valor recalculado, nenhuma fonte de dado alterada** — os mesmos 24 cards, com as mesmas expressões, apenas reordenados e agrupados. A reorganização foi feita por script que extraiu os 6 blocos existentes e os remontou na nova ordem, sem redigitar o conteúdo dos cards, justamente para não introduzir divergência.

**Redundâncias observadas, não alteradas:** "CPL" aparece duas vezes (como helper do card "Leads gerados" e como card próprio na seção de mídia); "Orçamento estimado" repete o valor que já é o helper do card "ROAS estimado". Nada foi removido sem autorização; anotado para decisão.

**Rollback:** `git revert <commit>`.

**Validação:** parser JSX OK e `react-scripts build` com sucesso (237.93 kB, +202 B). Conferência visual em produção após o deploy.

## 2026-09-02 — Claude (via Cowork) — Correção do ROAS estimado e exportação de orçamentos

**O quê:**
1. **Correção (autorizada pelo usuário).** No dashboard de mídia, `!['reprovado', 'nao feito'].includes(status)` passou a `'nao_feito'`. Era o mesmo erro de underscore corrigido antes no somatório: como `'nao feito'` nunca casava, orçamentos com status `nao_feito` estavam sendo somados ao **valor estimado** do canal, inflando o ROAS estimado.
2. **Nova função `exportBudgetsXlsx`.** Exporta `budgetFilteredItems` — ou seja, exatamente o que está na tela, respeitando período, datas, status, vendedor (inclusive o modo "exceto"), orçamentista, representante e busca. Gera `.xlsx` via SheetJS (`XLSX`), já presente no projeto e usado na exportação de contatos. Arquivo `orcamentos-AAAA-MM-DD.xlsx`, aba "Orçamentos".
3. **Dois botões** ("Exportar planilha" no cabeçalho do módulo e "Exportar" na barra da tabela operacional), ambos chamando a mesma função.

**Colunas (20):** ID, ID externo (ERP), Cliente, Empresa, Status, Vendedor, Orçamentista, Representante, Filial, Pedido do cliente, Plano de pagamento, Motivo da perda, Canal, Campanha, Valor orçado, Valor fechado, Solicitado em, Enviado em, Fechado em, Observações.

**Decisões de formato:** Status e Motivo da perda saem com o rótulo legível ("Em orçamento", não `em_orcamento`), resolvidos por `BUDGET_STATUS_OPTIONS` / `BUDGET_LOSS_REASON_OPTIONS`. Os dois campos de valor saem como **número**, não texto, para a planilha somar e permitir tabela dinâmica. Datas usam `formatDateBR`, mas com guarda: `formatDateBR` devolve `'-'` quando vazio, o que poluiria a planilha, então campo vazio sai vazio.

**Impacto:**
- **O ROAS estimado do dashboard de mídia vai cair** para o canal que tiver orçamento "não feito" (na base atual, 2 registros somando R$ 16.533,06). Essa queda é a correção, não uma regressão: o número anterior estava inflado.
- A exportação é somente leitura. Não escreve em planilha, não chama API, roda inteiramente no navegador a partir dos dados já carregados.
- Antes desta entrega o sistema não tinha nenhuma exportação de orçamentos.

**Rollback:** `git revert <commit>`. Um único arquivo de frontend; reverter devolve o botão e o cálculo ao estado anterior sem tocar em dado gravado.

**Validação:** parser JSX OK e `react-scripts build` com sucesso (237.73 kB, +465 B).

## 2026-09-02 — Claude (via Cowork) — Valor de "Enviado" e "Não feito" + correção do contador de não feitos

**O quê:**
1. **Correção de bug.** `buildBudgetStatsSummary` comparava `status === 'nao feito'` (com espaço), mas o valor gravado é `nao_feito` (com underscore) — é o `value` declarado em `BUDGET_STATUS_OPTIONS`. `normalizeOptionValue` só remove acento, apara espaços das pontas e baixa a caixa; **não** troca underscore por espaço. Resultado: o contador `naoFeitos` era **sempre 0**. Passou a comparar `'nao_feito'`.
2. `valorEnviado` e `valorNaoFeito` acumulados a partir de `budget_value`.
3. O card "Orçamentos" da aba Orçamentos passou a exibir duas linhas de apoio: `N enviados · R$ X` e `M não feitos · R$ Y`. O `helper` do `StatCard` agora aceita nó React (dois `<span className="block">`), não só texto.

**Por quê:** Pedido da diretoria para fechar a régua de valor por status, junto com o valor reprovado. O bug 1 apareceu ao conferir os dados antes de exibir: sem corrigir, o card mostraria "0 não feitos · R$ 0,00", número falso.

**Distribuição verificada na base no momento da alteração (1.100 registros):** em_orcamento 1.048 (R$ 3.923.192,61) · aprovado 31 (R$ 65.987,90 orçado / R$ 65.146,67 fechado) · novo 8 (R$ 192.871,07) · reprovado 7 (R$ 10.687,93) · enviado 4 (R$ 9.747,10) · nao_feito 2 (R$ 16.533,06). Em todos os status exceto "aprovado", `closed_value` é zero — por isso o valor exibido é sempre o **orçado**.

**Impacto:** O contador de "não feito" sai de 0 para o número real (2 na base atual). Nenhuma escrita, nenhuma alteração de API ou planilha. Os cards do Dashboard (`dashboardBudgetStats`, linhas ~4354) usam o mesmo somatório e portanto também passam a contar "não feito" corretamente, mas o layout deles não foi alterado.

**BUG CONHECIDO, AINDA NÃO CORRIGIDO (autorização pendente):** a mesma comparação errada existe na linha ~2117, no dashboard de mídia: `!['reprovado', 'nao feito'].includes(status)`. Como `'nao feito'` nunca casa, os orçamentos "não feito" (**R$ 16.533,06** hoje) estão sendo somados ao **valor estimado**, inflando o ROAS estimado do canal deles. Não corrigido nesta entrega porque altera um número que a diretoria já acompanha — corrigir fará o ROAS estimado cair. Aguardando decisão.

**Rollback:** `git revert <commit>`. Exibição e cálculo em memória, em um único arquivo de frontend.

**Validação:** parser JSX OK, `react-scripts build` com sucesso (237.27 kB, +69 B), e conferência dos valores em produção contra recálculo independente feito direto sobre a API.

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
