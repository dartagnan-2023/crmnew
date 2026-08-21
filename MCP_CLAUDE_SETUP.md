# MCP do CRM BHS - handoff para Claude

## Objetivo
Conectar o Claude ao MCP do CRM usando a URL com token no caminho, sem header customizado.

## Variaveis de ambiente
- `MCP_ACCESS_TOKEN`: token dedicado, longo e aleatorio, separado de `API_KEY_LEADS`
- `MCP_SERVER_NAME`: opcional, default `bhs-crm`
- `MCP_RATE_LIMIT_WINDOW_MS`: opcional, default `60000`
- `MCP_RATE_LIMIT_MAX`: opcional, default `120`

## URL para o Claude
Use a rota:
`https://crm.bhseletrica.com.br/api/mcp/k/<MCP_ACCESS_TOKEN>`

## Testes rapidos
- `GET /api/mcp` deve responder com info publica do servidor
- `GET /api/mcp/healthz` deve responder healthcheck
- `GET /api/mcp/k/<token>` deve responder a mesma info, mas autenticado
- `POST /api/mcp/k/<token>` deve aceitar o handshake MCP
- token ausente ou invalido deve retornar `401` com `WWW-Authenticate: Bearer`

## Nginx
Se o token vier na URL, use log mascarado para nao gravar a credencial em texto puro.
O exemplo esta em `backend/mcp.nginx.example.conf`.

## Backup
O rollback fica no Git. Antes de publicar, valide:
1. `node --check backend/server.js`
2. `git status --short`
3. deploy normal via workflow
