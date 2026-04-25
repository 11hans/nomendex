# LLM Cost Analysis & Optimization Proposals

**Datum:** 2026-04-25  
**Datový základ:** `~/Library/Logs/com.firstloop.nomendex/usage.jsonl` (41 záznamů, 2 dny: 23.–24. 4. 2026)  
**Agent:** `bpagent` (Claude Sonnet 4.6)

---

## 1. Shrnutí nálezu

| Metrika | Hodnota |
|---|---|
| Skutečné celkové náklady | **$2.00** |
| Náklady reportované přes `result` záznamy | $0.56 (28 % skutečnosti) |
| Počet sessions | 2 |
| Počet LLM volání (`assistant_turn`) | 37 |
| Cache read tokeny celkem | 1 030 440 |
| Cache creation tokeny celkem | 414 198 |

**Klíčový problém:** Monitoring ukazuje vývojovému týmu 3.5× nižší cenu, než je realita. `result` záznamy agregují jen finální výstup, ale `assistant_turn` záznamy (každé interní LLM volání včetně tool callů) nejsou do přehledu zahrnuty.

---

## 2. Popis problémů

### 2.1 Neúplné cost reportování

**Kde:** `usage-logger.ts`, zobrazení v Cost HUD

`result` event zachycuje souhrn na úrovni jednoho "query" (od uživatele po odpověď). `assistant_turn` eventy zachycují každé individuální LLM volání uvnitř tohoto query — tool cally, subagent volání, intermediate reasoning.

```
Skutečné náklady = Σ(assistant_turn.costUsdListPrice)
                 = $1.44  ← toto chybí v přehledu

Reportované náklady = Σ(result.costUsdListPrice)
                    = $0.56  ← toto vidí vývojář
```

`assistant_turn` záznamy mají v součtu **2.6× vyšší náklady** než `result` záznamy a obsahují 37 volání oproti 4. V produkčním prostředí s reálným provozem bude tento rozdíl pravděpodobně ještě větší (více tool callů, subagenti).

---

### 2.2 Opakovaná cache creation bez dostatečného reuse

**Kde:** `chat-routes.ts:1078–1112` (memory extraction), Anthropic SDK cache lifecycle

Session `03c7757d` se spustila 3× v průběhu 7 minut (19:21, 19:25, 19:29). Každý run vytvořil novou cache:

| Run | Cache creation | Cache read | Read/Created | Break-even |
|---|---|---|---|---|
| 19:21 (14 turns) | 30 671 | 125 076 | **4.1×** | 12.5× |
| 19:25 (7 turns) | 25 666 | 77 468 | **3.0×** | 12.5× |
| 19:29 (2 turns) | 27 215 | 45 997 | **1.7×** | 12.5× |

Cache creation stojí **1.25× cenu běžného input tokenu**. Aby se creation vyplatila, musí být tentýž kontext přečten ≥ 12.5× (při ceně read = 0.1×). V současném stavu se to nestane — každý re-run rekonstruuje cache znovu.

**Příčina:** Memory extraction po každém výsledku (`chat-routes.ts:1078`) spouští nové LLM volání nad stejným kontextem. Pokud je tento run vzdálen > 5 minut od předchozího (Anthropic cache TTL), cache expiruje a musí být vytvořena znovu. I při < 5 minutách jsou to 3 separátní volání se stejným ~20k token system promptem.

---

### 2.3 Velký systémový prompt s nízkým cache return on investment

**Kde:** `built-in-bpagent.ts:45–419`, `chat-routes.ts:687–764`

Systémový prompt BPagent je **~17 000 tokenů** skládaný dynamicky při každém query:

```
buildAgentContext()          ~200 tokenů   (datum, workspace path, API docs)
buildBpagentSystemPrompt()   ~15 000 tokenů (planning guide, API reference, skills)
buildDailyContextBlock()     ~300 tokenů   (optional)
buildMemoryPromptBlock()     ~1 000 tokenů (optional, max 4k chars)
```

