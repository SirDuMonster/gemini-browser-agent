# Jak Działa Gemini Chrome Agent - Przewodnik Implementacji

**Data utworzenia:** 2026-01-03
**Dla:** Kogoś kto nie wie nic o tym projekcie

---

## 🎯 Co To Jest?

Gemini Chrome Agent to rozszerzenie do Chrome, które automatyzuje przeglądarkę używając sztucznej inteligencji. Wyobraź sobie, że mówisz do przeglądarki "Znajdź mi ceny laptopów na Allegro" i ona to robi automatycznie - klika, przewija, wpisuje tekst.

**Jak to działa?**
1. Ty piszesz: "Wyszukaj AI tools w Google"
2. Agent **planuje** co zrobić (używa Gemini 3 Pro)
3. Agent **wykonuje** akcje (używa Claude Sonnet 4.5)
4. Powtarza aż zadanie będzie skończone

---

## 🏗️ Architektura - Jak To Jest Zbudowane?

### Główne Komponenty

```
┌─────────────────────────────────────────────────────────────┐
│                         UŻYTKOWNIK                          │
│                    (pisze: "Search Google")                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    POPUP UI (interfejs)                     │
│              - Okienko z czatem                             │
│              - Wysyła wiadomość START_TASK                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              SERVICE WORKER (mózg rozszerzenia)             │
│                                                             │
│  1. Tworzy sesję (zapisuje że rozpoczęliśmy zadanie)        │
│  2. Uruchamia "Agent Loop" (pętla główna)                   │
│  3. Koordynuje wszystko                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                      AGENT LOOP                             │
│              (to się dzieje w kółko)                        │
│                                                             │
│  Krok 1: Zrób screenshot strony                             │
│  Krok 2: PLANNER - zapytaj Gemini "co dalej?"              │
│  Krok 3: EXECUTOR - zapytaj Claude "jak to zrobić?"        │
│  Krok 4: PERFORM - wykonaj akcję na stronie                │
│  Krok 5: Powtórz lub zakończ                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              CONTENT SCRIPT (działa na stronie)             │
│                                                             │
│  - Analizuje co jest na stronie (przyciski, pola)          │
│  - Wykonuje akcje (klikanie, pisanie)                       │
│  - Robi screenshoty                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Struktura Plików - Co Gdzie Jest?

### `/src/shared/` - Rzeczy używane wszędzie

#### `types.ts` - Definicje typów
**Co to robi?**
Definiuje "kształty" danych używanych w całym projekcie. TypeScript wymaga, żebyśmy powiedzieli jakie dane gdzie przekazujemy.

**Przykłady:**
- `AgentSession` - dane o aktualnym zadaniu (ID, status, historia akcji)
- `PageContext` - informacje o stronie (URL, screenshot, elementy)
- `PlannedAction` - co agent planuje zrobić (np. "kliknij przycisk Login")
- `ComputerUseAction` - konkretna akcja (np. "kliknij w pozycji x=100, y=200")

#### `constants.ts` - Stałe wartości
**Co to robi?**
Przechowuje wszystkie stałe wartości w jednym miejscu, łatwo je zmienić.

**Przykłady:**
- `GEMINI_MODEL = 'google/gemini-3-pro-preview'` - jaki model AI używamy do planowania
- `CLAUDE_MODEL = 'anthropic/claude-sonnet-4-5-20250929'` - jaki model do wykonywania
- `OPENROUTER_API_KEY` - klucz do API (OpenRouter to pośrednik między nami a AI)
- `MAX_RETRY_ATTEMPTS = 3` - ile razy próbować jeśli akcja się nie uda
- `BLOCKED_DOMAIN_PATTERNS` - lista stron które są zabronione (banki, płatności)

#### `prompts/planner-system.ts` - Instrukcje dla Gemini
**Co to robi?**
To "instrukcja obsługi" dla AI Gemini. Mówi mu:
- Jakie akcje może planować (click, type, scroll, itp.)
- Jak ma formatować odpowiedź (JSON)
- Jakie zasady bezpieczeństwa stosować

**Przykład:**
```
Jesteś ekspertem od planowania automatyzacji.
Dostajesz: screenshot strony, listę elementów
Zwracasz: JSON z następną akcją do wykonania
```

#### `prompts/executor-system.ts` - Instrukcje dla Claude
**Co to robi?**
Instrukcja dla Claude z Computer Use. Mówi mu:
- Jak używać Computer Use API (mouse_move, left_click, type)
- Że ma być precyzyjny z koordynatami
- Jak lokalizować elementy na screenshotach

---

### `/src/shared/utils/` - Narzędzia pomocnicze

#### `storage-utils.ts` - Zapisywanie danych
**Co to robi?**
Rozszerzenia Chrome mogą zapisywać dane lokalnie (jak ciasteczka). Ten plik ma funkcje do:
- `getSettings()` - pobierz ustawienia użytkownika
- `saveSettings()` - zapisz ustawienia
- `getSession()` - pobierz aktualną sesję (zadanie)
- `saveSession()` - zapisz sesję
- `clearSession()` - usuń sesję

**Dlaczego to potrzebne?**
Żeby zapamiętać co agent robi, nawet jeśli zamkniesz popup. Dane są w `chrome.storage.local`.

#### `screenshot-utils.ts` - Robienie zrzutów ekranu
**Co to robi?**
- `captureScreenshot()` - robi screenshot aktywnej karty
- `processScreenshot()` - zmniejsza rozmiar (resize + kompresja)
- `captureWithAdaptiveQuality()` - automatycznie dobiera jakość żeby nie przekroczyć limitu API

**Dlaczego to potrzebne?**
AI potrzebuje widzieć stronę. Ale API ma limity:
- Gemini: max 4MB na obrazek
- Claude: max 5MB na obrazek

Więc musimy kompresować screenshoty.

**Jak działa kompresja?**
1. Zrób screenshot (pełna jakość)
2. Sprawdź rozmiar
3. Jeśli za duży → zmniejsz rozdzielczość i jakość JPEG
4. Powtarzaj aż będzie < 4MB

---

### `/src/api/` - Komunikacja z AI

#### `gemini-client.ts` - Rozmowa z Gemini (Planner)
**Co to robi?**
Wysyła zapytania do Gemini 3 Pro przez OpenRouter API.

**Główna funkcja: `plan()`**
```typescript
Input:
  - userRequest: "Search Google for AI tools"
  - context: { screenshot, url, DOM elements }
  - actionHistory: [poprzednie akcje]

