# Azure OCR Candidate Processing Pipeline

Proof of concept for automated candidate CV processing built on Microsoft Azure.

The project demonstrates an end-to-end AI/data pipeline for processing candidate documents, extracting OCR text, enriching candidate records, indexing them for search, and generating RAG-based answers using Azure AI Foundry.

## Overview

The project processes uploaded candidate CVs using an event-driven Azure architecture.

Current workflow:

```text
Azure Blob Storage
→ Azure Function Blob Trigger
→ Azure AI Vision OCR
→ Azure SQL Database
→ Azure Queue Storage
→ Azure Function Queue Trigger
→ Azure AI Search
→ Node.js API
→ Azure AI Foundry model
→ React frontend
```

The test dataset contains candidate CVs for a lumberjack role. The goal is to simulate a realistic document processing and candidate search pipeline.

Face API was originally considered, but it was removed from the project scope.

## Technologies

- Azure Blob Storage
- Azure Functions (.NET Isolated)
- Azure Queue Storage
- Azure SQL Database
- Azure AI Vision OCR
- Azure AI Search
- Azure AI Foundry
- Node.js / Express
- React
- C#
- .NET
- JavaScript
- Application Insights

## Current Features

### Document Processing

- Upload candidate CV documents to Azure Blob Storage
- Automatically trigger Azure Function on blob upload
- Extract OCR text using Azure AI Vision
- Store extracted text in Azure SQL Database

### Asynchronous Enrichment

- Queue-based processing architecture
- Candidate ID is sent to Azure Queue Storage
- Queue Trigger Function enriches candidate records
- Extracted candidate metadata includes:
  - full name
  - email
  - phone
  - processing status

### Database

Candidate records are stored in Azure SQL.

The `candidates` table contains fields such as:

- `candidate_id`
- `cv_file_name`
- `ocr_text`
- `full_name`
- `email`
- `phone`
- `status`

Duplicate records are not deleted. They are marked with:

```text
status = DUPLICATE
```

The API and search layer filter duplicates by default.

### Azure AI Search

Candidate records are indexed in Azure AI Search.

Current index:

```text
candidates-index-v2
```

The `ocr_text` field uses the Czech Microsoft analyzer:

```json
"analyzer": "cs.microsoft"
```

This improves search behavior for Czech word forms, for example matching:

```text
horský
horském
```

Search results exclude duplicate candidates by default.

### Node.js API

The Express API provides access to candidate data and search results.

Current endpoints:

```text
GET /candidates
GET /candidates/:id
GET /candidates/search/:text
GET /candidates/rag/:question
GET /candidates/rag-answer/:question
```

#### Search Endpoint

```text
GET /candidates/search/:text
```

Uses Azure AI Search to retrieve relevant candidates.

#### RAG Preview Endpoint

```text
GET /candidates/rag/:question
```

Retrieves relevant candidates from Azure AI Search and prepares the prompt/context for a model.

This endpoint is useful for debugging the retrieval step.

#### RAG Answer Endpoint

```text
GET /candidates/rag-answer/:question
```

Retrieves relevant candidates from Azure AI Search, sends the selected context to an Azure AI Foundry model, and returns a generated answer.

The model is instructed to answer only from the provided candidate data and not invent missing information.

### Azure AI Foundry

The project uses Azure AI Foundry for model-based answer generation.

Current model deployment:

```text
gpt-5-nano
```

The model is used only after retrieval from Azure AI Search.

The RAG flow is:

```text
User question
→ Azure AI Search retrieval
→ Candidate context
→ Azure AI Foundry model
→ Generated answer
```

The model does not search the database directly. It only works with the context provided by the retrieval layer.

### React Frontend

The React frontend displays candidates from the API and includes a simple AI question interface.

Frontend features:

- list candidates
- view candidate detail
- display OCR text
- ask AI questions over candidate data
- show generated RAG answer

## Basic Safety Measures

The API includes basic safety measures for the RAG endpoint:

- API bound to `127.0.0.1`, with Host and Origin checks before route handlers
- CORS restricted to the local React development and preview frontends
- rate limiting for AI requests
- question length validation
- duplicate candidates filtered out
- contact details are not sent to the model context
- technical error details are not exposed in API responses

Secrets and API keys are stored in local environment variables and should not be committed to Git.

### Local-only operation

Run the API with `node server.js` from `ocr-api`, and the frontend with
`npm run dev` from `ocr-frontend`. Open `http://127.0.0.1:5173`.
The frontend binds to loopback on port 5173 (preview uses 4173); it stops if
the port is occupied instead of silently choosing a different port. Do not
override the host with `--host 0.0.0.0` or expose these services through a tunnel.

The API accepts local frontend origins on ports 5173 and 4173 and same-origin
API requests. It rejects other supplied origins, unexpected Host headers, and
browser requests marked cross-site when they have no Origin. Local command-line
agents without an Origin header still work. These checks are not user
authentication: other processes on this computer can call the API. Shared
deployment requires authentication and authorization before exposing it.

