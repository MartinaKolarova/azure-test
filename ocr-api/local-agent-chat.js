require('dotenv').config();

const OpenAI = require('openai');

const modelClient = new OpenAI({
  baseURL: process.env.AZURE_MODEL_BASE_URL,
  apiKey: process.env.AZURE_MODEL_API_KEY,
});

const apiBaseUrl = process.env.LOCAL_API_BASE_URL || 'http://localhost:3000';

async function searchCandidates(query) {
  const response = await fetch(
    `${apiBaseUrl}/candidates/search/${encodeURIComponent(query)}`,
  );

  if (!response.ok) {
    throw new Error(`Search API error: ${response.status}`);
  }

  return response.json();
}

async function getCandidateDetail(id) {
  const response = await fetch(`${apiBaseUrl}/candidates/${id}`);

  if (!response.ok) {
    throw new Error(`Candidate detail API error: ${response.status}`);
  }

  return response.json();
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'search_candidates',
      description:
        'Search non-duplicate candidate CV records by a text query. Use this first when the user asks to find or compare candidates.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query in Czech or English.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_candidate_detail',
      description:
        'Get full candidate detail by candidate ID, including OCR text and all available candidate fields. Use this whenever the user asks for a detailed profile, detailed comparison, or asks to get details of selected candidates.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: 'Candidate ID.',
          },
        },
        required: ['id'],
      },
    },
  },
];

async function runAgent(userQuestion) {
  const messages = [
    {
      role: 'system',
      content:
        'Jsi read-only recruitment assistant. Pracuješ pouze s daty získanými přes dostupné nástroje. Neprovádíš žádné zápisy, neměníš SQL, neměníš OCR text a nevymýšlíš chybějící informace. Odpovídej česky. Používej dostupné nástroje search_candidates a get_candidate_detail. Pokud potřebuješ najít relevantní kandidáty, nejdřív použij search_candidates. Pokud uživatel žádá detail konkrétního kandidáta, detail více kandidátů nebo detailní porovnání konkrétních kandidátů, použij get_candidate_detail pro relevantní konkrétní kandidáty. Když potřebuješ detaily více kandidátů, vyžádej všechna potřebná get_candidate_detail volání najednou v jedné odpovědi. Nevolej opakovaně detail kandidáta, jehož detail už byl získán. Když nástroj get_candidate_detail použiješ, nepiš, že o detail teprve žádáš; rovnou použij získaná data ve finální odpovědi. Pokud detail kandidáta není dostupný, pracuj jen s informacemi ze search výsledků a jasně uveď, že detail nebyl dostupný. Nepopisuj interní postup agenta, nepiš věty typu "Požadavek: vyžádat detail", "detaily jsou k dispozici" ani "použil jsem nástroj". Ve finální odpovědi piš jen výsledek pro uživatele. Nezmiňuj kontaktní údaje, dostupnost kontaktů, e-maily ani telefony, pokud se uživatel výslovně neptá na kontakt. Neuváděj neurčité skupiny typu "ostatní kandidáti"; vypisuj pouze konkrétní kandidáty nalezené nástrojem. Pokud kandidát není jasně relevantní, neuváděj ho. Pokud informace v datech není, napiš "v dodaných datech neuvedeno". Nepokládej uživateli otázky. Nenabízej další akce. Nepiš věty typu "pokud chcete", "mohu připravit", "chcete, abych" ani "pokud preferujete". Na konci odpovědi uveď jedno konkrétní stručné doporučení podle dodaných dat. Doporučení musí být jedna stručná věta s kandidátem i důvodem. Nepiš alternativní doporučení ani podmíněná doporučení.',
    },
    {
      role: 'user',
      content: userQuestion,
    },
  ];

  for (let step = 0; step < 8; step++) {
    const completion = await modelClient.chat.completions.create({
      model: process.env.AZURE_MODEL_DEPLOYMENT,
      messages,
      tools,
      tool_choice: 'auto',
      max_completion_tokens: 900,
      reasoning_effort: 'minimal',
    });

    const message = completion.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content;
    }

    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments || '{}');
      console.log('\nTool requested:', toolCall.function.name);
      console.log('Tool arguments:', args);
      let result;

      if (toolCall.function.name === 'search_candidates') {
        result = await searchCandidates(args.query);
      } else if (toolCall.function.name === 'get_candidate_detail') {
        result = await getCandidateDetail(args.id);
      } else {
        result = { error: `Unknown tool: ${toolCall.function.name}` };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  return 'Agent nedokončil odpověď v povoleném počtu kroků.';
}
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const messages = [
  {
    role: 'system',
    content: `Jsi read-only recruitment assistant. Pracuješ pouze s daty získanými přes dostupné nástroje. Neprovádíš žádné zápisy, neměníš SQL, neměníš OCR text a nevymýšlíš chybějící informace. Odpovídej česky. Používej dostupné nástroje search_candidates a get_candidate_detail. Nejdřív použij search_candidates, pokud potřebuješ najít relevantní kandidáty. Pokud uživatel žádá detail konkrétního kandidáta, detail dvou kandidátů nebo detailní porovnání konkrétních kandidátů, použij get_candidate_detail. Když nástroj get_candidate_detail použiješ, nepiš, že o detail teprve žádáš; rovnou použij získaná data v odpovědi. Pokud detail kandidáta není dostupný, pracuj jen s informacemi ze search výsledků a jasně uveď, že detail nebyl dostupný. Nezmiňuj kontaktní údaje, dostupnost kontaktů, e-maily ani telefony, pokud se uživatel výslovně neptá na kontakt. Neuváděj neurčité skupiny typu "ostatní kandidáti"; vypisuj pouze konkrétní kandidáty nalezené nástrojem. Pokud kandidát není jasně relevantní, neuváděj ho. Pokud informace v datech není, napiš "v dodaných datech neuvedeno". Nepokládej uživateli otázky. Nenabízej další akce. Nepiš věty typu "pokud chcete", "mohu připravit", "chcete, abych" ani "pokud preferujete".

Struktura finální odpovědi musí být stručná a bez opakování:
1. Pokud uživatel žádá porovnání dvou kandidátů, uveď přesně dva kandidáty a potom sekci "Porovnání:".
2. V sekci "Porovnání:" porovnej oba kandidáty jen podle kritérií, na která se uživatel ptá.
3. Pokud uživatel žádá jednoho nejlepšího kandidáta, uveď pouze jednoho kandidáta.
4. Na konci uveď přesně jednu sekci s názvem "Doporučení:".
5. Sekce "Doporučení:" musí obsahovat přesně jednu větu a přesně jednoho doporučeného kandidáta.
6. Doporučení piš ve tvaru: "Nejvhodnější volba je [jméno kandidáta], protože [hlavní důvod]."

V doporučení nikdy nedoporučuj oba porovnávané kandidáty.
Po sekci "Doporučení:" už nesmí následovat žádný další text, žádná další sekce, žádné shrnutí, žádné alternativní doporučení ani nabídka další akce.
Piš gramaticky spisovnou češtinou a používej celé věty.
Pokud uživatel řekne, že nemáš uvádět kontaktní údaje, vůbec nezmiňuj kontaktní údaje ani jejich absenci.`,
  },
];

