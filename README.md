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

- CORS restricted to the local React frontend
- rate limiting for AI requests
- question length validation
- duplicate candidates filtered out
- contact details are not sent to the model context
- technical error details are not exposed in API responses

Secrets and API keys are stored in local environment variables and should not be committed to Git.

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
