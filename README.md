# N8N on AWS CDK

Deploy a complete **n8n workflow automation platform** on AWS with persistent storage, document processing capabilities, and AWS service integrations.

## What This Deploys

- **n8n** workflow automation tool running on EC2 with Docker
- **Persistent EBS volume** to retain n8n data across instance replacements
- **S3 bucket** for document processing/storage
- **DynamoDB table** for tracking document pipeline states
- **Lambda function** for reliable state management (Python 3.12)
- **AWS Bedrock** access for AI/ML capabilities
- **IAM credentials** automatically generated for n8n to access AWS services
- Sample **OCR workflow** for document processing

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  EC2 Instance (t3.small)                           │
│  ┌──────────────────────────────────────┐          │
│  │  Docker Container: n8n:latest        │          │
│  │  Port 5678 (Web UI)                  │          │
│  └──────────────────────────────────────┘          │
│           ↓ mounted volume                          │
│  ┌──────────────────────────────────────┐          │
│  │  EBS Volume (10GB, gp3, encrypted)   │          │
│  │  /home/ec2-user/.n8n                 │          │
│  └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────┘
              ↓ IAM Role with permissions
┌─────────────────────────────────────────────────────┐
│  AWS Resources:                                     │
│  - S3 Bucket (DocProcessingBucket)                  │
│  - DynamoDB Table (DocPipeline)                     │
│  - Lambda Function (State Manager)                  │
│    └─ Function URL: HTTPS endpoint                  │
│  - IAM User (n8n-bot-user) with access keys         │
│  - Bedrock API access                               │
└─────────────────────────────────────────────────────┘
```

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** configured with credentials (`aws configure`)
3. **Node.js** 18+ and npm installed
4. **AWS CDK CLI** installed globally: `npm install -g aws-cdk`

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Bootstrap CDK (First Time Only)

```bash
npx cdk bootstrap
```

### 3. Configure Security Group IP

⚠️ **Important**: Update the allowed IP address in [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L29)

Find your current IP:

```bash
curl ifconfig.me
```

Then update line 29 in [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts):

```typescript
ec2.Peer.ipv4('YOUR.IP.ADDRESS.HERE/32'),
```

### 4. Build & Deploy

```bash
npm run build
npx cdk deploy
```

### 5. Save the Outputs

After deployment, save these values:

- **N8nUrl** - Web UI access URL (http://[IP]:5678)
- **BucketName** - S3 bucket name
- **TableName** - DynamoDB table name
- **StateManagerFunctionUrl** - Lambda Function URL for state management
- **StateManagerFunctionName** - Lambda Function name
- **MistralApiKeySecretArn** - Secret ARN for Mistral API key
- **MistralApiKeySecretName** - Secret name (n8n/mistral-api-key)
- **N8nAccessKeyId** - AWS Access Key for n8n
- **N8nSecretAccessKey** - AWS Secret Key (⚠️ sensitive!)

### 6. Update Mistral API Key in Secrets Manager

The stack creates a placeholder secret. Update it with your actual Mistral API key:

```bash
aws secretsmanager update-secret \
  --secret-id n8n/mistral-api-key \
  --secret-string "your-mistral-api-key-here"
