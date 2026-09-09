# Correção de status de orçamentos — o que o ERP disse e o CRM não soube ler

**Data:** 09/09/2026
**Executado por:** Claude (via Cowork), rota `PUT /api/budgets/:id`, um registro por vez
**Autorizado por:** Bonitão (BHS Eletrônica)

## O que foi feito

17 orçamentos que estavam com status **"Novo"** passaram a ter o status que o ERP
já informava:

- **2 → Aprovado** (o ERP diz "Conluído Fechamento")
- **15 → Reprovado** (o ERP diz "Perdido" em alguma etapa)

Todos os 17 estavam em `novo` — que é, literalmente, a saída de "não entendi"
do mapeamento antigo. Ele só conseguia produzir três resultados: `em_orcamento`
para *pendente + prospecção*, `reprovado` para seis frases exatas de motivo de
perda, e `novo` para todo o resto.

## O filtro aplicado

Regra dada pelo dono do produto: **o que o usuário mexeu prevalece; corrige-se
apenas o que o ERP exportou e o CRM não soube interpretar.**

Foram examinados os 1.189 orçamentos da base. Entraram na correção apenas os que:

1. tinham status exatamente `novo`, e
2. tinham `raw_status` indicando Perdido ou Conluído/Concluído.

Nenhum registro foi excluído pelo critério 1 — os 17 candidatos estavam todos em
`novo`, ou seja, ninguém tinha escolhido status para nenhum deles.

Três deles (**117613**, **117751**, **117834**) tinham ajuste manual em **outros**
campos — representante "Dorival"; orçamentista "Felipe" com data de envio e a
observação "Cobrado retorno do cliente"; vendedor e orçamentista "ines". Foram
separados e apresentados à parte. Decisão do dono do produto: **corrigir também
o status deles**, já que o ajuste dessas pessoas não estava no status. Conferido
depois da gravação: os campos que elas preencheram continuam intactos.

## O que mudou, e o que não mudou

**Mudou:** apenas o campo `status`, mais o `updated_at` que a rota grava sozinha.

**Não mudou:** valor orçado, valor fechado, cliente, empresa, datas, filial,
representante, vendedor, orçamentista, observações, status cru. Nenhum dos 17
tem lead vinculado, então nenhuma automação foi disparada.

## Verificação

| status | antes | depois |
|---|---|---|
| `novo` | 23 | **6** (−17) |
| `aprovado` | 37 | **39** (+2) |
| `reprovado` | 7 | **22** (+15) |
| `em_orcamento` | 1.113 | 1.113 |
| `enviado` | 5 | 5 |
| `nao_feito` | 4 | 4 |

Todas as 17 chamadas devolveram HTTP 200 com o status pretendido. A releitura
depois encontrou **zero** divergências entre o que o ERP diz e o que o CRM mostra.

## Como desfazer

Os 17 estavam **todos** em `novo`. Para reverter, basta gravar `novo` nestes ids:

**Para `aprovado` (2):** 100 (nº 113596, SPOTS COMERCIAL ELETRICA), 451 (nº 116917, OAL MAQUINAS INDUSTRIAIS)

**Para `reprovado` (15):** 307, 319, 322, 333, 346, 357, 379, 404, 859, 956, 1065, 1120, 1145, 1203, 1204

O histórico de versões do Google Sheets também serve.

## Observações que ficam registradas

- **Quatro dos 17 estão com valor R$ 0,00**, incluindo uma das duas vendas ganhas
  (OAL Máquinas, nº 116917). O valor foi apagado pelas importações anteriores a
  08/09/2026 e **não tem de onde voltar**. O "Aprovado" da OAL entra valendo zero.
- **Os 15 reprovados ficaram sem motivo de perda.** O motivo vem de outra coluna
  do ERP e não foi capturado nesses registros. Aparecem com "-" na coluna Motivo
  perda, o que é a verdade, e não contaminam o gráfico de perdas, que ignora os
  sem motivo desde a correção de 02/09/2026.
- Entre a medição de 08/09 e a execução, a base foi de 1.158 para 1.189
  orçamentos e os casos a corrigir passaram de 13 para 17 — entrou importação
  durante a noite. Entre os novos apareceu um **"Perdido Qualificação"**,
  combinação que não existia na base quando o interpretador foi escrito. Ele leu
  certo, o que é a prova de que valeu a pena não codificar caso a caso.
