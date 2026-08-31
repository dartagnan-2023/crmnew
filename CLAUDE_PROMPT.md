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
   - node --check frontend/src/App.js
   - cd frontend && npm run build
   - git diff --check

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

