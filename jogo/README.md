# Herança

Protótipo jogável do conceito de jogo mobile discutido em agosto/2026.

`heranca.html` é um arquivo único, sem build e sem dependência. Abre no navegador
e joga. Publicado como Artifact para rodar no celular com a narração por IA ligada.

---

## O nicho

Não existe "gênero mobile inexplorado" — existem interseções desocupadas. A que este
protótipo ataca é o cruzamento de duas:

1. **IA generativa como motor de simulação, não como chat.** Todo produto que juntou
   LLM + jogo até aqui entregou chatbot com skin. Ninguém entregou um jogo onde a IA
   é a camada narrativa sobre um sistema de regras real.
2. **Multiplayer assíncrono de grupo fechado.** 5 minutos por dia, entre pessoas que
   já se conhecem, com aposta social alta.

A tese: **regras rígidas embaixo, IA narrando em cima.** Quem inverte isso — IA
decidindo as regras — faz um brinquedo, não um jogo. É onde as tentativas anteriores
morreram: sem consequência mecânica, o jogador percebe em três dias que nada tem peso.

## O loop

Cinco linhagens dividem a vila de Vale Fundo por doze anos. No produto final,
**1 ano = 1 dia real** e cada jogador é uma pessoa de verdade. No protótipo, os doze
anos correm em ~5 minutos contra quatro casas controladas por política fixa.

- **Comum:** celeiro, muralha, concórdia.
- **Seu:** ouro, terras, braços.
- Uma escolha por ano, entre cinco. O ano resolve sozinho.
- O renome final é multiplicado pela concórdia da vila. Vila arruinada divide o
  placar de todo mundo.

## As regras (o que a IA não decide)

Tudo abaixo é determinístico e vive em `resolverAno()`.

| Ação | Você ganha | A vila paga |
|---|---|---|
| Semear | +1 ouro | +5 +2×terras celeiro |
| Erguer pedra | — | −4 do seu ouro, +12 muralha, +3 concórdia |
| Acolher | +1 braço | −4 celeiro, +6 concórdia |
| Comerciar | +8 +2×terras ouro | −9 celeiro, −4 concórdia |
| Cercar o comum | +1 terra | −5 celeiro, −11 concórdia |

Resolução do ano, nesta ordem: as cinco casas agem → cada braço come 1 do celeiro →
fome se o celeiro não fecha (1 morte a cada 3 de déficit) → a muralha perde 4 e a
concórdia recupera 4 → um grande acontecimento.

Acontecimentos, por prioridade: **Cisma/Revolta** (concórdia < 25, ou uma casa com
riqueza > 1,8× a média — as outras a saqueiam e derrubam uma cerca) → **Invasão**
(probabilidade sobe com o ano, severidade cai com a muralha) → **Peste** → **Colheita
farta** → **Ano quieto** (+5 concórdia: a paz é o único jeito de a confiança subir).

`renome = (ouro×1,5 + terras×10 + braços×8) × (0,15 + 0,85 × (concórdia/100)^1,3)`,
e ×0,10 se a vila colapsar.

## As quatro casas rivais

Políticas fixas e legíveis de propósito — o jogador precisa conseguir prever quem é
quem para que a escolha dele tenha peso.

- **Casa Ferro** — ergue a muralha enquanto ela estiver baixa.
- **Casa Corvo** — comercia sempre, cerca a cada três anos, só semeia na iminência da fome.
- **Casa Espiga** — cuida do celeiro; acolhe quando sobra.
- **Casa Vinha** — **copia o que você fez no ano anterior.**

A Casa Vinha é a peça central. É ela que transforma a sua ganância em epidemia, e é o
substituto de motor único para o que, no produto real, é contágio social entre amigos.

## Balanceamento verificado

Simulação headless do motor, 5 sementes × 7 estratégias (`scratchpad/sim.js`, descartável):

| Estratégia | Renome |
|---|---|
| Equilibrada | 66–106 |
| Guardiã da vila | 72–78 |
| Só semear | 39–90 |
| Gananciosa esperta | 18–61 |
| **Só cercar (egoísta pura)** | **18–22** |

A egoísta pura termina em 1º no placar *local* e com o pior renome absoluto do jogo:
ela vence a disputa e perde a herança, porque zera a concórdia e divide o multiplicador
de todos por seis. É a fábula que o jogo existe para contar, e ela se sustenta na
matemática, não na narração.

## Onde a IA entra

Uma chamada por ano (`modelTier: "quick"`) recebendo só o boletim de fatos daquele ano,
com instrução explícita de não inventar número, nome nem acontecimento. Uma chamada
maior no fim para o epílogo. **O jogo é inteiro sem ela**: há narração de reserva
determinística, e `sample` sendo `null`, `not_granted` ou `rate_limited` degrada em
silêncio sem quebrar partida.

## Memória e usuários

A partida sobrevive a fechar o jogo. A primeira tela é o **livro das casas**: cria,
retoma e apaga perfis, cada um com sua crônica independente.

- **Salvamento automático a cada ano**, duas vezes: assim que o ano resolve (antes de
  a narração chegar) e de novo com a prosa. Fechar durante a narração não perde o ano.
- **Onde grava:** na coleção `casas` do armazenamento do artifact quando ele está
  disponível — a casa acompanha o jogador entre aparelhos — e **sempre** espelhado no
  `localStorage`. Se a nuvem cair ou for negada, o jogo grava igual; casas fundadas
  antes de a nuvem existir sobem sozinhas na primeira oportunidade.
- **O gerador aleatório é serializável.** Não dá para guardar um closure num save, então
  guarda-se quantas vezes o gerador foi chamado (`rngN`) e reconstrói-se avançando-o de
  novo. Verificado: uma partida de 12 anos com um save/restore *a cada ano* produz
  eventos, recursos e renome idênticos a uma partida corrida de ponta a ponta.
- A crônica é reconstruída na reabertura com o texto já narrado, e uma partida encerrada
  reabre no placar sem pagar a IA de novo pelo epílogo.

Os perfis são declarados pelo jogador, não autenticados — quem tem o link enxerga as
casas gravadas na nuvem. Serve para um grupo fechado, que é o público do conceito, mas
não é isolamento de verdade e precisa de identidade real antes de sair desse círculo.

## O que falta para virar produto

1. **Multiplayer assíncrono real** — servidor de estado, 5 a 20 jogadores humanos,
   resolução do ano num cron diário, notificação quando o ano vira.
2. **Custo de IA por jogador/dia** — hoje 1 chamada/jogador/dia. Uma narração por
   *vila* servida a todos os membros divide esse custo pelo tamanho do grupo.
3. **Convite como aquisição** — a vila só abre com N convidados. É a única forma de
   competir sem queimar verba de mídia.
4. **A crônica como objeto compartilhável** — o log de doze dias exportado é o
   conteúdo orgânico do jogo.
5. **Conteúdo de longo prazo** — 12 anos é uma temporada. A segunda temporada precisa
   herdar estado da primeira, senão não há razão para voltar.

## Riscos honestos

- **Retenção depende do grupo, não do loop.** Se o grupo esfria, a vila morre e não há
  loop solo que segure. É a força e a fragilidade do conceito.
- **Fosso não é o modelo, é o estado.** Qualquer um chama uma API. O defensável é a
  camada determinística por baixo — e ela precisa continuar sendo a autoridade quando
  o escopo crescer.
- **Onboarding assíncrono é difícil**: o jogador que entra no ano 1 e o que entra no
  ano 6 vivem jogos diferentes.