Use `ocr_api_reader` for the API's SQL connection and `ocr_functions_writer`
for Functions. Azure app settings and local `local.settings.json` are separate;
update each privately. Keep `.env` and `local.settings.json` ignored and readable
only by their owner (file mode `600` on macOS). Never put credentials in frontend
code or `VITE_*` variables.

Run `npm test` in `ocr-api` for synthetic local-access checks. These tests do not
load credentials or contact Azure. SQL firewall rules based on the current
Functions outbound IP list may need maintenance on the Consumption plan; they
are separate from the API's local-only boundary.

### Local API SQL authentication with Microsoft Entra

The API supports an explicit migration switch, `DB_AUTH_MODE=entra`. Until that
switch is set, the existing SQL-password configuration remains active. In Entra
mode, `DB_USER` and `DB_PASSWORD` are ignored and authentication failures never
fall back to them. The migration is not complete until the live reader test
passes and unused SQL-password access is removed.

1. Create a dedicated non-admin Entra developer account and its contained user
   in the application database. Grant only `SELECT` on `dbo.candidates`.
2. Copy the entries from `ocr-api/.env.entra.example` into the private
   `ocr-api/.env`, replacing the placeholders locally. The tenant GUID is from
   Entra Overview; the object GUID is from the reader **user**, not a managed
   identity or app registration. Keep the existing `DB_SERVER` and `DB_NAME`.
3. From `ocr-api`, run `npm run login:sql`. Open the displayed Microsoft device
   login page yourself and sign in as the dedicated reader. Never share the
   device code or use the database administrator account. The script does not
   open a browser and uses `--allow-no-subscriptions`; this reader needs SQL
   access, not a subscription management role.
   Login requests the Azure management scope so CLI subscription discovery can
   complete its MFA challenge. This grants no management role; the API requests
   a separate SQL token. Complete any MFA prompt as the dedicated reader.
4. Restart the API and verify reading through the frontend. The API checks the
   CLI account before acquiring SQL tokens, and checks the database user's
   object ID, `SELECT`, absence of candidate write/alter rights and absence of
   database `CONTROL` before returning the pool to route handlers.
5. After live verification, remove the unused `DB_USER` and `DB_PASSWORD` entries
   privately. Retire the old SQL user only after checking all its consumers.

The Azure CLI profile in `ocr-api/.azure-sql/` contains sensitive cached login
data. It is ignored by Git and created with owner-only directory permissions.
Never copy it into builds, archives or deployments. It is separate from the
normal Azure CLI profile. Run `npm run logout:sql` to sign out of this dedicated
profile after stopping the API. Browser and DBeaver logins are separate sessions;
CLI logout does not sign those out or terminate existing database connections.
The API never automatically opens a login page or uses a different credential
source such as an admin IDE login.

The database identity/permission check is a defense against wrong-account
selection, not a complete audit of all SQL grants, roles or stored procedures.
Keep the reader out of administrative roles and groups. Tenant and object IDs
are identifiers, not credentials; they can still be kept private in `.env`.

Azure Functions use their own managed identity via the Azure `SqlConnection`
setting with `Authentication=Active Directory Managed Identity`. This is
separate from local API authentication. Local Functions configuration is also
separate and must not use the cloud managed-identity setting on a developer Mac.

## Architecture

```text
Candidate CV
    │
    ▼
Azure Blob Storage
    │
    ▼
ProcessImageUpload Function
    │
    ├── OCR extraction via Azure AI Vision
    ├── Save OCR text to Azure SQL
    └── Send Candidate ID to Queue
                    │
                    ▼
         ProcessCandidateData Function
                    │
                    ├── Extract name/email/phone
                    ├── Update SQL candidate record
                    └── Mark duplicates by status
                    │
                    ▼
              Azure AI Search
                    │
                    ▼
               Node.js API
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Search results       RAG prompt/context
                              │
                              ▼
                    Azure AI Foundry model
                              │
                              ▼
                       React frontend
```

## Learning Goals

This project demonstrates:

- event-driven architecture on Azure
- serverless document processing
- OCR-based data extraction
- SQL persistence
- queue-based asynchronous processing
- Azure AI Search indexing
- Czech language search configuration
- RAG architecture
- Azure AI Foundry model integration
- basic API safety practices
- frontend integration with AI-generated responses

## Work in Progress

Possible next steps:

- improve frontend UI and layout
- move frontend API URL to environment variables
- add better structured model output
- add automated tests for API endpoints
- improve candidate scoring and ranking
- add project documentation diagrams
- explore agent-based workflows later

Agent-based processing is not currently required. It may become useful later if the model needs to perform multi-step actions, such as retrieving details, comparing candidates, and updating candidate status.

## Status

Work in progress / learning project.

The project currently demonstrates a complete Azure-based OCR and RAG pipeline:

```text
Blob Storage
→ Azure Functions
→ Azure AI Vision OCR
→ Azure SQL
→ Azure AI Search
→ Node.js API
→ Azure AI Foundry
→ React frontend
```
