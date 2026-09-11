# Correção do canal dos leads — 11/09/2026

Executado por: Claude (via Cowork), a pedido do Osnil.
Rota usada: `POST /api/leads/normalizar-canal` (admin), com simulação antes e `esperado` conferido na hora da gravação.

## O que foi corrigido

**40 leads** de um total de 2.200. Escritas **80 células**, apenas nas colunas **L (`channel_id`)** e **M (`channel_name`)**. Nenhuma outra coluna foi tocada — status, valor, dono, anotação, temperatura e datas ficaram como estavam.

| destino | quantidade | de onde veio a prova |
|---|---|---|
| Meta Ads (id 11) | 38 | anotação do próprio lead: "Origem: Instagram/Facebook Ad (Click-to-WhatsApp)" |
| Planilha Victor (id 8) | 2 | o próprio `source`/campanha: `planilha_victor` |

Dos 38 que viraram Meta Ads, **36 tinham `channel_id = 3`** — um canal que não existe mais na aba `channels`, o que fazia o nome sair vazio na leitura e aparecer como "-" na tela.

## Deixados em branco de propósito

Quatro leads não tinham prova nenhuma da origem e **não foram tocados**:

- DAC PAINEIS — anotação: "Cliente ligou para orçar ferramentas"
- Rodolfo — anotação: "Aguardando retorno de orçamento"
- OMEGATEC — anotação: "Prospecção de internet google, encaminhado para Osnil"
- Renan — sem anotação

O OMEGATEC é o caso que explica a regra: "prospecção de internet google" pode ser Google Ads ou busca orgânica, e são coisas diferentes. O padrão exige `google ads` escrito, então ele ficou em branco em vez de virar número errado em relatório.

## IDs alterados

```
207, 530, 2456, 2457, 2458, 2459, 2460, 2462, 3100, 3101, 3102, 3104,
3105, 3107, 3110, 3112, 3118, 3119, 3120, 3121, 3122, 3123, 3124, 3125,
3126, 3127, 3128, 3129, 3130, 3131, 3132, 3133, 3134, 3135, 3136, 3137,
3138, 3139, 3141, 3142
```

## Rollback

Limpar as colunas L e M dessas 40 linhas devolve o estado anterior em termos de exibição. O `channel_id` antigo era `3` (canal inexistente) em 36 delas e vazio nas outras 4 — ou seja, o estado anterior era "sem canal" na prática, nos 40 casos.

## Conferência depois de gravar

- Leads sem canal: **44 → 4** (só os quatro sem prova).
- Meta Ads: 330 → **368**. Planilha Victor: 315 → **317**.
- Rodando a rota de novo: **0 com prova**. Não há o que corrigir duas vezes.
