# BPagent – Uživatelský manuál

BPagent je specializovaný AI asistent integrovaný přímo do Nomendexu. Pomáhá ti s organizací poznámek, sledováním cílů, řízením projektů, týdenními review a udržením produktivního systému.

---

## Aktivace

1. Otevři chat (ikona chatu v postranním panelu nebo `Cmd+K` → Chat)
2. V záhlaví chatu klikni na rozbalovací menu agentů
3. Vyber **BPagent**

BPagent je dostupný ve všech pracovních prostorech bez dalšího nastavení.

---

## Očekávaná struktura vaultu

BPagent předpokládá Obsidian-kompatibilní strukturu složek.

```
{workspace}/
├── [daily notes folder]  # Denní záznamy (detekovaný název složky + formát data)
├── Goals/
│   ├── 0. Three Year Goals.md
│   ├── 1. Yearly Goals.md
│   ├── 2. Monthly Goals.md
│   └── 3. Weekly Review.md
├── Projects/             # Kanonické projektové poznámky (<ProjectName>.md)
├── Templates/            # Opakovaně použitelné šablony
├── Archives/             # Dokončené a neaktivní poznámky
└── Inbox/                # Rychlé záchyty (volitelné)
```

### Kaskáda cílů

BPagent pracuje s hierarchií cílů, která propojuje dlouhodobou vizi s denními úkoly:

```
3letá vize → Roční cíle → Projekty → Měsíční cíle → Týdenní review → Denní úkoly
  /goal-tracking   /project    /project        /monthly         /weekly
```

---

## Systém tagů

Tagy se používají přímo v obsahu poznámek syntaxí `#tag`.

| Kategorie | Tagy |
|-----------|------|
| **Priorita** | `#priority/high`, `#priority/medium`, `#priority/low` |
| **Stav** | `#active`, `#waiting`, `#completed`, `#archived` |
| **Kontext** | `#work`, `#personal`, `#health`, `#learning`, `#family` |

---

## Dostupné skills

Skills se spouštějí příkazem `/název` v chatu s BPagentem, nebo je agent použije automaticky.

### `/weekly` – Týdenní review

Strukturovaný 30minutový proces (doporučeno v neděli nebo v pondělí). Agent předá práci subagentovi `weekly-reviewer`, který provede tři fáze:

1. **Sběr (10 min)** – Přečte denní záznamy za posledních 7 dní, extrahuje dokončené úkoly, výhry a výzvy
2. **Reflexe (10 min)** – Zkontroluje soubory s cíli, vypočítá pokrok, identifikuje mezery
3. **Plánování (10 min)** – Stanoví jednu hlavní věc na příští týden, rozbije ji na denní zaměření

Průběh je viditelný jako progress indikátory v chatu.

### `/monthly` – Měsíční review

Strukturovaný proces na konci (nebo začátku) měsíce. Agent předá práci subagentovi `monthly-reviewer`, který provede tři fáze:

1. **Sběr (10 min)** – Sjednotí týdenní review za poslední měsíc, projde denní záznamy za 30 dní, načte měsíční cíle a stav projektů
2. **Reflexe (10 min)** – Zkontroluje kvartální a roční milníky přes goal forest, porovná plán vs. realitu
3. **Plánování (10 min)** – Stanoví hlavní zaměření a 3úrovňové priority (must / should / nice) na příští měsíc, založí/aktualizuje měsíční cíle přes API

Průběh je viditelný jako progress indikátory v chatu. Jednorázové dotazy ("kolik todos jsem dodělal minulý měsíc?") agent zodpoví přímo, bez delegace.

### `/project` – Správa projektů

Vytváření, sledování a archivace projektů propojených s cíli. Projektová metadata jsou v `.nomendex/projects.json` a stavová poznámka projektu je kanonicky v `Projects/<ProjectName>.md`.

### Automaticky spouštěné skills

Tyto skills BPagent volá sám bez explicitního příkazu:

| Skill | Účel |
|-------|------|
| `goal-tracking` | Sledování pokroku v kaskádě cílů |
| `obsidian-vault-ops` | Čtení a zápis souborů vaultu, wiki-linky |
| `check-links` | Hledání rozbitých wiki-linků |
| `search` | Fulltextové vyhledávání v obsahu vaultu |
| `todos` | Primární čtení/zápis TODO workflow (weekly/monthly) |

