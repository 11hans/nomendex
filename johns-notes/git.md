---
description: Git workflow – jak pracovat s větvemi (main / dev / prod)
---

# Git Workflow pro Nomendex

Tento workflow zajišťuje, že máme:
1.  **Aktuální kód z originálu** (`main`).
2.  **Místo pro vývoj** (`dev`).
3.  **Stabilní verzi pro produkci** (`prod`).

## Přehled větví

Máš v repozitáři tři hlavní větve:

```
upstream (firstloophq/nomendex)
    │
    ▼
  main  ──── zrcadlo upstreamu, NIKDY sem nepiš vlastní kód
    │
    ▼
   dev  ──── tvůj pracovní stůl. Sem sypeš commity, fixy, nápady.
    │        (Můžeš commitovat přímo).
    │
    ▼ (Pull Request)
    │
   prod ──── STABILNÍ / PRODUKČNÍ verze.
             Sem tekou změny z `dev` POUZE přes zkontrolovaný Pull Request.
```

---

## 1. Synchronizace (Začátek práce)

Udržuj si `main` a `dev` aktuální s originálem:

```bash
# 1. Stáhni novinky z upstreamu do main
git checkout main
git fetch upstream
git merge upstream/main
git push origin main

# 2. Promítni je do svého dev
git checkout dev
git merge main
git push origin dev
```

---

## 2. Vývoj (Denní chleba)

Pracuješ v **`dev`**. Tady máš volnou ruku.

### Možnost A: Přímé commity (Rychlovky)
Pokud děláš něco menšího a jsi na to sám, klidně syp přímo do `dev`:

```bash
git checkout dev
# ... coding ...
git add .
git commit -m "feat: nová funkcionalita pro todo"
git push origin dev
```

### Možnost B: Feature branch (Větší věci)
Pokud děláš na něčem složitém a nechceš si rozbít `dev`, udělej si vedlejší větev:

```bash
git checkout dev
git checkout -b experiment/nova-logika
# ... coding ...
git commit -m "wip: pokus o refactor"
# ... hotovo? šup zpátky do dev ...
git checkout dev
git merge experiment/nova-logika
git branch -d experiment/nova-logika
git push origin dev
```

---

## 3. Release do Produkce (`prod`)

Když máš v `dev` sadu změn, které fungují a chceš je "zabetonovat" do stabilní verze:

1.  Jdi na GitHub.
2.  Otevři **Pull Request** (PR).
    *   **Base:** `prod`
    *   **Compare:** `dev`
3.  Titul: např. "Release v1.2 - Oprava kalendáře a nové UI".
4.  Zkontroluj "Files changed" - sedí to?
5.  **Merge Pull Request**.

Tímto se bezpečně přenesou změny do `prod`. Větev `prod` tak vždy obsahuje jen funkční, ověřený kód.

---

## 4. Přispívání do Upstreamu (Open Source)

Pokud chceš poslat nějakou svou úpravu zpět do původního repozitáře (`firstloophq/nomendex`):

**Nikdy nedělej PR z `dev` nebo `prod`, protože tam máš pravděpodobně mix všeho možného!**

Postup pro čisté PR do světa:
1.  Vytvoř novou větev z čistého `main`:
    ```bash
    git checkout main
    git checkout -b feat/nazev-pro-upstream
    ```
2.  Přenes (cherry-pick) jen ty konkrétní commity, které chceš poslat:
    ```bash
    git cherry-pick <hash-commitu-z-dev>
    ```
3.  Pushni a vytvoř PR do upstreamu:
    ```bash
    git push origin feat/nazev-pro-upstream
    ```