Output:
  {
    thinking: "User wants to search. I see we're on google.com. Next: click search box",
    nextAction: {
      type: "click",
      description: "Click the search box",
      target: { description: "Search input", hint: "White box with 'Search' placeholder" }
    },
    status: "continue",
    confidenceScore: 0.95
  }
```

**Jak to działa?**
1. Buduje wiadomość z:
   - System prompt (instrukcje)
   - Screenshot (base64)
   - Tekst z opisem strony (URL, elementy, formularze)
2. Wysyła do OpenRouter API
3. Dostaje JSON z zaplanowaną akcją
4. Parsuje i zwraca

**Dlaczego OpenRouter?**
To pośrednik który daje dostęp do wielu AI (Gemini, Claude, itp.) przez jedno API. Płacisz pay-as-you-go.

#### `anthropic-client.ts` - Rozmowa z Claude (Executor)
**Co to robi?**
Wysyła zapytania do Claude Sonnet 4.5 z Computer Use.

**Główna funkcja: `execute()`**
```typescript
Input:
  - plannedAction: { type: "click", target: "search box" }
  - screenshot: base64 image
  - viewport: { width: 1920, height: 1080 }

Output:
  {
    toolUse: {
      type: "tool_use",
      name: "computer",
      input: {
        action: "mouse_move",
        coordinate: [450, 320]  // ← konkretne piksele!
      }
    },
    confidence: 0.85
  }
