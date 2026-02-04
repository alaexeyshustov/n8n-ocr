#!/bin/bash

# Script to add your current public IP to the n8n security group
# Usage: ./add-my-ip.sh

set -e

echo "🔍 Detecting your public IP address..."

# Get current public IP
MY_IP=$(curl -s https://checkip.amazonaws.com)

if [ -z "$MY_IP" ]; then
    echo "❌ Failed to detect public IP address"
    exit 1
fi

echo "✅ Your public IP: $MY_IP"

# Get the security group ID from CloudFormation stack outputs
echo "🔍 Looking up security group from CloudFormation stack..."

SECURITY_GROUP_ID=$(aws cloudformation describe-stacks \
    --stack-name N8nBaseInfrastructure \
    --query 'Stacks[0].Outputs[?OutputKey==`SecurityGroupId`].OutputValue' \
    --output text 2>/dev/null)

if [ -z "$SECURITY_GROUP_ID" ]; then
    echo "❌ Could not find security group. Make sure the stack 'N8nBaseInfrastructure' is deployed."
    echo "   Run: cdk deploy N8nBaseInfrastructure"
    exit 1
fi

echo "✅ Security Group ID: $SECURITY_GROUP_ID"

# Check if the IP is already authorized
echo "🔍 Checking if IP is already authorized..."

EXISTING_RULE=$(aws ec2 describe-security-groups \
    --group-ids "$SECURITY_GROUP_ID" \
    --query "SecurityGroups[0].IpPermissions[?FromPort==\`5678\` && ToPort==\`5678\`].IpRanges[?CidrIp==\`${MY_IP}/32\`].CidrIp" \
    --output text 2>/dev/null)

if [ -n "$EXISTING_RULE" ]; then
    echo "✅ Your IP ($MY_IP/32) is already authorized on port 5678"
    exit 0
fi

# Add the ingress rule
echo "🔐 Adding ingress rule for $MY_IP/32 on port 5678..."

aws ec2 authorize-security-group-ingress \
    --group-id "$SECURITY_GROUP_ID" \
    --protocol tcp \
    --port 5678 \
    --cidr "${MY_IP}/32" \

echo "✅ Successfully added ingress rule!"
echo ""
echo "📝 Summary:"
echo "   Security Group: $SECURITY_GROUP_ID"
echo "   Allowed IP:     $MY_IP/32"
echo "   Port:           5678 (TCP)"
echo ""
echo "🌐 You can now access n8n at: http://[N8N_PUBLIC_IP]:5678"
echo "   Use ./get-n8n-url.sh to find the n8n URL"