```

Or via AWS Console:

1. Go to **AWS Secrets Manager**
2. Find secret: `n8n/mistral-api-key`
3. Click **Retrieve secret value** → **Edit**
4. Replace placeholder with your Mistral API key
5. Save

Get your Mistral API key from: https://console.mistral.ai/

### 7. Configure n8n Environment

After accessing n8n, add these environment variables:

1. Go to **Settings** → **Environment Variables**
2. Add:
   - `LAMBDA_STATE_MANAGER_URL` = [StateManagerFunctionUrl from outputs]
   - `S3_BUCKET_NAME` = [BucketName from outputs]
3. Save and restart workflows

### 8. Access n8n

1. Open the `N8nUrl` in your browser
2. Complete first-time setup (create admin account)
3. Configure AWS credentials using the access keys from outputs
4. Set up Mistral API credentials (see "Creating Mistral Credentials" below)

## Common Commands

### Development

```bash
npm run build           # Compile TypeScript to JavaScript
npm run watch           # Watch mode - auto-compile on changes
npm test                # Run Jest unit tests
```

### CDK Operations

```bash
npx cdk synth          # Generate CloudFormation template
npx cdk diff           # Compare deployed vs current state
npx cdk deploy         # Deploy stack to AWS
npx cdk destroy        # Tear down stack (EBS volume retained)
```

## Working with n8n Workflows

### Importing the Sample OCR Workflow

1. Access n8n UI at your deployment URL
2. **Set environment variable**: Add `LAMBDA_STATE_MANAGER_URL` with the Function URL from outputs
3. Go to **Workflows** → **Import from File**
4. Upload [workflows/ocr.json](workflows/ocr.json)
5. Update the workflow:
   - Replace `YOUR_CREDENTIAL_ID` with your AWS credentials (in all nodes)
   - Set correct S3 bucket name (from deployment outputs)
   - The workflow now uses Lambda for state management automatically

### How the Workflow Works

The OCR pipeline processes documents through these stages:

1. **Schedule Trigger**: Runs every 5 minutes
2. **List S3 Files**: Gets all files from the bucket
3. **Loop Files**: Processes each file individually
4. **Get State**: Lambda checks current processing state
5. **State Router**: Routes based on state:
   - New/Empty → Mark as new → Download → **Mistral OCR** → **Classify** → Translate → Upload → Complete
   - PENDING_OCR → Download → **Mistral OCR** → **Classify** → Translate → Upload → Complete
   - PENDING_CLASSIFICATION → **Classify** → Translate → Upload → Complete
   - PENDING_TRANSLATION → Translate → Upload → Complete
   - COMPLETED → Skip (already processed)
6. **State Updates**: Lambda updates state after each stage

The workflow uses:

- **Mistral's Pixtral-12B model** for OCR (text extraction from images/PDFs)
- **Bedrock Mistral Large** for classification (categorizes documents into category/subcategory)
- **Bedrock Mistral Large** for translation (German translation)
- **S3 Upload** saves results to `category/subcategory/filename` structure

### Creating AWS Credentials in n8n

1. In n8n: **Settings** → **Credentials** → **New Credential**
2. Search for "AWS"
3. Enter the access keys from deployment outputs
4. Set your AWS region (e.g., `us-east-1`)
5. Test connection and save
6. Use this credential in all AWS nodes (S3, Bedrock, HTTP Request with AWS auth)

### Creating Mistral Credentials in n8n

1. In n8n: **Settings** → **Credentials** → **New Credential**
2. Search for "Header Auth"
3. Set:
   - **Name**: `Mistral API`
   - **Header Name**: `Authorization`
   - **Header Value**: `Bearer YOUR_MISTRAL_API_KEY`
4. Get your API key from: https://console.mistral.ai/
5. Test and save
6. Use this credential in the "Mistral OCR" node

**Alternative (using AWS Secrets Manager):**
The Mistral API key is stored in AWS Secrets Manager and the n8n IAM user has read access. You can fetch it programmatically in n8n workflows if needed.

## Important Configuration

### Data Persistence

The EBS volume has `removalPolicy: RETAIN`, which means:

- ✅ Your n8n data survives stack updates
- ✅ Data is preserved even if you run `cdk destroy`
- ⚠️ You must manually delete the volume from AWS console for complete cleanup
- 💡 To auto-delete on destroy, change to `cdk.RemovalPolicy.DESTROY` in [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L95)

### Docker Image

Currently uses `n8nio/n8n:latest` ([lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L14))

For production, consider:

- Pin to specific version: `n8nio/n8n:1.20.0`
- Use AWS ECR Public: `public.ecr.aws/n8n/n8n:latest`

## Troubleshooting

### Can't Access n8n Web UI

1. Verify security group allows your current IP in [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L29)
2. Check instance is running in AWS Console → EC2
3. Confirm n8n started: Use AWS Systems Manager Session Manager to connect:
   ```bash
   docker ps -a
   docker logs n8n
   ```

### Volume Mount Issues

Connect via Session Manager and check:

```bash
# Check device name
lsblk

# Verify mount
df -h | grep n8n

# Check permissions
ls -la /home/ec2-user/.n8n
```

### CloudFormation Stack Stuck

Check EC2 instance logs:

- Use Session Manager to connect
- View logs: `sudo cat /var/log/cloud-init-output.log`
- Look for Docker pull failures or volume attachment issues

## Cost Estimation

Expected monthly costs (us-east-1):

- **EC2 t3.small**: ~$15-20/month
- **EBS 10GB gp3**: ~$0.80/month
- **S3 storage**: ~$1.15/month (first 50GB)
- **DynamoDB**: Pay-per-request (minimal for low usage)

**Total**: ~$17-25/month for light usage

## Security Best Practices

1. ✅ Change the default IP in security group to your IP
2. 🔒 Enable HTTPS with Application Load Balancer + SSL certificate
3. 🔑 Rotate access keys periodically
4. 🔐 Use AWS Secrets Manager for credentials (instead of CloudFormation outputs)
5. 🛡️ Enable MFA on your AWS account
6. 📊 Enable CloudTrail for audit logging
7. 🚨 Set up CloudWatch alarms for unusual activity

## Advanced Modifications

### Change Instance Type

Edit [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L131):

```typescript
instanceType: ec2.InstanceType.of(
  ec2.InstanceClass.T3,
  ec2.InstanceSize.MEDIUM,
);
```

### Increase Storage

Edit [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L92):

```typescript
size: cdk.Size.gibibytes(20), // 20 GB instead of 10
```

### Enable Backups

Add AWS Backup plan for the EBS volume (requires additional code)

### Multi-AZ High Availability

For production, consider:

- Application Load Balancer
- EFS instead of EBS (for shared storage)
- Auto Scaling Group
- Multiple availability zones

## Cleanup

### Keep Data (Default)

```bash
npx cdk destroy
```

Removes all resources except the EBS volume - your n8n data is preserved.

### Complete Cleanup (Delete Everything)

1. Run `npx cdk destroy`
2. Go to **AWS Console** → **EC2** → **Volumes**
3. Find the volume tagged with your stack name
4. Delete it manually (⚠️ **permanent data loss!**)

## Resources

- **n8n Documentation**: https://docs.n8n.io/
- **AWS CDK Documentation**: https://docs.aws.amazon.com/cdk/
- **n8n Community**: https://community.n8n.io/
- **AWS CDK Examples**: https://github.com/aws-samples/aws-cdk-examples

## Version Information

- **CDK**: 2.1103.0
- **Node.js**: 24.10.1+
- **TypeScript**: 5.9.3
- **n8n**: latest (Docker)

## License

This project structure is based on the AWS CDK TypeScript template.

---

**Maintained By**: Aleksey Shustov  
**Last Updated**: February 2, 2026
