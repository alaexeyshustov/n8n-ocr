import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ecr_assets from "aws-cdk-lib/aws-ecr-assets";
import * as applicationautoscaling from "aws-cdk-lib/aws-applicationautoscaling";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";

export interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
  fileSystem: efs.IFileSystem;
  accessPoint: efs.IAccessPoint;
  docBucket: s3.IBucket;
  table: dynamodb.ITable;
  mistralApiKeySecret: secretsmanager.ISecret;
  awsAccessKeyIdSecret: secretsmanager.ISecret;
  awsSecretAccessKeySecret: secretsmanager.ISecret;
  lambdaFunctionUrlSecret: secretsmanager.ISecret;
}

/**
 * ECS Stack
 * Contains: ECS Cluster, Task Definitions, Container Definitions, ECS Service
 */
export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly n8nImage: ecr_assets.DockerImageAsset;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // ============================================================
    // CUSTOM N8N DOCKER IMAGE WITH WORKFLOWS
    // ============================================================

    this.n8nImage = new ecr_assets.DockerImageAsset(this, "N8nCustomImage", {
      directory: path.join(__dirname, ".."),
      file: "Dockerfile",
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    // ============================================================
    // ECS CLUSTER WITH SPOT CAPACITY
    // ============================================================

    this.cluster = new ecs.Cluster(this, "N8nCluster", {
      vpc: props.vpc,
      clusterName: "n8n-cluster",
      containerInsights: true,
    });


    // ============================================================
    // ECS TASK DEFINITION
    // ============================================================

    const taskRole = new iam.Role(this, "N8nTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Grant task permissions
    props.docBucket.grantReadWrite(taskRole);
    props.table.grantReadWriteData(taskRole);
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
    const executionRole = new iam.Role(this, "N8nTaskExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy",
        ),
      ],
    });

    // Grant execution role permission to read secrets
    props.mistralApiKeySecret.grantRead(executionRole);
    props.awsAccessKeyIdSecret.grantRead(executionRole);
    props.awsSecretAccessKeySecret.grantRead(executionRole);
    props.lambdaFunctionUrlSecret.grantRead(executionRole);

    const taskDefinition = new ecs.FargateTaskDefinition(this, "N8nTaskDef", {
      taskRole: taskRole,
      executionRole: executionRole,
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    // Add EFS volume to task
    taskDefinition.addVolume({
      name: "n8n-data",
      efsVolumeConfiguration: {
        fileSystemId: props.fileSystem.fileSystemId,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: props.accessPoint.accessPointId,
          iam: "ENABLED",
        },
      },
    });

    const logGroup = new logs.LogGroup(this, "N8nLogGroup", {
      logGroupName: "/ecs/n8n",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const container = taskDefinition.addContainer("n8n", {
      image: ecs.ContainerImage.fromDockerImageAsset(this.n8nImage),
      environment: {
        N8N_SECURE_COOKIE: "false",
        S3_BUCKET_NAME: props.docBucket.bucketName,
      },
      secrets: {
        MISTRAL_API_KEY: ecs.Secret.fromSecretsManager(
          props.mistralApiKeySecret,
        ),
        AWS_ACCESS_KEY_ID: ecs.Secret.fromSecretsManager(
          props.awsAccessKeyIdSecret,
        ),
        AWS_SECRET_ACCESS_KEY: ecs.Secret.fromSecretsManager(
          props.awsSecretAccessKeySecret,
        ),
        LAMBDA_STATE_MANAGER_URL: ecs.Secret.fromSecretsManager(
          props.lambdaFunctionUrlSecret,
        ),
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "n8n",
        logGroup: logGroup,
      }),
      portMappings: [
        {
          containerPort: 5678,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    container.addMountPoints({
      sourceVolume: "n8n-data",
      containerPath: "/home/node/.n8n",
      readOnly: false,
    });

    // Grant task role permission to access EFS
    props.fileSystem.grant(
      taskDefinition.taskRole,
      "elasticfilesystem:ClientMount",
      "elasticfilesystem:ClientWrite",
    );

    // ============================================================
    // ECS SERVICE
    // ============================================================

    this.service = new ecs.FargateService(this, "N8nService", {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 1,
      enableExecuteCommand: true,
      assignPublicIp: true,
      securityGroups: [props.securityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Allow service to access EFS
    props.fileSystem.connections.allowDefaultPortFrom(this.service);

    // ============================================================
    // SCHEDULED SCALING (Turn off at night)
    // ============================================================

    const scaling = this.service.autoScaleTaskCount({
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
        hour: "9",
        minute: "0",
      }),
      minCapacity: 1,
      maxCapacity: 1,
    });

    // ============================================================
    // OUTPUTS
    // ============================================================


    new cdk.CfnOutput(this, "N8nClusterName", {
      value: this.cluster.clusterName,
      description: "ECS Cluster name - use AWS Console to find instance IP",
    });

    new cdk.CfnOutput(this, "N8nServiceName", {
      value: this.service.serviceName,
      description: "ECS Service name",
    });

    new cdk.CfnOutput(this, "N8nAccessInfo", {
      value:
        "Use AWS Console > ECS > Cluster > Service > Tasks > Network > Public IP to access n8n at port 5678",
      description: "How to find n8n URL",
    });

    new cdk.CfnOutput(this, "N8nDockerImageUri", {
      value: this.n8nImage.imageUri,
      description: "Custom n8n Docker image with workflows",
    });
  }
}