```

**Jak to działa?**
1. Buduje wiadomość z screenshot i opisem akcji
2. Definiuje Computer Use tool (mówi Claude że ma dostęp do Computer Use)
3. Wysyła do OpenRouter
4. Claude analizuje screenshot i zwraca tool_use z konkretnymi koordynatami
5. Parsujemy i zwracamy

**Computer Use = specjalna funkcja Claude**
Claude Sonnet 4.5 ma "Computer Use" - potrafi analizować screenshoty i mówić gdzie kliknąć (piksele x,y).

---

### `/src/background/` - Mózg rozszerzenia (działa w tle)

#### `state-manager.ts` - Zarządzanie stanem sesji
**Co to robi?**
Przechowuje i zarządza aktualnym zadaniem (sesją).

**Główne funkcje:**
- `createSession(userRequest)` - tworzy nową sesję z ID i zapisuje
- `updateStatus(status)` - zmienia status ("planning" → "executing" → "completed")
- `recordAction(action, screenshot, success)` - zapisuje wykonaną akcję
- `getActionHistory()` - zwraca listę wszystkich akcji w tej sesji
- `endSession()` - kończy sesję

**Przykład sesji:**
```typescript
{
  id: "session_1234567890_abc123",
  startedAt: "2026-01-03T10:30:00",
  userRequest: "Search Google for AI tools",
  status: "executing",
  actions: [
    {
      id: "action_001",
      plannedAction: { type: "click", description: "Click search box" },
      executedAction: { action: "mouse_move", coordinate: [450, 320] },
      success: true,
      duration: 1234
    },
    { ... }
  ],
  currentContext: { url: "https://google.com", screenshot: "...", ... }
}
```

**Dlaczego to potrzebne?**
Żeby pamiętać co agent robi, nawet jak zamkniesz popup. Wszystko zapisane w chrome.storage.

#### `planner.ts` - Wrapper dla Gemini
**Co to robi?**
Wysokopoziomowy wrapper który ułatwia używanie GeminiClient.

**Główne funkcje:**
- `plan()` - planuje następną akcję (używa geminiClient)
- `validatePlannedAction()` - sprawdza czy zaplanowana akcja ma sens
- `requiresConfirmation()` - sprawdza czy akcja wymaga potwierdzenia użytkownika
- `isBlockedDomain()` - sprawdza czy strona jest zablokowana

**Przykład walidacji:**
```typescript
// Jeśli Gemini zwrócił akcję "type" ale bez wartości:
{
  type: "type",
  description: "Type in search box",
  value: undefined  // ← brakuje!
}

// validatePlannedAction() zwróci:
{ valid: false, reason: "Type action requires value" }
```

**Dlaczego osobny wrapper?**
- Czytelniejszy kod (zamiast zawsze używać geminiClient.plan())
- Dodatkowe sprawdzenia bezpieczeństwa
- Łatwiejsza zmiana implementacji później

#### `executor.ts` - Wrapper dla Claude
**Co to robi?**
Wysokopoziomowy wrapper dla AnthropicClient.

**Główne funkcje:**
- `execute()` - wykonuje zaplanowaną akcję (używa anthropicClient)
- `convertToComputerUseAction()` - konwertuje proste akcje bez używania AI
- `validateExecutorResponse()` - sprawdza czy Claude zwrócił poprawną odpowiedź

**Smart optimization: proste akcje bez AI**
Niektóre akcje nie potrzebują vision AI:
```typescript
Akcja: "scroll down"
↓
Bez AI: { action: "key", text: "Page_Down" }  // ← od razu wiadomo co zrobić

Akcja: "refresh page"
↓
Bez AI: { action: "key", text: "F5" }

