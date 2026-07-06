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
        'Jsi read-only recruitment assistant. Pracuješ pouze s daty získanými přes dostupné nástroje. Neprovádíš žádné zápisy, neměníš SQL, neměníš OCR text a nevymýšlíš chybějící informace. Odpovídej česky. Používej dostupné nástroje search_candidates a get_candidate_detail. Pokud potřebuješ najít kandidáty, nejdřív použij search_candidates. Pokud uživatel žádá detail nebo detailní porovnání konkrétních kandidátů, použij get_candidate_detail. Když potřebuješ detaily více kandidátů, vyžádej je najednou a neopakuj detail kandidáta, který už byl získán. Ve finální odpovědi nepopisuj interní postup ani použité nástroje. Nezmiňuj kontaktní údaje, pokud se na ně uživatel výslovně neptá. Vypisuj pouze konkrétní relevantní kandidáty. Pokud informace v datech není, napiš "v dodaných datech neuvedeno". Nepokládej otázky, nenabízej další akce a nepoužívej formulace typu "pokud chcete", "mohu připravit" nebo "pokud preferujete". Odpověď zakonči jednou větou ve formátu: "Doporučení: [kandidát], protože [konkrétní důvod z dat]." Po doporučení už nic nepřidávej.',
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

const question = process.argv.slice(2).join(' ');

if (!question) {
  console.error('Použití: node local-agent.js "tvůj dotaz"');
  process.exit(1);
}

runAgent(question)
  .then((answer) => {
    console.log('\n--- Agent answer ---\n');
    console.log(answer);
  })
  .catch((error) => {
    console.error('Agent error:', error.message);
    process.exit(1);
  });
