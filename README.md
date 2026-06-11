# Azure OCR Candidate Processing Pipeline

Proof of concept for automated candidate document processing built on Microsoft Azure.

## Overview

The project processes uploaded candidate CVs using an event-driven architecture.

Current workflow:

Blob Storage
→ Azure Function (Blob Trigger)
→ Azure Computer Vision OCR
→ Azure SQL Database
→ Azure Queue Storage
→ Azure Function (Queue Trigger)

The goal is to automatically extract information from candidate documents and prepare the pipeline for further AI-based processing and candidate matching.

## Technologies

- Azure Blob Storage
- Azure Functions (.NET Isolated)
- Azure Queue Storage
- Azure SQL Database
- Azure Computer Vision OCR
- Application Insights
- C#
- .NET

## Current Features

### Document Processing

- Upload CV documents to Blob Storage
- Automatic Blob Trigger execution
- OCR text extraction using Azure Computer Vision
- Store extracted text in Azure SQL Database

### Asynchronous Processing

- Queue-based architecture
- Candidate processing queue
- Separate Queue Trigger Function for additional processing steps

### Monitoring

- Application Insights integration
- Function execution monitoring
- Error tracking and diagnostics

## Database

Current candidate records contain:

- Candidate ID
- CV file name
- OCR extracted text
- Processing metadata

## Architecture

```text
CV PDF
    │
    ▼
Azure Blob Storage
    │
    ▼
ProcessImageUpload Function
    │
    ├── OCR extraction
    ├── Save to Azure SQL
    └── Send Candidate ID to Queue
                    │
                    ▼
         ProcessCandidateData Function
```

## Work in Progress

Planned extensions:

- AI-based candidate data extraction
- Candidate profile generation
- Face API integration
- Candidate photo matching
- Search and filtering capabilities

## Status

Work in progress / learning project.

The project currently demonstrates an end-to-end Azure document processing pipeline using serverless services and event-driven architecture.
