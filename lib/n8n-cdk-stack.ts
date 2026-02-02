import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as applicationautoscaling from "aws-cdk-lib/aws-applicationautoscaling";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";

interface N8nEcsServiceProps {
  vpc: ec2.IVpc;
  fileSystem: efs.FileSystem;
  accessPoint: efs.AccessPoint;
  n8nImage: ecr_assets.DockerImageAsset;
  docBucket: s3.Bucket;
  table: dynamodb.Table;
  secrets: {
    mistralApiKey: secretsmanager.ISecret;
    awsAccessKeyId: secretsmanager.ISecret;
    awsSecretAccessKey: secretsmanager.ISecret;
    lambdaFunctionUrl: secretsmanager.ISecret;
  };
  bucketName: string;
}

interface N8nEcsServiceResult {
  cluster: ecs.Cluster;
  service: ecs.Ec2Service;
}

/**
 * Creates ECS infrastructure for running n8n on Spot instances with scheduled scaling
 */
function createN8nEcsService(
  scope: Construct,
  props: N8nEcsServiceProps,
): N8nEcsServiceResult {
  const { vpc, fileSystem, accessPoint, n8nImage, docBucket, table } = props;

  // ============================================================
  // ECS CLUSTER WITH SPOT CAPACITY
  // ============================================================

  const cluster = new ecs.Cluster(scope, "N8nCluster", {
    vpc,
    clusterName: "n8n-cluster",
    containerInsights: true,
  });

  // Add EC2 Spot capacity provider
  const capacityProvider = new ecs.AsgCapacityProvider(
    scope,
    "SpotCapacityProvider",
    {
      autoScalingGroup: cluster.addCapacity("SpotCapacity", {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.T3,
          ec2.InstanceSize.SMALL,
        ),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
        spotPrice: "0.0104", // t3.small spot price
        desiredCapacity: 1,
        minCapacity: 0,
        maxCapacity: 1,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
      }),
      enableManagedTerminationProtection: false,
      spotInstanceDraining: true,
    },
  );

  cluster.addAsgCapacityProvider(capacityProvider);

  // ============================================================
  // ECS TASK DEFINITION
  // ============================================================

  const taskRole = new iam.Role(scope, "N8nTaskRole", {
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
  });

  // Grant task permissions
  docBucket.grantReadWrite(taskRole);
  table.grantReadWriteData(taskRole);
  taskRole.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListFoundationModels",
        "bedrock:GetFoundationModel",
      ],
      resources: ["*"],
    }),
  );

  // Task execution role for pulling images and accessing secrets
  const executionRole = new iam.Role(scope, "N8nTaskExecutionRole", {
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy",
      ),
    ],
  });

  // Grant execution role permission to read secrets
  props.secrets.mistralApiKey.grantRead(executionRole);
  props.secrets.awsAccessKeyId.grantRead(executionRole);
  props.secrets.awsSecretAccessKey.grantRead(executionRole);
  props.secrets.lambdaFunctionUrl.grantRead(executionRole);

  const taskDefinition = new ecs.Ec2TaskDefinition(scope, "N8nTaskDef", {
    taskRole: taskRole,
    executionRole: executionRole,
    networkMode: ecs.NetworkMode.BRIDGE,
  });

  // Add EFS volume to task
  taskDefinition.addVolume({
    name: "n8n-data",
    efsVolumeConfiguration: {
      fileSystemId: fileSystem.fileSystemId,
      transitEncryption: "ENABLED",
      authorizationConfig: {
        accessPointId: accessPoint.accessPointId,
        iam: "ENABLED",
      },
    },
  });

  const logGroup = new logs.LogGroup(scope, "N8nLogGroup", {
    logGroupName: "/ecs/n8n",
    retention: logs.RetentionDays.ONE_WEEK,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
  });

  const container = taskDefinition.addContainer("n8n", {
    image: ecs.ContainerImage.fromDockerImageAsset(n8nImage),
    memoryReservationMiB: 512,
    cpu: 256,
    environment: {
      N8N_SECURE_COOKIE: "false",
      S3_BUCKET_NAME: props.bucketName,
    },
    secrets: {
      MISTRAL_API_KEY: ecs.Secret.fromSecretsManager(
        props.secrets.mistralApiKey,
      ),
      AWS_ACCESS_KEY_ID: ecs.Secret.fromSecretsManager(
        props.secrets.awsAccessKeyId,
      ),
      AWS_SECRET_ACCESS_KEY: ecs.Secret.fromSecretsManager(
        props.secrets.awsSecretAccessKey,
      ),
      LAMBDA_STATE_MANAGER_URL: ecs.Secret.fromSecretsManager(
        props.secrets.lambdaFunctionUrl,
      ),
    },
    logging: ecs.LogDriver.awsLogs({
      streamPrefix: "n8n",
      logGroup: logGroup,
    }),
    portMappings: [
      {
        containerPort: 5678,
        hostPort: 5678,
        protocol: ecs.Protocol.TCP,
      },
    ],
  });

  container.addMountPoints({
    sourceVolume: "n8n-data",
    containerPath: "/home/node/.n8n",
    readOnly: false,
  });

  // Grant task execution role permission to access EFS
  fileSystem.grant(
    taskDefinition.taskRole,
    "elasticfilesystem:ClientMount",
    "elasticfilesystem:ClientWrite",
  );

  // ============================================================
  // ECS SERVICE
  // ============================================================

  const service = new ecs.Ec2Service(scope, "N8nService", {
    cluster,
    taskDefinition,
    desiredCount: 1,
    capacityProviderStrategies: [
      {
        capacityProvider: capacityProvider.capacityProviderName,
        weight: 1,
        base: 0,
      },
    ],
    enableExecuteCommand: true,
  });

  // Allow service to access EFS
  fileSystem.connections.allowDefaultPortFrom(service);

  // ============================================================
  // SCHEDULED SCALING (Turn off at night)
  // ============================================================

  const scaling = service.autoScaleTaskCount({
    minCapacity: 0,
    maxCapacity: 1,
  });

  // Scale down to 0 at 10 PM UTC (turn off)
  scaling.scaleOnSchedule("ScaleDownAtNight", {
    schedule: applicationautoscaling.Schedule.cron({
      hour: "22",
      minute: "0",
    }),
    minCapacity: 0,
    maxCapacity: 0,
  });

  // Scale up to 1 at 8 AM UTC (turn on)
  scaling.scaleOnSchedule("ScaleUpInMorning", {
    schedule: applicationautoscaling.Schedule.cron({
      hour: "8",
      minute: "0",
    }),
    minCapacity: 1,
    maxCapacity: 1,
  });

  return { cluster, service };
}

