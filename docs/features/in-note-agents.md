# In-Note Agents

## Context

Nomendex má bohatou agent/chat infrastrukturu (SSE streaming přes `/api/chat`, konfigurovatelné agenty, MCP, permission flow), ale notes editor (ProseMirror) zatím nemá žádnou AI integraci. Uživatelé musí kopírovat text z poznámky do Chat tabu, spustit agenta, a výsledek ručně přenést zpět — to narušuje tok psaní a rozbíjí kontext.

**Cíl feature**: umožnit uživateli spustit agenta přímo z poznámky nad označeným textem, aniž by opustil editor. Výstup se streamuje v kontextu poznámky a uživatel rozhoduje, zda jej přijme, vloží pod výběr, zahodí, nebo pokračuje v plném chatu.

## UX rozhodnutí (schváleno)

1. **Spouštění**: Floating toolbar nad netriviálním textovým výběrem v editoru. Tlačítka: předdefinované quick actions (Rewrite, Summarize, Translate, Fix grammar, Expand) + dropdown "Agents" se seznamem nakonfigurovaných agentů.
2. **Výstup**: Inline "agent block" vložený za blok obsahující konec výběru. Ephemeral (neukládá se do markdownu), zobrazuje header (akce, agent, status), streamovaný obsah a akční lištu: **Accept** (nahradí výběr), **Insert below**, **Discard**, **Continue in chat**.
3. **Konverzace**: Hybrid — defaultně one-shot. Tlačítko "Continue in chat" otevře nový chat tab s výběrem + dosavadní odpovědí jako seeded kontextem.
4. **Typy akcí**: kombinace
   - **Quick actions**: one-shot, Haiku, bez nástrojů, bez session (rychlé, nízká latence).
   - **Full agents**: běží přes `/api/chat` SDK session s tools/MCP/permission flow (plná síla, uživatelem zvolený agent).

## Architektonický přehled

### Komponenty

- **Floating toolbar** — React portál, pozicovaný přes `view.coordsAtPos(selection.from)`. Zobrazuje quick actions + Agents dropdown (`/api/agents/list`).
- **Agent block** — ProseMirror `Decoration.widget` zakotvený za top-level blokem obsahujícím `selection.to`. Widget hostí React root s UI stavem (streaming / awaiting permission / done / error).
- **Plugin state** — autoritativní zdroj: `{ toolbar, blocks: Map<blockId, { actionId, agentId, originalRange, afterPos, status, text, permissionPending? }> }`. Původní výběr se mapuje přes `tr.mapping` při každé transakci, aby Accept fungoval i po editaci nad blokem.
- **Stream hook** — jednotný parser SSE, dva režimy: `quick` (volá `/api/notes/quick-action`) a `agent` (volá `/api/chat` s `transient: true`). Stejný tvar událostí v obou režimech.

### Backend

Hybridní řešení (zdůvodnění v "Otevřené otázky"):

- **`POST /api/notes/quick-action`** — nový endpoint. Vstup: `{ actionId, selectionText }`. Výstup: SSE stream text deltas. Backed by Claude CLI one-shot se `--output-format stream-json` (analogie `features/todos/rewrite.ts`). Bez session, bez tools, bez permission flow.
- **`POST /api/chat` rozšíření** — přidat `transient: true` flag. Skippne persistenci session, jinak zachová celý existující pipeline (canUseTool, permission_request, tool streaming).

### Ephemeralita

Agent block je `Decoration.widget`, NE skutečný node — nemůže být serializován do markdownu. To zaručuje, že dokud uživatel explicitně neudělá Accept / Insert below, nic se do `.md` souboru nepropíše.

## Klíčové toky

### Spuštění quick action
1. Uživatel vybere text → toolbar se zobrazí.
2. Klik na Rewrite → plugin otevře agent block za aktuálním blokem, uloží `originalRange` do plugin state.
3. `useAgentStream` volá `/api/notes/quick-action`, streamuje delty do bloku.
4. Uživatel klikne Accept → jediná transakce nahradí zmapovaný `originalRange` finálním textem a zavře blok.

### Spuštění nakonfigurovaného agenta
1. Stejné jako výše, ale volá `/api/chat` s `transient: true` a zvoleným `agentId`.
2. Tool use události se v bloku renderují jako status řádky.
3. Pokud přijde `permission_request` → v bloku se zobrazí Allow / Deny.
4. Deny → stream končí čistě, blok zobrazí "denied".

