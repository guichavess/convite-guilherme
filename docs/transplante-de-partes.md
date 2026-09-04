# Transplante de partes entre avatares VRM

Documento de apoio da seção `3.5 TRANSPLANTE DE PARTES` do `index.html`.
Cobre o que foi medido nos 12 modelos, a solução escolhida, os débitos
técnicos aceitos e o roteiro de teste manual.

---

## 1. Diagnóstico da arquitetura anterior

Fluxo antes da mudança (números de linha do commit `b46da6a`):

| responsabilidade | onde vivia |
|---|---|
| catálogo de personagens (`CAST`) | 754 |
| tabela de peças coloríveis (`PARTS`, regex no nome do **material**) | 767 |
| carregar/cachear/montar o VRM (`VRMAvatar.select`) | 838 |
| varredura única: encoding, colliders, índice de materiais (`prepare`) | 878 |
| troca do modelo em cena (`mount`) | 903 |
| peças disponíveis no personagem (`availableParts`) | 912 |
| recoloração por textura (`colorizeMap`) | 962 |
| aplicação por peça / geral (`applyPart`, `applyAll`) | 1043–1088 |
| linhas do painel (`UI.renderRows`) | 1413 |

`prepare` percorria a cena uma vez e guardava, por peça, a lista de
**materiais** que casavam com `PARTS[i].test`. `colorizeMap` convertia a
textura em luminância num canvas e a repintava no tom escolhido. Nada disso
trocava malha entre modelos: a "customização" era recolorir o modelo já
carregado.

## 2. Auditoria dos 12 modelos

Levantada com `docs/auditoria-vrm.js` (Node puro, lê o GLB direto — sem
dependência nova). Rodar com:

```
node docs/auditoria-vrm.js assets/avatars
```

| modelo | ossos humanoid | altura ref. (Head, m) | escala vs VITA | ombro/altura | quadril/altura | grupos spring / joints | joints de cabelo | peças (hair/tops/bottom/shoes/neck/face/body) |
|---|---|---|---|---|---|---|---|---|
| VIVI | 54/54 | 1.191 | 0.812 | 0.0321 | 0.1104 | 22 / 31 | 19 | sim / sim / — / sim / — / sim / sim |
| HARU | 54/54 | 1.320 | 0.900 | 0.0300 | 0.1033 | 11 / 22 | 8 | sim / sim / sim / sim / — / sim / sim |
| AOI | 54/54 | 1.352 | 0.922 | 0.0297 | 0.1023 | 10 / 12 | 7 | sim / sim / sim / sim / — / sim / sim |
| SHIBU | 54/54 | 1.388 | 0.946 | 0.0323 | 0.1112 | 16 / 22 | 14 | sim / sim / sim / sim / sim / sim / sim |
| SHINO | 54/54 | 1.417 | 0.966 | 0.0316 | 0.1089 | 17 / 23 | 15 | sim / sim / sim / sim / sim / sim / sim |
| NOIR | 54/54 | 1.422 | 0.970 | 0.0315 | 0.1085 | 17 / 26 | 14 | sim / sim / — / sim / — / sim / sim |
| MIKA | 54/54 | 1.422 | 0.970 | 0.0315 | 0.1085 | 10 / 19 | 7 | sim / sim / — / sim / — / sim / sim |
| VITA | 54/54 | 1.466 | 1.000 | 0.0305 | 0.1052 | 18 / 27 | 15 | sim / sim / — / sim / — / sim / sim |
| VICTORIA | 54/54 | 1.497 | 1.021 | 0.0299 | 0.1030 | 16 / 25 | 13 | sim / sim / — / sim / — / sim / sim |
| REN | 54/54 | 1.545 | 1.054 | 0.0319 | 0.1098 | 10 / 11 | 8 | sim / sim / sim / sim / — / sim / sim |
| KENTA | 54/54 | 1.552 | 1.058 | 0.0317 | 0.1093 | 8 / 13 | 7 | sim / sim / sim / sim / — / sim / sim |
| FUMIRIYA | 54/54 | 1.684 | 1.149 | 0.0292 | 0.1007 | 13 / 13 | 13 | sim / sim / sim / sim / sim / sim / sim |

Leitura dos números — os três fatos que decidiram o desenho:

1. **Os 12 têm os mesmos 54 ossos humanoid**, com os mesmos nomes. Não existe
   modelo com rig incompleto; o remapeamento por nome é total, sem furos.
2. **A bind pose é equivalente entre modelos.** A `inverseBindMatrix` do
   `Head` é translação pura e igual a `-altura do Head` (ex.: AOI `(0, -1.352,
   -0.005)`), ou seja: rotação identidade em todos. Os esqueletos diferem só
   em *posição* de osso — nunca em orientação. É isso que permite reusar a
   malha do doador sem recalcular `boneInverses`.
3. **As proporções normalizadas são quase idênticas** (ombro/altura entre
   0,0292 e 0,0323; quadril/altura entre 0,1007 e 0,1112 — dispersão de ~5%),
   mas a altura absoluta varia 41% (VIVI 1,191 m contra FUMIRIYA 1,684 m).
   A cabeça, ao contrário, é quase constante: bbox do rosto de 0,212 a 0,244.
   Logo: peça presa ao corpo precisa de correção de proporção; peça presa à
   cabeça não precisa.

Estrutura de malha, idêntica nos 12: `Face` (10 primitivas), `Body` (6 a 9) e
`Hair001` (46 a 118). O VRoid exporta cada primitiva com um material só, e o
GLTFLoader as explode em `SkinnedMesh` independentes — por isso a peça é
identificável e removível sem tocar em geometria. Todos os materiais dos 12
modelos caem em alguma peça de `PECAS`: nenhum órfão.

Outliers a observar: **VICTORIA, VITA, VIVI, MIKA e NOIR não têm `Bottoms`**
(vestido/saia inteiriça); **só SHINO, SHIBU e FUMIRIYA têm `AccessoryNeck`**.
Par mais divergente (pior caso de teste): **VIVI × FUMIRIYA** — 41% de
diferença de altura.

## 3. Solução adotada

**Não** reordenamos `bones[]` nem tocamos em `skinIndex`/buffers de geometria.
O VRM doador inteiro entra na cena como filho da cena do personagem base; as
malhas que não interessam saem do grafo; e a cada frame os 54 ossos humanoid
do doador recebem `position`/`quaternion`/`scale` do osso de mesmo nome da
base. O esqueleto do doador passa a ser, geometricamente, o da base.

Três funções, uma responsabilidade cada:

- `Transplante.mapearOssos(base, doador)` — pares osso-a-osso por nome.
- `Transplante.anexar(d)` — põe o doador na cena zerado e reseta os springs.
- `mostrarMalhas(vrm, mapa)` — decide o que de cada modelo fica no grafo.

Por que assim, e não pelo remapeamento de skeleton:

| critério | remapear `bones[]` | rig do doador dirigido pela base (adotado) |
|---|---|---|
| altura/porte diferente | escala global ou correção por osso, à mão | sai de graça: o osso *é* o da base |
| spring bones do doador | portar os joints extras e reconstruir o manager | continuam do doador, funcionando |
| buffers de geometria | `skinIndex` reescrito | intocados |
| voltar atrás | reprocessar | religar no grafo, instantâneo |
| custo por frame | zero | 0,02 ms de cópia de pose + física só quando necessária |

Escala: como as posições dos ossos passam a ser as da base, o comprimento da
roupa acompanha o alvo **por osso** (melhor que um fator único). O cabelo, cujos
ossos ficam abaixo de `Head` e não são humanoid, mantém o tamanho original —
correto, porque a cabeça é praticamente constante entre os 12.

### Custo por frame, medido no Chrome (3 doadores)

| etapa | primeira versão | versão final |
|---|---|---|
| cópia de pose (54 ossos × 3) | 0,024 ms | 0,024 ms |
| spring bones | 3,475 ms | ~1,2 ms (só o doador do cabelo; frames alternados em mobile) |
| blendshapes + materiais + lookAt | 0,047 ms | ~0,01 ms (só o doador do rosto) |
| **total `sincronizar`** | **5,33 ms** | **0,70 ms** |

Malhas escondidas saem do grafo em vez de `visible=false`: com 46 a 118
primitivas por modelo, mantê-las penduradas custava um terço do frame rate
(32 fps contra 39 fps sem doador). Depois da mudança, 3 doadores custam o
mesmo que nenhum (40 contra 39 fps na mesma máquina).

## 4. Gestão de memória