export class N8NCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================================
    // CUSTOM N8N DOCKER IMAGE WITH WORKFLOWS
    // ============================================================

    // Build custom Docker image with workflows baked in
    const n8nImage = new ecr_assets.DockerImageAsset(this, "N8nCustomImage", {
      directory: path.join(__dirname, ".."),
      file: "Dockerfile",
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    const vpc =
      ec2.Vpc.fromLookup(this, "DefaultVPC", { isDefault: true }) ||
      new ec2.Vpc(this, "NewVPC", { maxAzs: 2 });

    const securityGroup = new ec2.SecurityGroup(this, "N8nSecurityGroup", {
      vpc,
      description: "Allow N8N web access and EFS",
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(
      ec2.Peer.ipv4("172.16.0.0/12"),
      ec2.Port.tcp(5678),
      "Allow N8N Web UI",
    );

    const docBucket = new s3.Bucket(this, "DocProcessingBucket", {
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

    const table = new dynamodb.Table(this, "DocPipelineTable", {
      tableName: "DocPipeline",
      partitionKey: { name: "file_name", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // ============================================================
    // LAMBDA FUNCTION FOR DYNAMODB STATE MANAGEMENT
    // ============================================================

    const stateManagerFunction = new lambda.Function(
      this,
      "StateManagerFunction",
      {
        functionName: "n8n-doc-pipeline-state-manager",
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "state-manager.lambda_handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda")),
        environment: {
          TABLE_NAME: table.tableName,
        },
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        description:
          "Manages document processing state in DynamoDB for n8n workflows",
      },
    );

    // Grant Lambda permissions to access DynamoDB
    table.grantReadWriteData(stateManagerFunction);

    // Create Function URL for easy invocation from n8n
    const functionUrl = stateManagerFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.POST, lambda.HttpMethod.GET],
        allowedHeaders: ["*"],
      },
    });

    // ============================================================
    // SECRETS MANAGER
    // ============================================================

    const mistralApiKeySecret = new secretsmanager.Secret(
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

    // Create the User
    const n8nUser = new iam.User(this, "N8nBotUser", {
      userName: "n8n-bot-user",
    });

    // Give it Admin access to S3, DynamoDB, Bedrock (Simplifies n8n setup)
    n8nUser.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
    );
    n8nUser.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess"),
    );
    n8nUser.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonBedrockFullAccess"),
    );

    // Grant permission to invoke the state manager Lambda
    stateManagerFunction.grantInvoke(n8nUser);
    stateManagerFunction.grantInvokeUrl(n8nUser);

    // Grant permission to read Mistral API key from Secrets Manager
    mistralApiKeySecret.grantRead(n8nUser);

    // Generate Access Key
    const accessKey = new iam.AccessKey(this, "N8nBotKey", {
      user: n8nUser,
    });

    // Store AWS credentials in Secrets Manager for ECS task
    const awsAccessKeyIdSecret = new secretsmanager.Secret(
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

    const awsSecretAccessKeySecret = new secretsmanager.Secret(
      this,
      "AwsSecretAccessKey",
      {
        secretName: "n8n/aws-secret-access-key",
        description: "AWS Secret Access Key for n8n",
        secretStringValue: accessKey.secretAccessKey,
      },
    );

    // Store Lambda Function URL in Secrets Manager
    const lambdaFunctionUrlSecret = new secretsmanager.Secret(
      this,
      "LambdaFunctionUrl",
      {
        secretName: "n8n/lambda-function-url",
        description: "Lambda State Manager Function URL",
        secretStringValue: cdk.SecretValue.unsafePlainText(functionUrl.url),
      },
    );

    // ============================================================
    // EFS FOR PERSISTENT STORAGE
    // ============================================================

    const fileSystem = new efs.FileSystem(this, "N8nFileSystem", {
      vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      securityGroup: securityGroup,
    });

    const accessPoint = fileSystem.addAccessPoint("N8nAccessPoint", {
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
    // ECS SERVICE FOR N8N
    // ============================================================

    const { cluster, service } = createN8nEcsService(this, {
      vpc,
      fileSystem,
      accessPoint,
      n8nImage,
      docBucket,
      table,
      secrets: {
        mistralApiKey: mistralApiKeySecret,
        awsAccessKeyId: awsAccessKeyIdSecret,
        awsSecretAccessKey: awsSecretAccessKeySecret,
        lambdaFunctionUrl: lambdaFunctionUrlSecret,
      },
      bucketName: docBucket.bucketName,
    });

    // ============================================================
    // OUTPUTS (URL & Resource Names)
    // ============================================================

    new cdk.CfnOutput(this, "N8nClusterName", {
      value: cluster.clusterName,
      description: "ECS Cluster name - use AWS Console to find instance IP",
    });

    new cdk.CfnOutput(this, "N8nServiceName", {
      value: service.serviceName,
      description: "ECS Service name",
    });

    new cdk.CfnOutput(this, "N8nAccessInfo", {
      value:
        "Use AWS Console > ECS > Cluster > Service > Tasks > Network > Public IP to access n8n at port 5678",
      description: "How to find n8n URL",
    });

    new cdk.CfnOutput(this, "BucketName", { value: docBucket.bucketName });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "FileSystemId", {
      value: fileSystem.fileSystemId,
      description: "EFS File System ID for persistent storage",
    });

    // ============================================================
    // OUTPUTS
    // ============================================================

    new cdk.CfnOutput(this, "StateManagerFunctionUrl", {
      value: functionUrl.url,
      description: "Lambda Function URL for state management",
    });

    new cdk.CfnOutput(this, "StateManagerFunctionName", {
      value: stateManagerFunction.functionName,
      description: "Lambda Function Name",
    });

    new cdk.CfnOutput(this, "MistralApiKeySecretArn", {
      value: mistralApiKeySecret.secretArn,
      description:
        "Mistral API Key Secret ARN - Update value in AWS Console after deployment",
    });

    new cdk.CfnOutput(this, "MistralApiKeySecretName", {
      value: mistralApiKeySecret.secretName,
      description: "Mistral API Key Secret Name",
    });

    new cdk.CfnOutput(this, "N8nDockerImageUri", {
      value: n8nImage.imageUri,
      description: "Custom n8n Docker image with workflows",
    });
  }
}