### Continue in chat
1. Plugin přečte `selectionText`, dosavadní `assistantText` a `agentId`.
2. Sestaví seeded zprávy (prior user turn s výběrem + prior assistant turn).
3. Pro v1 jednodušší cesta: seeded turns se sbalí do `<context>`-wrapped first user prompt → žádná backend změna.
4. Otevře se nový chat tab s `{ agentId, seededMessages }`. Původní agent block se zavře (byl "povýšen" do chatu).

## Quick action registry

Statická definice v kódu (v1 neupravitelné uživatelem):

```
{ id, label, systemPrompt, model: "claude-haiku-4-5" }
```

Sada v1: **Rewrite, Summarize, Translate, Fix grammar, Expand**.

## Edge cases k ošetření

- Výběr přes více top-level bloků → blok se vloží za blok obsahující `to`.
- Výběr uvnitř code block / table → blok se vloží za obalující top-level blok (`$from.before(1)`).
- Editace nad blokem během streamu → `originalRange` se mapuje přes `tr.mapping`, blok zůstává ukotven.
- Discard během streamu → AbortController přeruší stream, žádná mutace dokumentu.
- Více souběžných bloků → v1 limit 3 běžící současně.
- Reload aplikace → bloky jsou ephemeral, po reloadu se neobnovují.

## Rizika

- **Flicker widget decorations**: při každé transakci by se widget mohl přerenderovat. Mitigace: klíčovat widget přes `blockId` a znovupoužít DOM + React root přes modulární `Map`.
- **Transient SDK sessions**: Claude Code SDK zapisuje session JSONL horlivě. Nutno ověřit, zda jde potlačit, jinak akceptovat "leaked" soubory + přidat úklidový pass.
- **Coord positioning toolbaru**: při zalomení řádku může být pozice špatně; clampovat na viewport.
- **Undo semantika**: Accept jako jediná `tr` → jedno undo vrátí celé Accept.

## Otevřené otázky

1. **Rozsah kontextu pro quick actions**: jen výběr, nebo i okolní odstavec / celá nota? Doporučení v1: jen výběr, později checkbox "include note context". Viz UX roadmap §13 (@-mention kontextu).
2. **Translate cílový jazyk**: picker v dropdownu, nebo heuristika (výchozí jazyk workspace)? Rozhodnutí: submenu s jazyky + last-used v localStorage (viz UX roadmap §7).
3. **Persistence transient sessions**: tolerovat leaked JSONL, nebo přidat cleanup?
4. **Seeded chat**: concat-into-first-prompt (jednodušší) vs. skutečný `messages[]` array? Doporučení v1: concat.
5. **Klávesové zkratky**: Cmd-K / Cmd-J nad výběrem pro toolbar. Rozhodnutí: Cmd-J (viz UX roadmap §11).
6. **Limit souběžných bloků**: 3? Konfigurovatelné?
7. **Povolení quick actions na úrovni workspace**: jsou defaultně všem, nebo lze v settings vypnout jednotlivé akce?

## UX roadmap (post-v1)

V1 je "5 tlačítek + agent dropdown nad výběrem". Aby feature byla vnímaná jako "AI v editoru" (Notion, Linear, Cursor) a ne jako "další tooltip s batch transformacemi", níže seřazené vylepšení dle dopadu.

### Status

v2 implementováno: §1, §2, §3, §4, §8, §9, §10, §11 (jen ⌘J), §12 (smooth mount, autoscroll, Copy, Model badge).
Odloženo: §5 Ghost-text streaming, §6 IA refactor, §11 kompletní blokové zkratky, §13 @-mention kontext, §12 (Accepted toast, Language badge).
Zrušeno: §7 Translate target picker (překlad zůstává auto cs↔en).

### 1. Free-form prompt box (Notion Cmd+J style) — killer feature ✅ v2

Quick actions jsou user-facing schované pod jedním tlačítkem `✨ Ask AI ⌘J`. Po kliku vertikální popover s:
- input `Tell AI what to do with selection…` (Enter = custom quick action, `systemPrompt = userInput + "Return only the result."`)
- sekce pod inputem: *Edit* (Rewrite, Fix grammar, Shorter, Longer, Change tone →), *Generate* (Summarize, Expand, Translate →), *Agents* (config agenti)

