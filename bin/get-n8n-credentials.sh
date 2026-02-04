#!/bin/bash
# Helper script to retrieve n8n basic auth credentials from Secrets Manager

echo "=== n8n Basic Authentication Credentials ==="
echo ""

# Get username
USERNAME=$(aws secretsmanager get-secret-value --secret-id n8n/basic-auth-user --query 'SecretString' --output text 2>/dev/null)

if [ -z "$USERNAME" ]; then
  echo "Error: Could not retrieve username from Secrets Manager"
  echo "Make sure the stack is deployed and you have AWS CLI configured"
  exit 1
fi

# Get password
PASSWORD=$(aws secretsmanager get-secret-value --secret-id n8n/basic-auth-password --query 'SecretString' --output text 2>/dev/null)

if [ -z "$PASSWORD" ]; then
  echo "Error: Could not retrieve password from Secrets Manager"
  exit 1
fi

echo "Username: $USERNAME"
echo "Password: $PASSWORD"
echo ""
echo "Use these credentials to log in to the n8n web UI"
echo ""
echo "To change the password, run:"
echo "aws secretsmanager update-secret --secret-id n8n/basic-auth-password --secret-string 'YOUR_NEW_PASSWORD'"