Ale akcja: "click Login button"
↓
Potrzeba AI: musi znaleźć gdzie jest ten przycisk na screenshocie
```

**Dlaczego to optymalizacja?**
- Oszczędność kosztów API (nie wysyłamy do Claude jeśli nie trzeba)
- Szybciej (nie czekamy na odpowiedź z API)

#### `service-worker.ts` - GŁÓWNY MÓZG
**Co to robi?**
To jest serce całego rozszerzenia. Orkiestrator który wszystkim zarządza.

**Struktura:**

##### 1. **Inicjalizacja**
```typescript
chrome.runtime.onInstalled.addListener(...)
// Gdy rozszerzenie się zainstaluje:
// - Załaduj state manager
// - Załaduj ustawienia domyślne
```

##### 2. **Message Handling**
```typescript
chrome.runtime.onMessage.addListener(...)
// Nasłuchuje wiadomości z popup/content scripts

Typy wiadomości:
- START_TASK: użytkownik kliknął "Start"
- STOP_TASK: użytkownik kliknął "Stop"
- GET_STATUS: popup pyta "jaki jest status?"
- GET_SETTINGS: popup pyta o ustawienia
- UPDATE_SETTINGS: użytkownik zmienił ustawienia
```

##### 3. **Agent Loop - NAJWAŻNIEJSZE!**
```typescript
async function runAgentLoop() {
  while (true) {
    // === KROK 1: POBIERZ KONTEKST ===
    const context = await getCurrentPageContext()
    // - Robi screenshot strony
    // - Wysyła wiadomość do content script: "daj mi listę elementów"
    // - Zbiera wszystko w PageContext object

    // === KROK 2: PLANOWANIE ===
    const plannerResponse = await planner.plan(userRequest, context, history)
    // - Wysyła do Gemini: screenshot + opis strony
    // - Gemini odpowiada: "kliknij w search box"

    // Sprawdź czy zakończone:
    if (plannerResponse.status === 'done') {
      break; // KONIEC!
    }

    // === KROK 3: WYKONANIE ===
    const action = await executeAction(plannedAction, context)
    // - Jeśli prosta akcja → od razu wykonaj
    // - Jeśli złożona → zapytaj Claude o koordynaty
    // - Wyślij do content script: "wykonaj akcję X"

    // === KROK 4: ZAPISZ ===
    await stateManager.recordAction(plannedAction, action, success)

    // === KROK 5: POCZEKAJ ===
    await waitForPageStable(1000) // Czekaj aż strona się ustabilizuje

    // === KROK 6: POWTÓRZ ===
  }
}
```

**Przykład przepływu:**
```
Użytkownik: "Search Google for AI tools"

Iteracja 1:
  Screenshot: google.com (główna strona)
  Planner: "Kliknij search box"
  Executor: Znajdź współrzędne search box → [450, 320]
  Perform: Kliknij w [450, 320]
  Wait: 1 sekunda

Iteracja 2:
  Screenshot: google.com (search box aktywny, kursor w środku)
  Planner: "Wpisz 'AI tools'"
  Executor: Prosta akcja → type "AI tools"
  Perform: Wpisz tekst
  Wait: 1 sekunda

Iteracja 3:
  Screenshot: google.com (tekst wpisany, sugestie widoczne)
  Planner: "Kliknij przycisk Search"
  Executor: Znajdź przycisk Search → [530, 450]
  Perform: Kliknij
  Wait: 2 sekundy (czekaj na ładowanie)

Iteracja 4:
  Screenshot: google.com/search?q=AI+tools (wyniki wyszukiwania)
  Planner: "Zadanie ukończone - wyniki się wyświetliły"
  Status: done
  KONIEC
```

##### 4. **Helper Functions**

**`getCurrentPageContext()`**
```typescript
// 1. Znajdź aktywną kartę
const tab = await chrome.tabs.query({ active: true })

// 2. Zrób screenshot
const screenshot = await captureScreenshot(tab.id)

// 3. Wyślij wiadomość do content script
const domData = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTEXT' })

// 4. Złóż wszystko w PageContext
return { url: tab.url, screenshot, domSnapshot: domData, ... }
```

**`executeAction()`**
```typescript
// 1. Sprawdź czy prosta akcja
const simple = executor.convertToComputerUseAction(plannedAction)
if (simple) {
  // Od razu wyślij do content script
  return performActionInTab(simple)
}

