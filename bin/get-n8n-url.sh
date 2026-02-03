#!/bin/bash
# Helper script to get the n8n URL from ECS task

CLUSTER_NAME=$(aws cloudformation describe-stacks --stack-name N8nCdkStack --query "Stacks[0].Outputs[?OutputKey=='N8nClusterName'].OutputValue" --output text)
SERVICE_NAME=$(aws cloudformation describe-stacks --stack-name N8nCdkStack --query "Stacks[0].Outputs[?OutputKey=='N8nServiceName'].OutputValue" --output text)

if [ -z "$CLUSTER_NAME" ] || [ -z "$SERVICE_NAME" ]; then
  echo "Error: Could not find cluster or service name from CloudFormation stack"
  exit 1
fi

echo "Cluster: $CLUSTER_NAME"
echo "Service: $SERVICE_NAME"
echo ""

# Get the task ARN
TASK_ARN=$(aws ecs list-tasks --cluster "$CLUSTER_NAME" --service-name "$SERVICE_NAME" --query 'taskArns[0]' --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "No running tasks found. The service might be scaled down or starting up."
  exit 1
fi

# Get the ENI ID from the task
ENI_ID=$(aws ecs describe-tasks --cluster "$CLUSTER_NAME" --tasks "$TASK_ARN" --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' --output text)

if [ -z "$ENI_ID" ]; then
  # For EC2 tasks, get the container instance
  CONTAINER_INSTANCE=$(aws ecs describe-tasks --cluster "$CLUSTER_NAME" --tasks "$TASK_ARN" --query 'tasks[0].containerInstanceArn' --output text)
  
  if [ -z "$CONTAINER_INSTANCE" ]; then
    echo "Error: Could not find container instance"
    exit 1
  fi
  
  # Get the EC2 instance ID
  INSTANCE_ID=$(aws ecs describe-container-instances --cluster "$CLUSTER_NAME" --container-instances "$CONTAINER_INSTANCE" --query 'containerInstances[0].ec2InstanceId' --output text)
  
  # Get the public IP
  PUBLIC_IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
else
  # Get the public IP from the ENI
  PUBLIC_IP=$(aws ec2 describe-network-interfaces --network-interface-ids "$ENI_ID" --query 'NetworkInterfaces[0].Association.PublicIp' --output text)
fi

if [ -z "$PUBLIC_IP" ] || [ "$PUBLIC_IP" = "None" ]; then
  echo "Error: Could not find public IP. The instance might not have a public IP assigned."
  exit 1
fi

echo "n8n URL: http://$PUBLIC_IP:5678"
