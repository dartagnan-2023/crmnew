# MCP do CRM BHS - Handoff oficial para Claude

Este documento reúne tudo o que o Claude precisa para se conectar ao CRM BHS via MCP.

## Estado atual

- O CRM já expõe um servidor MCP próprio no backend do projeto.
- A rota principal para clientes que não aceitam header customizado é:
  `https://crm.bhseletrica.com.br/api/mcp/k/<MCP_ACCESS_TOKEN>`
- O servidor também aceita autenticação por `Authorization: Bearer <token>` e `X-API-Key: <token>`.
- A implementação autoritativa hoje está em `backend/server.js`.

## O que o Claude precisa

### 1. URL pública do MCP

Use uma URL HTTPS pública. Não use `localhost`, `127.0.0.1` ou transporte `stdio` para o Claude em nuvem.

URL recomendada para Claude Desktop, Claude Cowork e conectores que aceitam apenas URL:

`https://crm.bhseletrica.com.br/api/mcp/k/<MCP_ACCESS_TOKEN>`

URL alternativa, se o cliente permitir header customizado:

`https://crm.bhseletrica.com.br/api/mcp`

### 2. Autenticação

Ordem suportada pelo servidor:

1. `Authorization: Bearer <token>`
2. `X-API-Key: <token>`
3. Segmento de caminho `/api/mcp/k/<token>`

Regras:

- `MCP_ACCESS_TOKEN` deve ser um token dedicado ao MCP.
- Não reutilize `API_KEY_LEADS`.
- O token deve ser longo e aleatório.
- O servidor responde `401` com `WWW-Authenticate: Bearer` quando o token está ausente ou inválido.
- Comparação do token é feita em tempo constante.

### 3. Variáveis de ambiente

Arquivo de exemplo: `backend/mcp.env.example`

Variáveis relevantes:

- `MCP_ACCESS_TOKEN`
- `MCP_SERVER_NAME`
- `MCP_TRANSPORT`
- `MCP_HTTP_HOST`
- `MCP_HTTP_PORT`
- `MCP_RATE_LIMIT_WINDOW_MS`
- `MCP_RATE_LIMIT_MAX`
- `MCP_ALLOWED_ORIGINS`
- `CRM_API_BASE`
- `CRM_API_KEY`
- `CRM_API_AUTH_HEADER`
- `CRM_API_AUTH_PREFIX`
- `CRM_REQUEST_TIMEOUT_MS`
- `CRM_MAX_PAGES`

Valores padrão esperados:

- `MCP_SERVER_NAME=bhs-crm`
- `MCP_TRANSPORT=http`
- `MCP_HTTP_HOST=127.0.0.1`
- `MCP_HTTP_PORT=8787`
- `CRM_API_AUTH_HEADER=Authorization`
- `CRM_API_AUTH_PREFIX=Bearer `

### 4. Toolset disponível

O Claude verá estas tools:

- `search_leads`
- `get_lead`
- `list_budgets`
- `get_budget`
- `list_email_events`
- `get_crm_summary`

## Contrato das tools

### `search_leads`

Busca leads com paginação e filtros.

Filtros suportados:

- `q`
- `ownerId`
- `status`
- `campaign`
- `channel`
- `created_from`
- `created_to`
- `updated_from`
- `updated_to`
- `limit`
- `cursor`

### `get_lead`

Retorna o lead individual pelo `id`.

### `list_budgets`

Lista orçamentos com paginação, agregações e filtros.

Filtros suportados:

- `date_from`
- `date_to`
- `date_field` com valores:
  - `emissao`
  - `validade`
  - `ultima_interacao`
  - `atualizacao`
- `status`
- `ownerId`
- `responsavel`
- `channel`
- `sem_interacao_desde`
- `updated_since`
- `q`
- `limit`
- `cursor`

### `get_budget`

Retorna o orçamento individual pelo `id`.

### `list_email_events`

Lista eventos de e-mail já armazenados pelo CRM.

Filtros suportados:

- `period`
- `eventType`
- `campaign`
- `leadId`
- `q`
- `limit`
- `cursor`

### `get_crm_summary`

Resumo operacional do CRM.

Parâmetros:

- `scope`: `all` ou `mine`

## Envelope de resposta

Listagens devolvem:

```json
{
  "data": [],
  "meta": {
    "total": 0,
    "returned": 0,
    "has_more": false,
    "next_cursor": null,
    "truncated": false,
    "filters_applied": {},
    "generated_at": "2026-08-31T00:00:00-03:00",
    "timezone": "America/Sao_Paulo",
    "source": "crm-bhs",
    "schema_version": "1.0.0"
  }
}
```

Para `list_budgets`, também pode existir `meta.aggregates`:

- `count`
- `valor_total_soma`
- `valor_medio`
- `valor_maior`

## Endpoints do MCP

### Públicos

- `GET /api/mcp`
- `GET /api/mcp/healthz`

### Autenticados

- `GET /api/mcp/k/<token>`
- `POST /api/mcp/k/<token>`
- `POST /api/mcp`

### Comportamento esperado

- `GET /api/mcp` responde informações públicas do servidor.
- `GET /api/mcp/healthz` responde healthcheck.
- `GET /api/mcp/k/<token>` responde info autenticada.
- `POST /api/mcp/k/<token>` aceita handshake MCP.
- `POST /api/mcp` aceita handshake MCP com header de autenticação.

## Formato para Claude Desktop

Se o cliente aceitar URL apenas, use:

`https://crm.bhseletrica.com.br/api/mcp/k/<MCP_ACCESS_TOKEN>`

Se o cliente aceitar configuração com header customizado, use:

- URL: `https://crm.bhseletrica.com.br/api/mcp`
- Header: `Authorization`
- Prefixo: `Bearer `

Se o cliente aceitar `X-API-Key`, use:

- URL: `https://crm.bhseletrica.com.br/api/mcp`
- Header: `X-API-Key`
- Valor: `<MCP_ACCESS_TOKEN>`

## Nginx

Se o token vier na URL, o Nginx deve mascarar o caminho nos logs para não gravar a credencial em texto puro.

Arquivo de referência:

- `backend/mcp.nginx.example.conf`

Ponto importante:

- `proxy_set_header Authorization $http_authorization;`
- `location /api/mcp/k/` precisa encaminhar para o backend

## Rate limit

O MCP possui rate limit por token.

Padrões atuais:

- janela: `60000 ms`
- máximo: `120` requisições por janela

## Como gerar o token

Exemplo de geração:

```bash
openssl rand -hex 32
```

Ou em Node:

```js
crypto.randomBytes(32).toString('hex')
```

## Checklist de conexão

1. Definir `MCP_ACCESS_TOKEN` no ambiente do servidor.
2. Reiniciar o backend para carregar a variável.
3. Publicar o Nginx com proxy para `/api/mcp` e `/api/mcp/k/`.
4. Testar `GET /api/mcp/healthz`.
5. Testar `GET /api/mcp/k/<token>`.
6. Testar `POST /api/mcp/k/<token>` com `initialize`.
7. Testar `tools/list`.

## Testes de aceite

### 1. Sem token

```bash
curl -i -s -X POST https://crm.bhseletrica.com.br/api/mcp/k/ | head -20
```

Esperado:

- `401`
- header `WWW-Authenticate: Bearer`

### 2. Token inválido

```bash
curl -i -s -X POST https://crm.bhseletrica.com.br/api/mcp/k/invalido | head -20
```

Esperado:

- `401`
- nunca `404`

### 3. Handshake MCP

```bash
curl -i -s -X POST https://crm.bhseletrica.com.br/api/mcp/k/$MCP_ACCESS_TOKEN \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Esperado:

- `200`
- `protocolVersion`
- `serverInfo`

### 4. Listagem de tools

```bash
curl -s -X POST https://crm.bhseletrica.com.br/api/mcp/k/$MCP_ACCESS_TOKEN \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Esperado:

- as 6 tools listadas acima

## O que o Claude não deve fazer

- Não usar `localhost` se estiver fora da máquina do servidor.
- Não depender de `stdio` para acesso remoto.
- Não pedir header customizado ao conector se ele só aceitar URL.
- Não reutilizar `API_KEY_LEADS`.
- Não registrar o token em logs.

## Observação operacional

Se o cliente Claude só permitir URL do servidor MCP e não permitir header customizado, a única forma adequada é usar:

`https://crm.bhseletrica.com.br/api/mcp/k/<MCP_ACCESS_TOKEN>`

Essa rota já está preparada no CRM para esse cenário.
