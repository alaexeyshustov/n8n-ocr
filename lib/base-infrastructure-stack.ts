import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

/**
 * Base Infrastructure Stack
 * Contains: VPC, Security Groups, IAM Roles/Users, S3 Bucket, EFS, Secrets
 */
export class BaseInfrastructureStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly docBucket: s3.Bucket;
  public readonly fileSystem: efs.FileSystem;
  public readonly accessPoint: efs.AccessPoint;
  public readonly n8nUser: iam.User;
  public readonly mistralApiKeySecret: secretsmanager.ISecret;
  public readonly awsAccessKeyIdSecret: secretsmanager.ISecret;
  public readonly awsSecretAccessKeySecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================================
    // VPC
    // ============================================================

    this.vpc =
      ec2.Vpc.fromLookup(this, "DefaultVPC", { isDefault: true }) ||
      new ec2.Vpc(this, "NewVPC", { maxAzs: 2 });

    // ============================================================
    // SECURITY GROUP
    // ============================================================

    this.securityGroup = new ec2.SecurityGroup(this, "N8nSecurityGroup", {
      vpc: this.vpc,
      description: "Security group for n8n ECS instances",
      allowAllOutbound: true,
    });
    // Note: No default ingress rule - use add-my-ip.sh script to add your current IP

    // ============================================================
    // S3 BUCKET
    // ============================================================

    this.docBucket = new s3.Bucket(this, "DocProcessingBucket", {
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
      lifecycleRules: [
        {
          id: "DeleteTmpFiles",
          prefix: "tmp/",
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    // ============================================================
    // EFS FOR PERSISTENT STORAGE
    // ============================================================

    this.fileSystem = new efs.FileSystem(this, "N8nFileSystem", {
      vpc: this.vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.accessPoint = this.fileSystem.addAccessPoint("N8nAccessPoint", {
      path: "/n8n-data",
      createAcl: {
        ownerUid: "1000",
        ownerGid: "1000",
        permissions: "755",
      },
      posixUser: {
        uid: "1000",
        gid: "1000",
      },
    });

    // ============================================================
    // SECRETS MANAGER
    // ============================================================

    this.mistralApiKeySecret = new secretsmanager.Secret(
      this,
      "MistralApiKey",
      {
        secretName: "n8n/mistral-api-key",
        description: "Mistral AI API key for OCR in n8n workflows",
        secretStringValue: cdk.SecretValue.unsafePlainText(
          "PLACEHOLDER_REPLACE_AFTER_DEPLOYMENT",
        ),
      },
    );

    // ============================================================
    // IAM USER FOR N8N (AUTO-GENERATED CREDENTIALS)
    // ============================================================

    this.n8nUser = new iam.User(this, "N8nBotUser", {
      userName: "n8n-bot-user",
    });

    // Give it Admin access to S3, DynamoDB, Bedrock
    this.n8nUser.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
    );
    this.n8nUser.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess"),
    );
    this.n8nUser.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonBedrockFullAccess"),
    );

    // Grant permission to read Mistral API key from Secrets Manager
    this.mistralApiKeySecret.grantRead(this.n8nUser);

    // Generate Access Key
    const accessKey = new iam.AccessKey(this, "N8nBotKey", {
      user: this.n8nUser,
    });

    // Store AWS credentials in Secrets Manager
    this.awsAccessKeyIdSecret = new secretsmanager.Secret(
      this,
      "AwsAccessKeyId",
      {
        secretName: "n8n/aws-access-key-id",
        description: "AWS Access Key ID for n8n",
        secretStringValue: cdk.SecretValue.unsafePlainText(
          accessKey.accessKeyId,
        ),
      },
    );

    this.awsSecretAccessKeySecret = new secretsmanager.Secret(
      this,
      "AwsSecretAccessKey",
      {
        secretName: "n8n/aws-secret-access-key",
        description: "AWS Secret Access Key for n8n",
        secretStringValue: accessKey.secretAccessKey,
      },
    );

    // ============================================================
    // OUTPUTS
    // ============================================================

    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      exportName: "N8n-VpcId",
    });

    new cdk.CfnOutput(this, "SecurityGroupId", {
      value: this.securityGroup.securityGroupId,
      description: "Security Group ID for n8n ECS instances - use add-my-ip.sh to add your IP",
      exportName: "N8n-SecurityGroupId",
    });

    new cdk.CfnOutput(this, "BucketName", {
      value: this.docBucket.bucketName,
      exportName: "N8n-BucketName",
    });

    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.fileSystem.fileSystemId,
      description: "EFS File System ID for persistent storage",
      exportName: "N8n-FileSystemId",
    });

    new cdk.CfnOutput(this, "MistralApiKeySecretArn", {
      value: this.mistralApiKeySecret.secretArn,
      description:
        "Mistral API Key Secret ARN - Update value in AWS Console after deployment",
    });

    new cdk.CfnOutput(this, "MistralApiKeySecretName", {
      value: this.mistralApiKeySecret.secretName,
      description: "Mistral API Key Secret Name",
    });
  }
}