Při průměrném `assistant_turn` je cache read **21 176 tokenů** a cache creation **8 598 tokenů** — tedy kontext se přečte typicky 2–3× na turn (není ideální). Pro session s 36 turns to znamená 36 × 21 176 = **762 336 cache read tokenů** pouze na systémový prompt.

Část tohoto promptu se mění per-query (datum, memory block) — to neumožňuje cache sdílet across sessions.

---

### 2.4 Vysoký počet turns na query

**Kde:** `chat-routes.ts` (tool execution loop)

Session `03c7757d` měla 36 `assistant_turn` záznamů (průměr 12 per sub-run). Průměrný output na turn byl **7 tokenů** — agent dělá převážně krátké tool cally s velkým kontextem. Každý turn stojí ~$0.039, z toho velká část jsou cache read tokeny.

```
36 turns × 21 176 avg cache read tokens = 762 k cache reads
36 turns × 8 598 avg cache creation tokens = 309 k cache creates
```

Kdybychom snížili počet turns na 20 (batch tool calls), ušetříme ~$0.60 na takovou session.

---

## 3. Navrhované optimalizace

### OPT-1: Opravit cost reporting — zobrazovat skutečné náklady

**Priorita: Vysoká | Dopad: Viditelnost, ne přímá úspora**

`result` event sám o sobě nestačí pro správný přehled. Cost HUD a jakýkoli budoucí dashboard musí sčítat **všechny** eventy.

**Konkrétní změna v `usage-logger.ts`:**

```typescript
// Přidat kumulativní session cost tracker
// Místo zobrazování jen result.costUsdListPrice zobrazovat:
const sessionCost = assistantTurnEvents
  .filter(e => e.sessionId === sessionId)
  .reduce((sum, e) => sum + e.costUsdListPrice, 0);
```

Alternativně: přidat do `result` eventu pole `totalCostUsd` které sečte všechny `assistant_turn` eventy pro daný session run. Tím se nezmění schéma logu, jen přidá jedna metrika.

---

### OPT-2: Sdílet systémový prompt cache across sub-runs

**Priorita: Vysoká | Odhadovaná úspora: ~30–40 % nákladů na memory extraction**

Memory extraction (`chat-routes.ts:1078`) spouští nové LLM volání, které načítá stejný ~15k token systémový prompt jako hlavní query. Pokud by extraction používala **minimalizovaný prompt** (bez planning guide, API reference atd.), cache creation by byla výrazně nižší.

**Konkrétní návrh:**

```typescript
// chat-routes.ts:1078 — memory extraction run
// Místo plného bpagentPrompt použít stripped-down verzi:
const extractionSystemPrompt = buildMinimalExtractionPrompt(notesPath);
// ~500 tokenů místo ~17 000 tokenů
```

Extraction nepotřebuje znát scheduling rules ani API reference — potřebuje jen instrukce pro parsování memories z konverzace.

---

### OPT-3: Oddělit statický a dynamický kontext v systémovém promptu

**Priorita: Střední | Odhadovaná úspora: 15–25 % na cache creation**

Anthropic prompt cache funguje nejlépe na **stabilní prefix**. Momentálně se systémový prompt skládá takto:

```
[buildAgentContext — DYNAMICKÝ: datum]
[buildBpagentSystemPrompt — STATICKÝ: ~15k tokenů]
[buildDailyContextBlock — SEMI-DYNAMICKÝ]
[buildMemoryPromptBlock — DYNAMICKÝ: jiný per-session]
```

Datum na začátku invaliduje cache pro celý prompt každý den. Pokud se dynamické části (datum, memory) přesunou **na konec** systémového promptu nebo do prvního user message, statická část (~15k tokenů) bude moci využít cache přes více sessions i dní.

**Konkrétní změna:**

```typescript
// chat-routes.ts:694 — změnit pořadí
let bpagentPrompt = [
  buildBpagentSystemPrompt(...),   // statické — jde první, cache-friendlier
  buildDailyContextBlock(),         // semi-statické
  buildAgentContext(notesPath),     // dynamické (datum) — jde poslední
  memoryBlock,                      // dynamické — jde poslední
].filter(Boolean).join('\n\n');
```

