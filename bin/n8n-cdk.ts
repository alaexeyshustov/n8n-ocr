#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib/core';
import { BaseInfrastructureStack } from '../lib/base-infrastructure-stack';
import { StateMachineStack } from '../lib/state-machine-stack';
import { EcsStack } from '../lib/ecs-stack';

const app = new cdk.App();

const env = {
  account: process.env.AWS_ACCOUNT_ID || process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION
};

// Deploy stacks in order of dependencies
const baseStack = new BaseInfrastructureStack(app, 'N8nBaseInfrastructure', { env });

const stateMachineStack = new StateMachineStack(app, 'N8nStateMachine', {
  env,
  n8nUser: baseStack.n8nUser,
});

const ecsStack = new EcsStack(app, 'N8nEcsService', {
  env,
  vpc: baseStack.vpc,
  fileSystem: baseStack.fileSystem,
  securityGroup: baseStack.securityGroup,
  accessPoint: baseStack.accessPoint,
  docBucket: baseStack.docBucket,
  table: stateMachineStack.table,
  mistralApiKeySecret: baseStack.mistralApiKeySecret,
  awsAccessKeyIdSecret: baseStack.awsAccessKeyIdSecret,
  awsSecretAccessKeySecret: baseStack.awsSecretAccessKeySecret,
  lambdaFunctionUrlSecret: stateMachineStack.lambdaFunctionUrlSecret,
  n8nBasicAuthUserSecret: baseStack.n8nBasicAuthUserSecret,
  n8nBasicAuthPasswordSecret: baseStack.n8nBasicAuthPasswordSecret,
});
