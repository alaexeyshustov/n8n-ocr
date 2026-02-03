import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "path";

export interface StateMachineStackProps extends cdk.StackProps {
  n8nUser: iam.IUser;
}

/**
 * State Machine Stack
 * Contains: DynamoDB Table, Lambda Function for state management
 */
export class StateMachineStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly stateManagerFunction: lambda.Function;
  public readonly lambdaFunctionUrl: lambda.FunctionUrl;
  public readonly lambdaFunctionUrlSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: StateMachineStackProps) {
    super(scope, id, props);

    // ============================================================
    // DYNAMODB TABLE
    // ============================================================

    this.table = new dynamodb.Table(this, "DocPipelineTable", {
      tableName: "DocPipeline",
      partitionKey: { name: "file_name", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ============================================================
    // LAMBDA FUNCTION FOR DYNAMODB STATE MANAGEMENT
    // ============================================================

    this.stateManagerFunction = new lambda.Function(
      this,
      "StateManagerFunction",
      {
        functionName: "n8n-doc-pipeline-state-manager",
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "state-manager.lambda_handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../lambda")),
        environment: {
          TABLE_NAME: this.table.tableName,
        },
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        description:
          "Manages document processing state in DynamoDB for n8n workflows",
      },
    );

    // Grant Lambda permissions to access DynamoDB
    this.table.grantReadWriteData(this.stateManagerFunction);

    // Create Function URL for easy invocation from n8n
    this.lambdaFunctionUrl = this.stateManagerFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.POST, lambda.HttpMethod.GET],
        allowedHeaders: ["*"],
      },
    });

    // Store Lambda Function URL in Secrets Manager
    this.lambdaFunctionUrlSecret = new secretsmanager.Secret(
      this,
      "LambdaFunctionUrl",
      {
        secretName: "n8n/lambda-function-url",
        description: "Lambda State Manager Function URL",
        secretStringValue: cdk.SecretValue.unsafePlainText(
          this.lambdaFunctionUrl.url,
        ),
      },
    );

    // ============================================================
    // IAM PERMISSIONS FOR N8N USER
    // ============================================================

    // Grant permission to invoke the state manager Lambda
    this.stateManagerFunction.grantInvoke(props.n8nUser);
    this.stateManagerFunction.grantInvokeUrl(props.n8nUser);

    // ============================================================
    // OUTPUTS
    // ============================================================

    new cdk.CfnOutput(this, "TableName", {
      value: this.table.tableName,
      exportName: "N8n-TableName",
    });

    new cdk.CfnOutput(this, "StateManagerFunctionUrl", {
      value: this.lambdaFunctionUrl.url,
      description: "Lambda Function URL for state management",
      exportName: "N8n-StateManagerFunctionUrl",
    });

    new cdk.CfnOutput(this, "StateManagerFunctionName", {
      value: this.stateManagerFunction.functionName,
      description: "Lambda Function Name",
    });
  }
}