// 2. Złożona akcja - pytaj Claude
const response = await executor.execute(plannedAction, screenshot, viewport)

// 3. Wyślij do content script
await performActionInTab(response.toolUse.input)
```

**`performActionInTab()`**
```typescript
// Wyślij wiadomość do content script na aktywnej karcie
await chrome.tabs.sendMessage(tabId, {
  type: 'PERFORM_ACTION',
  action: { action: 'mouse_move', coordinate: [450, 320] }
})
```

##### 5. **Broadcasting - Komunikacja z UI**
```typescript
// Wysyła updates do popup UI

broadcastStatusUpdate('executing', session)
// → Popup dostaje: "Status zmienił się na 'executing'"

broadcastProgressUpdate(3, "Clicking search button")
// → Popup dostaje: "Krok 3: Clicking search button"

broadcastTaskComplete("Search completed successfully")
// → Popup dostaje: "Zadanie ukończone!"

broadcastTaskError("Failed to find element")
// → Popup dostaje: "Błąd: Failed to find element"
```

##### 6. **Error Handling & Retry**
```typescript
let retryCount = 0

try {
  await executeAction(...)
} catch (error) {
  retryCount++

  if (retryCount >= MAX_RETRY_ATTEMPTS) {
    throw new Error('Failed after 3 attempts')
  }

  // Spróbuj ponownie w następnej iteracji
  continue
}
```

---

## 🔄 Pełny Przepływ Danych - Krok Po Kroku

### Scenariusz: Użytkownik pisze "Open YouTube and search for coding tutorials"

#### **Krok 1: Użytkownik klika "Start" w popup**
```
Popup UI
  ↓ wysyła wiadomość
{ type: 'START_TASK', userRequest: "Open YouTube and search for coding tutorials" }
  ↓ otrzymuje
Service Worker (handleStartTask)
```

#### **Krok 2: Service Worker tworzy sesję**
```typescript
stateManager.createSession("Open YouTube and search for coding tutorials")
↓ tworzy
{
  id: "session_123",
  userRequest: "Open YouTube...",
  status: "planning",
  actions: []
}
↓ zapisuje do
chrome.storage.local
```

#### **Krok 3: Uruchamia Agent Loop**
```typescript
runAgentLoop("session_123") // Nie czeka na zakończenie, działa asynchronicznie
```

#### **Krok 4: Agent Loop - Iteracja 1**

**4.1 Pobierz kontekst**
```typescript
Service Worker
  ↓ wywołuje
chrome.tabs.captureVisibleTab()
  ↓ zwraca
Screenshot (base64)

Service Worker
  ↓ wysyła do
Content Script: { type: 'GET_CONTEXT' }
  ↓ Content Script analizuje DOM
  ↓ zwraca
{
  domSnapshot: {
    interactiveElements: [
      { tagName: 'INPUT', text: '', selector: '#search', bounds: {...} },
      { tagName: 'BUTTON', text: 'Login', selector: '.login-btn', bounds: {...} }
    ],
    forms: [...],
    links: [...]
  },
  viewport: { width: 1920, height: 1080 }
}

Service Worker
  ↓ składa w
PageContext = {
  url: "https://google.com",
  screenshot: "data:image/jpeg;base64,...",
  domSnapshot: {...},
  viewport: {...}
}
```

**4.2 Planowanie**
```typescript
Service Worker
  ↓ wywołuje
planner.plan(userRequest, context, [])
  ↓ wywołuje
geminiClient.plan()
  ↓ buduje wiadomość
{
  role: "system",
  content: PLANNER_SYSTEM_PROMPT  // Instrukcje dla Gemini
}
{
  role: "user",
  content: [
    { type: "text", text: "User Request: Open YouTube...\nCurrent Page: google.com\n..." },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } }
  ]
}
  ↓ wysyła do
