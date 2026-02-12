# N8N on AWS CDK

Deploy a complete **n8n workflow automation platform** on AWS with persistent storage, document processing capabilities, and AWS service integrations.

## What This Deploys

- **n8n** workflow automation tool running on **ECS with Fargate** for serverless container management
- **Basic Authentication** protecting the web UI with auto-generated credentials
- **Scheduled scaling** to turn off at night (10 PM UTC) and on in the morning (9 AM UTC)
- **Persistent EFS volume** to retain n8n data across task restarts
- **S3 bucket** for document processing/storage
- **DynamoDB table** for tracking document pipeline states
- **Lambda function** for reliable state management (Python 3.12)
- **AWS Bedrock** access for AI/ML capabilities
- **IAM credentials** automatically generated for n8n to access AWS services
- **Custom Docker image** with workflows baked in, stored in ECR
- Sample **OCR workflow** for document processing

## Architecture

```
┌────────────────────────────────────────────────────┐
│  ECS Cluster (n8n-cluster)                         │
│  ┌──────────────────────────────────────┐          │
│  │  Fargate Task                        │          │
│  │  ┌────────────────────────────────┐  │          │
│  │  │ ECS Task: n8n (custom image)   │  │          │
│  │  │ Port 5678 (Web UI)             │  │          │
│  │  │ 🔒 Basic Auth Protected        │  │          │
│  │  └────────────────────────────────┘  │          │
│  └──────────────────────────────────────┘          │
│           ↓ mounted volume                         │
│  ┌──────────────────────────────────────┐          │
│  │  EFS File System (encrypted)         │          │
│  │  /home/node/.n8n                     │          │
│  └──────────────────────────────────────┘          │
│                                                    │
│  Scheduled Scaling:                                │
│  • Scale down to 0 at 10 PM UTC (night)            │
│  • Scale up to 1 at 9 AM UTC (morning)             │
└────────────────────────────────────────────────────┘
              ↓ Task IAM Role with permissions
┌─────────────────────────────────────────────────────┐
│  AWS Resources:                                     │
│  - ECR Repository (custom n8n image)                │
│  - S3 Bucket (DocProcessingBucket)                  │
│  - DynamoDB Table (DocPipeline)                     │
│  - Lambda Function (State Manager)                  │
│    └─ Function URL: HTTPS endpoint                  │
│  - IAM User (n8n-bot-user) with access keys         │
│  - Bedrock API access                               │
│  - Secrets Manager:                                 │
│    ├─ Mistral API key                               │
│    ├─ Basic Auth Username (admin)                   │
│    └─ Basic Auth Password (auto-generated)          │
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

### 2. Configure Environment Variables

Create a `.env` file in the project root with your AWS account details:

```bash
cp .env.example .env
```

Then edit `.env` with your actual values:

```bash
AWS_ACCOUNT_ID="your-account-id"
AWS_REGION="your-region"
```

### 3. Bootstrap CDK (First Time Only)

```bash
npx cdk bootstrap
```

### 4. Configure Security Group IP

⚠️ **Important**: Update the allowed IP address in [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts#L29)

Find your current IP:

```bash
curl ifconfig.me
```

Then update line 29 in [lib/n8n-cdk-stack.ts](lib/n8n-cdk-stack.ts):

```typescript
ec2.Peer.ipv4('YOUR.IP.ADDRESS.HERE/32'),
```

### 5. Build & Deploy

⚠️ **Note**: First deployment takes 5-10 minutes as it builds and pushes the custom Docker image to ECR.

```bash
npm run build
npx cdk deploy
```

### 6. Add Your IP to Security Group

The security group has no default ingress rules for security. Add your current public IP:

```bash
./add-my-ip.sh
```

This script will:
- Auto-detect your current public IP address
- Add an ingress rule to allow access to n8n on port 5678
- Check if your IP is already authorized before adding

**Note:** If your IP changes, run this script again to add the new IP.

### 7. Get the n8n URL

After deployment, get the n8n URL by running:

```bash
./bin/get-n8n-url.sh
```

Or manually via AWS Console:

1. Go to **ECS** → **Clusters** → **n8n-cluster**
2. Click on the service → **Tasks** tab
3. Click on the running task
4. Find the **Public IP** under Network section
5. Access n8n at `http://[PUBLIC_IP]:5678`

