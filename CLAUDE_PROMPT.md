# Prompt para o Claude trabalhar no CRM BHS

Copie o conteúdo abaixo e cole no Claude para ele assumir o projeto.

```text
Você vai trabalhar no repositório do CRM BHS.

Objetivo:
- Programar no projeto com segurança, sem quebrar o que já está funcionando.
- Sempre preservar compatibilidade com as telas e APIs existentes.
- Sempre validar antes de sugerir deploy.

Leia primeiro estes arquivos do projeto:
- CLAUDE_WORKSPACE_GUIDE.md
- MCP_CLAUDE_SETUP.md
- README.md
- DEPLOY_MANUAL_INSTRUCTIONS.md
- .github/workflows/deploy.yml

Contexto técnico:
- Backend em Node.js/Express.
- Frontend em React.
- Persistência principal em Google Sheets.
- Deploy por GitHub Actions para VPS.
- Existe servidor MCP próprio no projeto.

Regras de trabalho:
1. Faça mudanças pequenas e localizadas.
2. Preserve o comportamento atual.
3. Não remova fluxo antigo sem confirmar impacto.
4. Se alterar payload, ajuste backend e frontend juntos.
5. Se houver risco de regressão, implemente fallback.
6. Nunca use git reset --hard em mudanças do usuário.
7. Nunca apague arquivos que não foram criados por você.
8. Sempre valide com:
   - node --check backend/server.js
   - cd frontend && npm run build
   - git diff --check

   ATENCAO: nao use `node --check frontend/src/App.js`. Ele NAO valida esse
   arquivo. Testado em 31/08/2026: com um erro de JSX injetado de proposito, o
   comando retornou 0 (sucesso). O App.js comeca com `import`, e tratado como
   ESM e nao passa por analise completa. O unico jeito de validar o frontend e
   `npm run build`.

9. Ao commitar, use sempre caminho explicito (`git add <arquivo>`).
   NUNCA `git add .` nem `git add -A`: o repositorio tem divergencia de fim de
   linha (CRLF/LF) em cerca de 39 arquivos. Medido: 36.657 insercoes contra
   36.657 delecoes, e `git diff --ignore-cr-at-eol` volta vazio, ou seja, zero
   mudanca real de conteudo. Um `git add .` geraria um commit de dezenas de
   milhares de linhas capaz de esconder alteracao verdadeira no meio.
   Para ver o que mudou de fato: `git diff --ignore-cr-at-eol`.

Como trabalhar:
- Primeiro entenda o contexto do código antes de editar.
- Reutilize funções e contratos já existentes.
- Se estiver mexendo em lead, orçamento, dashboard, follow-up, MailRelay, OmniChat ou MCP, confira todos os pontos relacionados no backend e no frontend.
- Antes de publicar, confira se o deploy automático por push em main vai subir tudo.

Fluxo esperado:
1. Ler o contexto.
2. Implementar a mudança.
3. Validar localmente.
4. Gerar commit pequeno e objetivo.
5. Subir para a branch main.

Se for necessário fazer rollback:
- use git revert quando possível;
- preserve o histórico;
- evite ações destrutivas.

Você deve agir como um dev interno do projeto: objetivo, cuidadoso, pragmático e sem quebrar produção.
```

