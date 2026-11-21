# Bezpečnostní audit — bod 4

Datum: 17. 11. 2026. Výchozí větev `foundry-agent-experiment`, commit `6407f07`.
Pracovní strom byl před úpravami čistý. Aktualizováno 21. 11. 2026:
implementace je v commitu `8473c7e`; uživatelka potvrdila ruční push a nasazení.
Implementace a dohodnutá provozní zkouška jsou dokončené v níže vymezeném rozsahu.
Zbývající omezení nejsou tímto prohlášením odstraněna.

## Mapa toku dat a původní nálezy

`FACT` označuje závěr doložený lokálním zdrojovým kódem nebo syntetickým testem;
`REPORTED` výsledek doložený výpisem nebo potvrzením uživatelky v konverzaci;
`UNKNOWN` skutečnost, kterou provedené kontroly nepotvrzují.

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

## Lokální kontroly provedené asistentem — FACT

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

Při původní lokální implementaci asistent nevykonával produkční entry pointy
API/agentů, přihlášení, skutečné dotazy do SQL, Search ani modelu, OCR volání,
uploady nebo browser. Pozdější živé testy spouštěla uživatelka podle domluveného
postupu; jejich důkazy jsou uvedené samostatně níže. Obsah `.env`,
`local.settings.json`, tokenů ani přihlašovacích profilů se nečetl. Vznikly jen
zdrojové změny, syntetické testy a lokální build artefakty. Historické logy se nemazaly.

## Provozní ověření 21. 11. 2026 — REPORTED

Uživatelka výslovně potvrdila, že všechny životopisy v projektu jsou syntetické.
Živé kroky spouštěla sama; asistent nečetl autentizační profily, nepřebíral
přihlašovací údaje a neovládal přihlášený browser.

- Nasazení `nordic-lumberjack-functions` skončilo podle poskytnutého terminálového
  výpisu úspěšně, bez build chyb (6 upozornění). Po synchronizaci byly registrované
  `ProcessImageUpload` jako blob trigger a `ProcessCandidateData` jako queue trigger.
- Po restartu lokální aplikace bylo čtení SQL zablokované firewallem pro klientskou
  IP. Uživatelka po pokynu k přidání úzkého IP pravidla potvrdila, že se kandidáti
  načítají. Skutečná uložená firewallová pravidla nebyla asistentem zkontrolována.
- Nový syntetický upload je ve frontendu jako kandidát **31**, včetně OCR textu.
  Po zpracování má stav `CONTACT_PARTIAL`: telefon je v OCR na samostatném řádku
  bez popisku, ale nebyl extrahován do pole `phone`. Zdrojový extraktor vyžaduje
  popisek; jeho pravidlo se při této opravě neměnilo.
- `ProcessImageUpload`: v portálu úspěšné volání **21. 11. 2026 22:43:01**,
  po rozkliknutí bez zobrazených zpráv.
- `ProcessCandidateData`: v portálu úspěšné volání **21. 11. 2026 22:43:17**,
  poskytnutá aplikační zpráva pouze `candidate_updated RowsAffected=1`.
  Časy jsou převzaté z výpisu portálu. V těchto prohlédnutých detailech se
  nezobrazovaly kontakty ani OCR; nejde o kontrolu všech cloudových logů.
- RAG ve frontendu úspěšně vrátil porovnání a doporučení pro 3 syntetické kandidáty
  (ID 1, 23 a 16). Poskytnutá odpověď neobsahovala e-maily ani telefonní čísla.
- Jednorázový agent vrátil profesní shrnutí kandidáta **31**, bez kontaktů,
  celého OCR a ladicích bloků v poskytnutém výstupu.
- Uživatelka potvrdila také chatový test: navazující otázka zůstala u kandidáta
  **31**, bez kontaktů a ladicích výpisů; postup zahrnoval ukončení pomocí `exit`.
- V agentní odpovědi se místo jména objevil nadpis `KDO JSEM`. Původ této chyby
  nebyl ověřen proti databázovému poli jména; evidujeme ji jako samostatný problém
  kvality extrakce či odpovědi. Neprohlašujeme profesní tvrzení modelu za ověřená.

Dodatečná kontrola asistenta — **FACT**: skutečná lokální projekce pro RAG,
agentní hledání a detail prošla syntetickým případem `phone: null` s neoznačeným
telefonem přímo v OCR. Ve všech třech kontextech byl telefon odstraněn a profesní
text zachován. Kontrola nevolala žádnou externí službu a neměnila zdrojový kód.

Provozní zkouška potvrzuje funkčnost úspěšných průchodů a uvedené výstupy.
Samotná odpověď bez kontaktů nedokazuje jejich nepřítomnost ve vstupu modelu:
modelové payloady byly kontrolovány lokálními testy a revizí kódu, nikoli zachycením
živých požadavků. Cloudové chybové větve nebyly záměrně vyvolávané; pokrývají je
lokální syntetické testy.

## Zbývající omezení

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
- **UNKNOWN:** Úplnost logů Azure mimo výše prohlédnuté běhy, app-setting přepisy `host.json`, binding chyby
  vzniklé před vstupem do funkce, startup/host chyby, údaje o názvech blobů,
  infrastruktura/proxy, provider retention a serverová diagnostika modelu nejsou
  ověřené. SDK debug zákaz neřídí serverové ukládání. Názvy uploadů by neměly
  obsahovat kontakty. Nepřidávat tracing těl požadavků ani `NODE_DEBUG`/instrumentaci
  mimo tuto aplikační hranici.
- **UNKNOWN:** Věcná správnost profesních tvrzení modelu, úplnost redakce na všech
  možných OCR vstupech a přesný živý payload nejsou potvrzené. Nebylo samostatně
  ověřeno, že nový kandidát 31 už prošel indexací do Search: živý RAG našel jiné
  syntetické kandidáty, zatímco agentní detail 31 čte SQL.
- Staré logy mohou stále obsahovat data z předchozí verze. Jejich retence,
  prohlédnutí nebo cílené odstranění jsou samostatný krok, nikoli výsledek této změny.

Pro původní bod 4 není nutné rozšiřovat extrakci neoznačených telefonů ani opravit
rozpoznávání jmen. Tyto otázky kvality dat zůstávají samostatně evidované. Případné
cloudové testy chyb, kontrola dalších zdrojů telemetrie, nastavení retence nebo
úklid uložených dat vyžadují další dohodu o konkrétním rozsahu.

## Ruční commit a push aktualizace záznamu

Implementační commit `8473c7e` již uživatelka vytvořila a potvrdila jeho push.
Po aktualizaci tohoto dokumentu zbývá uložit pouze záznam provozního ověření:

```sh
git diff --check
git diff -- docs/security-step-4.md
git add -- docs/security-step-4.md
git diff --cached --stat
git commit -m "Document step 4 deployment and synthetic live checks"
git push origin foundry-agent-experiment
```

Asistent tuto aktualizaci necommitoval ani nepushoval. Dokumentační změna
nevyžaduje nové nasazení aplikace.
