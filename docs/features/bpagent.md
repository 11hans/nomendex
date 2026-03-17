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

BPagent předpokládá Obsidian-kompatibilní strukturu složek. Pokud ji zatím nemáš, použij `/adopt` pro automatické nastavení.

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
  /goal-tracking   /project    /project        /monthly         /weekly         /daily
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

### `/daily` – Denní poznámka

Vytvoří nebo aktualizuje dnešní denní záznam.

**Důležité:** Agent nejdřív detekuje reálnou vault konvenci (složku, případné vnoření, formát názvu souboru), až potom čte nebo zakládá denní poznámku.

**Ranní rutina (5 min):**
- Todo-first workset (nejdřív živé TODO položky)
- Teprve pak strategický kontext z cílů a projektů
- Identifikace jednoho hlavního zaměření dne
- Přehled nedokončených úkolů z předchozího dne
- Nastavení časových bloků

**Večerní rutina (5 min):**
- Doplnění sekce reflexe
- Přehled pozornosti věnované cílům a projektům
- Přesun nedokončených úkolů
- Uložení změn

### `/weekly` – Týdenní review

Strukturovaný 30minutový proces (doporučeno v neděli nebo v pondělí). Agent předá práci subagentovi `weekly-reviewer`, který provede tři fáze:

1. **Sběr (10 min)** – Přečte denní záznamy za posledních 7 dní, extrahuje dokončené úkoly, výhry a výzvy
2. **Reflexe (10 min)** – Zkontroluje soubory s cíli, vypočítá pokrok, identifikuje mezery
3. **Plánování (10 min)** – Stanoví jednu hlavní věc na příští týden, rozbije ji na denní zaměření

Průběh je viditelný jako progress indikátory v chatu.

### `/monthly` – Měsíční review

30minutový process na konci měsíce:
- Shrnutí týdenních výher a výzev
- Kontrola kvartálních milníků
- Plánování zaměření na příští měsíc

### `/project` – Správa projektů

Vytváření, sledování a archivace projektů propojených s cíli. Projektová metadata jsou v `.nomendex/projects.json` a stavová poznámka projektu je kanonicky v `Projects/<ProjectName>.md`.

### `/review` – Chytrý router

Automaticky detekuje správný typ review podle kontextu (denní / týdenní / měsíční) a spustí příslušný workflow.

### `/adopt` – Nastavení BPagent workflow

Pokud nemáš připravenou strukturu, `/adopt` ji nastaví nad existujícím workspace krok za krokem.

### Automaticky spouštěné skills

Tyto skills BPagent volá sám bez explicitního příkazu:

| Skill | Účel |
|-------|------|
| `goal-tracking` | Sledování pokroku v kaskádě cílů |
| `obsidian-vault-ops` | Čtení a zápis souborů vaultu, wiki-linky |
| `check-links` | Hledání rozbitých wiki-linků |
| `search` | Fulltextové vyhledávání v obsahu vaultu |
| `todos` | Primární čtení/zápis TODO workflow (daily/weekly/monthly) |

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
3. scheduled/in-progress TODO (úkoly s `scheduledStart` zahrnujícím dnešek nebo dříve, plus `in_progress`)
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

### `goal-aligner` – Kontrola souladu cílů

Analyzuje soulad denních aktivit s dlouhodobými cíli. Spouštěj pro:
- Audit cílů ("Jak si stojím s ročními cíli?")
- Kontrolu priorit ("Věnuji čas správným věcem?")

Výstup obsahuje skóre souladu, přehled mezer a konkrétní doporučení.

### `inbox-processor` – Zpracování inboxu

Zpracovává záchyty podle GTD principů:
1. Prohledá složku `Inbox/` a poznámky označené `#inbox`
2. Pro každou položku navrhne kategorii a akci
3. Čeká na tvoje potvrzení před přesunem

Kategorie: `#next-action`, `#project`, `#waiting`, `#someday`, `#reference`

### `note-organizer` – Organizace vaultu

Údržba a reorganizace vaultu:
- Identifikace osiřelých poznámek (bez příchozích linků)
- Hledání a oprava rozbitých wiki-linků `[[takto]]`
- Standardizace tagů
- Přesun dokončených projektů do `Archives/`

**Důležité:** Agent vždy nejprve navrhne plán změn a čeká na tvoje potvrzení.

---

## Paměť agenta

BPagent si pamatuje kontext mezi sezeními. Paměti se ukládají automaticky při chatu a jsou dostupné v dalších sezeních.

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

- Agent automaticky prohledá relevantní paměti při každém dotazu
- Nejrelevantnější paměti vloží do kontextu konverzace
- Deduplicita: stejná paměť se neukládá dvakrát (automatické sloučení)
- Paměti s platností expirují automaticky po uplynutí doby

### Rozsah pamětí

- **Workspace** – Sdílené mezi BPagentem a všemi jeho subagenty (nejběžnější)
- **Agent** – Privátní pro konkrétního agenta

---

## Příklady použití

### Ranní zahájení dne
```
Uživatel: /daily
BPagent:  [Vytvoří dnešní denní poznámku s kontextem z cílů a projekty pro dnešek]
```

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

### Zpracování inboxu
```
Uživatel: Zpracuj mi inbox
BPagent:  [Deleguje na inbox-processor, projde Inbox/ složku, navrhne akce pro každou položku]
```

### Organizace vaultu
```
Uživatel: Zorganizuj mi vault, najdi rozbitý linky
BPagent:  [Deleguje na note-organizer, provede analýzu, navrhne plán – ČEKÁ na potvrzení před změnami]
```

---

## Tipy a omezení

### Co BPagent dělá automaticky
- Prohledává paměti při každém dotazu
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
