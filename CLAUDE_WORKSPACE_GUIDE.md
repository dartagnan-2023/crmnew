# CLAUDE Workspace Guide - CRM BHS

Este arquivo existe para permitir que o Claude entre no projeto e programe com contexto suficiente, sem depender da conversa.

## Objetivo do projeto

O CRM BHS é um sistema de vendas e relacionamento baseado em:

- backend Node.js/Express
- frontend React
- banco em Google Sheets
- deploy por GitHub Actions e VPS

O sistema já possui módulos de:

- CRM de leads
- dashboards
- orçamentos
- exportação/importação
- agenda de follow-up
- integração MailRelay
- integração OmniChat
- servidor MCP

## Onde mexer

Arquivos principais:

- [backend/server.js](./backend/server.js)
- [frontend/src/App.js](./frontend/src/App.js)
- [.github/workflows/deploy.yml](./.github/workflows/deploy.yml)
- [MCP_CLAUDE_SETUP.md](./MCP_CLAUDE_SETUP.md)
- [README.md](./README.md)

Arquivos de apoio úteis:

- [backend/mcp.env.example](./backend/mcp.env.example)
- [backend/mcp.nginx.example.conf](./backend/mcp.nginx.example.conf)
- [DEPLOY_MANUAL_INSTRUCTIONS.md](./DEPLOY_MANUAL_INSTRUCTIONS.md)

## Regras de trabalho

1. Faça mudanças pequenas e localizadas.
2. Preserve comportamento existente.
3. Não remova lógica antiga sem confirmar impacto.
4. Sempre valide antes de publicar.
5. Sempre suba para `main` quando a mudança estiver pronta.
6. Nunca dê `git reset --hard` em mudanças do usuário.
7. Nunca apague arquivos que você não criou ou não entende.
8. Se houver risco de regressão, faça fallback primeiro.

## O que é crítico não quebrar

- login e autenticação
- criação/edição/exclusão de leads
- dashboards do CRM
- orçamentos
- exportação/importação de planilhas
- agenda de follow-up
- integração MailRelay
- integração OmniChat
- MCP
- deploy automático via GitHub Actions

## Fluxo padrão de programação

### 1. Entender o contexto

Leia primeiro:

1. `README.md`
2. `MCP_CLAUDE_SETUP.md`
3. `.github/workflows/deploy.yml`
4. os trechos relevantes de `backend/server.js`
5. os trechos relevantes de `frontend/src/App.js`

### 2. Implementar

- Prefira alterações pequenas.
- Reutilize funções já existentes.
- Preserve nomes e contratos já usados pelo frontend/backend.
- Se mudar payload, ajuste os dois lados.

### 3. Validar

Execute sempre:

```bash
node --check backend/server.js
cd frontend && npm run build
git diff --check
```

> **Nao use `node --check frontend/src/App.js`.** Ele nao valida esse arquivo.
> Testado em 31/08/2026: injetamos um erro grosseiro de JSX numa copia do
> `App.js` e o comando **retornou 0 (sucesso)**. O mesmo `node --check` rejeita
> corretamente um arquivo JSX pequeno e um arquivo com erro de JS puro — o
> problema e especifico deste arquivo, que comeca com `import`, e tratado como
> ESM e nao passa por analise sintatica completa.
>
> Quem confiou nesse passo achou que estava validando o frontend e nao estava.
> **So `npm run build` valida o frontend.**
>
> O `node --check backend/server.js` continua valido: o backend e CommonJS e nao
> tem JSX.

### Como commitar sem gerar ruido

O repositorio tem divergencia de fim de linha (CRLF/LF) em cerca de 39 arquivos.
Medido em 31/08/2026: `git diff` acusa 36.657 insercoes contra 36.657 delecoes
(numero identico) e `git diff --ignore-cr-at-eol` volta **vazio** — ou seja, zero
mudanca real de conteudo.

Por isso:

- **Nunca** use `git add .` nem `git add -A`. Um commit desses teria dezenas de
  milhares de linhas e esconderia alteracao verdadeira no meio.
- Sempre `git add <caminho/do/arquivo>`, um a um.
- Para ver o que realmente mudou: `git diff --ignore-cr-at-eol`.

