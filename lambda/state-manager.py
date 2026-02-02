import json
import boto3
import os
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table_name = os.environ['TABLE_NAME']
table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    """
    Lambda function to manage document processing state in DynamoDB.
    
    Operations:
    - GET: Retrieve current state for a file
    - UPDATE: Update state for a file
    
    Event body format:
    {
        "operation": "GET" | "UPDATE",
        "file_name": "path/to/file.pdf",
        "new_state": "PENDING_OCR" | "PENDING_CLASSIFICATION" | "PENDING_TRANSLATION" | "COMPLETED" (for UPDATE only),
        "metadata": {} (optional, for UPDATE only)
    }
    """
    try:
        # Parse request body
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', event)
        
        operation = body.get('operation', '').upper()
        file_name = body.get('file_name')
        
        if not file_name:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'file_name is required'})
            }
        
        # Handle GET operation
        if operation == 'GET':
            return get_state(file_name)
        
        # Handle UPDATE operation
        elif operation == 'UPDATE':
            new_state = body.get('new_state')
            metadata = body.get('metadata', {})
            
            if not new_state:
                return {
                    'statusCode': 400,
                    'body': json.dumps({'error': 'new_state is required for UPDATE operation'})
                }
            
            return update_state(file_name, new_state, metadata)
        
        else:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': f'Invalid operation: {operation}. Use GET or UPDATE'})
            }
    
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }


def get_state(file_name):
    """Retrieve current state for a file."""
    try:
        response = table.get_item(Key={'file_name': file_name})
        
        if 'Item' in response:
            item = response['Item']
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'file_name': item.get('file_name'),
                    'state': item.get('state'),
                    'metadata': item.get('metadata', {}),
                    'updated_at': item.get('updated_at'),
                    'exists': True
                })
            }
        else:
            # File doesn't exist yet - return empty state
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'file_name': file_name,
                    'state': None,
                    'metadata': {},
                    'exists': False
                })
            }
    
    except Exception as e:
        print(f"Error getting state for {file_name}: {str(e)}")
        raise


def update_state(file_name, new_state, metadata):
    """Update state for a file."""
    try:
        timestamp = datetime.utcnow().isoformat()
        
        # Update item in DynamoDB
        response = table.update_item(
            Key={'file_name': file_name},
            UpdateExpression='SET #state = :state, updated_at = :timestamp, metadata = :metadata',
            ExpressionAttributeNames={
                '#state': 'state'
            },
            ExpressionAttributeValues={
                ':state': new_state,
                ':timestamp': timestamp,
                ':metadata': metadata
            },
            ReturnValues='ALL_NEW'
        )
        
        updated_item = response.get('Attributes', {})
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'file_name': updated_item.get('file_name'),
                'state': updated_item.get('state'),
                'metadata': updated_item.get('metadata', {}),
                'updated_at': updated_item.get('updated_at'),
                'success': True
            })
        }
    
    except Exception as e:
        print(f"Error updating state for {file_name}: {str(e)}")
        raise
