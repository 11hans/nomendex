---
description: Git workflow – jak pracovat s větvemi (main / dev / feature)
---

# Git Workflow pro Nomendex

## Přehled větví

```
upstream (firstloophq/nomendex)
    │
    ▼
  main  ──── zrcadlo upstreamu, NIKDY sem nepiš vlastní kód
    │
    ▼
   dev  ──── tvůj hlavní integrační branch, sem merguješ hotové features
    │
    ├── feat/nazev-feature
    ├── fix/nazev-bugu
    └── refactor/nazev
```

- **main** = vždy odpovídá čistému stavu upstream repozitáře.
- **dev** = tvoje "pískoviště", kde se potkávají všechny tvé úpravy.
- **feat/xxx** = dočasná větev pro jednu konkrétní věc. Jakmile ji zamerguješ do `dev`, můžeš ji smazat.

## 1. Začátek práce (synchronizace)

Než začneš, ujisti se, že máš vše aktuální:

```bash
# Stáhni novinky z originálu do main
git checkout main
git fetch upstream
git merge upstream/main
git push origin main

# Aktualizuj svůj dev
git checkout dev
git merge main
git push origin dev
```

## 2. Vývoj nové feature

VŽDY vytvářej feature větve z `dev`:

```bash
git checkout dev
git checkout -b feat/moje-nova-vec
```

Pracuj, commituj, a až budeš hotov:

```bash
git add .
git commit -m "feat(oblast): popis změny"
```

## 3. Merge do dev (uložení práce)

Když jsi s prací spokojený:

```bash
git checkout dev
git merge feat/moje-nova-vec
git push origin dev

# Teď můžeš feature větev smazat - kód už je v dev!
git branch -d feat/moje-nova-vec
```

---

## 🚀 4. Jak poslat hotovou feature do světa (PR do upstreamu)

Tohle je důležité: **Nikdy nedělej PR z `dev` a ani ze své staré feature větve!**

Proč?
1. V `dev` máš mix všeho možného.
2. Stará feature větev může být "špinavá" (merge commity, opravy překlepů).

**Správný postup pro čisté PR:**

1. **Ujisti se, že máš aktuální `main`** (viz bod 1).

2. **Vytvoř novou, čistou větev z main:**
   ```bash
   git checkout main
   git checkout -b pr/moje-feature
   ```

3. **"Vyzobni" (cherry-pick) změny z dev:**
   Najdi si hash commitu ve své historii (např. přes `git log --oneline dev`) a přenes ho:
   ```bash
   git cherry-pick <hash-commitu>
   ```
   *Tip: Pokud máš feature rozplizlou do 10 commitů "fix", "typo", "wip", je lepší je v tomto kroku spojit (squash) do jednoho hezkého commitu.*

4. **Pushni a vytvoř PR:**
   ```bash
   git push origin pr/moje-feature
   ```
   Pak jdi na GitHub a vytvoř Pull Request z `pr/moje-feature` do `firstloophq/nomendex:main`.
   Po přijetí PR můžeš tuto `pr/` větev smazat.

---

## Užitečné příkazy

**Stash (odložení práce):**
```bash
git stash push -m "rozpracovano"  # schovat
git stash pop                     # obnovit
```

**Zrušení změn:**
```bash
git checkout .                    # zahodit změny v souborech
git reset --hard HEAD             # vrátit se na poslední commit
```
