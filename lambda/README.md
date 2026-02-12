# Lambda State Manager

This Lambda function manages the document processing state machine for the n8n workflow pipeline.

## Purpose

Provides a centralized, reliable way to track document processing state in DynamoDB, replacing direct DynamoDB access from n8n workflows.

## API

The function is exposed via Lambda Function URL with AWS IAM authentication.

### Request Format

```json
{
  "operation": "GET" | "UPDATE",
  "file_name": "path/to/document.pdf",
  "new_state": "PENDING_OCR" | "PENDING_TRANSLATION" | "COMPLETED",
  "metadata": {}
}
```

### Operations

#### GET - Retrieve State

**Request:**
```json
{
  "operation": "GET",
  "file_name": "documents/invoice-123.pdf"
}
```

**Response:**
```json
{
  "file_name": "documents/invoice-123.pdf",
  "state": "PENDING_OCR",
  "metadata": {
    "discovered_at": "2026-02-02T10:30:00Z",
    "file_size": 245678
  },
  "updated_at": "2026-02-02T10:30:00Z",
  "exists": true
}
```

If the file doesn't exist in the table:
```json
{
  "file_name": "documents/new-file.pdf",
  "state": null,
  "metadata": {},
  "exists": false
}
```

#### UPDATE - Update State

**Request:**
```json
{
  "operation": "UPDATE",
  "file_name": "documents/invoice-123.pdf",
  "new_state": "PENDING_TRANSLATION",
  "metadata": {
    "ocr_completed_at": "2026-02-02T10:35:00Z",
    "text_length": 1250
  }
}
```

**Response:**
```json
{
  "file_name": "documents/invoice-123.pdf",
  "state": "PENDING_TRANSLATION",
  "metadata": {
    "ocr_completed_at": "2026-02-02T10:35:00Z",
    "text_length": 1250
  },
  "updated_at": "2026-02-02T10:35:00Z",
  "success": true
}
```

## State Machine Flow

```
NULL → PENDING_OCR → PENDING_CLASSIFICATION → PENDING_TRANSLATION → COMPLETED
  ↑         ↓                  ↓                      ↓                    ↓
  └─────────┴──────────────────┴──────────────────────┴────────────────────┘
                          (workflow processes file)
```

## Environment Variables

- `TABLE_NAME` - DynamoDB table name (automatically set by CDK)

## Error Handling

- Returns `400` for invalid requests (missing parameters)
- Returns `500` for DynamoDB errors
- All errors logged to CloudWatch Logs

## Usage in n8n

The n8n workflow uses AWS Lambda invoke nodes to call this function directly.

### Environment Variable Required

Set in n8n: `LAMBDA_STATE_MANAGER_NAME` = `n8n-doc-pipeline-state-manager` (default function name)

### Example n8n AWS Lambda Node

```json
{
  "operation": "invoke",
  "functionName": "={{ $env.LAMBDA_STATE_MANAGER_NAME || 'n8n-doc-pipeline-state-manager' }}",
  "payload": "json",
  "payloadJson": "={\n  \"operation\": \"GET\",\n  \"file_name\": \"{{ $('Loop Files').item.json.Key }}\"\n}",
  "credentials": {
    "aws": {
      "name": "AWS"
    }
  }
}
```

## Deployment

The function is automatically deployed by the CDK stack in [lib/state-machine-stack.ts](../lib/state-machine-stack.ts).

## Permissions

- **Lambda Execution Role**: Read/write access to DynamoDB table
- **n8n IAM User**: Direct Lambda invoke permission (granted by CDK)
