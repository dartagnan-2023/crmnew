# Correção de status — "Cadastrado" → "novo"

**Data:** 08/09/2026
**Executado por:** Claude (via Cowork), rota `POST /api/leads/normalizar-status`
**Autorizado por:** Bonitão (BHS Eletrônica)

## O que foi feito

83 leads que estavam com o status `Cadastrado` — valor que **não existe** na lista do
sistema (`novo, contato, proposta, negociacao, ganho, perdido`) — passaram a ter o
status `novo`.

Enquanto estavam com `Cadastrado`, esses 83 caíam em "sem status" e ficavam
**invisíveis em todos os gráficos de funil**.

## Origem do problema

Importação única "Planilha Victor", entre 15/12/2025 e 14/01/2026. A palavra
`Cadastrado` não existe em nenhum ponto do código do CRM — veio de fora, do
vocabulário da planilha do Victor. Nenhum lead com esse status foi criado depois
de 14/01/2026: a origem está encerrada.

A mesma importação trouxe 384 leads: 192 com `Novo` (maiúsculo), 108 com `contato`,
83 com `Cadastrado` e 1 com `proposta`.

## O que NÃO foi tocado

- **Os leads com `Novo` maiúsculo ficaram como estavam**, por decisão tomada
  durante a execução: a equipe está usando essa maiúscula como marcador para
  separar os leads do Victor numa limpeza em andamento. Normalizar teria
  misturado esses registros com os `novo` legítimos e destruído a distinção.
- Nenhuma outra coluna da planilha foi escrita — só a coluna H (`status`).
- `updated_at`, `owner`, `source`, `temperature`, `sla_due_at`, `created_at`:
  todos intactos.
- Nenhuma automação foi disparada. O OmniChat não foi acionado.

## Verificação

| | Antes | Depois |
|---|---|---|
| `Cadastrado` | 83 | **0** |
| `novo` | 375 | **458** (375 + 83, exato) |
| `Novo` (maiúsculo) | 128 | 128 (intocado) |
| `contato` | 1.303 | 1.303 |
| `perdido` | 251 | 251 |
| `ganho` | 26 | 26 |
| `proposta` | 33 | 33 |
| `negociacao` | 3 | 3 |

A rota devolveu `gravado: true`, `encontrados: 83`, e a releitura imediata
encontrou `0` registros com `Cadastrado`.

## Como desfazer

Os 83 registros são exatamente os que satisfazem:

    source == "Planilha Victor"  E  status == "novo"

Conferido no momento da execução: essa condição devolve exatamente 83 registros.
(Antes da correção, nenhum lead da "Planilha Victor" tinha `novo` minúsculo.)

Alternativas de rollback:
1. Histórico de versões do Google Sheets (Arquivo → Histórico de versões).
2. A própria rota no sentido inverso — **com cuidado**: `{"de":"novo","para":...}`
   pegaria também os 375 `novo` legítimos. Só use com filtro manual pelos IDs abaixo.

## IDs alterados (83)

130, 132, 134, 148, 246, 247, 249, 256, 275, 293, 294, 324, 353, 380, 381, 451,
406, 482, 448, 272, 161, 188, 319, 326, 191, 395, 365, 198, 111, 225, 185, 313,
375, 163, 162, 429, 499, 363, 441, 263, 209, 227, 422, 172, 432, 277, 366, 493,
484, 216, 119, 378, 196, 426, 489, 423, 155, 98, 106, 177, 113, 415, 107, 128,
498, 229, 496, 328, 101, 235, 99, 361, 392, 308, 200, 197, 189, 222, 390, 348,
126, 377, 334

## Observação registrada durante a execução

Entre 15h20 e 17h35 do dia 08/09/2026, o total de leads da base caiu de 2.267
para 2.202, e o status `Novo` caiu de 192 para 128 — cerca de 65 exclusões. O
usuário confirmou que é uma limpeza combinada da equipe. Registrado aqui apenas
para que essa variação não seja confundida, no futuro, com efeito desta correção:
**esta correção não excluiu nenhum lead.**