OpenRouter API → Gemini 3 Pro
  ↓ Gemini analizuje
  "User wants YouTube. Currently on Google. First: navigate to youtube.com"
  ↓ zwraca JSON
{
  thinking: "User wants to open YouTube. We're on Google. I need to navigate to youtube.com first.",
  nextAction: {
    type: "navigate",
    description: "Navigate to YouTube",
    value: "https://youtube.com",
    waitAfter: 2000
  },
  expectedOutcome: "YouTube homepage should load",
  status: "continue",
  confidenceScore: 0.98
}
  ↓ planner.plan() zwraca do
Service Worker
```

**4.3 Walidacja**
```typescript
planner.validatePlannedAction(response)
↓ sprawdza
- Czy status !== 'error'?  ✓
- Czy nextAction istnieje?  ✓
- Czy nextAction ma type i description?  ✓
- Czy navigate ma value (URL)?  ✓
↓ zwraca
{ valid: true }
```

**4.4 Wykonanie**
```typescript
Service Worker
  ↓ wywołuje
executeAction(plannedAction, context)
  ↓ sprawdza
executor.convertToComputerUseAction(plannedAction)
  ↓ navigate nie jest prostą akcją
  ↓ zwraca null

  ↓ wywołuje Claude
executor.execute(plannedAction, screenshot, viewport)
  ↓ wysyła do
OpenRouter API → Claude Sonnet 4.5
  ↓ ale czekaj... navigate nie wymaga vision!

Faktycznie, dla navigate możemy:
  ↓ bezpośrednio
chrome.tabs.update(tabId, { url: "https://youtube.com" })
```

**4.5 Zapisz akcję**
```typescript
stateManager.recordAction(
  plannedAction: { type: "navigate", ... },
  executedAction: undefined,  // navigate nie używa Computer Use
  beforeScreenshot: "data:image/...",
  afterScreenshot: undefined,  // Nie mamy jeszcze - strona się ładuje
  success: true,
  duration: 245
)
↓ dodaje do session.actions[]
↓ zapisuje do chrome.storage.local
```

**4.6 Czekaj**
```typescript
await waitForPageStable(2000)  // Czekaj 2 sekundy na załadowanie YouTube
```

#### **Krok 5: Agent Loop - Iteracja 2**

**5.1 Pobierz kontekst (YouTube homepage)**
```typescript
getCurrentPageContext()
↓ screenshot YouTube homepage
↓ DOM: search box, kategorie, logo
PageContext = {
  url: "https://youtube.com",
  screenshot: "...",
  domSnapshot: { ... }
}
```

**5.2 Planowanie**
```typescript
Gemini dostaje:
- Screenshot YouTube
- User request: "Open YouTube and search for coding tutorials"
- Action history: [navigate to YouTube ✓]

Gemini myśli:
"YouTube is open. Now I need to search. I see a search box at the top."

Zwraca:
{
  thinking: "YouTube loaded successfully. Now need to click search box and type 'coding tutorials'.",
  nextAction: {
    type: "click",
    description: "Click the search box at the top",
    target: {
      description: "Search box",
      hint: "White input field with 'Search' placeholder at the top center"
    },
    waitAfter: 500
  },
  status: "continue",
  confidenceScore: 0.92
}
```

**5.3 Wykonanie (z Claude Vision)**
```typescript
executor.execute(plannedAction, screenshot, viewport)
↓ wysyła do Claude
{
  Planned Action: "Click the search box"
  Target: "White input field at top center"
  Screenshot: [YouTube homepage image]
}

Claude analizuje screenshot:
"I can see the search box in the top-center area. Based on the layout, it's approximately at x=640, y=80"

Zwraca:
{
  toolUse: {
    type: "tool_use",
    name: "computer",
    input: { action: "mouse_move", coordinate: [640, 80] }
  }
}

Service Worker wysyła do Content Script:
{
  type: 'PERFORM_ACTION',
  action: { action: 'mouse_move', coordinate: [640, 80] }
}

