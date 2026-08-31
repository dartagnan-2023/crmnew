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

Cinco linhagens dividem uma vila por doze anos. Ao fundar uma partida o jogador
nomeia **a vila** e **a sua casa** — o nome da vila vale no cabeçalho, na abertura da
crônica, no placar e no prompt enviado à IA. Partidas salvas antes disso reabrem como
"Vale Fundo". No produto final,
**1 ano = 1 dia real** e cada jogador é uma pessoa de verdade. No protótipo, os doze
anos correm em ~5 minutos contra quatro casas controladas por política fixa.

- **Comum:** celeiro, muralha, concórdia.
- **Seu:** ouro, terras, braços.
- Uma escolha por ano, entre cinco. O ano resolve sozinho.
- O renome final é multiplicado pela concórdia da vila. Vila arruinada divide o
  placar de todo mundo.

## As regras (o que a IA não decide)

Tudo abaixo é determinístico e vive em `resolverAno()`. **Toda ação rende algo à casa
que a escolhe, e o rendimento cresce com o que ela já construiu** — é essa composição
que faz a escolha valer a pena ano após ano.

| Ação | Retorno seu | A vila |
|---|---|---|
| **Semear** | +2 +terras ouro | +4 +2×terras +⌊braços/2⌋ celeiro |
| **Arar novo campo** | +1 terra, −6 ouro | +2 concórdia |
| **Acolher** | +1 braço | −3 celeiro, +6 concórdia |
| **Erguer pedra** | +2 renome, −(4+⌊renome/2⌋) ouro | +12 muralha, +2 concórdia |
| **Comerciar** | +5 +2×terras +2×braços ouro | −8 celeiro, −4 concórdia |
| **Cercar o comum** | +1 terra de graça | −5 celeiro, −11 concórdia |

Terras e braços multiplicam semear e comerciar; renome entra direto no placar. **Arar e
cercar dão a mesma terra** — um custa ouro, o outro custa a vila: é a decisão moral
central, e agora as duas fazem a casa crescer. Erguer fica indisponível com a muralha
acima de 92 (não há o que erguer), o que impede a estratégia de botão único.

**Marcos** pagam metas de médio prazo: 4 terras → +8 ouro; 7 braços → +4 renome;
6 de renome → +12 ouro; 45 de ouro → +4 renome.

Resolução do ano, nesta ordem: as casas agem → cada braço come 1 do celeiro → fome se o
celeiro não fecha (1 morte a cada 3 de déficit) → a muralha perde 4 e a concórdia
recupera 3 → um grande acontecimento → conferência dos marcos.

Acontecimentos, por prioridade: **Cisma/Revolta** (concórdia < 25, ou uma casa com
riqueza > 1,8× a média) → **Invasão** (probabilidade sobe com o ano, severidade cai com
a muralha) → **Peste** → **Colheita farta** → **Ano quieto** (+3 concórdia).

`renome final = (ouro×1,2 + terras×10 + braços×8 + obras×8) × (0,15 + 0,85 ×
(concórdia/100)^1,3)`, e ×0,10 se a vila colapsar.

## Por que a economia foi reescrita

O primeiro desenho falhou num ponto que só aparece jogando: **o caminho honesto não
tinha juros compostos.** Semear rendia `5 + 2×terras` e terras só vinham de cercar, a
ação antissocial. Cooperar era uma reta horizontal.

Medido no motor antigo, jogando "só semear" por doze anos: ouro 10 → 23, terras 2 → 2,
braços 4 → **2,4**. O jogador cooperava a partida inteira e terminava com menos gente do
que começou, enquanto "só cercar" levava terras a 11,6. Pior: a contribuição da escolha
do jogador ao celeiro tinha **razão sinal/ruído de 0,89** — menor que o que as outras
casas e os eventos causavam no mesmo ano, então ele semeava +9 e via o celeiro cair −2.

Depois da reescrita, "só semear" leva o ouro de 10 a ~60 com ganho limpo e previsível, e
"arar + semear" leva as terras de 2 a 6.

## Recompensa visível

Metade do problema era de tela, não de regra:

- **"A sua escolha rendeu"** — bloco no topo de cada ano da crônica, com os deltas
  exatos da sua ação, separados do total da vila. A crônica rola para o topo da entrada
  nova, não para o fim, para que essa linha caia na primeira dobra.
- **Deltas piscando** no rodapé sobre ouro, terras, braços e renome.
- **Avisos de risco** no cabeçalho antes do desastre ("O celeiro tem 19 e a vila come
  20: vai faltar"), o que transforma o acaso em decisão informada.
- **Preço dinâmico** de erguer na própria bandeja, e o motivo quando a ação está travada.

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

Simulação headless do motor, 6 sementes × 8 estratégias (`scratchpad/sim2.js`, descartável),
por renome final:

| Estratégia | Renome médio | Posição média |
|---|---|---|
| Só erguer | 161 | 4,8 |
| Construtor honesto (mista) | 153 | 3,2 |
| Fazendeiro (arar + semear) | 123 | 2,5 |
| Só semear | 84 | 3,5 |
| Oportunista total | 55 | 2,0 |
| Só comerciar | 52 | 3,8 |
| Ganancioso esperto | 52 | 1,3 |
| **Só cercar (egoísta pura)** | **21** | 3,0 |

As construtivas ficam ~3× acima das extrativas. "Só erguer" empata com a mista porque,
quando não pode pagar a pedra, recai em semear — na prática ela *é* a mista; e repare na
posição média 4,8: ela termina em último no placar local, porque as rivais colhem a
concórdia que ela constrói. A egoísta pura continua vencendo a disputa local e perdendo a
herança.

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
- O save carrega `vilaNome`; a desserialização preenche "Vale Fundo" quando ele falta,
  para os saves da versão 1.

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