async function runAgentTurn(userQuestion) {
  messages.push({
    role: 'user',
    content: userQuestion,
  });

  for (let step = 0; step < 5; step += 1) {
    const completion = await modelClient.chat.completions.create({
      model: process.env.AZURE_MODEL_DEPLOYMENT,
      messages,
      tools,
      tool_choice: 'auto',
      max_completion_tokens: 900,
      reasoning_effort: 'minimal',
    });

    const message = completion.choices[0].message;
    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content;
    }

    for (const toolCall of message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);

      let result;

      try {
        if (toolCall.function.name === 'search_candidates') {
          result = await searchCandidates(args.query);
        } else if (toolCall.function.name === 'get_candidate_detail') {
          result = await getCandidateDetail(args.id);
        } else {
          result = {
            error: `Unknown tool: ${toolCall.function.name}`,
          };
        }
      } catch (error) {
        result = {
          error: error.message,
          tool: toolCall.function.name,
          args,
        };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return 'Agent nedokončil odpověď v povoleném počtu kroků.';
}

function ask() {
  rl.question('\nTy: ', async (input) => {
    const question = input.trim();

    if (question.toLowerCase() === 'exit') {
      rl.close();
      return;
    }

    if (!question) {
      ask();
      return;
    }

    try {
      const answer = await runAgentTurn(question);
      console.log('\nAgent:\n');
      console.log(answer);
    } catch (error) {
      console.error('Agent error:', error.message);
    }

    ask();
  });
}

console.log('Lokální agent spuštěn. Pro ukončení napiš: exit');
ask();
