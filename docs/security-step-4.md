# Bezpečnostní audit — bod 4

Datum: 17. 11. 2026. Výchozí větev `foundry-agent-experiment`, commit `6407f07`.
Pracovní strom byl před úpravami čistý. Commit, push ani nasazení nejsou součástí provedené práce.

## Mapa toku dat a původní nálezy

`FACT` označuje závěr doložený lokálním zdrojovým kódem nebo syntetickým testem;
`UNKNOWN` skutečnost, kterou bez cloudového ověření nelze potvrdit.

| Vrstva | Tok a původní problém — FACT | Provedená změna |
| --- | --- | --- |
| Frontend | API seznam → React state → seznam/detail s kontakty a OCR. Konzole vypisovala celé záznamy a odpovědi AI; chybové zprávy přebíraly `error.message`. Otázka byla v URL. | Odstraněny datové a chybové výpisy, pevné uživatelské chyby, otázka přes POST, limit 500 znaků. Zobrazení kontaktů a OCR zachováno. |
| API seznam/detail | SQL → plné záznamy → lokální uživatel. Výjimky SQL šly celé do konzole. | Zachovaný obsah pro UI, pevné události při chybách, číselná validace ID, `Cache-Control: no-store`. |
| API Search/RAG | Search → kontakty/metadata/OCR → kontext. Search logoval dotaz. Preview obsahoval e-mail a telefon; RAG posílal jméno souboru a první část nesanitizovaného OCR. | POST, společný allowlist a redakce, jednotný kontext preview/answer, žádné dotazy ani SDK výjimky v aplikačních logách. |
| Agent jednorázový/chat | Plné odpovědi Search/detail API → JSON tool result → model. Jednorázový agent vypisoval argumenty nástrojů; chat posílal i `error.message` a argumenty v chybovém výsledku. Historie chatu rostla bez limitu. | Společné jádro, validace argumentů, projekce každého tool výsledku, obecné chyby, omezená historie, limity kroků/volání/kontextu, cache opakovaných volání. |
| Blob Function | Blob → celý dokument do Azure AI Vision → OCR do SQL → do fronty pouze číselné ID. Nezachycená SDK výjimka mohla obsahovat tělo odpovědi nebo URL. | Bez změny datového účelu; bezpečná hranice výjimek bez původní zprávy/inner exception, vypnuté HTTP logování QueueClientu. |
| Queue Function | ID → OCR ze SQL → extrakce jména/e-mailu/telefonu → SQL. Log obsahoval jméno a oba kontakty; chybná zpráva fronty se vypisovala celá. | Úspěch obsahuje jen pevný event a počet upravených řádků; neplatné ID pevný event; bezpečná hranice výjimek. |
| Diagnostika | SDK debug, Express default error/404 handling a Functions host tvoří další výstupní cesty. | Runtime vypíná `DEBUG`, `AZURE_LOG_LEVEL`, `OPENAI_LOG`, OpenAI má explicitní `logLevel: off`. Vlastní JSON chyby a 404 bez URL/stacku. Lokální rate limit bez diagnostiky hodnot hlaviček. Host/worker omezují SDK logy, dependency tracking a Live Metrics. |

Zdroje: `ocr-frontend/src/App.jsx`, `ocr-api/app.js`, `model-data.js`, `agent.js`,
`agent-runtime.js`, `runtime-privacy.js`, `server.js`, obě CLI entry pointy,
`Function1.cs`, `ProcessCandidateData.cs`, `SafeExecution.cs`, `Program.cs`, `host.json`.
SQL identita a přihlašovací mechanismus nebyly změněny.

## Modelová hranice — FACT

- Kandidát pro model má pouze `id`, `full_name` (do 120 znaků) a `profile`.
- E-mail, telefon, název souboru, datum vytvoření, stav, skóre a neznámá pole
  nejsou součástí modelového objektu. Search lokálně načítá e-mail a telefon
  pro odstranění jejich přesných hodnot z OCR; tyto hodnoty nepředává modelu.
- Redakce probíhá před zkrácením: známé kontakty, rozpoznané e-maily,
  některé OCR varianty, telefonní řetězce, webové odkazy a označené osobní řádky.
  Stejná redakce se aplikuje na otázku, argumenty hledání a textovou odpověď modelu.
- RAG: nejvýše 3 kandidáti, profil do 1 800 znaků. Agentní hledání: nejvýše
  5 kandidátů po 1 800 znacích. Detail: jeden vyžádaný kandidát do 4 000 znaků.