WebGL não coleta nada sozinho. `disposeVRM(vrm)` libera geometria, materiais e
**todas** as texturas alcançáveis (varredura genérica das propriedades e dos
uniforms — uma lista fixa de nomes deixava ~2/3 das texturas do MToon vivas), e
também `skeleton.dispose()`, que é onde mora a *bone texture* (2 texturas por
modelo que vazavam em toda troca). O cache é LRU (`VRMAvatar.LIMITE_CACHE = 5`)
e nunca poda o personagem em cena nem um doador escolhido.

Medição com `renderer.info.memory`, 72 trocas de peça seguidas, forçando o
cache ao mínimo antes e depois:

```
antes:  { geometrias: 88, texturas: 31 }
depois: { geometrias: 88, texturas: 31 }
```

Estável, sem crescimento.

## 5. Débitos técnicos aceitos (explícitos)

1. **Roupa emprestada não tem física.** Só o doador do *cabelo* roda spring
   bones; saia ou gola vinda de outro modelo acompanha o osso, rígida. Foi a
   troca que derrubou o custo de 5,3 ms para 0,7 ms por frame.
2. **Em mobile a física do cabelo emprestado roda em frames alternados**, com
   o dt acumulado.
3. **Sem colisão de tecido.** Roupa modelada para um corpo muito mais largo
   pode interpenetrar a pele do alvo — o retarget corrige comprimento, não
   volume. O volume é do doador de propósito: é a roupa *daquele* personagem.
4. **O doador existe uma vez em memória**, então a mesma peça não pode ser
   usada duas vezes com poses diferentes.
5. **Rosto e corpo são peças separadas**: trocar só o rosto mantém o pescoço do
   alvo, e uma diferença grande de tom de pele fica visível na emenda. A linha
   PELE do painel repinta os dois de uma vez, o que resolve na prática.
6. **Combinações não são pré-montadas em cache.** Não é preciso: o "cache" é o
   próprio doador já carregado — voltar a uma combinação anterior é só religar
   malhas no grafo, sem reprocessamento.

## 6. Checklist de teste manual

| # | caso | resultado |
|---|---|---|
| 1 | cabelo VIVI no corpo VITA (proporções próximas) | OK — encaixe e escala corretos |
| 2 | blusa + calça do KENTA na VITA | OK — comprimento acompanha o alvo; volume é do doador |
| 3 | 3 peças de 3 modelos (cabelo NOIR + blusa SHINO + calçado VICTORIA na VITA) | OK |
| 4 | pior caso: cabelo/blusa/calça/gola da FUMIRIYA (1,684) na VIVI (1,191) | OK, sem quebra |
| 5 | peça ausente no doador (calça da VICTORIA, que não tem `Bottoms`) | degrada em silêncio: peça segue do próprio, cena intacta |
| 6 | escolher como personagem um modelo que estava doando (VICTORIA) | doadores soltos, malhas do próprio de volta |
| 7 | recolorir peça emprestada (cabelo da SHINO em roxo no KENTA) | OK — a cor é aplicada no doador |
| 8 | trocar o doador com a cor já escolhida (SHINO → SHIBU) | OK — cor reaplicada no novo doador |
| 9 | ALEATÓRIO com mistura de peças | OK |
| 10 | RESET | volta tudo para "PRÓPRIO" |
| 11 | SAVE + reload (memory card v4) | combinação restaurada (cabelo REN na VICTORIA) |
| 12 | save antigo (v3, sem `pecas`) | carrega com todas as peças em "PRÓPRIO" |
| 13 | 72 trocas seguidas — memória de GPU | geometrias e texturas estáveis |
| 14 | fps com 3 doadores contra nenhum | 40 contra 39 (mesma máquina) |
| 15 | boot PS2, menu, convite, detalhes, RSVP | inalterados |
| 16 | 12 cabelos × 3 corpos diferentes | **pendente** — 6 cabelos cobertos; falta a varredura completa |
| 17 | Android mid-range real | **pendente** — medido só em desktop; o número de mobile é estimativa a partir do custo de CPU |

## 7. Como usar pelo console

```js
PS2CONVITE.peca("hair", "vivi");   // cabelo da VIVI
PS2CONVITE.peca("tops", null);      // volta a blusa do próprio personagem
PS2CONVITE.Transplante.doadores;    // quem está em cena
```