**Note:** The service scales down to 0 tasks at 10 PM UTC and scales back up to 1 task at 8 AM UTC. You can manually adjust the desired count in the ECS console if needed.

### 8. Get Basic Auth Credentials

n8n is protected with HTTP Basic Authentication. Retrieve your auto-generated credentials:

```bash
./bin/get-n8n-credentials.sh
```

This will display:
- **Username**: admin (default)
- **Password**: Auto-generated 16-character password

**To change the password:**

```bash
aws secretsmanager update-secret \
  --secret-id n8n/basic-auth-password \
  --secret-string "YOUR_NEW_PASSWORD"
```

Then restart the ECS task for the change to take effect.

### 9. About the Empty Credentials Section

⚠️ **IMPORTANT**: When you first log in to n8n, **Settings → Credentials will be EMPTY**. This is normal!

**Why?** n8n does NOT automatically create credential entries from environment variables.

**What to do?** You have two options:

1. **Use environment variables directly** in workflows: `{{ $env.AWS_ACCESS_KEY_ID }}`
2. **Create credential entries manually** in Settings → Credentials

📖 **See [docs/EMPTY-CREDENTIALS-EXPLAINED.md](docs/EMPTY-CREDENTIALS-EXPLAINED.md)** for detailed explanation and step-by-step guide.

📋 **Fresh deployment checklist**: [docs/FRESH-DEPLOYMENT-CHECKLIST.md](docs/FRESH-DEPLOYMENT-CHECKLIST.md) - Verify everything is working correctly.

### 10. Save the Deployment Outputs

After deployment, save these values from the CDK outputs:

- **N8nClusterName** - ECS cluster name
- **N8nServiceName** - ECS service name
- **BucketName** - S3 bucket name
- **TableName** - DynamoDB table name
- **FileSystemId** - EFS file system ID for persistent storage
- **StateManagerFunctionUrl** - Lambda Function URL for state management
- **StateManagerFunctionName** - Lambda Function name
- **MistralApiKeySecretArn** - Secret ARN for Mistral API key
- **MistralApiKeySecretName** - Secret name (n8n/mistral-api-key)
- **N8nAccessKeyId** - AWS Access Key for n8n
- **N8nSecretAccessKey** - AWS Secret Key (⚠️ sensitive!)
- **N8nDockerImageUri** - Custom Docker image URI in ECR

### 7. Update Mistral API Key in Secrets Manager

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

### 8. Configure Credentials in n8n UI

⚠️ **Important**: On fresh deployment, the Credentials section in n8n will be **empty**. You must manually create credential entries.

While environment variables are available in the container, n8n does NOT automatically create credential entries from them. You have two options:

#### Option A: Use Environment Variables Directly (Simpler)

Access secrets in workflows using `{{ $env.VARIABLE_NAME }}`:

- `{{ $env.MISTRAL_API_KEY }}` - Mistral AI API key
- `{{ $env.AWS_ACCESS_KEY_ID }}` - AWS access key
- `{{ $env.AWS_SECRET_ACCESS_KEY }}` - AWS secret key  
- `{{ $env.LAMBDA_STATE_MANAGER_NAME }}` - Lambda Function Name (default: `n8n-doc-pipeline-state-manager`)
- `{{ $env.S3_BUCKET_NAME }}` - S3 bucket name

**Example in HTTP Request node:**
```
Header Name: Authorization
Header Value: Bearer {{ $env.MISTRAL_API_KEY }}
```

#### Option B: Create Credential Entries (Recommended for imported workflows)

The imported OCR workflow uses credential placeholders that need to be replaced:

**1. Create AWS Credential:**
- In n8n: Settings → Credentials → New Credential → "AWS"
- Access Key ID: Get from CloudFormation outputs or use `{{ $env.AWS_ACCESS_KEY_ID }}`
- Secret Access Key: Get from CloudFormation outputs or use `{{ $env.AWS_SECRET_ACCESS_KEY }}`
- Region: Your AWS region (e.g., `us-east-1`)
- Test and Save

**2. Create Mistral API Credential:**
- Settings → Credentials → New Credential → "Header Auth"
- Name: `Mistral API`
- Header Name: `Authorization`
- Header Value: `Bearer {{ $env.MISTRAL_API_KEY }}`
- Save