- Agent: nejvýše 8 modelových kroků, 5 volání nástrojů v jednom kroku,
  10 za tah a 32 000 znaků serializovaných zpráv před dalším odesláním modelu.
  JSON výsledků se nikdy neřeže uprostřed serializace.
- Mezi tahy chatu zůstávají nejvýše 2 dokončené otázky a odpovědi (odpověď do
  6 000 znaků), bez výsledků nástrojů. Selhaný tah nezanechá rozpracovaný protokol.
  `reset` a ukončení chatu zahazují kontext aplikace.
- Kontakty se neposílají záměrně ani při explicitním požadavku na kontakt;
  uživatelka je má v lokálním detailu. Původní OCR a kontakty zůstávají v SQL,
  Search a v odpovědích seznam/detail pro UI podle dosavadního účelu aplikace.

## API kompatibilita

| Aktuální endpoint | Vstup/výstup |
| --- | --- |
| `GET /candidates` | Původní pole pro UI, včetně kontaktů a OCR. |
| `GET /candidates/:id` | Původní detail, validní kladné SQL integer ID. |
| `POST /candidates/search` | JSON `{ "query": "motorová pila" }`, nejvýše 5 omezených profilů. |
| `POST /candidates/rag` | JSON `{ "question": "Porovnej zkušenosti s těžbou" }`, omezené profily a přesné `messages`. |
| `POST /candidates/rag-answer` | Stejný vstup; odpověď a seznam ID/jmen, bez vracení dotazu. |

Staré GET cesty s textem v URL jsou odstraněny; nevracejí ani neprovádějí starý
workflow. Vlastní klienty je potřeba přepnout na POST. Frontend a oba agenti jsou
upravené společně. Search již neslouží k vracení plného kontaktového záznamu.
Preview už nevrací `prompt_for_model`, ale `messages`, které používá i answer.

## Provedené kontroly — FACT

1. `node --test ocr-api/test/*.test.js`: **51/51 úspěšných testů**.
   Původní testy lokálního přístupu a Entra zůstaly; nové testy kontrolují
   syntetické kontakty, OCR, metadata a neznámá pole, profesní fakta, limity,
   preview vs. skutečný payload, API chyby/404/neplatný JSON/velké tělo,
   rate limit, agentní výsledky i chyby, historii a SDK debug výstupy.
   Express běží v paměti bez naslouchajícího socketu. SQL, Search, model a fetch
   jsou nahrazeny testovacími objekty; OpenAI SDK test má vlastní fake fetch.
2. `npm run lint` ve frontendu: úspěch.
3. Produkční frontend build: úspěch s Vite `envDir` nastaveným na prázdný
   dočasný adresář; výstup také v dočasném adresáři. `.env` se nenačítalo.
4. `tests/PrivacyChecks`: offline C# kontrola skutečné `SafeExecution` ověřila
   úspěch, synchronní a asynchronní výjimku i zrušenou úlohu. Selhání není
   spolknuto; výjimka předávaná hostiteli nemá původní text, Data ani inner error.
5. Functions se úspěšně sestavily v izolované kopii pouze zdrojů, projektu a
   `host.json`, bez `local.settings.json`. NuGet zdroje byly prázdné, použila se
   lokální cache. Floating verze `2.*`/`6.*` se offline nejprve nevyřešily;
   pouze dočasná kopie projektu proto použila přesné verze z existujícího
   `obj/project.assets.json`: Worker 2.52.0, Worker.Sdk 2.1.0, Storage.Blobs 6.8.2,
   Http.AspNetCore 2.1.1. Výsledný build: 0 chyb, 6 nullable upozornění
   CS8600/CS8605 v původních konfiguračních/SQL částech. Repozitářové verze balíčků
   nebyly změněny. Functions host se nespouštěl.
6. Instalované přímé Node závislosti odpovídají lockfilům. Nic se neinstalovalo
   a neprováděl se síťový vulnerability audit. Kontrola syntaxe a `git diff --check`
   prošly. Závěrečné hledání logovacích míst potvrdilo odstranění původních dumpů.

Samostatná C# kontrola jde zopakovat z kořene projektu:

```sh
dotnet restore tests/PrivacyChecks/PrivacyChecks.csproj --configfile tests/PrivacyChecks/NuGet.Config -p:NuGetAudit=false
dotnet build tests/PrivacyChecks/PrivacyChecks.csproj --no-restore -p:UseSharedCompilation=false -nodeReuse:false
dotnet tests/PrivacyChecks/bin/Debug/net10.0/PrivacyChecks.dll
```

