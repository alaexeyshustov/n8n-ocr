# N8N CDK Project - AI Agent Instructions

## Working Guidelines

**CRITICAL RULES:**

1. **Never create summary files** - Do not create `CHANGES.md`, `SUMMARY.md`, `MIGRATION.md`, or similar documentation files unless explicitly requested by the user. Communicate changes directly to the user.

2. **Always plan before implementing features** - When asked to add a new feature or make significant changes:
   - Create a plan using the `manage_todo_list` tool
   - Break down the work into discrete, trackable steps
   - Mark tasks as in-progress/completed as you work through them
   - This ensures visibility and prevents incomplete implementations

## Project Context

This is an **AWS CDK TypeScript infrastructure-as-code project** that deploys a complete **n8n automation platform** on AWS. You are helping maintain and modify this infrastructure.

## Project Purpose

Deploys a production-ready n8n instance with:

- **Persistent data** via EBS volume (survives instance replacement)
- **AWS service integrations** (S3, DynamoDB, Bedrock)
- **Document processing pipeline** with OCR workflow
- **Automated IAM credential generation** for n8n workflows

## Architecture Overview

```
ECS Cluster (n8n-cluster)
  └─ Fargate Task
      └─ ECS Task: n8n (custom Docker image from ECR)
          ├─ Port 5678 (Web UI - Basic Auth Protected)
          └─ Mounted EFS: /home/node/.n8n (encrypted, persistent)

Scheduled Scaling:
  - Scale down to 0 at 10 PM UTC (night)
  - Scale up to 1 at 9 AM UTC (morning)

AWS Resources:
  - ECR Repository: Custom n8n image with workflows baked in
  - EFS File System: Persistent storage for n8n data
  - S3 Bucket: DocProcessingBucket (with lifecycle rules)
  - DynamoDB Table: DocPipeline (partition key: file_name)
  - Lambda Function: State Manager (Python 3.12, manages DynamoDB state)
    └─ Function URL: HTTPS endpoint with IAM auth
  - Secrets Manager: 
    ├─ Mistral API key (n8n/mistral-api-key)
    ├─ Basic Auth Username (n8n/basic-auth-user)
    └─ Basic Auth Password (n8n/basic-auth-password)
  - IAM User: n8n-bot-user (with auto-generated access keys)
  - IAM Role: Task role with S3, DynamoDB, Bedrock permissions
  - Security Group: No default ingress rules (use add-my-ip.sh to add your IP)
```

## File Structure

```
bin/n8n-cdk.ts           # CDK app entry point, stack instantiation
bin/add-my-ip.sh         # Helper script to add your current IP to security group
bin/get-n8n-url.sh       # Helper script to find ECS task IP
lib/n8n-cdk-stack.ts     # Main infrastructure definition (all resources)
lambda/state-manager.py  # Lambda function for DynamoDB state management
lambda/README.md         # Lambda API documentation
workflows/ocr.json       # Sample n8n workflow with Mistral OCR (baked into Docker image)
Dockerfile               # Custom n8n image with workflows and Python
import-workflows.sh      # Workflow import script (runs on container startup)
.dockerignore            # Docker build exclusions
test/n8n-cdk.test.ts     # Jest snapshot tests
```

## Critical Infrastructure Details

### Security Configuration

- **IP Restriction**: No default ingress rules - use `add-my-ip.sh` script to add your current public IP to security group
- **Network**: Uses default VPC (or creates new 2-AZ VPC if none exists)

### Data Persistence

- **EFS File System**: Persistent storage for n8n data
  - `removalPolicy: RETAIN` - File system survives `cdk destroy`
  - Access Point: `/n8n-data` with UID/GID 1000
  - Mount point in container: `/home/node/.n8n`
  - Encrypted at rest and in transit

### ECS Configuration

- **Cluster**: n8n-cluster with EC2 Spot capacity provider
- **Instance Type**: t3.small with spot pricing (~70% cost savings)
- **Task Definition**: EC2 launch type with EFS volume
- **Service**: Single task (desired count: 1, scales to 0 at night)
- **Scaling Schedule**:
  - Scale down at 22:00 UTC (10 PM)
  - Scale up at 08:00 UTC (8 AM)