Content Script wykonuje:
document.elementFromPoint(640, 80).click()
```

**5.4 Dalej w pętli...**
```
Iteracja 3: Type "coding tutorials"
Iteracja 4: Click search button / Press Enter
Iteracja 5: Verify results loaded
  ↓ Gemini widzi wyniki wyszukiwania
  ↓ Status: "done"
  ↓ KONIEC
```

---

## 📡 Komunikacja Między Komponentami

### Message Types (Typy Wiadomości)

#### **BackgroundMessage** - Od UI do Service Worker
```typescript
{ type: 'START_TASK', userRequest: "..." }
{ type: 'STOP_TASK' }
{ type: 'GET_STATUS' }
{ type: 'GET_SETTINGS' }
{ type: 'UPDATE_SETTINGS', settings: {...} }
```

#### **ContentMessage** - Od Service Worker do Content Script
```typescript
{ type: 'GET_CONTEXT' }
  → Content Script zwraca: { domSnapshot, viewport }

{ type: 'PERFORM_ACTION', action: { action: 'mouse_move', coordinate: [x, y] } }
  → Content Script wykonuje i zwraca: { success: true }

{ type: 'TAKE_SCREENSHOT' }
  → Alternatywny sposób robienia screenshotów
```

#### **UIMessage** - Od Service Worker do Popup
```typescript
{ type: 'STATUS_UPDATE', status: 'executing', session: {...} }
{ type: 'PROGRESS_UPDATE', step: 3, description: "Clicking button" }
{ type: 'TASK_COMPLETE', summary: "Successfully found results" }
{ type: 'TASK_ERROR', error: "Element not found" }
{ type: 'CLARIFICATION_NEEDED', question: "Which button should I click?" }
{ type: 'ACTION_EXECUTED', action: {...} }
```

---

## 🛡️ Bezpieczeństwo

### Zablokowane Domeny
```typescript
BLOCKED_DOMAIN_PATTERNS = [
  'bank', 'banking', 'paypal', 'venmo',
  'crypto', 'blockchain',
  '.gov', 'irs.',
  'medical', 'healthcare', 'hospital'
]

// Przed wykonaniem akcji:
if (url.includes('bank')) {
  throw new Error('Domain blocked for safety')
}
```

### Akcje Wymagające Potwierdzenia
```typescript
SENSITIVE_ACTIONS = ['navigate']

// Jeśli Gemini chce nawigować:
if (requiresConfirmation(action)) {
  // TODO: Pokazuj modal "Czy na pewno chcesz przejść do X?"
  // Na razie tylko logujemy
}
```

### Limity
```typescript
maxActionsPerTask: 50  // Max 50 akcji na zadanie (żeby nie zapętlić)

if (session.actions.length >= 50) {
  endSession()
  throw new Error('Action limit reached')
}
```

---

## 💾 Przechowywanie Danych

### Chrome Storage Structure
```typescript
chrome.storage.local = {
  // Ustawienia użytkownika
  'agent_settings': {
    openRouterApiKey: "sk-or-v1-...",
    maxActionsPerTask: 50,
    actionDelayMs: 1000,
    screenshotQuality: 'adaptive',
    requireConfirmationFor: ['navigate'],
    blockedDomains: ['bank', 'paypal', ...],
    showThinkingProcess: true,
    debugMode: true
  },

  // Aktualna sesja
  'agent_session': {
    id: "session_123",
    startedAt: "2026-01-03T10:30:00Z",
    userRequest: "Search Google for AI tools",
    status: "executing",
    actions: [
      {
        id: "action_001",
        timestamp: "2026-01-03T10:30:01Z",
        plannedAction: { type: "click", description: "..." },
        executedAction: { action: "mouse_move", coordinate: [450, 320] },
        beforeScreenshot: "data:image/...",
        afterScreenshot: "data:image/...",
        success: true,
        duration: 1234
      }
    ],
    currentContext: {
      url: "https://google.com",
      title: "Google",
      screenshot: "data:image/...",
      domSnapshot: { ... },
      viewport: { width: 1920, height: 1080 },
      timestamp: "2026-01-03T10:30:05Z"
    }
  },

  // Historia akcji (ostatnie 100)
  'action_history': [
    { ... },
    { ... }
  ]
}
```

---

## 🔍 Debugging

### Debug Logs
```typescript
// Wszystkie logi mają prefix
debugLog('ServiceWorker', 'Starting task', { userRequest })
// Output: [GCA] [ServiceWorker] Starting task { userRequest: "..." }