Nevykonávaly se produkční entry pointy API/agentů, přihlášení, skutečné dotazy do
SQL, Search ani modelu, OCR volání, uploady nebo browser. Obsah `.env`,
`local.settings.json`, tokenů ani přihlašovacích profilů se nečetl. Vznikly jen
zdrojové změny, syntetické testy a lokální build artefakty. Historické logy se nemazaly.

## Zbývající omezení a ověření po dohodě

- **FACT:** Jde o minimalizaci, ne anonymizaci. Model stále dostává jména, ID
  a omezené výňatky OCR. Heuristiky nezaručují rozpoznání všech adres, osobních údajů,
  kontaktů zapsaných slovy, neobvyklých OCR chyb či úmyslného kódování. Mohou také
  odstranit část užitečné informace na řádku s kontaktem. Zkrácení může vynechat
  relevantní zkušenost. Přísnější hranice by vyžadovala schválené strukturované
  profesní profily místo volného OCR.
- **FACT:** Celý dokument musí nadále dostat Azure AI Vision pro samotné OCR.
  Tato služba není nahrazena ani omezena na výňatky.
- **FACT:** UI data jsou dostupná v paměti a síťovém panelu browseru. `no-store`
  neodstraňuje dříve uložená data. CLI odpověď je záměrný výstup pro uživatelku;
  přesměrování stdout, záznam terminálu či shell historie mohou uchovat osobní
  údaje. Do argumentů CLI nezadávat kontakty; profesní dotazy lze psát v chatu.
- **FACT:** Bezpečné aplikační chyby mají méně diagnostického detailu. Chybové
  události a počty zůstaly. Vypnutí dependency tracking omezuje korelaci závislostí.
- **UNKNOWN:** Skutečné logy Azure, app-setting přepisy `host.json`, binding chyby
  vzniklé před vstupem do funkce, startup/host chyby, údaje o názvech blobů,
  infrastruktura/proxy, provider retention a serverová diagnostika modelu nejsou
  ověřené. SDK debug zákaz neřídí serverové ukládání. Názvy uploadů by neměly
  obsahovat kontakty. Nepřidávat tracing těl požadavků ani `NODE_DEBUG`/instrumentaci
  mimo tuto aplikační hranici.
- **UNKNOWN:** Kvalita skutečných RAG/agentních odpovědí a cloudový end-to-end provoz
  se bez externích služeb nepotvrzují. Lokální zdrojové opravy se v cloudu projeví
  až nasazením; v lokální aplikaci po restartu.
- Staré logy mohou stále obsahovat data z předchozí verze. Jejich retence,
  prohlédnutí nebo cílené odstranění jsou samostatný krok, nikoli výsledek této změny.

Po předchozí dohodě lze nasadit Functions a použít jeden čistě syntetický dokument
s unikátními kontaktovými značkami: ověřit OCR → SQL → queue → Search → UI/RAG/agent,
zkontrolovat nové běžné i chybové logy a modelový payload a potvrdit, že se značky
neobjevily v diagnostice. Rozsah uploadu, cloudové zápisy, logy a úklid je nutné
domluvit předem. Tento krok zatím nebyl proveden.

## Ruční commit a push

Z kořene projektu po kontrole změn:

```sh
git status --short
git diff --check
git diff
git add -- .gitignore README.md docs/security-step-4.md \
  ocr-api/app.js ocr-api/model-data.js ocr-api/runtime-privacy.js \
  ocr-api/agent.js ocr-api/agent-runtime.js ocr-api/server.js \
  ocr-api/local-agent.js ocr-api/local-agent-chat.js ocr-api/test/privacy.test.js \
  ocr-frontend/src/App.jsx \
  msdocs-storage-bind-function-service-main/dotnet/ProcessImage/Function1.cs \
  msdocs-storage-bind-function-service-main/dotnet/ProcessImage/ProcessCandidateData.cs \
  msdocs-storage-bind-function-service-main/dotnet/ProcessImage/SafeExecution.cs \
  msdocs-storage-bind-function-service-main/dotnet/ProcessImage/Program.cs \
  msdocs-storage-bind-function-service-main/dotnet/ProcessImage/host.json \
  tests/PrivacyChecks/PrivacyChecks.csproj tests/PrivacyChecks/Program.cs tests/PrivacyChecks/NuGet.Config
git diff --cached --stat
git diff --cached
git commit -m "Minimize model data and remove sensitive diagnostic logs"
git push origin foundry-agent-experiment
```

Před commitem zkontrolovat i nové soubory v staged diffu. Žádný příkaz výše
nenasazuje aplikaci do Azure.
