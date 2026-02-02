import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class N8NCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CONFIGURATION
    // Using a popular community mirror from ECR Public to avoid Docker Hub limits
    // You can search gallery.ecr.aws for other mirrors if preferred
    const PUBLIC_ECR_IMAGE = 'n8nio/n8n:latest';

    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true }) || 
                new ec2.Vpc(this, 'NewVPC', { maxAzs: 2 });
    
    // CRITICAL: We must pick a specific Availability Zone (AZ)
    // because EBS volumes can only attach to instances in the same AZ.
    const targetAz = vpc.availabilityZones[0]; 

    const securityGroup = new ec2.SecurityGroup(this, 'N8nSecurityGroup', {
      vpc,
      description: 'Allow SSH and N8N web access',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.ipv4('89.186.158.150/32'), 
      ec2.Port.tcp(5678),
       'Allow N8N Web UI'
    );

    const docBucket = new s3.Bucket(this, 'DocProcessingBucket', {
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
      lifecycleRules: [{ id: 'DeleteTmpFiles', prefix: 'tmp/', expiration: cdk.Duration.days(1) }]
    });
    
    const table = new dynamodb.Table(this, 'DocPipelineTable', {
      tableName: 'DocPipeline',
      partitionKey: { name: 'file_name', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    const role = new iam.Role(this, 'N8nInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    // SSM & CloudWatch Permissions
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'));
    
        // Grant Access to S3 Bucket
    docBucket.grantReadWrite(role);

    // Grant Access to DynamoDB Table
    table.grantReadWriteData(role);

    // Application Permissions (Bedrock & S3)
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:List*', 's3:Get*', 's3:Put*', 's3:Delete*'],
      resources: ['*'],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:ListFoundationModels',
        'bedrock:GetFoundationModel'
      ],
      resources: ['*'],
    }));

    // 4. Create Persistent Storage (EBS Volume)
    const volume = new ec2.Volume(this, 'N8nDataVolume', {
      availabilityZone: targetAz, // Must match instance
      size: cdk.Size.gibibytes(10), // 10 GB Storage
      encrypted: true,
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // CRITICAL: Keeps data if stack is destroyed
    });

    // User Data Script
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      // --- OS Setup ---
      'yum update -y',
      'yum install -y docker python3 python3-pip', 
      'service docker start',
      'usermod -a -G docker ec2-user',
      'chkconfig docker on',

      // --- MOUNT PERSISTENT VOLUME ---
      // 1. Identify the device. On T3 instances, /dev/sdf often shows up as /dev/nvme1n1
      // We check for the NVMe device that is NOT the root volume.
      'DEVICE="/dev/sdf"',
      'if [ -e /dev/nvme1n1 ]; then DEVICE="/dev/nvme1n1"; fi',
      
      // 2. Wait for device to attach
      'while [ ! -e $DEVICE ]; do echo "Waiting for disk $DEVICE"; sleep 5; done',

      // 3. Format the disk (ONLY if it has no data/filesystem yet)
      'blkid $DEVICE || mkfs -t xfs $DEVICE',

      // 4. Create Mount Point
      'mkdir -p /home/ec2-user/.n8n',
      
      // 5. Mount the volume
      'mount $DEVICE /home/ec2-user/.n8n',
      
      // 6. Add to fstab (so it mounts automatically on reboot)
      'echo "$DEVICE /home/ec2-user/.n8n xfs defaults,nofail 0 2" >> /etc/fstab',

      // 7. Fix Permissions (Container User 1000 needs to own the mounted drive)
      'chown -R 1000:1000 /home/ec2-user/.n8n',
      // -------------------------------

      // --- Start n8n ---
      `docker run -d --name n8n -p 5678:5678 --restart unless-stopped -e N8N_SECURE_COOKIE=false -v /home/ec2-user/.n8n:/home/node/.n8n ${PUBLIC_ECR_IMAGE}`,

      // --- Post-Start: Install Python in Container ---
      'sleep 10',
      'docker exec -u 0 n8n apk add --update --no-cache python3 py3-pip',
      'docker restart n8n'
    );

    const instance = new ec2.Instance(this, 'N8nInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: securityGroup,
      availabilityZone: targetAz, // Force instance to same AZ as volume
      role: role,
      userData: userData,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // 7. Attach Volume to Instance
    // This tells AWS to plug the USB stick (Volume) into the Computer (Instance)
    new ec2.CfnVolumeAttachment(this, 'N8nVolumeAttachment', {
      volumeId: volume.volumeId,
      instanceId: instance.instanceId,
      device: '/dev/sdf', // Linux sees this device
    });

       // ============================================================
       // 7. OUTPUTS (URL & Resource Names)
       // ============================================================
       new cdk.CfnOutput(this, 'N8nUrl', { value: `http://${instance.instancePublicIp}:5678` });
       new cdk.CfnOutput(this, 'BucketName', { value: docBucket.bucketName });
       new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
   
       // ============================================================
       // 8. IAM USER FOR N8N (AUTO-GENERATED CREDENTIALS)
       // ============================================================
       
       // Create the User
       const n8nUser = new iam.User(this, 'N8nBotUser', {
         userName: 'n8n-bot-user',
       });
   
       // Give it Admin access to S3, DynamoDB, Bedrock (Simplifies n8n setup)
       n8nUser.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'));
       n8nUser.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
       n8nUser.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess'));
   
       // Generate Access Key
       const accessKey = new iam.AccessKey(this, 'N8nBotKey', {
         user: n8nUser,
       });
   
       // OUTPUT THE KEYS
       // Warning: This displays the Secret Key in your terminal/CloudFormation console.
       // For a dev environment this is fine, but avoid for strictly regulated production.
       new cdk.CfnOutput(this, 'N8nAccessKeyId', {
         value: accessKey.accessKeyId,
         description: 'Copy this to n8n Credential',
       });
   
       new cdk.CfnOutput(this, 'N8nSecretAccessKey', {
         value: accessKey.secretAccessKey.unsafeUnwrap(),
         description: 'Copy this to n8n Credential',
       });
  }
}