### Docker Image

- **Base**: n8nio/n8n:latest
- **Customizations**:
  - Python 3 and pip installed
  - Workflows copied to `/data/workflows-import/` (persistent location)
  - Import script at `/usr/local/bin/import-workflows.sh`
  - Entrypoint runs import script before n8n startup
  - Built and pushed to ECR during deployment

**Workflow Import Mechanism:**
- Workflows stored in `/data/workflows-import/` (not overridden by EFS)
- On first container start: Script copies workflows to `/home/node/.n8n/` (EFS-backed)
- Marker file `.workflows-imported` prevents re-importing
- See `import-workflows.sh` for implementation details

### IAM Setup

- **Instance Role**: Lines 95-120 - SSM, CloudWatch, S3, DynamoDB, Bedrock permissions
- **Lambda Execution Role**: Auto-created by CDK with DynamoDB read/write access
- **Bot User**: Lines 215-240 - IAM user with S3, DynamoDB, Bedrock, Lambda invoke, and Secrets Manager read permissions

### Secrets Manager

- **Mistral API Key**: Lines 87-92 in [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L87-L92)
- **Secret Name**: `n8n/mistral-api-key`
- **Initial Value**: Placeholder (must be updated after deployment)
- **Access**: Granted to n8n IAM user for workflow access
- **Update Command**: `aws secretsmanager update-secret --secret-id n8n/mistral-api-key --secret-string "key"`

### Lambda State Manager

- **Function**: Lines 60-85 in [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L60-L85)
- **Code**: [lambda/state-manager.py](lambda/state-manager.py)
- **Purpose**: Centralized DynamoDB state management for document processing workflow
- **Invocation**: Function URL with AWS IAM authentication
- **API**: GET (retrieve state) / UPDATE (modify state) operations
- **State Flow**: NULL → PENDING_OCR → PENDING_CLASSIFICATION → PENDING_TRANSLATION → COMPLETED
- **Documentation**: [lambda/README.md](lambda/README.md)

### Workflow Integration

- **OCR Provider**: Mistral AI (Pixtral-12B model via API)
  - Authentication: HTTP Header Auth with Bearer token
  - API Endpoint: https://api.mistral.ai/v1/chat/completions
  - Model: pixtral-12b-2409 (vision model for text extraction)
- **Classification**: Bedrock (Mistral Large)
  - Categorizes documents into category/subcategory structure
  - Returns JSON with filesystem-safe names
- **Translation**: Bedrock (Mistral Large)
  - Translates to German if not already in German
- **Output**: S3 upload to `category/subcategory/filename` path

## Common Modification Patterns

### Add Your IP to Security Group

Use the `add-my-ip.sh` script to automatically add your current public IP to the security group:

```bash
./bin/add-my-ip.sh
```

This script will:
- Auto-detect your current public IP
- Find the security group from the CloudFormation stack
- Add an ingress rule for port 5678
- Skip if your IP is already authorized

### Change Instance Type

**File**: [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L131)

```typescript
instanceType: ec2.InstanceType.of(
  ec2.InstanceClass.T3,
  ec2.InstanceSize.MEDIUM,
);
```

### Increase Volume Size

**File**: [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L92)

```typescript
size: cdk.Size.gibibytes(20), // Change from 10
```

### Pin Docker Image Version

**File**: [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L14)

```typescript
const PUBLIC_ECR_IMAGE = "n8nio/n8n:1.20.0"; // Instead of :latest
```

### Make Volume Auto-Delete on Destroy

**File**: [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L95)

```typescript
removalPolicy: cdk.RemovalPolicy.DESTROY, // Instead of RETAIN
```

## Workflow Information

### Sample Workflow: [workflows/ocr.json](workflows/ocr.json)

- **Trigger**: Every 5 minutes
- **Flow**: S3 List → DynamoDB State Check → OCR Processing
- **Purpose**: Document processing pipeline demo
- **Note**: Contains placeholder `YOUR_CREDENTIAL_ID` - needs manual update after deployment

## Environment Configuration

### Required Environment Variables