---

## Konvence denních poznámek

BPagent už nepředpokládá fixní `daily-notes/` ani fixní formát data.

Postup:
1. Přečte `vault-config.json` (pokud existuje)
2. Prohlédne existující daily-notes soubory
3. Znovu použije stejný pattern (např. `M-D-YYYY`, `YYYY-MM-DD`, flat vs `YYYY/MM/`)
4. Pokud konvence neexistuje, explicitně to řekne a požádá o potvrzení

Tím se zabrání duplikovaným strukturám typu `daily-notes/` vs `Daily Notes/`.

## „Today“ workset (todo-first)

Pro dotazy typu „show today“, „co mám dnes dělat“, „schedule“, „calendar for today“:

1. overdue TODO (úkoly s `dueDate` před dneškem)
2. TODO splatné dnes (úkoly s `dueDate` dnes)
3. scheduled/in-progress/planned TODO (úkoly s `scheduledStart` zahrnujícím dnešek nebo dříve, plus `in_progress` a `planned`)
4. Today/Now custom sloupce po načtení reálné board konfigurace
5. focused project TODO (pokud uživatel jmenuje projekt)
6. ostatní kandidáti

Schedule a calendar dotazy primárně zohledňují `scheduledStart`/`scheduledEnd`, výběry pro overdue a deadline spoléhají na `dueDate`.

Výstup má být po bucket sekcích, ne jako jeden smíšený seznam.

## Read-only default pro plánování

U plánovacích dotazů je default:
- nejdřív číst, shrnout a navrhnout plán
- změny (create/update TODO nebo zápis do poznámky) až po jasném potvrzení nebo explicitním požadavku

To snižuje nechtěné mutace během brainstormingu.

---

## Specializovaní subagenti

BPagent automaticky deleguje složitější úkoly na specializované subagenty. Průběh vidíš jako progress indikátory v chatu.

### `weekly-reviewer` – Týdenní reviewer

Spouští se přes `/weekly`. Prochází denní záznamy za posledních 7 dní, čte soubory s cíli a generuje strukturovaný report:

```markdown
## Week of [rozsah dat]

### Výhry
- [měřitelný výsledek]

### Výzvy
- [co se postavilo do cesty]

### Vzorce
- [opakující se témata]

### Pokrok cílů
| Cíl | Pokrok | Poznámky |

### Příští týden
**Jedna hlavní věc:** [priorita]
```

### `monthly-reviewer` – Měsíční reviewer

Spouští se přes `/monthly`. Stejně jako `weekly-reviewer` běží ve třech fázích (Sběr → Reflexe → Plánování) s progress indikátory. Sjednocuje týdenní review za poslední měsíc, kontroluje kvartální a roční milníky přes typed goal graph (`computedProgress`, ne počítání checkboxů) a generuje strukturovaný měsíční report — výhry, výzvy, vzorce, todo metriky podle projektů, pokrok cílů, kvartální milníky a plán na příští měsíc. Nové měsíční cíle zakládá přes API a poté regeneruje dashboardy.

### `goal-aligner` – Kontrola souladu cílů

Analyzuje soulad denních aktivit s dlouhodobými cíli. Spouštěj pro:
- Audit cílů ("Jak si stojím s ročními cíli?")
- Kontrolu priorit ("Věnuji čas správným věcem?")

Výstup obsahuje skóre souladu, přehled mezer a konkrétní doporučení.

---

## Vypnuté skilly a subagenti (říjen 2026)

Revize agentů (11. 10. 2026, poznámka `Revize agentů 2026-10.md` ve vaultu) vypnula rituály, které stály na staré šabloně deníku. Deník teď Honza píše sám v Today view.

| Co | Proč |
|----|------|
| `/daily` | Ranní a večerní rituál (workset, Evening Reflection, Energy/Mood) přepisoval deník na starou strukturu |
| `/daily-notes` | Pomocník pro `/daily` (`daily-note.sh`) |
| `/review` | Router, který posílal hlavně na `/daily` |
| `/adopt` | Jednorázové zakládání struktury vaultu |
| `note-organizer` | Subagent pro reorganizaci vaultu |

Současně z promptu zmizela sekce Daily Workflow (Morning a Evening, zápis `<!-- workset: … -->` do deníku) a `<daily-context>` už neposílá streak „DEN X“.