**3. Fix Workflow Credentials:**
- Open OCR Pipeline workflow
- Click "Fix credentials" button at top
- Assign your AWS credential to all Lambda nodes
- Save workflow

**Get CloudFormation outputs:**
```bash
aws cloudformation describe-stacks --stack-name N8nBaseInfrastructure \
  --query 'Stacks[0].Outputs'
```

Get your Mistral API key from: https://console.mistral.ai/

### 7. Configure n8n Environment

After accessing n8n, add these environment variables:

1. Go to **Settings** → **Environment Variables**
2. Add:
   - `LAMBDA_STATE_MANAGER_NAME` = `n8n-doc-pipeline-state-manager` (or use the function name from outputs)
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
2. **Set environment variable**: Add `LAMBDA_STATE_MANAGER_NAME` = `n8n-doc-pipeline-state-manager` (optional, this is the default)
3. Go to **Workflows** → **Import from File**
4. Upload [workflows/ocr.json](workflows/ocr.json)
5. Update the workflow:
   - Replace `AWS_CREDENTIAL_ID` with your AWS credentials ID (in all AWS Lambda and S3 nodes)
   - Set correct S3 bucket name (from deployment outputs)
   - The workflow now uses direct Lambda invocation for state management

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

⚠️ **On Fresh Deployment**: Settings → Credentials will be **EMPTY**. n8n does NOT auto-create credentials from environment variables.

**Two Ways to Use AWS Credentials:**

#### Quick Method: Use Environment Variables
In any node requiring AWS credentials, use expressions:
- Access Key: `{{ $env.AWS_ACCESS_KEY_ID }}`
- Secret Key: `{{ $env.AWS_SECRET_ACCESS_KEY }}`

#### Proper Method: Create Credential Entry
1. In n8n: **Settings** → **Credentials** → **New Credential**
2. Search for "AWS"
3. Choose how to enter credentials:
   
   **Option A - From CloudFormation Outputs:**
   ```bash
   # Get the actual values
   aws cloudformation describe-stacks --stack-name N8nBaseInfrastructure \
     --query 'Stacks[0].Outputs' --output table
   ```
   Copy/paste the Access Key ID and Secret Access Key values.
   
   **Option B - Reference Environment Variables:**
   - Access Key ID: `{{ $env.AWS_ACCESS_KEY_ID }}`
   - Secret Access Key: `{{ $env.AWS_SECRET_ACCESS_KEY }}`
   
4. Set your AWS region (e.g., `us-east-1`)
5. **Test connection** to verify credentials work
6. **Save** the credential

**After creating the credential:**
- Open the OCR Pipeline workflow  
- You'll see credential warnings on nodes (this is normal for imported workflows)
- Click **"Fix credentials"** button at the top
- Select your AWS credential from dropdown
- All nodes will be updated automatically

📖 **Troubleshooting**: If you get permission errors, see [docs/LAMBDA-PERMISSION-FIX.md](docs/LAMBDA-PERMISSION-FIX.md)

### Creating Mistral Credentials in n8n

⚠️ **On Fresh Deployment**: The Credentials section is **EMPTY**. You must create this manually.

**Two Ways to Use Mistral API Key:**

#### Quick Method: Use Environment Variable
In HTTP Request nodes calling Mistral API:
- Header Name: `Authorization`
- Header Value: `Bearer {{ $env.MISTRAL_API_KEY }}`

#### Proper Method: Create Credential Entry
1. In n8n: **Settings** → **Credentials** → **New Credential**
2. Search for "Header Auth"
3. Configure:
   - **Name**: `Mistral API`
   - **Header Name**: `Authorization`
   - **Header Value**: `Bearer {{ $env.MISTRAL_API_KEY }}`
     
     OR if you want to hardcode it:
     - **Header Value**: `Bearer YOUR_ACTUAL_MISTRAL_API_KEY`
     
4. **Test** (if using hardcoded key)
5. **Save**
6. Use this credential in the "Mistral OCR" HTTP Request node

**Get your Mistral API key from:** https://console.mistral.ai/

**Note**: The API key is also stored in AWS Secrets Manager (`n8n/mistral-api-key`) and the n8n IAM user has read access, so workflows can fetch it programmatically if needed.

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