Tahle jediná změna transformuje feature z "batch transformací" na "AI partnera".

### 2. Iteration loop po dokončení streamu ✅ v2

Dnes má user po `done` jen Accept / Insert / Chat / Discard — buď bere, nebo nebere. Chybí Notion-style loop:
- **Refine chips**: `Shorter` · `Longer` · `More formal` · `Simpler` · `Bulleted` (pošlou dosavadní output zpět s `Rewrite this to be {chip}`)
- **Refine input** `Tell AI what to change…` pro freeform follow-up
- **Try again** — re-run stejné akce, jiný seed

Bez toho je každý nepovedený pokus ztracený — user musí discardnout, znovu vybrat, znovu spustit. S loopem se jeden výběr stane konverzací.

### 3. Diff preview pro transform akce ✅ v2

Pro **Rewrite / Fix grammar / Translate** je ideální inline red-strikethrough / green-insert přímo v původním textu (Grammarly, Cursor Tab style). Teď uživatel porovnává dva bloky očima.
- Implementace: při `done` udělat token-level diff selection ↔ output a renderovat přes `Decoration.inline`. Accept = commit, Discard = odstranit decorations.
- Pro **Expand / Summarize / Continue writing** nech stávající "block pod". Diff dává smysl jen u transformací.

### 4. "Continue writing" bez výběru (empty-line trigger) ✅ v2 (částečně)

Implementováno: toolbar se ukazuje i v prázdném top-level bloku; ⌘J na libovolné pozici kurzoru vyvolá Ask AI popover (bez potřeby výběru). Custom prompt bez selekce běží (`quick-action.ts` fallback). Ghost-text + auto-context z předchozích bloků odloženo do §5.

Aktuálně selection ≥5 znaků (`in-note-agent-plugin.ts:109`). To blokuje největší use-case — **psát s AI**, ne jen transformovat existující text.
- Na prázdném řádku: toolbar jako subtle ghost `✨ Press Space for AI` místo nad výběrem
- Akce: `Continue writing` (pošle předchozí 2–3 bloky jako kontext, streamuje od kurzoru)
- Pro `Brainstorm / Outline / Draft` zůstává stejný popover

### 5. Ghost-text streaming pro generate akce ⏸ odloženo

Pro Expand / Continue writing renderovat výstup **přímo do dokumentu v gray italic** (Cursor / Copilot ghost text), accept = změnit styling na normal, discard = smazat. U transformace (Rewrite) zůstává boxed blok s diff (§3).

Rozhodovací pravidlo: **generate = ghost inline, transform = block s diff**.

### 6. Custom-prompt ≠ agent — fixni IA ⏸ odloženo (částečně pokryto §1)

Teď jsou *quick actions* a *agents* dvě oddělené vrstvy v toolbaru. V hlavě uživatele je to jedno — "AI". Skryj rozdíl:
- Primary UI: Ask AI prompt + 5 presetů (free-form prompt = ad-hoc quick action přes stejný backend)
- Agents jako sekundární `Use agent ▸` submenu s vysvětlením "Agents can use tools and your files"
- Taxonomie v UI: *Edit* / *Generate* / *Transform* / *Ask* (Q&A o výběru), ne "quick actions vs. agents"

### 7. Translate target picker ❌ zrušeno

Aktuální Translate auto-detekuje cs↔en; picker se ukázal jako scope creep.

Submenu na hover: `Translate ▸ English · Czech · German · Spanish · Custom…`. Heuristika "default workspace language" je horší — user potřebuje flipovat jazyky. Last-used uložit do localStorage, zobrazit nahoře seznamu.

### 8. Původní výběr během streamingu "v escrow" ✅ v2

Během streamu se originální text nemění, ale user ztrácí, který range se transformuje (mezitím myš kliknula jinam). Fade původní range na 40% opacity po dobu běhu bloku (`Decoration.inline` s className `in-note-agent-source-pending`). Accept = commit, Discard = restore full opacity. Propojí vizuálně zdroj ↔ output.

### 9. Stop ≠ Discard ✅ v2