---

### OPT-4: Snížit počet turns pomocí parallel tool calls

**Priorita: Střední | Odhadovaná úspora: ~20–40 % turns → přímá úspora na turn count**

Průměrný output na `assistant_turn` je 7 tokenů, což odpovídá agentovi který volá jeden tool za turn. Claude umí v jedné odpovědi vrátit více `tool_use` bloků — tzv. parallel tool calls.

Pokud agent typicky dělá:
```
turn 1: read_todos
turn 2: read_goals  
turn 3: read_timeblocks
```

S parallel tool calls by to byl 1 turn místo 3, při stejném výsledku.

**Konkrétní návrh:** V systémovém promptu BPagent explicitně instrukovat agenta, aby paralelizoval nezávislé read operace:

```
## Tool Usage
When gathering information, call multiple read tools in a single response
rather than sequentially. For example, read todos, goals, and timeblocks
in one turn rather than three separate turns.
```

---

### OPT-5: Cache warm-up pro opakované sessions

**Priorita: Nízká | Odhadovaná úspora: závisí na frekvenci sessions**

Anthropic cache TTL je 5 minut. Pokud uživatel posílá zprávy s delšími pauzami, cache expiruje a ~15k tokenů systémového promptu se platí jako cache creation znovu.

Potenciální řešení: Lightweight "ping" query s prázdným uživatelským vstupem každé 4 minuty během aktivní session pro udržení cache warm. Nicméně toto má smysl pouze pokud průměrná pauza mezi zprávami je 5–15 minut — pro kratší pauzy není potřeba, pro delší je to zbytečné.

**Doporučení:** Nejdřív nasbírat data o průměrném inter-message intervalu před implementací.

---

## 4. Prioritizace

| # | Optimalizace | Implementační náročnost | Odhadovaná úspora | Priorita |
|---|---|---|---|---|
| OPT-1 | Opravit cost reporting | Nízká (1–2h) | Viditelnost | **Ihned** |
| OPT-2 | Minimální prompt pro memory extraction | Střední (0.5 den) | 30–40 % extraction costs | **Vysoká** |
| OPT-3 | Statický prefix first v system promptu | Nízká (30 min) | 15–25 % cache creation | **Vysoká** |
| OPT-4 | Parallel tool calls instrukce | Nízká (30 min) | 20–40 % na turn count | **Střední** |
| OPT-5 | Cache warm-up | Střední (0.5 den) | Závisí na usage patternu | **Nízká** |

---

## 5. Co měřit po optimalizacích

Pro vyhodnocení dopadů přidat do usage logu:

1. **`cacheHitRate`** per session run — `cacheReadTokens / (cacheReadTokens + cacheCreationTokens + inputTokens)`
2. **`totalSessionCostUsd`** v `result` eventu — součet všech `assistant_turn` nákladů pro daný run
3. **`avgOutputTokensPerTurn`** — indikátor tool call granularity; cíl > 50 tokenů/turn (momentálně 7)
4. **`systemPromptTokens`** — sledovat trend pokud se prompt mění

Baseline (současný stav):
- Cache hit rate: 62–80 % (cíl: > 85 %)
- Avg output/turn: 7 tokenů (cíl: > 50 tokenů)
- Memory extraction cost: ~$0.13–0.24 per run (cíl: < $0.05)

---

## 6. Poznámky k datovému vzorku

Data obsahují pouze 41 záznamů ze 2 dnů a 2 sessions. Závěry jsou orientační — doporučuje se:

- Sbírat data alespoň 2 týdny před finálním rozhodnutím o prioritách
- Přidat do logu `subagentId` pro rozlišení hlavního agenta a subagentů (weekly-reviewer, inbox-processor atd.)
- Sledovat zda pattern "3 sub-runs za session" je výjimka nebo norma

