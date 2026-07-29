# Painel de Consultas — Inteligência Societária (Graph Intelligence)

Módulo de inteligência societária com visualização em grafo interativo (React Flow):
a partir de um CNPJ, o sistema descobre a estrutura societária em múltiplas camadas
(empresa → sócios → outras empresas dos sócios → …), com expansão sob demanda e
prevenção de loops.

![stack](https://img.shields.io/badge/React%2018-TypeScript-blue) ![vite](https://img.shields.io/badge/Vite-5-purple)

## Interface

Layout em grade, sempre em modo claro: topbar com busca inteligente e ações;
sidebar esquerda com filtros (switches), profundidade e legenda; workspace
central com breadcrumb, indicador de nível e o mapa (nós circulares com cartão
de rótulo, arestas com chip de relacionamento e controles centrais); painel
direito de detalhes com abas (Visão geral / Sócios / Histórico) e modo
Estatísticas (Indicadores / Linha do tempo). Percentuais de participação
societária não são exibidos nem exportados.

A identidade visual é totalmente branca e neutra (preto/grafite/cinza — sem azul):
empresas são círculos grafite preenchidos, pessoas são círculos brancos com borda,
baixadas têm contorno tracejado e filiais usam cinza médio.

## Funcionalidades

- **Mapa interativo em React Flow** (@xyflow/react): pan, zoom, arrastar nós (posição
  preservada), controles, layout radial automático e botão **Reorganizar**.
- **Controle de camadas** `[ − ] Camada N [ + ]` flutuante sobre o mapa: camadas
  cumulativas (avançar adiciona o próximo nível de relacionamentos mantendo os
  anteriores; voltar oculta apenas os exclusivos das camadas superiores, com cache
  dos dados já consultados). O `−` desabilita na Camada 1 e o `+` quando não há
  novas conexões nos dados.
- **Expansão individual**: clique simples seleciona (painel de detalhes); **duplo
  clique** expande as conexões do nó. Botões **Expandir Tudo** (BFS até o limite de
  níveis, com teto de segurança de 600 nós) e **Recolher Tudo**.
- **Configurar mapa** (⚙, abaixo do controle de camadas): painel retrátil de forças
  estilo Obsidian — força centrípeta, repulsão, força e distância dos links (escala
  0–100, d3-force) — que refina as posições geradas pelo layout radial, com botões
  **Animar** e **Restaurar padrão** e persistência em localStorage. Com valores
  padrão a simulação não roda e o layout permanece o radial puro; personalizado,
  o refinamento se aplica automaticamente a novas camadas e expansões.
- **Limite de camadas configurável**: 2, 3, 5, 10 ou ilimitado; entidades já visitadas
  são deduplicadas (anti-loop).
- **Identidade visual**: empresas ativas em azul, pessoas em verde, administradores em
  amarelo, inativas em cinza, baixadas em vermelho, filiais em laranja, matrizes com anel
  roxo. Tamanho do nó cresce com conexões e capital social. Cada tipo de relacionamento
  tem cor própria e legenda na linha (visível ao aproximar o zoom).
- **Painel lateral** com dados cadastrais completos (empresa) ou participações (pessoa),
  histórico societário e navegação para nós relacionados. No nó pessoa, uma seção
  **Perfil completo** (APIFull) traz o restante da resposta em seções recolhíveis
  simples, uma por chave — ver "Fontes de dados" e o aviso de segurança abaixo.
- **Busca inteligente** por nome, CPF, CNPJ, razão social ou fantasia — destaca,
  centraliza e aplica zoom no nó encontrado.
- **Filtros dinâmicos**: pessoas/empresas, situação cadastral, administradores, sócios,
  filiais/matrizes, participação mínima, UF, CNAE, data de abertura.
- **Breadcrumb** de navegação, **painel de estatísticas** (totais, capital somado,
  estados, municípios, CNAEs) e **linha do tempo** societária.
- **Exportação**: PNG em alta resolução, SVG, PDF (preservando o layout), JSON completo
  e CSV das conexões.
- **Layout responsivo** (drawers em mobile), sempre em modo claro.

## Fontes de dados

A camada de dados é plugável (`src/services/provider.ts`):

| Provedor | CNPJ → sócios | CPF → perfil + empresas |
|---|---|---|
| **FonteData** (rota interna `/api/consulta-empresa`) | ✅ | — |
| **APIFull** (rota interna `/api/consulta-pessoa`) | — | ✅ (perfil completo + `sociedades[]`) |

Nenhuma chamada é feita direto do navegador para a FonteData/APIFull:
`api/consulta-empresa.ts` e `api/consulta-pessoa.ts` (Vercel Edge Functions)
atuam como proxy same-origin, repassando as consultas com
`FONTEDATA_API_KEY` e `APIFULL_AUTHORIZATION` só no servidor, sob rotas com
nome de negócio (nunca o nome do fornecedor ou o endpoint real dele). Isso
evita bloqueio de CORS (as duas são APIs servidor-a-servidor), mantém as
chaves fora do bundle do cliente e nunca expõe qual fornecedor está por trás
de cada rota — ver "Neutralidade do frontend" abaixo.

**Pipeline entre camadas:** CNPJ → FonteData → empresa + sócios (Camada 1) →
ao avançar de camada, cada CPF da fronteira é consultado na APIFull → os
CNPJs em `sociedades[]` são enriquecidos na FonteData (empresa completa +
todos os seus sócios) → empresa nova e seus sócios entram juntos na mesma
camada seguinte à da pessoa → repete a partir das pessoas novas na próxima
camada. Só `sociedades[]` altera o grafo — o restante do perfil da APIFull
(documentos, contatos, vazamentos etc.) aparece só no painel lateral da
pessoa, nunca vira nó/aresta.

Clicar numa pessoa carrega o perfil completo (cache/dedup real por CPF em
`src/store/personProfileStore.ts`, compartilhado com a expansão de camada)
mas **não** expande o grafo — isso só acontece ao avançar de camada. Uma
falha ao enriquecer algum CNPJ de `sociedades[]` não cancela os demais nem
o restante da camada; o nó da pessoa fica clicável de novo pra tentar só o
que faltou (o perfil já em cache não é rebuscado).

### ⚠️ Aviso de segurança — leia antes de configurar em produção

**`/api/consulta-empresa`, `/api/consulta-pessoa` e `/api/saved-queries/*` exigem
sessão autenticada** (cookie `HttpOnly`/`SameSite=Lax`, `Secure` em
produção — ver `api/_lib/auth.ts`). Login e sessão são tabelas próprias no
Supabase (`users`/`sessions`, ver `supabase/migrations/`), **não** Supabase
Auth. Não há cadastro público nesta versão — crie o primeiro usuário com
`scripts/create-user.ts` (ver seção "Criando o primeiro usuário" abaixo).

**O mascaramento de campos sensíveis no painel (CPF, RG, contas, Pix etc.,
com botão "Revelar") não é a única camada de proteção — é conveniência de
UI que complementa a exigência de sessão.** Só os campos "duros" (senhas,
hashes, tokens, chaves de API, códigos de sessão) nunca são exibidos, sob
nenhuma circunstância, e nunca são persistidos numa consulta salva.

Não há rate-limit nem controle de concorrência no servidor (exigiria
KV/Redis, que este projeto não tem) — a mitigação adicional é client-side:
cache por CPF/CNPJ, lotes com concorrência limitada, e uma confirmação antes
de "Expandir Tudo" iniciar uma cascata grande de consultas pagas.

### Neutralidade do frontend

O produto se apresenta como próprio e independente: o navegador nunca recebe
nome de fornecedor, a palavra "API" em texto técnico, saldo/créditos da
conta, chave, endpoint externo, nome de modelo/SDK ou qualquer outro detalhe
de infraestrutura — nem em texto visível, nem em mensagens de erro, nem em
metadados/envelopes de resposta, nem no bundle compilado. Regra completa em
`CLAUDE.md`. Resumo da arquitetura que garante isso:

- **Fronteira server-only**: `src/services/apifull.ts`/`fontedata.ts`
  chamam só as rotas internas neutras `/api/consulta-pessoa` e
  `/api/consulta-empresa` — nunca o domínio real do fornecedor, nunca com a
  chave. As credenciais (`FONTEDATA_API_KEY`, `APIFULL_AUTHORIZATION`) só
  existem em `process.env`, lidas por `api/*.ts` (nunca `VITE_*`, nunca
  importado por `src/`).
- **Espelhamento de imagens** (`api/_lib/imageMirror.ts`): nenhuma imagem é
  servida a partir do domínio de origem. Toda imagem que aparece numa
  resposta de consulta — URL ou Base64 — é baixada/decodificada no servidor,
  validada por magic bytes, gravada no bucket `imagens_url` e substituída no
  payload por uma URL assinada do nosso próprio Storage, **antes** de a
  resposta chegar ao navegador. Uma `<img src>` apontando para a CDN do
  fornecedor entregaria o domínio dele em texto claro; por isso, quando o
  espelhamento falha, o campo vira `null` em vez de manter a URL original.
  O índice `mirrored_images` (origem → objeto no bucket) evita rebaixar a
  mesma imagem a cada consulta.
- **Normalizador central de erros** (`api/_lib/upstreamError.ts`): nenhuma
  falha do fornecedor é repassada crua ao navegador. O detalhe completo (só
  status + request-id do upstream — nunca o corpo, que pode conter dado da
  pessoa consultada) fica no log do servidor, correlacionável por um
  identificador de diagnóstico curto devolvido ao cliente junto de uma
  mensagem pública neutra em pt-BR (`{ code, message, id }`).
- **Leitura segura no cliente** (`src/services/proxyError.ts`): mesmo que o
  formato de erro mude inesperadamente, o cliente só aceita o campo
  `message` de um JSON — nunca repassa texto cru/HTML/stack trace.
- **Política automatizada** (`scripts/ui-policy/`): lista central de termos
  proibidos, aplicada tanto ao código-fonte (`npm run check:ui-policy`)
  quanto ao bundle compilado (`npm run check:ui-policy:static`, rode após
  `npm run build`) — falha o CI se algo proibido aparecer, apontando arquivo
  e linha. Nunca toca dado dinâmico pesquisado (resultados, nomes, links) —
  só varre arquivos-fonte e o bundle estático.

## Rodando

```bash
cp .env.example .env   # preencha FONTEDATA_API_KEY, APIFULL_AUTHORIZATION, SUPABASE_URL, SUPABASE_SECRET_KEY
npm install
npm run dev        # http://localhost:5173 — só a UI; /api/* não é servido (ver abaixo)
npm run build      # produção em dist/
npm run preview
npm run test       # Vitest (normalização, URLs, cache, camadas, dedup, mascaramento, auth)
```

### Criando o primeiro usuário

Não há cadastro público — o primeiro usuário é criado por um script
administrativo que roda fora do Edge Runtime, com `SUPABASE_URL`/
`SUPABASE_SECRET_KEY` no ambiente:

```bash
npx tsx scripts/create-user.ts --email admin@example.com --nome "Admin"
# a senha é pedida em seguida, de forma oculta (sem eco no terminal) —
# nunca passe --password/--senha na linha de comando.
```

`npm run dev`/`npm run preview` sozinhos **não** servem `/api/*` (Vite não
conhece Vercel Functions), então a busca vai falhar localmente com esses
comandos — servem só para trabalhar na UI. Para testar o fluxo completo
(incluindo as chamadas reais à FonteData/APIFull) é preciso rodar via
[Vercel CLI](https://vercel.com/docs/cli): `vercel dev` (lê as variáveis do
`.env` automaticamente), ou testar direto numa URL de deployment de
Preview/Produção da Vercel com as variáveis configuradas naquele ambiente —
**garanta que o deployment não fique publicamente exposto antes de testar**
(ver aviso de segurança acima).

## Arquitetura

```
api/
├── _lib/                   # helpers server-only (nunca importados pelo client)
│   ├── supabase.ts         # client Supabase (Service Role Key, sempre ignora RLS)
│   ├── password.ts         # hash PBKDF2 via Web Crypto
│   ├── session.ts          # token opaco, hash, cookie HttpOnly/SameSite=Lax
│   ├── auth.ts             # requireSession (protege rotas) + validateOrigin (CSRF)
│   ├── ssrf.ts             # bloqueio de host privado/loopback ao baixar imagens de terceiro
│   ├── uploads.ts          # sniff de MIME, hash, upload/signed URL no bucket imagens_url
│   └── imageMirror.ts      # espelha p/ o bucket toda imagem de uma consulta, antes de ela chegar ao navegador
├── auth/
│   ├── login.ts            # POST — e-mail/senha contra tabelas próprias (sem Supabase Auth)
│   ├── logout.ts           # POST — revoga a sessão
│   └── session.ts          # GET — verificação da sessão atual
├── saved-queries/
│   ├── index.ts            # GET lista / POST cria (snapshot + upload de imagens)
│   └── [id].ts              # GET abre (signed URLs) / DELETE exclui (+ imagens do bucket)
├── consulta-empresa.ts     # Vercel Edge Function: proxy same-origin p/ FonteData (protegida por sessão)
└── consulta-pessoa.ts      # Vercel Edge Function: proxy same-origin p/ APIFull (protegida por sessão)

supabase/migrations/        # users, sessions, saved_queries, saved_query_images, mirrored_images (RLS sem policies)

scripts/create-user.ts      # cria o primeiro usuário (senha só via prompt oculto, nunca em argv/log)

src/
├── types/graph.ts          # modelo de grafo: nós Pessoa/Empresa, relacionamentos tipados
├── services/
│   ├── provider.ts         # interface DataProvider (plugável)
│   ├── fontedata.ts        # provedor real (API comercial FonteData)
│   ├── apifull.ts          # perfil completo + sociedades[] (API comercial APIFull)
│   └── savedQueries.ts     # client das rotas /api/saved-queries/*
├── store/
│   ├── authStore.ts           # Zustand: sessão do usuário (login/logout/checkSession)
│   ├── graphStore.ts          # Zustand: expansão BFS, camadas, dedupe/anti-loop, filtros, tema,
│   │                          # snapshot/hidratação de consulta salva, foto do nó de pessoa
│   └── personProfileStore.ts  # Zustand: fila sequencial + cache/dedup do perfil APIFull por CPF,
│                              # mecanismo de lote (batch) para sincronizar mapa/camadas com a fila
├── lib/
│   ├── filtering.ts        # filtros dinâmicos + estatísticas + grau dos nós
│   ├── flowLayout.ts       # layout radial + posicionamento incremental
│   ├── exporters.ts        # PNG/SVG/PDF/JSON/CSV (nunca inclui o perfil da APIFull)
│   ├── colors.ts           # identidade visual de nós e conexões (paleta do painel)
│   ├── format.ts           # CNPJ/CPF/moeda/data
│   ├── mask.ts             # classificação/mascaramento de campos sensíveis + stripHardFields
│   ├── url.ts              # isSafeHttpUrl (só http/https — bloqueia javascript:/data:/file:)
│   ├── personPhoto.ts      # extração da foto do perfil APIFull (cadastral.foto > fotos[] > extraFotos[])
│   ├── profileImages.ts    # coleta de imagens do perfil para upload ao salvar a consulta
│   └── profileRender.ts    # limites de profundidade/itens + detecção de Base64/documento/URL de imagem
├── painel.css              # estrutura visual do painel (grid, painéis, nós rf-entity, perfil)
└── components/
    ├── LoginForm.tsx, SavedQueriesList.tsx
    ├── flow/               # FlowCanvas, EntityNode (foto na bolinha da pessoa), FloatingEdge
    └── painel/              # Topbar (nome do usuário/Sair, Salvar consulta, Consultas salvas),
                              # FiltersSidebar, Workspace, DetailsPanel, PersonProfilePanel,
                              # ImageLightbox, SaveQueryButton, CollapsibleSection
```