The project uses dotenv to load AWS account configuration from a `.env` file:

**File**: `.env` (in project root, gitignored)

**Loading**: [bin/n8n-cdk.ts](bin/n8n-cdk.ts) imports `dotenv/config` at the top

**Fallback**: If `.env` is not present, falls back to `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` environment variables

**Priority**: `AWS_ACCOUNT_ID` > `CDK_DEFAULT_ACCOUNT`, `AWS_REGION` > `CDK_DEFAULT_REGION`

## Build & Deployment Commands

```bash
npm install          # Install dependencies
npm run build       # Compile TypeScript
npm run watch       # Auto-compile on changes
npm test            # Run Jest tests

npx cdk bootstrap   # One-time AWS account setup
npx cdk synth      # Generate CloudFormation
npx cdk diff       # Show changes
npx cdk deploy     # Deploy to AWS
npx cdk destroy    # Teardown (volume retained)
```

**Note**: Ensure `.env` file is configured before running CDK commands that require account/region (bootstrap, synth, deploy).

## Troubleshooting Guide

### Deployment Issues

- **Stack stuck**: Check `/var/log/cloud-init-output.log` on EC2 instance
- **Docker pull fails**: Network/registry issue, check security group outbound rules
- **Volume attachment timeout**: AZ mismatch between instance and volume

### Runtime Issues

- **n8n not accessible**: Verify security group IP, check Docker: `docker ps -a && docker logs n8n`
- **Volume not mounted**: Check `lsblk` and `/etc/fstab`, verify device name
- **Permission errors**: Verify `/home/ec2-user/.n8n` owned by 1000:1000

### Access Methods

- **Web UI**: http://[PublicIP]:5678 (from allowed IP)
- **SSH**: Use AWS Systems Manager Session Manager (SSM)
- **Logs**: CloudWatch Logs (if logging configured), `/var/log/cloud-init-output.log`

## Cost Considerations

Monthly estimate (us-east-1):

- EC2 t3.small: ~$15-20
- EBS 10GB gp3: ~$0.80
- S3: ~$1.15 (50GB tier)
- DynamoDB: Pay-per-request (minimal)
- **Total**: ~$17-25/month

## Security Considerations

When modifying:

1. **Never** use `ec2.Peer.anyIpv4()` for production security groups
2. **Rotate** IAM access keys periodically (currently static)
3. **Consider** AWS Secrets Manager instead of CloudFormation outputs for keys
4. **Enable** CloudTrail and GuardDuty for production deployments
5. **Review** IAM permissions - currently uses managed policies (broad permissions)

## Known Limitations

1. **Single AZ**: Instance and volume tied to one availability zone
2. **No HTTPS**: Plain HTTP on port 5678 (add ALB for HTTPS)
3. **No backups**: No automated EBS snapshots configured
4. **Static credentials**: Access keys exposed in CloudFormation outputs
5. **Latest tag**: Docker image uses `:latest` (unpinned)

## Extension Points

To add features, consider:

- **HTTPS**: Add ALB, ACM certificate, Route53 record
- **High Availability**: Multi-AZ with ALB + EFS (instead of EBS)
- **Backups**: AWS Backup plan for EBS snapshots
- **Monitoring**: CloudWatch dashboards and alarms
- **Secrets**: AWS Secrets Manager integration
- **Auto-scaling**: Auto Scaling Group (requires EFS for shared storage)

## Dependencies

```json
{
  "aws-cdk-lib": "^2.235.1",
  "constructs": "^10.0.0",
  "aws-cdk": "2.1103.0",
  "typescript": "~5.9.3"
}
```

## Important References

- **n8n Container**: Runs as user 1000, expects `/home/node/.n8n` inside container
- **Device Mapping**: `/dev/sdf` → `/dev/nvme1n1` on NVMe instances (T3/T4g)
- **VPC Lookup**: Uses default VPC if exists, creates new otherwise
- **CloudFormation Outputs**: Lines 169-213 expose connection details

---

**Project Type**: Infrastructure as Code (AWS CDK)  
**Language**: TypeScript  
**Target**: AWS  
**Last Updated**: February 2, 2026