**Jak vypnutí funguje.** Skilly už nejsou mezi výchozími (`services/default-skills.ts`). Při startu appka přesune jejich kopie se `source: nomendex` z `.claude/skills/<název>/` do `.nomendex/archived-skills/<název>/` (`RETIRED_SKILLS`, `archiveRetiredSkills()`). Nic nemaže. Kopie s jiným `source:` nechá být. Když archivní složka už existuje, přidá k názvu časovou značku.

**Jak vrátit.**
- Jeden skill: přesuň složku zpátky do `.claude/skills/` a změň v ní `source: nomendex` na `source: user`. Jinak ji appka při dalším startu znovu archivuje.
- Všechno: `git revert` commitu, který skilly vypnul. Skilly se při dalším startu znovu nainstalují a `note-organizer` se vrátí do `subagents/index.ts`.

`/weekly` a `/monthly` a jejich revieweři stále počítají se streakem a starou šablonou deníku. Předělávají se v úkolu „3 · Předělat weekly a monthly agenty“.

---

## Paměť agenta

BPagent si pamatuje kontext mezi sezeními. Jak se paměti ukládají, určuje nastavení extrakce (`workspace.json → memoryExtraction.provider`): ve výchozím stavu (`disabled`) si je agent ukládá sám během chatu nástrojem `memory_save`; se zapnutou extrakcí (`openrouter` / `claude`) se vytáhnou automaticky po skončení sezení a agent má paměť jen pro čtení.

### Typy pamětí

| Typ | Příklady | Platnost |
|-----|---------|----------|
| `goal` | "Chci dokončit projekt X do dubna" | Trvalá |
| `project` | "Projekt Redesign webu – ve fázi 2" | Trvalá |
| `decision` | "Rozhodli jsme se nepoužívat framework Y" | Trvalá |
| `preference` | "Preferuji ranní práci na hluboce soustředěných úkolech" | Trvalá |
| `context` | "Tento měsíc je priorita launch produktu" | 90 dní |
| `reference` | "Klíčový kontext k projektu Z" | 90 dní |

### Jak paměti fungují

- Ke každé zprávě se automaticky dohledají nejrelevantnější paměti a přiloží se k ní jako kontext — v rámci jednoho sezení každá paměť jen jednou
- Další paměti si agent může dohledat sám (`memory_search`)
- Deduplicita: stejná paměť se neukládá dvakrát (automatické sloučení)
- Paměti s platností expirují automaticky po uplynutí doby

### Rozsah pamětí

- **Workspace** – Sdílené mezi BPagentem a všemi jeho subagenty (nejběžnější)
- **Agent** – Privátní pro konkrétního agenta

---

## Příklady použití

### Týdenní review
```
Uživatel: /weekly
BPagent:  [Deleguje na weekly-reviewer, zobrazí progress fáze 1/2/3, vrátí strukturovaný report]
```

### Kontrola cílů
```
Uživatel: Jak si stojím s letošními cíly?
BPagent:  [Deleguje na goal-aligner, přečte goals soubory, vrátí alignment report se skóre a doporučeními]
```

---

## Tipy a omezení

### Co BPagent dělá automaticky
- Prohledává paměti při každém dotazu
- Volá lokální API (`curl` na todos, goals, projects, insights…) bez dotazu na oprávnění; mazání a ostatní příkazy dál vyžadují potvrzení (viz [agents.md](./agents.md#bpagent-local-api-calls))
- Deleguje složité úkoly na specializované subagenty
- Zobrazuje průběh dlouhých operací jako progress indikátory

### Co BPagent VŽDY čeká na potvrzení
- Přesun, přejmenování nebo smazání poznámek
- Reorganizace struktury složek
- Hromadné změny tagů

### Produktivní koučovací styl
Pokud chceš, aby byl agent přímější a pokládal hlubší otázky, použij:
```
/output-style coach
```
V tomto módu agent:
- Zpochybňuje předpoklady konstruktivně
- Drží tě u závazků
- Propojuje denní práci s tvou misí
- Klade silné otázky pro objasnění priorit

### Klíčové konvence
- Wiki-linky: `[[název poznámky]]`
- Denní záznamy: detekovaný vault pattern (např. `3-11-2026.md` nebo `2026-03-11.md`)
- Cíle jsou v souborech `Goals/0-3.*.md`
