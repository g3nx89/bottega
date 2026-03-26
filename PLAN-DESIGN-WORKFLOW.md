# AI-Assisted Design Workflow — Piano Strategico

> Bottega diventa il collega che si ricorda tutte le regole di design per te,
> le tiene aggiornate dentro Figma, e le applica ogni volta che lavora.
>
> **Versione:** 3.4 — riscrittura completa dopo multi-agent critique (5 prospettive),
> ricerca di settore (6 indagini), e iterazioni strategiche con l'utente.

---

## Indice

1. [Contesto e Bisogni](#1-contesto-e-bisogni)
2. [Filosofia e Principi](#2-filosofia-e-principi)
3. [Architettura: Figma Is The Truth](#3-architettura-figma-is-the-truth)
4. [Come Funziona: I 4 Momenti](#4-come-funziona-i-4-momenti)
5. [Iniezione del DS nell'Agente](#5-iniezione-del-ds-nellagente)
6. [Strategia Tool](#6-strategia-tool)
7. [Piano di Implementazione](#7-piano-di-implementazione)
8. [Interazione con il Sistema di Compressione](#8-interazione-con-il-sistema-di-compressione)
9. [Rischi e Mitigazioni](#9-rischi-e-mitigazioni)
10. [Decisioni Registrate](#10-decisioni-registrate)

---

## Vincoli di Scope

- Contesto **single-user**. Interazione con PLAN-MULTI-SESSION.md in Sezione 7.4.
- Indipendente dal PLAN-MULTI-SESSION — implementabile prima o dopo.
- `package.json` non richiede modifiche: nessuna nuova dipendenza.

---

## 1. Contesto e Bisogni

### 1.1 Il Problema

Bottega opera su Figma con 34 tool ma è **stateless rispetto alle decisioni di design**: ogni sessione riparte da zero. Un utente che ha definito una palette colori lunedì deve rispiegarla mercoledì. Il risultato: screen inconsistenti, lavoro ripetitivo, impossibilità di mantenere coerenza visiva.

### 1.2 L'Utente Tipo

Product owner o fondatore tecnico in un team di 1-5 persone. Non è un designer professionista, progetta per iterazione, vuole coerenza senza gestire manualmente ogni dettaglio. Usa Figma come strumento di lavoro.

### 1.3 I 5 Bisogni (validati con utenti reali)

| # | Bisogno | Problema concreto |
|---|---------|-------------------|
| 1 | Trasformare sketch grezzi in screen strutturati | Ogni sketch richiede ore per diventare implementation-ready |
| 2 | Mantenere consistenza tra screen | Le stesse decisioni vengono prese diversamente su screen diversi |
| 3 | Costruire il design system progressivamente | Definire un DS completo prima di progettare è irrealistico |
| 4 | Ridurre le correzioni ripetitive | Micro-inconsistenze (spaziatura, colori, font) richiedono ispezione manuale |
| 5 | Identificare e riutilizzare pattern | Strutture ripetute non vengono trasformate in componenti |

### 1.4 Insight dalla Ricerca di Settore

La ricerca (2024-2026) ha evidenziato pattern chiave:

- **Figma Variables sono lo standard**: il 69,8% dei team le usa come source of truth per i design token
- **I team piccoli non costruiscono DS da zero**: adottano un kit (shadcn, Untitled UI) e personalizzano 5 cose
- **Le uniche 5 cose che contano**: colori, scala tipografica, spacing base, border radius, shadows
- **Il problema #1 è la manutenzione, non la definizione**: 63% dei team non ha risorse dedicate al DS
- **Gli agenti AI su Figma sono la frontiera emergente**: Bottega si posiziona esattamente in questo spazio
- **Le pagine di documentazione dentro Figma sono pratica standard**: team strutturati usano pagine dedicate con fondazioni, componenti, regole

---

## 2. Filosofia e Principi

### 2.1 La Visione

Bottega non è "un tool per gestire un design system". È **il manutentore automatico che nessun team piccolo ha** — il collega che si ricorda le regole, le applica, e le tiene aggiornate.

### 2.2 Principi Guida

1. **Figma è la verità** — tutto vive dentro Figma (variabili + pagina DS). Zero drift, portabilità gratis.
2. **Progressivo, non prescrittivo** — il DS cresce con il prodotto, non prima. L'agente aiuta a costruirlo pezzo per pezzo.
3. **Socratico, non automatico** — l'agente propone, l'utente conferma. Niente modifiche al DS senza approvazione.
4. **Proattivo, non invadente** — l'agente segnala quando qualcosa dovrebbe entrare nel DS, ma non blocca mai il lavoro.
5. **Tool dedicati per il DS** — ogni operazione DS ha un tool affidabile e testabile. Nessuna operazione DS passa per `figma_execute`.
6. **Auto-layout sempre** — ogni frame con figli deve usare auto-layout. Il lint lo verifica.

### 2.3 Cosa NON Facciamo

- ~~Guidelines store su filesystem locale~~ → tutto in Figma
- ~~Schema JSON tipizzato con migrazione~~ → testo libero in frame nominati
- ~~Rule engine meccanico complesso (severity, autoFixable, soglie)~~ → matching di set semplice nel tool + giudizio dell'LLM
- ~~Backup .prev.json~~ → Figma ha il suo version history
- ~~Versioning del DS~~ → il prompt è uno snapshot; l'agente si riallinea via tool
- ~~Operazioni DS via `figma_execute`~~ → tool dedicati per ogni operazione DS

---

## 3. Architettura: Figma Is The Truth

### 3.1 I Due Livelli di Informazione

Tutto il design system vive dentro il file Figma, su due livelli complementari:

| Livello | Cosa contiene | Dove vive in Figma | Esempio |
|---------|---------------|--------------------|---------|
| **Valori** (quantitativi) | Colori, font size, spacing, radii, shadows | **Variabili Figma** | `color/primary = #A259FF` |
| **Regole** (qualitativi) | Best practice, convenzioni, istruzioni | **Pagina "Design System"** | "Buttons always have a left icon" |

I due livelli sono complementari: le variabili dicono **cosa** usare, la pagina DS dice **come** usarlo.

### 3.2 Struttura della Pagina "Design System"

Una pagina Figma dedicata con sezioni strutturate tramite frame con naming convention:

```
📄 Pagina "Design System"
├── 🔲 [DS::colors]
│   ├── Swatch grid (componenti con fill bound alle variabili)
│   └── Text: "Use 'error' only for error states, never decorative"
├── 🔲 [DS::typography]
│   ├── Type specimens (con stili dalle variabili)
│   └── Text: "Max 2 heading levels per screen"
├── 🔲 [DS::spacing]
│   ├── Spacing scale visualization (4-8-16-24-32-48)
│   └── Text: "Card inner padding: always 16px"
├── 🔲 [DS::components]
│   ├── Component instances di riferimento
│   └── Text: "Primary buttons always have a left icon"
├── 🔲 [DS::naming]
│   ├── Text: naming conventions (PascalCase, slash-separated, max 3 levels)
│   ├── Text: categories, elements, states vocabulary
│   └── Text: project glossary (ProductCard, UserAvatar, NavBar...)
└── 🔲 [DS::rules]
    └── Text: "Max 3 accent colors per screen. No shadows on inner elements."
```

**Regole della pagina DS:**
- Tutti i testi sono **sempre in inglese**, indipendentemente dalla lingua dell'utente
- Struttura B: frame con naming convention `[DS::section]` per machine-readability + contenuto libero dentro ogni frame
- Include campioni visivi (swatch colori, specimen tipografici) come da best practice del settore
- L'utente può modificarla direttamente in Figma — l'agente legge gli aggiornamenti

### 3.3 Supporto Librerie Esistenti

Se l'utente usa una libreria con un DS già maturo (es. Untitled UI), l'agente può:

1. Analizzare le variabili e i componenti della libreria
2. Proporre di creare una pagina "Design System" locale basata sui token della libreria
3. L'utente personalizza progressivamente: il DS locale diventa un'evoluzione della libreria

Il DS locale non sostituisce la libreria — la complementa con regole e personalizzazioni specifiche del progetto.

### 3.4 Dove Vive Ogni Informazione — Vista Completa

```
File Figma
├── Variabili Figma                         ← valori quantitativi
│   ├── color/primary = #A259FF                (source of truth per i numeri)
│   ├── color/error = #FF3B30
│   ├── typography/body/size = 16
│   ├── spacing/md = 16
│   └── radius/default = 8
│
├── 📄 Pagina "Design System"               ← regole qualitative + campioni
│   ├── [DS::colors] + swatches + regole
│   ├── [DS::typography] + specimens + regole
│   ├── [DS::spacing] + scale + regole
│   ├── [DS::components] + istanze + regole
│   └── [DS::rules] + regole generali
│
├── Libreria collegata (opzionale)           ← componenti e token di base
│   └── (Untitled UI, Material, custom...)
│
├── 📄 Screen di lavoro                      ← pagine del prodotto
│   ├── Page "Home"
│   ├── Page "Dashboard"
│   └── Page "Settings"
```

---

## 4. Come Funziona: I 4 Momenti

### 4.1 Primo Contatto con il File

L'agente apre un file Figma e automaticamente:

1. **Legge le variabili Figma** — colori, font, spacing, radii già definiti
2. **Cerca la pagina "Design System"** — se esiste, estrae le regole dai frame `[DS::*]`
3. **Rileva librerie collegate** — ne nota l'esistenza e sa come cercarci dentro
4. **Inietta tutto nel system prompt** — ora sa come lavorare su quel file

Se il file non ha né variabili né pagina DS:

> *"This file doesn't have a design system yet. I can see you're using Inter font, with these 5 colors and 8px-based spacing. Want me to set up variables and a Design System page based on what's already here?"*

### 4.2 Costruzione Socratica

L'agente analizza il file e guida l'utente passo per passo:

> **Agente:** "I found Inter used everywhere in 5 sizes: 12, 14, 16, 20, 32px. I suggest this scale: caption=12, body=16, subtitle=20, heading=24, display=32. Does this work?"
>
> **Utente:** "Sì, ma body dovrebbe essere 16 non 14."
>
> **Agente:** Crea le variabili Figma + aggiorna la pagina DS con sezione tipografia + specimen visivi.

Se l'utente parte da una libreria esistente:

> **Agente:** "I see you're using Untitled UI. Want me to create a local Design System page based on its tokens, so we can evolve it for your project?"

Per ogni decisione confermata, l'agente fa **sempre due cose** con tool dedicati:
1. Crea/aggiorna le **variabili Figma** via `figma_setup_tokens` (idempotente — crea o aggiorna)
2. Aggiorna la **pagina Design System** via `figma_update_ds_page` (crea sezioni, campioni, testo)

### 4.3 Lavoro Quotidiano

L'utente chiede "make me a product card". L'agente:

- Usa colori/font/spacing dalle variabili Figma
- Cerca componenti esistenti prima di creare da zero
- Se introduce un valore non nel DS, chiede:

> *"#FF3B30 isn't in your palette. Should I add it as 'error'?"*

La proattività bidirezionale copre ogni modifica:

| Cosa succede | Cosa fa l'agente |
|---|---|
| Utente chiede di cambiare il colore primario | Aggiorna variabile + pagina DS |
| Utente crea elemento con colore non in palette | *"Should I add this to the DS?"* |
| Utente crea un nuovo componente riutilizzabile | *"Should I add ProductCard to the DS?"* |
| Utente usa font size non nella scala | *"18px isn't in your type scale. Add as 'body-lg'?"* |
| Agente nota un pattern ripetuto su più screen | *"This card structure appears 5 times. Make it a component?"* |
| Utente chiede di modificare spacing delle card | Aggiorna istanze, poi *"Update DS rule for card padding?"* |

**Regola fondamentale:** quando una modifica al DS viene confermata, l'agente aggiorna SEMPRE entrambi i livelli — variabile Figma (via `figma_setup_tokens`) E pagina DS (via `figma_update_ds_page`). Mai uno senza l'altro. Mai via `figma_execute`.

Dopo ogni modifica al DS, l'agente chiama `figma_design_system(forceRefresh: true)` per riallineare il suo contesto.

### 4.4 Review

L'utente chiede "check this page for consistency". L'agente:

1. Chiama `figma_lint(nodeId)` — un singolo tool call che:
   - Confronta ogni nodo con le variabili DS (colori, font, spacing)
   - Verifica le naming convention
   - Controlla l'uso di auto-layout
   - Esegue le regole native Figma (stili staccati, etc.)
   - Restituisce le regole qualitative dalla pagina DS per il giudizio dell'LLM
2. L'agente interpreta il report e presenta il risultato:

> *"Found 8 issues: 2 colors not in palette (#A359FF looks like a typo for 'primary'), 1 font size not in scale, 2 frames without auto-layout, 1 layer with default name 'Frame 47', 1 fill not linked to a variable. Also, checking DS rule: 'buttons always have left icon' — let me verify with a screenshot..."*

3. Chiama `figma_screenshot` su elementi specifici se serve verifica visiva
4. Propone correzioni e le applica su conferma

Il matching meccanico (è questo valore nel DS? sì/no) è nel tool. Il giudizio (è un errore o è intenzionale?) è dell'LLM.

---

## 5. Iniezione del DS nell'Agente

### 5.1 Strategia a Tre Livelli

```
┌─────────────────────────────────────────────────────┐
│  SYSTEM PROMPT (snapshot all'avvio sessione)         │
│                                                       │
│  1. DS notation legend (~100 token, fisso)            │
│  2. DS block compresso (~200-500 token, dinamico)     │
│  3. Behavioral instructions (~100 token, fisso)       │
├─────────────────────────────────────────────────────┤
│  TOOL RESULTS (hint durante la sessione)              │
│                                                       │
│  dsStatus: "active" | "partial" | "none"             │
│  in: figma_screenshot, figma_get_file_data            │
├─────────────────────────────────────────────────────┤
│  ON-DEMAND (refresh esplicito)                        │
│                                                       │
│  figma_design_system(forceRefresh: true)             │
│  → L'agente lo chiama dopo modifiche al DS           │
│  → Restituisce tutto: variabili + componenti + regole │
└─────────────────────────────────────────────────────┘
```

### 5.2 Il DS nel System Prompt

#### Posizione nel prompt

```
1. Identity + 7-step workflow               ← identità + processo (critico)
2. DS notation legend                        ← come leggere il DS (fisso)
3. DS block del progetto                     ← il DS attivo (dinamico)
4. DS behavioral instructions               ← come usare il DS (fisso)
5. Tool selection guide                      ← reference
6. JSX + Plugin API reference               ← reference dettagliato
7. Critical rules + anti-patterns           ← guardrail (posizione di forza)
```

Le regole critiche restano in fondo perché nel "contesto recente" del prompt — dove i modelli prestano più attenzione.

#### Legenda di notazione (fisso, ~100 token)

Il blocco DS usa un formato compresso. L'agente deve sapere come leggerlo:

```
## Design System Notation

The DS block below uses compact notation:
- Type entries: name=fontSize/lineHeight/fontWeight (e.g., body=16/24/400)
- Colors: name=#HEX (e.g., primary=#A259FF)
- Space: base unit + scale array (e.g., 8px [4 8 16 24 32 48])
- Radii: name=value (e.g., md=8)
- Components: Name (key:componentKey) [variants] (e.g., Button (key:abc) [size:sm|md|lg])
- Rules: "category: rule text"

Use these values for ALL design operations. For full details or visual samples,
call figma_design_system or inspect the "Design System" page.
```

#### DS block compresso (dinamico, ~200-500 token)

Costruito all'avvio della sessione leggendo da Figma. Esempio tipico:

```
## Active Design System

Colors: primary=#A259FF secondary=#4A90D9 error=#FF3B30 warning=#FF9500
  bg: surface=#FFF surface-alt=#F5F5F5 | text: primary=#1C1C1E secondary=#8E8E93

Type: Inter — caption=12/16/400 body=16/24/400 subtitle=20/28/500 heading=24/32/700 display=32/40/700

Space: 8px grid [4 8 16 24 32 48] | Radii: sm=4 md=8 lg=16

Components:
  Button/Primary (key:abc123) [size:sm|md|lg, state:default|hover|disabled]
  Button/Secondary (key:def456) [size:sm|md|lg]
  Card/Product (key:ghi789) [layout:horizontal|vertical]
  Input/Text (key:jkl012) [state:default|focus|error, hasLabel:yes|no]
  Nav/Header (key:mno345)
  → Inspect: figma_get_component_details(nodeId)

Library: "Untitled UI" (fileKey:xyz789)
  → Search: figma_search_components(query, libraryFileKey:"xyz789")
  → Browse: figma_get_library_components(fileKey:"xyz789")

Naming: PascalCase, slash-separated, max 3 levels
  Categories: Nav|Card|Form|List|Modal|Hero|Footer|Sidebar
  Elements: Container|Header|Body|Title|Label|Input|Icon|Image|Action
  States: Default|Hover|Active|Disabled|Error|Loading|Empty
  Glossary: ProductCard, UserAvatar, NavBar, SearchInput, MetricTile
  → Full glossary on DS page [DS::naming]

Rules:
  "colors: Use 'error' only for error states, never decorative"
  "components: Primary buttons always have a left icon"
  "typography: Max 2 heading levels per screen"
  "spacing: Card inner padding always 16px"
  "rules: Max 3 accent colors per screen"
  "rules: No shadows on inner elements"
```

**Principi di compressione:**
- Notazione densa per i valori: `body=16/24/400` invece di `{ fontSize: 16, lineHeight: 24, fontWeight: 400 }`
- Raggruppamento per tipo: una riga per categoria
- Regole come frasi corte con prefisso di sezione
- Componenti con key + varianti inline
- Puntatori espliciti per i dettagli (tool da chiamare)
- **Mai troncare**: tutto il DS va nel prompt, anche se grande

#### Best practices Figma (fisso, ~200 token)

Regole universali che valgono SEMPRE, indipendenti dal DS. Blocco compatto nel prompt:

```
## Figma Best Practices (ALWAYS apply)

Structure:
- Use auto-layout for ALL frames with children — no exceptions
- Prefer FILL over FIXED sizing — elements should adapt to their container
- Max 4 levels of nesting (Screen > Section > Component > Element)
- Never use absolute positioning when auto-layout can achieve the same result
- Group related elements under semantically named frames

Components:
- ALWAYS search for existing components before creating from scratch
- Prefer instantiating components over building from raw frames
- Extract repeated structures (3+ occurrences) into components
- Use component properties and variants, not separate components for each state

Naming:
- Name EVERY layer — never leave "Frame 1", "Rectangle 2", "Group 3"
- Use PascalCase with slash separator: "Card/Body", "Nav/Header/Logo"
- Max 3 levels: Category/Element/State

Construction:
- Build inside-out: leaf nodes first, then containers
- Set layoutMode BEFORE layout properties (padding, gap, sizing)
- appendChild BEFORE setting FILL sizing
- Bind colors and values to variables when a DS is active — bound values can't drift
```

Queste regole consolidano e completano le istruzioni oggi sparse nel prompt (~righe 11, 237, 244, 314, 315, 320 del prompt attuale). Verificate meccanicamente da `figma_lint`.

#### Istruzioni comportamentali (fisso, ~100 token)

```
## Working with the Design System

- ALWAYS use DS colors, fonts, spacing, radii for new elements
- ALWAYS check components list before creating from scratch
- ALWAYS use auto-layout for frames with children
- ALWAYS name layers following DS naming conventions
- When user introduces a value not in the DS, ask to add it
- When confirmed: update BOTH via figma_setup_tokens (variables) AND figma_update_ds_page (rules/samples)
- NEVER use figma_execute for DS operations — use dedicated DS tools only
- After any DS modification: call figma_design_system(forceRefresh: true) to refresh context
- If user says they changed the DS: call figma_design_system(forceRefresh: true) to reload
- To verify a screen: call figma_lint(nodeId) — returns DS adherence + auto-layout + naming in one call
- The DS block above is a snapshot from session start. For current state, call figma_design_system
- Do NOT screenshot the entire DS page. Screenshot specific screens or elements you're working on
```

### 5.3 Budget Token

| Blocco | Token | % su 1M | % su 200K (Haiku) |
|--------|-------|---------|-------------------|
| DS notation legend | ~100 | 0.01% | 0.05% |
| DS block (caso tipico) | ~200-300 | 0.02-0.03% | 0.10-0.15% |
| DS block (caso grande: 30+ colori, 20+ componenti, 20+ regole) | ~500 | 0.05% | 0.25% |
| Behavioral instructions | ~100 | 0.01% | 0.05% |
| **Totale** | **~400-700** | **0.04-0.07%** | **0.20-0.35%** |

Impatto trascurabile su tutti i modelli supportati.

### 5.4 Gestione del DS che Evolve Mid-Session

**Nessun versioning.** Il system prompt è uno snapshot statico all'avvio — non può essere aggiornato (limitazione di Pi SDK `DefaultResourceLoader`).

**L'agente modifica il DS →** sa già cosa è cambiato (è nella conversazione recente). Chiama `figma_design_system(forceRefresh: true)` per riallineare il contesto.

**L'utente modifica il DS in Figma →** dice all'agente "ho cambiato il design system" o "rileggi il DS". L'agente chiama `figma_design_system(forceRefresh: true)`.

**Sessione successiva →** `buildSystemPrompt` rilegge tutto da Figma e costruisce un prompt fresco.

**Sessioni lunghe (30+ turni con modifiche) →** l'istruzione nel prompt dice all'agente di richiamare `figma_design_system` se ha bisogno dello stato aggiornato.

### 5.5 dsStatus Hint nei Tool Result

I tool `figma_screenshot` e `figma_get_file_data` includono un flag semplice:

```
"dsStatus": "active"      ← variabili + pagina DS presenti
"dsStatus": "partial"     ← variabili presenti, pagina DS mancante
"dsStatus": "none"        ← nessun DS
```

Serve **solo** come trigger proattivo:
- `"none"` → l'agente suggerisce di creare il DS
- `"partial"` → l'agente suggerisce di completarlo con una pagina DS
- `"active"` → l'agente lavora normalmente

Nessuna versione, nessun timestamp, nessun campo da mantenere.

---

## 6. Strategia Tool

### 6.1 Principio: Tool Dedicati per il DS

Ogni operazione sul design system ha un tool dedicato, affidabile e testabile. **Nessuna operazione DS passa per `figma_execute`** — le operazioni DS sono troppo critiche per dipendere da codice Plugin API generato al volo dall'LLM.

### 6.2 Mappa Completa dei Tool DS

| Tool | Ruolo | Stato |
|---|---|---|
| **`figma_design_system`** | **Leggere** il DS: variabili + componenti + regole + naming | Modificato |
| **`figma_setup_tokens`** | **Scrivere** token: creare e aggiornare variabili (idempotente) | Modificato |
| **`figma_update_ds_page`** | **Scrivere** pagina DS: creare/aggiornare sezioni, campioni, testo | **Nuovo** |
| **`figma_lint`** | **Verificare** aderenza DS + naming + auto-layout + lint nativo Figma | Modificato |
| **`figma_bind_variable`** | Collegare proprietà numeriche a variabili (padding, gap, radius, fontSize, lineHeight, strokeWeight) | Modificato |
| **`figma_set_fills`** | Settare colori con binding opzionale via parametro `bindTo` | Modificato |
| **`figma_set_strokes`** | Settare stroke con binding opzionale via parametro `bindTo` | Modificato |
| `figma_search_components` | Cercare componenti per nome | Invariato |
| `figma_get_component_details` | Ispezionare un componente | Invariato |
| `figma_get_library_components` | Elencare componenti di una libreria | Invariato |

**Conteggio totale: 35 tool** (34 attuali + 1 nuovo `figma_update_ds_page`).

### 6.3 Dettaglio Tool Modificati e Nuovi

#### `figma_design_system` — Estensione Lettura

**Oggi:** legge variabili + componenti locali, comprime, cache con `forceRefresh`.

**Dopo:** tutto quanto sopra, **più:**
- Cerca la pagina "Design System" nel file
- Estrae il testo dai frame `[DS::*]` (colors, typography, spacing, components, naming, rules)
- Aggiunge `dsStatus` al risultato (`"active"` / `"partial"` / `"none"`)
- Include le naming convention e il glossario dalla sezione `[DS::naming]`

#### `figma_setup_tokens` — Reso Idempotente

**Oggi:** crea SEMPRE una nuova collezione con modi e variabili.

**Dopo:** comportamento intelligente:
- Se la collezione con quel nome **esiste già** → aggiunge/aggiorna le variabili al suo interno
- Se **non esiste** → la crea (comportamento attuale)
- Se una variabile con quel nome **esiste già** → aggiorna il suo valore
- Se **non esiste** → la crea

L'agente chiama sempre lo stesso tool sia per il setup iniziale sia per l'evoluzione del DS. Non deve mai pensare "sto creando o aggiornando?".

#### `figma_update_ds_page` — Nuovo

Tool dedicato per creare e mantenere la pagina "Design System" nel file Figma.

**Parametri:**
- `section`: quale sezione aggiornare (`colors`, `typography`, `spacing`, `components`, `naming`, `rules`)
- `action`: `create` (errore se esiste), `update` (crea se non esiste), `append` (aggiunge senza sovrascrivere)
- `text`: contenuto testuale delle regole (sempre in inglese)
- `samples`: campioni visivi da creare (swatch colori, specimen tipografici, etc.)

**Comportamento interno:**
1. Trova o crea la pagina "Design System"
2. Trova o crea la sezione `[DS::section]`
3. Aggiorna il testo delle regole
4. Crea/aggiorna i campioni visivi
5. Restituisce conferma strutturata

#### `figma_set_fills` / `figma_set_strokes` — Binding Opzionale via `bindTo`

**Problema risolto:** con due tool separati per i colori (`figma_set_fills` per il valore grezzo, `figma_bind_variable` per il binding), l'agente sceglie spesso il tool sbagliato — usa `figma_set_fills` con hex hardcodato quando dovrebbe bindare alla variabile DS.

**Soluzione:** aggiungere un parametro opzionale `bindTo` ai tool esistenti:

```
// Senza DS — setta il colore come valore grezzo (comportamento attuale)
figma_set_fills(nodeId, [{ type: "SOLID", color: "#A259FF" }])

// Con DS — setta il colore E lo binda alla variabile (un solo tool call)
figma_set_fills(nodeId, [{ type: "SOLID", color: "#A259FF" }], { bindTo: "colors/primary" })
```

Quando `bindTo` è presente, il tool internamente:
1. Setta il fill (per il valore visivo immediato)
2. Binda la proprietà alla variabile (per la garanzia DS)

Lo stesso per `figma_set_strokes`:
```
figma_set_strokes(nodeId, strokes, weight, { bindTo: "colors/border" })
```

**Perché è meglio di due tool separati:** l'agente usa SEMPRE `figma_set_fills` per i colori. Se il DS è attivo e il colore corrisponde a una variabile, passa `bindTo`. Zero confusione su quale tool usare.

**Description aggiornata:**
```
figma_set_fills: "Set solid fill colors. When a DS is active, use bindTo parameter
to bind the fill to a DS variable (bound values can't drift)."
figma_set_strokes: "Set solid stroke colors and weight. Use bindTo to bind to a DS variable."
```

#### `figma_bind_variable` — Riposizionato per Proprietà Numeriche

**Oggi:** supporta fill e stroke (COLOR).

**Dopo:** con fill/stroke gestiti da `figma_set_fills`/`figma_set_strokes` via `bindTo`, `figma_bind_variable` si specializza sulle **proprietà numeriche** che non hanno un tool "set" dedicato:

| Proprietà | Tipo variabile | Uso |
|---|---|---|
| `paddingTop/Right/Bottom/Left` | FLOAT | Spacing |
| `itemSpacing` (gap) | FLOAT | Spacing |
| `cornerRadius` | FLOAT | Radii |
| `fontSize` | FLOAT | Tipografia |
| `lineHeight` | FLOAT | Tipografia |
| `strokeWeight` | FLOAT | Bordi |

Per le **shadows/effects**: si usano Effect Styles di Figma (non variable binding, perché le shadows sono composite — offset + blur + spread + color). L'agente crea Effect Styles nel DS e li applica ai nodi.

**Description aggiornata:**
```
figma_bind_variable: "Bind numeric properties to DS variables: padding, gap,
cornerRadius, fontSize, lineHeight, strokeWeight. For colors, use figma_set_fills
or figma_set_strokes with the bindTo parameter instead."
```

**Impatto sul bridge:** ~20 righe aggiunte al handler `BIND_VARIABLE` per supportare `node.setBoundVariable(property, variable)` sulle proprietà FLOAT. Il supporto fill/stroke rimane per backward compatibility ma il prompt guida verso `figma_set_fills`/`figma_set_strokes` con `bindTo`.

**Perché il binding è critico:** un valore bound a una variabile **non può driftare**. Se `paddingTop` è legato a `spacing/md`, cambiare il valore della variabile aggiorna automaticamente tutti i nodi. È la garanzia più forte di aderenza al DS.

#### `figma_lint` — Esteso con DS Check + Auto-Layout + Best Practices

**Oggi:** wrapper per `connector.lintDesign()` — regole native Figma (naming, stili staccati).

**Dopo:** tool di verifica comprensivo. Architettura a due componenti:

**Componente A — Raccolta dati (plugin Figma)**

Una walk arricchita eseguita nel plugin via codice fisso (pattern `buildGetFileDataCode`, non codice LLM-generated). Raccoglie per ogni nodo:
- Fill/stroke colors
- `fontName` (family + style), `fontSize`, `fontWeight`, `lineHeight`
- `padding` (top/right/bottom/left), `itemSpacing`, `cornerRadius`
- `strokeWeight`
- `effects` (shadows, blurs)
- `boundVariables` — quali proprietà sono legate a variabili
- `visible` — layer nascosti
- Children count (per check auto-layout e nodi vuoti)

Il codice della walk è una stringa fissa costruita in Electron (`buildLintDataCode()`), versionata e testata. Passa attraverso il handler `EXECUTE_CODE` già esistente — **nessuna modifica al bridge** per la raccolta dati.

**Componente B — Logica di matching (Electron)**

Funzioni pure, completamente unit-testabili:

```
checkColors(nodeFills, dsPalette)            → ColorIssue[]
checkSpacing(nodePadding, dsScale)           → SpacingIssue[]
checkTypography(nodeFont, dsTypeScale)       → TypographyIssue[]
checkNaming(nodeName, dsConventions)         → NamingIssue[]
checkAutoLayout(nodeInfo)                    → AutoLayoutIssue[]
checkDepthAndSizing(tree)                    → StructureIssue[]
checkEffects(nodeEffects, dsEffectStyles)    → EffectIssue[]
checkBoundVariables(nodeBoundVars, dsVars)   → BindingIssue[]
```

Stessi input → stessi output → riproducibile al 100%.

**Scope del lint:**

| Parametro | Comportamento |
|---|---|
| `figma_lint({ nodeId: "123" })` | Linta il subtree del nodo specifico |
| `figma_lint({})` (nodeId omesso) | Linta la pagina intera |
| `figma_lint({ selection: true })` | Linta la selezione corrente dell'utente |

Quando l'agente dovrebbe lintare:
- **Dopo layout complessi (3+ elementi):** lint automatico del subtree creato
- **Su richiesta utente ("controlla"):** lint pagina intera
- **Non dopo ogni singola operazione** — troppo rumore

**Risultato strutturato in tre sezioni:**

**1. `dsCheck` — Confronto con il Design System**

Matching meccanico (è nel DS? sì/no) per colori, tipografia, spacing, radii, stroke weight, effects:

```json
{
  "dsCheck": {
    "aligned": 38,
    "issues": 7,
    "colors": {
      "notInPalette": [
        { "value": "#A359FF", "nodes": ["Button/CTA"], "nearest": "primary=#A259FF", "bound": false }
      ]
    },
    "typography": {
      "notInScale": [
        { "fontSize": 18, "fontWeight": 400, "lineHeight": 28,
          "nodes": ["Card/Subtitle"], "nearest": "body=16/24/400", "bound": false }
      ],
      "wrongFont": [
        { "fontFamily": "Helvetica", "nodes": ["Footer/Legal"], "expected": "Inter" }
      ]
    },
    "spacing": {
      "notInGrid": [
        { "value": 12, "property": "paddingLeft", "nodes": ["Card/Body"], "nearest": "8 or 16", "bound": false }
      ]
    },
    "radii": {
      "notInDs": [
        { "value": 6, "nodes": ["Input/Search"], "nearest": "sm=4 or md=8" }
      ]
    },
    "strokeWeight": {
      "notInDs": [
        { "value": 3, "nodes": ["Divider"], "nearest": "default=1 or thick=2" }
      ]
    },
    "effects": {
      "notLinkedToStyle": [
        { "node": "Card/Product", "effectType": "DROP_SHADOW", "message": "Shadow not linked to DS Effect Style" }
      ]
    },
    "unboundButCorrect": [
      { "value": 16, "property": "paddingTop", "nodes": ["List/Item"],
        "suggestion": "Matches spacing/md — bind for safety" },
      { "value": "#A259FF", "property": "fill", "nodes": ["Badge/Dot"],
        "suggestion": "Matches primary — bind for safety" }
    ],
    "dsRules": [
      "components: Primary buttons always have a left icon",
      "colors: Use 'error' only for error states"
    ]
  }
}
```

**2. `bestPractices` — Regole universali Figma**

```json
{
  "bestPractices": {
    "autoLayout": [
      { "node": "Card", "children": 4, "message": "Frame with 4 children has no auto-layout" },
      { "node": "Header/Actions", "child": "CloseButton", "message": "Absolute positioning inside auto-layout" }
    ],
    "sizing": [
      { "node": "Card/Image", "message": "Fixed width inside auto-layout parent — use FILL" }
    ],
    "depth": [
      { "node": "Card/Body/Content/Text/Label", "levels": 5, "max": 4, "message": "5 levels deep — flatten" }
    ],
    "naming": [
      { "node": "Frame 47", "issue": "default-name" },
      { "node": "card_body", "issue": "wrong-format", "convention": "PascalCase/slash" }
    ],
    "empty": [
      { "node": "Group 3", "message": "Empty frame with no children — remove" }
    ],
    "hidden": [
      { "node": "Old Header", "message": "Hidden layer — remove if unused" }
    ]
  }
}
```

**3. `figmaLint` — Regole native Figma**

```json
{
  "figmaLint": [
    { "node": "Icon", "issue": "detached-fill", "message": "Fill not linked to variable or style" }
  ]
}
```

### 6.4 Prevenzione Confusione tra Tool

**`figma_design_system` vs `figma_get_file_data`**

> *"`figma_design_system`: the single source of truth for the project's design system — variables, components, rules, naming conventions. Call with forceRefresh after DS changes.*
> *`figma_get_file_data`: structural tree of any page or node — use for inspecting screens you're working on, NOT for reading the design system."*

**`figma_lint` vs `figma_design_system`**

> *"`figma_lint`: VERIFY a screen against the DS and quality rules — returns what's aligned and what's not. Use to check adherence.*
> *`figma_design_system`: READ the DS overview — variables, components, rules. Use to refresh your DS context."*

**`figma_setup_tokens` vs `figma_update_ds_page`**

> *"When updating the DS, ALWAYS call BOTH:*
> *1. `figma_setup_tokens` to create/update Figma variables (values)*
> *2. `figma_update_ds_page` to update the DS page (rules + visual samples)*
> *Never update one without the other."*

**`figma_update_ds_page` vs `figma_set_text`**

> *"`figma_update_ds_page`: ONLY for the Design System page. Manages [DS::*] sections, samples, and rules.*
> *`figma_set_text`: for text on working screens. Never use for the DS page."*

**`figma_setup_tokens` vs `figma_execute` per le variabili**

> *"ALL variable operations go through `figma_setup_tokens`. NEVER use `figma_execute` to create, update, or delete variables."*

**`figma_design_system` vs `figma_search_components`**

> *"Use `figma_design_system` for the overview of all components. Use `figma_search_components` to find a specific component by name when you need its key for instantiation."*

**`figma_set_fills` vs `figma_bind_variable` per i colori**

> *"To set a COLOR: ALWAYS use `figma_set_fills` (or `figma_set_strokes`). When a DS is active, pass the `bindTo` parameter to bind to the DS variable.*
> *`figma_bind_variable` is for NUMERIC properties only (padding, gap, radius, fontSize, lineHeight, strokeWeight)."*

**`figma_render_jsx` vs `figma_create_child` per la creazione**

> *"For layouts with 2+ elements: ALWAYS use `figma_render_jsx` (one roundtrip, consistent structure).*
> *`figma_create_child` is ONLY for adding a SINGLE element to an existing parent."*

**`figma_execute` — esclusione esplicita per operazioni DS**

> *"`figma_execute`: for operations NOT covered by dedicated tools (GROUP→FRAME, reparenting, complex conditional logic).*
> *NEVER use for Design System operations — use `figma_setup_tokens`, `figma_bind_variable`, `figma_update_ds_page` instead."*

### 6.5 Audit Description e PromptSnippet dei Tool

Dall'audit completo di tutti i 35 tool emerge che le description e i promptSnippet attuali non riflettono il piano DS. Le seguenti description devono essere aggiornate nell'implementazione:

#### Tool DS — Description da Aggiornare

| Tool | PromptSnippet attuale | PromptSnippet aggiornato |
|---|---|---|
| `figma_design_system` | "get design system overview (variables + local components, cached)" | "get complete DS (variables + components + rules + naming + status). Use forceRefresh:true after DS changes" |
| `figma_setup_tokens` | "create a design token collection with modes and variables in one call" | "create or update design tokens (idempotent — creates collection if new, adds/updates variables if existing)" |
| `figma_bind_variable` | "link a node fill/stroke to a design token variable" | "bind numeric properties to DS variables (padding, gap, radius, fontSize, lineHeight, strokeWeight). For colors, use figma_set_fills/set_strokes with bindTo" |
| `figma_lint` | "check design quality (naming, spacing, consistency)" | "verify screen quality — DS adherence + auto-layout + naming + best practices. Returns structured report" |
| `figma_set_fills` | "set solid fill colors on a node (SOLID only)" | "set fill colors. Use bindTo parameter to bind to a DS variable (bound values can't drift)" |
| `figma_set_strokes` | "set solid stroke colors and weight (SOLID only)" | "set stroke colors and weight. Use bindTo to bind to a DS variable" |
| `figma_set_text` | "set text content and font properties on a text node" | "set text on working screens (NOT for the Design System page — use figma_update_ds_page)" |
| `figma_execute` | "run raw Figma Plugin API code (escape hatch)" | "run Plugin API code for operations not covered by dedicated tools. NEVER for DS operations" |

#### Tool non-DS — Nessuna Modifica Necessaria

I seguenti tool hanno description chiare e non confliggono con il workflow DS:

- **Core**: `figma_status`, `figma_get_selection`, `figma_screenshot` — ruoli unici
- **Discovery**: `figma_get_file_data`, `figma_search_components`, `figma_get_library_components`, `figma_get_component_details` — distinti
- **Manipulation**: `figma_resize`, `figma_move`, `figma_rename`, `figma_clone`, `figma_delete`, `figma_create_child`, `figma_set_image_fill` — specifici
- **Components**: `figma_instantiate`, `figma_set_instance_properties`, `figma_arrange_component_set` — specifici
- **Image Gen** (7 tool): tutti con scope chiaro e distinto
- **JSX**: `figma_render_jsx`, `figma_create_icon` — chiari

---

## 7. Piano di Implementazione

### 7.1 Step 1 — Lettura DS + Iniezione nel Prompt (valore immediato)

**Obiettivo:** L'agente conosce il DS dal primo messaggio e lo usa nelle operazioni.

| Modifica | File | Descrizione |
|----------|------|-------------|
| `figma_design_system` legge pagina DS | `tools/discovery.ts` | Cerca pagina "Design System", estrae testo dai frame `[DS::*]` (incluso `[DS::naming]`). Aggiunge `dsStatus` e `rules` al risultato. |
| `buildSystemPrompt` accetta dati DS | `system-prompt.ts` | Nuova firma: `buildSystemPrompt(modelLabel, dsData?)`. Formatta il DS in notazione compatta con legenda. Aggiunge behavioral instructions e chiarimenti tool. |
| `createFigmaAgent` fetcha il DS | `agent.ts` | Prima di creare la sessione, chiama la logica di `figma_design_system` per ottenere variabili + componenti + regole + naming. Passa il risultato a `buildSystemPrompt`. |
| `dsStatus` hint nei tool | `tools/core.ts`, `tools/discovery.ts` | `figma_screenshot` e `figma_get_file_data` includono `dsStatus` nel risultato. |
| Test | `tests/` | Test per: lettura pagina DS, compressione nel formato prompt, iniezione, hint `dsStatus`. |

**Criterio di completamento:** l'agente sa del DS dal primo messaggio. Chiamando `figma_design_system(forceRefresh: true)` ottiene lo stato aggiornato con variabili + componenti + regole + naming.

### 7.2 Step 2 — Tool Dedicati per Scrivere il DS

**Obiettivo:** L'agente può creare e far evolvere il DS con tool affidabili, senza `figma_execute`.

| Modifica | File | Descrizione |
|----------|------|-------------|
| `figma_setup_tokens` idempotente | `tools/tokens.ts` | Se la collezione esiste, aggiunge/aggiorna variabili. Se non esiste, la crea. Stessa interfaccia, comportamento intelligente. |
| `figma_update_ds_page` (nuovo) | `tools/ds-page.ts` | Tool dedicato: crea/aggiorna pagina DS con sezioni `[DS::*]`, campioni visivi (swatch, specimen tipografici), testo regole. Azioni: create/update/append. Implementato con codice fisso via `EXECUTE_CODE` (nessuna estensione bridge). |
| `figma_bind_variable` esteso | `tools/jsx-render.ts` + bridge `code.js` | Supporto per proprietà FLOAT: padding, gap, cornerRadius, fontSize, lineHeight, strokeWeight. ~20 righe aggiunte al handler bridge. |
| Istruzioni workflow socratico | `system-prompt.ts` | Istruzioni per: analizzare file → proporre → confermare → `figma_setup_tokens` + `figma_update_ds_page`. Supporto fork da libreria. Istruzione: "bind values to variables, don't use raw numbers". |
| Test | `tests/` | Test per: idempotenza setup_tokens, creazione/aggiornamento pagina DS, bind_variable proprietà numeriche. |

**Criterio di completamento:** l'agente può creare un DS da zero (o da fork di libreria), popolare la pagina con campioni visivi e regole, aggiornare entrambi i livelli con tool dedicati, e bindare tutti i valori a variabili.

### 7.3 Step 3 — Lint Esteso + Proattività

**Obiettivo:** L'agente verifica l'aderenza al DS e suggerisce aggiornamenti proattivamente.

| Modifica | File | Descrizione |
|----------|------|-------------|
| `buildLintDataCode()` | `tools/lint.ts` (nuovo file) | Walk arricchita: raccoglie fontName, fontWeight, lineHeight, boundVariables, effects, cornerRadius, strokeWeight, visible, children count. Codice fisso, eseguito via `EXECUTE_CODE` (nessuna estensione bridge). |
| Funzioni di matching | `tools/lint.ts` | Funzioni pure: `checkColors`, `checkSpacing`, `checkTypography`, `checkNaming`, `checkAutoLayout`, `checkDepthAndSizing`, `checkEffects`, `checkBoundVariables`. Unit-testabili al 100%. |
| Assemblaggio report | `tools/lint.ts` | Tre sezioni: `dsCheck` (matching DS), `bestPractices` (auto-layout, depth, sizing, naming, empty/hidden nodes), `figmaLint` (regole native Figma). |
| Parametro `selection` | `tools/lint.ts` | `figma_lint({ selection: true })` linta la selezione corrente. |
| Comportamento proattivo | `system-prompt.ts` | Istruzioni per: rilevare valori non nel DS → suggerire aggiunta. Aggiornare SEMPRE `figma_setup_tokens` + `figma_update_ds_page` insieme. Auto-lint dopo layout complessi (3+ elementi). |
| Test | `tests/` | Unit test per ogni funzione di matching (funzioni pure). Integration test per la walk arricchita. |

**Criterio di completamento:** `figma_lint` verifica aderenza DS (colori, tipografia, spacing, radii, stroke weight, effects, binding), best practices (auto-layout, depth, sizing, naming, empty/hidden), e lint nativo. Risultato riproducibile. Funziona su nodo, pagina intera, o selezione.

### 7.4 Interazione con PLAN-MULTI-SESSION.md

Entrambi i piani modificano: `agent.ts`, `system-prompt.ts`, `tools/discovery.ts`.

Punti di contatto limitati e additivi. Implementare questo piano prima del Multi-Session è più semplice. I conflitti sono risolvibili con merge additivo.

### 7.5 Stima di Effort

| Step | Descrizione | Righe stimate (source + test) |
|------|-------------|-------------------------------|
| Step 1 | Lettura DS + iniezione prompt + best practices block | ~350 |
| Step 2 | `figma_setup_tokens` idempotente + `figma_update_ds_page` + `figma_bind_variable` esteso + bridge (+20 righe) | ~400 |
| Step 3 | `figma_lint` completo (`buildLintDataCode` + 8 funzioni matching + report 3 sezioni + parametro selection) + proattività | ~450 |
| **Totale** | | **~1200** |

---

## 8. Interazione con il Sistema di Compressione

Il sistema di compressione esistente (`compression/`) intercetta i risultati dei tool per ridurre il consumo di token. L'introduzione dei tool DS richiede attenzione per evitare che la compressione elimini informazioni critiche.

### 8.1 Principio: Nessuna Compressione sui Tool DS Critici

I tool DS sono chiamati raramente (1-15 volte per sessione) e i loro risultati contengono informazioni critiche che l'agente deve vedere per intero. Il risparmio token della compressione (~1800 token/sessione) è trascurabile rispetto al rischio di perdere informazione.

**Tool rimossi da `MUTATION_TOOLS` (risultato completo, mai compresso):**

| Tool | Oggi | Dopo | Razionale |
|---|---|---|---|
| `figma_setup_tokens` | Compresso a `"OK collection=X vars=N"` | **Risultato completo** | Con l'idempotenza, l'agente deve sapere quali variabili sono state create vs aggiornate vs invariate. |
| `figma_bind_variable` | Compresso a `"OK node=X"` | **Risultato completo** | L'agente deve sapere quale proprietà è stata legata a quale variabile. |

**Tool nuovi (mai in `MUTATION_TOOLS`):**

| Tool | Categoria metriche | Compressione |
|---|---|---|
| `figma_update_ds_page` | `'mutation'` | Mai compresso — risultato serve completo |
| `figma_lint` | `'discovery'` | Mai compresso — è il report principale di qualità |

**Tool con compressione parziale:**

`figma_design_system` mantiene la compressione esistente per variabili e componenti (`compactDesignSystem: true` → hex colors, componenti raggruppati), ma i nuovi campi **passano sempre senza compressione**:

```typescript
interface CachedDesignSystem {
  // Compressi dal flag compactDesignSystem:
  variables: CompactVariableCollection[];
  components: CompactComponent[];
  // MAI compressi — sempre inclusi:
  rules: DsRule[];
  naming: DsNaming | null;
  dsStatus: 'active' | 'partial' | 'none';
}
```

### 8.2 Modifiche al Codice di Compressione

| File | Modifica | Righe |
|---|---|---|
| `compression/metrics.ts` | Cambiare categoria di `figma_setup_tokens` e `figma_bind_variable` da `'mutation'` a `'other'`. Aggiungere `figma_update_ds_page: 'mutation'` e `figma_lint: 'discovery'`. | ~4 |
| `compression/design-system-cache.ts` | Estendere `CompactDesignSystem` con `rules`, `naming`, `dsStatus`. La funzione `compactDesignSystem()` preserva questi campi senza comprimerli. | ~20 |
| `compression/mutation-compressor.ts` | Rimuovere il branch morto per `figma_setup_tokens` (righe 45-49 attuali). | -5 |

### 8.3 `dsStatus` Hint: Calcolato dalla Cache

I tool `figma_screenshot` e `figma_get_file_data` aggiungono `dsStatus` al risultato. Il valore viene letto dalla cache di `DesignSystemCache` — nessun roundtrip WebSocket aggiuntivo.

Se la cache non è ancora popolata (primissima chiamata tool, prima di `figma_design_system`), `dsStatus` è `"unknown"`. Alla prima chiamata `figma_design_system` la cache si popola e i tool successivi restituiscono il valore corretto.

### 8.4 `fontSize` nel Livello `standard` di `projectTree`

Il livello `standard` (profilo `balanced`, default) oggi omette `fontSize` dai nodi TEXT — disponibile solo in livello `detailed`.

**Modifica:** includere `fontSize` anche nel livello `standard`. Il costo è ~2 token per nodo TEXT, trascurabile. Il font size è informazione fondamentale per il lavoro di design, indipendente dal DS.

Questo è un fix indipendente dal piano DS ma necessario per un'esperienza coerente.

### 8.5 Architettura Cache e Startup Path

La logica di lettura del DS viene usata in due contesti:

1. **Startup** (`createFigmaAgent` in `agent.ts`) — legge il DS per iniettarlo nel system prompt, prima che la sessione esista
2. **Runtime** (tool `figma_design_system`) — legge il DS su richiesta dell'agente durante la sessione

**Soluzione:** estrarre la logica in una funzione condivisa `readDesignSystem()` usata da entrambi i path. La stessa istanza di `DesignSystemCache` è condivisa — il fetch dello startup popola la cache, e il primo `figma_design_system` runtime la riusa senza fetch duplicato.

```
Startup:
  createFigmaAgent → readDesignSystem() → popola cache → buildSystemPrompt(dsData)

Runtime:
  figma_design_system → readDesignSystem() → cache hit (già popolata) → return cached
  figma_design_system(forceRefresh) → readDesignSystem(force) → fetch fresco → aggiorna cache
```

---

## 9. Rischi e Mitigazioni

(Sezione rinumerata dopo inserimento Sezione 8)

| Rischio | Prob. | Impatto | Mitigazione |
|---------|-------|---------|-------------|
| L'agente non segue le istruzioni DS nel prompt | Media | Alto | Le verifiche usano dati concreti (variabili + regole), non solo istruzioni astratte. `figma_lint` fa il matching meccanico — non dipende dalla compliance del prompt. |
| Falsi positivi nel DS check di `figma_lint` | Media | Medio | Il tool non giudica — segnala non-match e nearest value. L'LLM decide se è un errore o intenzionale. L'utente valida prima delle correzioni. |
| Il DS nel prompt degrada l'instruction-following | Bassa | Medio | Budget <700 token totali. Posizione strategica nel prompt (dopo identità, prima del reference). Il prompt attuale è ~5000 token — l'aggiunta è <14%. |
| La pagina DS diventa obsoleta (utente non la aggiorna) | Media | Medio | `figma_update_ds_page` aggiorna la pagina ad ogni modifica confermata. L'utente non deve fare nulla manualmente. |
| Confusione tra tool DS | Media | Alto | Istruzioni esplicite per ogni coppia di tool nel prompt (Sezione 6.4). Ruoli chiaramente distinti: leggere / scrivere token / scrivere pagina / verificare. |
| DS grande occupa troppi token | Bassa | Basso | Anche il caso estremo (500 token) è <0.07% del contesto su 1M. Compressione densa senza mai troncare. |
| `figma_setup_tokens` idempotente rompe collezioni esistenti | Bassa | Alto | L'idempotenza aggiunge/aggiorna ma non elimina variabili esistenti. Test dedicati per merge su collezioni popolate. |
| Creazione pagina DS fallisce (font, layout) | Media | Basso | `figma_update_ds_page` usa codice fisso via `EXECUTE_CODE` — testato e versionato. Fallback: testo semplice senza campioni visivi. |
| L'agente usa `figma_execute` per operazioni DS | Media | Medio | Istruzione esplicita nel prompt: "ALL variable operations go through `figma_setup_tokens`. ALL DS page operations go through `figma_update_ds_page`. NEVER use `figma_execute` for DS operations." |
| Walk arricchita per lint troppo lenta su pagine grandi | Bassa | Medio | Profondità limitata a 6 livelli. L'agente può lintare per subtree anziché pagina intera. Stesse ottimizzazioni di `figma_get_file_data`. |
| Bridge diverge troppo dall'upstream | Bassa | Basso | L'unica modifica al bridge è ~20 righe nel handler `BIND_VARIABLE`. Raccolta dati lint e operazioni DS page usano `EXECUTE_CODE` con codice fisso — zero modifiche al bridge. |

---

## 10. Decisioni Registrate

Registro delle decisioni chiave emerse dal processo di analisi (multi-agent critique + ricerca + iterazioni).

| # | Decisione | Alternative valutate | Razionale |
|---|-----------|---------------------|-----------|
| D1 | **Figma è la source of truth** — variabili + pagina DS, niente filesystem locale | Filesystem locale (piano v2.0), Cloud/DB | Zero drift, portabilità gratis, l'utente vede e modifica direttamente. La ricerca conferma: 69.8% dei team usa variabili Figma come SoT. |
| D2 | **Matching meccanico semplice in `figma_lint`** + giudizio dell'LLM | Rule engine complesso (piano v2.0), tutto LLM senza matching | Il matching di set (è nel DS? sì/no) è affidabile e stabile come codice. Il giudizio (è un errore o intenzionale?) resta all'LLM. Equilibrio tra affidabilità e flessibilità. |
| D3 | **Tool dedicati per ogni operazione DS** — niente `figma_execute` per il DS | Un solo tool monolitico, tool generici | Le operazioni DS sono critiche e devono essere affidabili, testabili, con schema validato. `figma_execute` genera codice al volo — troppo fragile per il DS. |
| D4 | **`figma_setup_tokens` reso idempotente** | Tool CRUD separati (create/update/delete variable), tool nuovo | Stessa interfaccia, comportamento più intelligente. L'agente non deve distinguere tra "creo" e "aggiorno". |
| D5 | **`figma_update_ds_page` come tool nuovo** | Usare `figma_set_text` + `figma_render_jsx` + `figma_execute` | La pagina DS ha bisogno di un tool dedicato: crea la pagina se non esiste, gestisce le sezioni `[DS::*]`, crea campioni visivi. Troppo complesso per assemblare da tool generici. |
| D6 | **`figma_lint` unifica DS check + auto-layout + lint nativo** | Tool separati per DS check e lint | Un'unica azione "controlla la qualità" da parte dell'utente = un tool. Elimina la confusione "quale tool chiamo per controllare?". |
| D7 | **DS compresso nel prompt, mai troncato** | Solo via tool, troncamento con puntatore | Il DS è sempre rilevante (Bottega fa solo design). <700 token = impatto trascurabile. Troncare perde informazione. |
| D8 | **Legenda di decodifica nel prompt** | Formato auto-esplicativo | L'agente deve capire la notazione compressa senza guessing. ~100 token fissi eliminano l'ambiguità. |
| D9 | **Niente versioning del DS** | Versione incrementale, timestamp, hash | Over-engineering. Il prompt è uno snapshot. L'agente si riallinea via `figma_design_system(forceRefresh)`. L'utente comunica le modifiche. |
| D10 | **Testo DS sempre in inglese** | Lingua dell'utente, multilingua | Consistenza e machine-readability. L'agente lavora meglio con testo inglese. |
| D11 | **Frame con naming convention `[DS::*]`** | Testo libero senza struttura, schema rigido | Machine-parseable (l'agente sa dove cercare) ma contenuto libero (l'utente scrive come vuole). |
| D12 | **Campioni visivi nella pagina DS** | Solo testo | Best practice del settore. I campioni (swatch, specimen) rendono il DS utile anche visivamente per l'utente, non solo per l'agente. |
| D13 | **Supporto fork da libreria** | Solo DS creato da zero | I team piccoli partono da kit esistenti (shadcn, Untitled UI). Il DS locale è un'evoluzione, non un sostituto. |
| D14 | **Proattività bidirezionale** | Solo su valori nuovi, solo su richiesta utente | Qualsiasi modifica che dovrebbe stare nel DS viene segnalata. L'agente aggiorna SEMPRE `figma_setup_tokens` + `figma_update_ds_page` insieme. |
| D15 | **`dsStatus` come flag semplice** (active/partial/none) | Con versione, con timestamp, con lista sezioni mancanti | Solo trigger proattivo. Nessuna complessità di sync. |
| D16 | **Naming convention nel DS** con sezione `[DS::naming]` | Solo regola nel prompt, nessuna convention | Il naming coerente è critico per file leggibili da coding agent. Convention strutturali + glossario del progetto nella pagina DS. |
| D17 | **Auto-layout check in `figma_lint`** | Solo istruzione nel prompt, tool separato | L'auto-layout è fondamentale per design implementation-ready. Un check verificabile è più affidabile di un'istruzione nel prompt. |
| D18 | **Cross-screen pattern detection escluso** (futuro tool dedicato) | Incluso in `figma_lint`, solo nel prompt | Complessità troppo alta per il lint di uno screen singolo. Meriterà un tool dedicato in futuro, non da discutere adesso. |
| D19 | **Best practices Figma come blocco coeso nel prompt** | Regole sparse in punti diversi del prompt | Consolida e completa le regole universali (auto-layout, FILL sizing, depth max 4, naming). Verificate meccanicamente da `figma_lint`. |
| D20 | **`figma_bind_variable` esteso a tutte le proprietà DS** | Solo fill/stroke, binding manuale per il resto | Un valore bound a una variabile non può driftare — è la garanzia più forte di aderenza al DS. Proprietà: padding, gap, radius, fontSize, lineHeight, strokeWeight. |
| D21 | **Shadows gestite via Effect Styles, non variable binding** | Binding di singole proprietà shadow a variabili FLOAT | Le shadows sono composite (offset + blur + spread + color). Bindare singole proprietà è fragile. Gli Effect Styles sono lo strumento nativo di Figma per questo. |
| D22 | **Lint raccoglie `boundVariables` per ogni nodo** e segnala `unboundButCorrect` | Solo check del valore grezzo | Segnalare valori corretti ma non bound è prevenzione: oggi è giusto, domani potrebbe driftare. Il binding è la garanzia. |
| D23 | **Lint architettura a due componenti**: walk arricchita (codice fisso nel plugin) + funzioni pure di matching (Electron) | Tutta la logica nel plugin, o tutto via `figma_execute` LLM-generated | La walk è codice fisso (`buildLintDataCode`), non codice LLM. Le funzioni di matching sono pure, unit-testabili al 100%, riproducibili. Bridge invariato per la raccolta dati. |
| D24 | **Lint su 3 scope**: nodo specifico, pagina intera, selezione corrente | Solo pagina intera | Nodo specifico per self-check dopo creazione. Pagina intera per review. Selezione per check mirato dall'utente. |
| D25 | **Lint check include**: layer nascosti, nodi vuoti, depth > 4, FIXED in auto-layout | Solo DS check + auto-layout + naming | Le best practice universali (depth, sizing, cleanup) sono critiche per file Figma di qualità, indipendenti dal DS. |
| D26 | **`figma_update_ds_page` via codice fisso `EXECUTE_CODE`**, non handler bridge dedicato | Handler dedicato nel bridge | Le operazioni sulla pagina DS sono complesse ma poco frequenti. Codice fisso in Electron è sufficiente, testabile, e non modifica il bridge. |
| D27 | **Nessuna compressione sui tool DS critici** — `figma_setup_tokens` e `figma_bind_variable` rimossi da `MUTATION_TOOLS` | Compressione estesa con formato custom per tool DS | Il risparmio token è trascurabile (~1800/sessione). Il rischio di perdere info critica (created vs updated, quale proprietà bound) è alto. Risultato completo sempre. |
| D28 | **Cache DS include rules/naming/dsStatus** — mai compressi | Solo variabili e componenti in cache | I nuovi campi DS (regole, naming, status) sono piccoli e critici. Se compressi o omessi dalla cache, l'agente perde il contesto DS in profilo `balanced`. |
| D29 | **`readDesignSystem()` condivisa** tra startup path e runtime path | Path separati con logica duplicata | Evita doppio fetch. Lo startup popola la cache, il primo `figma_design_system` runtime la riusa. Una sola logica da mantenere e testare. |
| D30 | **`fontSize` incluso nel livello `standard`** di `projectTree` | Solo nel livello `detailed` | Il font size è informazione fondamentale per il design. Il costo è ~2 token per nodo TEXT, trascurabile. L'agente deve vedere i font size anche senza chiamare `figma_lint`. |
| D31 | **`dsStatus` hint calcolato dalla cache**, non da check live | Check live ogni volta | Zero roundtrip aggiuntivo. La cache è aggiornata dallo startup e da `forceRefresh`. Se la cache non è popolata, restituisce `"unknown"`. |
| D32 | **`figma_set_fills`/`figma_set_strokes` con parametro `bindTo`** | Tool separati per colori vs binding | Elimina la confusione più pericolosa: l'agente usa un solo tool per i colori, con binding opzionale. Zero rischio di scegliere il tool sbagliato. |
| D33 | **`figma_bind_variable` riposizionato per sole proprietà numeriche** | Supporta tutto (fill, stroke, numeriche) | Con `bindTo` su set_fills/set_strokes, il bind_variable si specializza su proprietà che non hanno un tool "set" dedicato. Ruoli chiari, zero overlap. |
| D34 | **Aggiornamento description/promptSnippet di 8 tool** per riflettere il piano DS | Lasciare le description attuali | L'agente sceglie i tool basandosi su description e promptSnippet. Se non riflettono il piano (idempotenza, bindTo, pagina DS, esclusioni), le scelte saranno sbagliate. |
| D35 | **`figma_execute` esclude esplicitamente operazioni DS** nella description | Description generica senza esclusioni | L'escape hatch è il rischio maggiore di bypass dei tool dedicati DS. L'esclusione esplicita nella description riduce il rischio. |

---

## Appendice — Cronologia del Documento

- **v1.0** — Analisi iniziale con requisiti, opzioni architetturali, dettaglio tecnico
- **v2.0** — Incorpora risultati della multi-agent critique (Requirements Validator, Solution Architect, Document Quality Reviewer)
- **v3.0** — Riscrittura completa. Multi-agent critique a 5 prospettive (Product Strategy, Architecture, LLM Behavior, Devil's Advocate, Implementation Pragmatist). 6 ricerche di settore (Figma DS management, designer-developer handoff, small team practices, Figma documentation pages, Plugin API capabilities, Bottega codebase check). Iterazioni strategiche con l'utente. Architettura semplificata: "Figma Is The Truth" + estensione tool esistente + DS compresso nel prompt.
- **v3.1** — Aggiornamento strategia tool: tool dedicati per DS (no `figma_execute`), `figma_setup_tokens` idempotente, nuovo `figma_update_ds_page`, `figma_lint` esteso con DS check + auto-layout + naming convention. Sezione `[DS::naming]` nella pagina DS. 18 decisioni registrate.
- **v3.2** — Architettura lint completa: walk arricchita (codice fisso plugin) + funzioni pure di matching (Electron, unit-testabili). `figma_bind_variable` esteso a tutte le proprietà DS (padding, gap, radius, fontSize, lineHeight, strokeWeight). Shadows via Effect Styles. Best practices Figma come blocco coeso nel prompt. Lint check include: `unboundButCorrect`, depth, sizing, layer nascosti, nodi vuoti, effects. Lint su 3 scope (nodo, pagina, selezione). Bridge quasi invariato (~20 righe). 26 decisioni registrate. ~1200 righe stimate.
- **v3.3** — Analisi interazione con il sistema di compressione. Nessuna compressione sui tool DS critici (`figma_setup_tokens`, `figma_bind_variable` rimossi da `MUTATION_TOOLS`). Cache DS estesa con rules/naming/dsStatus (mai compressi). `readDesignSystem()` condivisa tra startup e runtime. `fontSize` incluso nel livello `standard` di `projectTree`. `dsStatus` hint calcolato dalla cache. Nuova Sezione 8 (Compressione). 31 decisioni registrate.
- **v3.4** — Audit completo di tutti i 35 tool per rischi di confusione nel contesto DS. `figma_set_fills`/`figma_set_strokes` con parametro `bindTo` per eliminare confusione colori vs binding. `figma_bind_variable` riposizionato per sole proprietà numeriche. Aggiornamento description/promptSnippet di 8 tool. `figma_execute` esclude esplicitamente operazioni DS. Nuova Sezione 6.5 (Audit Description). 35 decisioni registrate.