Discard teď killne stream i smaže partial text. Oddělit:
- `Stop` — přeruší stream, ponechá partial output v bloku (user může Accept na to, co přišlo, nebo retry)
- `Discard` — zavře blok bez commitu

Notion / ChatGPT / Cursor — všichni tohle dělí.

### 10. Tool activity jako collapsed strip (full-agent mode) ✅ v2

Default-collapsed `▸ Used 3 tools` s expandem na detail (Notion / Cursor pattern). Main output drží čistý flow. Pouze `permission_request` bubble up jako blokující prvek.

### 11. Keyboard shortcuts na bloku ✅ v2 (jen ⌘J)

⌘J otevírá Ask AI popover z editoru (i bez výběru — force-toolbar na pozici kurzoru). Blokové zkratky (`Esc`, `⌘↵`, `⌘⇧↵`, `⌘R`, `Tab`) odloženy.

V `InNoteAgentBlock.tsx` zachytit:
- `Esc` → Discard (nebo Stop pokud streaming)
- `⌘↵` → Accept
- `⌘⇧↵` → Insert below
- `⌘R` → Try again
- `Tab` → focus na Refine input (viz §2)

Zobrazit jako `KeyboardIndicator` na tlačítkách (existing pattern v codebase). Toolbar se otevírá `⌘J`.

### 12. Drobnosti s vysokým poměrem přínos/práce

- ✅ **Smooth mount**: 150ms `opacity+translateY(-4px) → 0` na otevření bloku.
- ✅ **Autoscroll**: `block.scrollIntoView({ block: "nearest", behavior: "smooth" })` při mountu.
- ✅ **Copy button** v header baru.
- ⏸ **Accepted toast s Undo** 5s po Accept.
- ✅ **Model badge v header** `Haiku` pro quick-action / custom-prompt bloky.
- ⏸ **Language detected badge** u Translate.

### 13. Kontext selektoru (nahrazuje Otázku #1) ⏸ odloženo

Místo binární checkbox "include context" → **@-mention do promptu**: user píše `make this match the tone of @note:projects.md` nebo `@block:previous`. Tokenizovaný input. Zapadá do existing wiki-links modelu a matchuje kam jdou Notion / Cursor / Raycast.


## v2 — klíčové soubory

- **Plugin + state**: `features/notes/in-note-agent-plugin.ts` — `AgentBlockData` (nyní včetně `customPrompt`, `originalText`, `toolCalls`), `META_SET_TOOLBAR`, `META_ADD_TOOL_CALL`, source escrow decoration, empty-line trigger.
- **Floating toolbar**: `features/notes/InNoteFloatingToolbar.tsx` — Ask AI pill + popover s Edit/Generate/Agents sekcemi, `externalOpenSignal` pro ⌘J, cached toolbar přes ztracený focus.
- **Agent block**: `features/notes/InNoteAgentBlock.tsx` — streaming/done/error states, Stop vs Discard, refine chips + custom instruction input, diff preview toggle, tool activity strip, model badge, Copy, smooth mount.
- **Stream wiring**: `features/notes/note-view.tsx` — `startAgentStream`, handlers (accept/insert/discard/stop/retry/refine/permission), ⌘J listener, tool_use event dispatch.
- **Quick-action backend**: `features/notes/quick-action.ts` + `features/notes/quick-action-types.ts` — podporuje `actionId | customPrompt`, `TRANSFORM_ACTION_IDS`, `REFINE_CHIPS`, prázdný selection fallback.
- **Diff**: `features/notes/word-diff.ts` — LCS word-level diff pro §3.
- **CSS**: `bun-sidecar/src/input.css` — `.in-note-agent-source-pending`, `.in-note-agent-diff-{removed,added}`, `.in-note-agent-block-mount` animace.

## Reference na existující patterns (pro future implementaci)

- Editor: `bun-sidecar/src/features/notes/note-view.tsx`
- Plugin + popup pattern: `components/prosemirror/wiki-links/plugin.ts`
- Decoration + widget pattern: `features/notes/simple-todo.ts`
- SSE streaming (frontend): `features/chat/chat-view.tsx` (lines 835–981)
- SSE backend: `server-routes/chat-routes.ts`
- One-shot Claude CLI runner: `features/todos/rewrite.ts`
- Agent list API: `/api/agents/list`