Normalizar o fim de linha de vez e uma tarefa propria, de alto impacto, que
precisa ser combinada com quem mais mexe no repositorio.

### 4. Versionar

```bash
git add .
git commit -m "mensagem curta e objetiva"
git push origin main
```

O push em `main` aciona o deploy automático.

## Deploy

O deploy oficial é o workflow do GitHub Actions:

- [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)

Resumo do fluxo:

1. push na `main`
2. GitHub Actions conecta no VPS
3. backend é atualizado
4. frontend é buildado
5. Nginx é recarregado

Se o deploy automático falhar:

- consulte [DEPLOY_MANUAL_INSTRUCTIONS.md](./DEPLOY_MANUAL_INSTRUCTIONS.md)

## Rollback

Rollback preferencial:

1. localizar o commit anterior estável
2. `git revert <commit>`
3. push na `main`

Se for emergência operacional, usar o último commit que funcionava e publicar de novo, sem apagar histórico.

## Ambiente

### Backend

- Express
- Google Sheets como persistência
- PM2 em produção
- porta esperada: `3001`

### Frontend

- React
- build com `react-scripts`
- produção em arquivos estáticos

## Como o projeto organiza os dados

Principais entidades:

- `leads`
- `budgets`
- `channels`
- `users`
- `settings`
- `lead_interactions`
- `followup_notifications`
- `email_events`
- `ad_spend`

## Regras de negócio relevantes

### Leads

- lead pode ter status, responsável, canal, campanha, valor, observações e temperatura
- lead pode ter interação manual registrada
- o histórico de interação deve permanecer salvo
- observação de origem não deve ser apagada por operador

### Orçamentos

- orçamento pode existir sem lead
- importação de planilha deve ser idempotente quando possível
- exportação deve sair limpa e útil para diretoria

### Follow-up

- o follow-up é agendado no OmniChat
- o CRM agenda, o OmniChat entrega
- não disparar processamento em massa por acidente

### MailRelay

- há integração para eventos de e-mail
- o CRM cruza campanhas e engajamento

### MCP

- o MCP é usado para integração externa e leitura
- a documentação oficial está em `MCP_CLAUDE_SETUP.md`

## Campos e contratos importantes

Quando mexer em payloads, revise sempre:

- `notes`
- `operator_notes`
- `next_contact`
- `owner`
- `ownerId`
- `campaign`
- `channel_id`
- `channel_name`
- `temperature`
- `sla_due_at`
- `last_interaction_notes`
- `followup_*`

## Antes de editar

Verifique:

1. se o dado já existe em outra parte do fluxo
2. se o backend precisa persistir novo campo
3. se o frontend precisa mostrar/editar o novo campo
4. se a exportação/importação precisa ser atualizada
5. se o deploy automático vai pegar a mudança sem intervenção extra

## Boas práticas para mudanças nesta base

- mantenha compatibilidade com campos antigos
- normalize dados no backend antes de salvar
- não dependa de estado visual para persistência
- trate logs e mensagens de erro com clareza
- se algo pode romper produção, implemente fallback

## Comandos úteis

### Backend

```bash
cd backend
npm install
npm start
```

### Frontend

```bash
cd frontend
npm install
npm start
```

### Build

```bash
cd frontend
npm run build
```

## Conferência rápida de saúde

- o backend precisa responder em `/api/ping`
- o frontend precisa buildar sem erro
- o login precisa continuar funcionando
- o deploy em `main` precisa permanecer ativo

## Contexto operacional

Se o Claude estiver conectado via MCP:

- use a URL pública do MCP definida no ambiente
- não use `localhost`
- não peça header customizado se o conector não suportar
- leia `MCP_CLAUDE_SETUP.md` antes de chamar tools

## O que fazer se houver dúvida

1. Inspecionar o código existente.
2. Ler o contrato da função/rota antes de alterar.
3. Validar localmente.
4. Publicar com commit pequeno.
5. Testar no ambiente real.

## Observação final

Este arquivo não substitui a leitura do código.
Ele serve para dar ao Claude o mapa do projeto e o caminho seguro para programar nele.