debugError('Planner', 'Planning failed', error)
// Output: [GCA] [Planner] Planning failed Error: ...
```

### Włączanie/wyłączanie
```typescript
// W constants.ts
export const DEBUG = true  // Zmień na false żeby wyłączyć logi
```

---

## 💰 Koszty API

### OpenRouter Pricing (orientacyjnie)
- **Gemini 3 Pro**: ~$2.50 / 1M input tokens, ~$10 / 1M output tokens
- **Claude Sonnet 4.5**: ~$3 / 1M input tokens, ~$15 / 1M output tokens

### Średni koszt na akcję
```
Jedna iteracja:
- Screenshot: ~5KB compressed → w base64 ~7KB
- DOM text: ~2KB
- Total input: ~10KB tekstu + obrazek

Token count (szacunkowo):
- Tekst: ~2500 tokens
- Obrazek: ~1000 tokens
- Total: ~3500 input tokens

Koszt jednej iteracji:
- Gemini (planning): 3500 tokens × $2.50/1M = $0.00875
- Claude (execution): 3500 tokens × $3/1M = $0.0105
- Total: ~$0.02 per action

Zadanie z 5 akcjami: ~$0.10
```

---

## 🎓 Najważniejsze Koncepty

### 1. **Agent Loop**
To jest pętla która się powtarza:
```
LOOP:
  1. Zobacz co jest na stronie (screenshot + DOM)
  2. Zapytaj Gemini: "co dalej?"
  3. Zapytaj Claude: "gdzie kliknąć?"
  4. Wykonaj akcję
  5. Poczekaj
  6. Powtórz lub zakończ
```

### 2. **Separation of Concerns (Podział Odpowiedzialności)**
- **Gemini (Planner)**: Strategia - "CO zrobić i DLACZEGO"
- **Claude (Executor)**: Taktyka - "GDZIE dokładnie (piksele) i JAK"
- **Content Script**: Wykonanie - faktyczne klikanie/pisanie

### 3. **Computer Use**
To specjalna funkcja Claude która pozwala mu:
- Analizować screenshoty
- Zwracać precyzyjne koordynaty (x, y)
- Symulować mysz i klawiaturę

### 4. **State Management**
Wszystko co agent robi jest zapisywane:
- Każda akcja
- Każdy screenshot
- Każdy status

Dzięki temu możemy:
- Pokazać progress użytkownikowi
- Debugować co poszło nie tak
- Wznowić zadanie po restarcie

### 5. **Message Passing**
Chrome Extensions składają się z oddzielnych części:
- Service Worker (background)
- Content Script (na stronie)
- Popup UI (interface)

Komunikują się przez wiadomości:
```typescript
chrome.runtime.sendMessage({ type: 'START_TASK' })
chrome.tabs.sendMessage(tabId, { type: 'PERFORM_ACTION' })
```

---

## 📚 Co Dalej?

To co zostało zaimplementowane to **backend** - logika, AI, zarządzanie stanem.

**Co jeszcze potrzebujemy?**
1. **Content Scripts** - kod który działa na stronie i faktycznie klika/pisze
2. **Popup UI** - interfejs użytkownika (React)
3. **DOM Analyzer** - inteligentna analiza strony
4. **Action Performer** - wykonywanie akcji

**Postęp:**
- ✅ API Clients (Gemini + Claude)
- ✅ Background Service Worker (orchestrator)
- ✅ State Management
- ⏳ Content Scripts (0%)
- ⏳ UI (0%)

---

**Dokument będzie aktualizowany wraz z postępem implementacji.**
