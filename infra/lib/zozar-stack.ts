import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, type BundlingOptions } from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { join } from 'node:path';

/**
 * ZO-ZAR infrastructure.
 *
 * Read docs/ARCHITECTURE.md before changing anything here. Two constraints in particular
 * are load-bearing and are enforced by this file rather than by convention:
 *
 * 1. Aiven's free PostgreSQL plan allows 20 connections and has no PgBouncer, and RDS
 *    Proxy cannot front a non-AWS database. Each Lambda uses a pg pool of max 1, and the
 *    reserved concurrency below is what caps how many containers can exist at once. The
 *    ceilings sum to 14, leaving headroom for migrations, psql and Aiven's own management
 *    connections. Raising any of them without re-checking the budget will exhaust the
 *    database rather than scale the API.
 *
 * 2. No VPC. Lambdas reach Aiven over its public TLS endpoint. Placing them in a VPC
 *    would require a NAT gateway at roughly $32/month, which is more than the rest of
 *    this stack costs put together. Security therefore rests on TLS and credentials, and
 *    the database certificate is verified against Aiven's project CA.
 */

const CONNECTION_BUDGET = {
  api: 8,
  websocket: 4,
  worker: 1,
} as const;

export type ZozarStackProps = StackProps & {
  /** SSM Parameter Store prefix holding the SecureString secrets, for example
   * `/zozar/prod`. Created outside this stack: CloudFormation cannot write a SecureString,
   * and putting secrets in a template would record them in the deployment history. */
  parameterPrefix: string;

  /**
   * When set (Learner Lab), all functions run as this pre-existing role because the lab
   * forbids creating roles.
   *
   * An AWS Academy Learner Lab denies `iam:CreateRole`, so the three execution roles this
   * stack would normally declare cannot be created. The lab instead provides `LabRole`,
   * which already carries the permissions the functions need. Leave this unset outside the
   * lab and every function gets its own least-privilege role, exactly as before.
   */
  lambdaRoleArn?: string;
};

export class ZozarStack extends Stack {
  constructor(scope: Construct, id: string, props: ZozarStackProps) {
    super(scope, id, props);

    const serverRoot = join(__dirname, '..', '..', 'server');

    /**
     * Learner Lab only: the single pre-existing execution role for all three functions.
     *
     * `mutable: false` tells CDK never to attach a policy to it: the lab blocks IAM
     * writes, so attaching one would fail at deploy time.
     * `addGrantsToResources: true` makes each grant that *can* be expressed on the other
     * side of the relationship land in that resource's own policy instead of being
     * silently discarded; see the comment on `readSecrets` below for the grants that have
     * no such other side.
     *
     * One consequence to be clear about: all three functions share this role, so the
     * per-function split below — the API reads and writes media, the worker only reads
     * and deletes — collapses into its union for the duration of a lab deployment. The
     * split stays in the code because outside the lab it is real.
     */
    const lambdaRole = props.lambdaRoleArn
      ? iam.Role.fromRoleArn(this, 'LambdaRole', props.lambdaRoleArn, {
          mutable: false,
          addGrantsToResources: true,
        })
      : undefined;

    /** Private media bucket. Nothing is public-read; every object is reached through a
     * presigned URL issued by the API after an authorization check. */
    const media = new s3.Bucket(this, 'Media', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      // Retained on stack deletion: these are users' photos and voice notes, and a
      // mistaken `cdk destroy` must not take them with it.
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Backstop for the retention promise. The worker deletes objects when their
          // message expires; this catches anything it missed, and anything uploaded but
          // never committed to a message.
          id: 'expire-voice-notes',
          prefix: 'voice-notes/',
          expiration: Duration.days(31),
        },
        {
          id: 'abort-incomplete-uploads',
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });

    const sharedEnvironment = {
      S3_BUCKET: media.bucketName,
      SSM_PARAMETER_PREFIX: props.parameterPrefix,
      NODE_ENV: 'production',
      // Keeps the SDK from spending cold-start time probing for EC2 instance metadata
      // that does not exist in Lambda.
      AWS_EC2_METADATA_DISABLED: 'true',
    };

    const bundling: BundlingOptions = {
      // Bundled rather than layered, and arm64 for the cheaper per-millisecond rate.
      minify: true,
      sourceMap: true,
      target: 'node22',
      // The SDK is provided by the runtime; bundling it would slow cold starts for nothing.
      externalModules: ['@aws-sdk/*'],
    };

    const defaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      projectRoot: serverRoot,
      depsLockFilePath: join(serverRoot, 'package-lock.json'),
      tsconfig: join(serverRoot, 'tsconfig.json'),
      bundling,
      environment: sharedEnvironment,
      // Outside the lab this is absent, and each NodejsFunction declares its own role.
      ...(lambdaRole ? { role: lambdaRole } : {}),
    };

    /**
     * Builds a function with its own log group.
     *
     * An explicit LogGroup rather than the `logRetention` prop: that prop is deprecated,
     * and it works by deploying a custom-resource Lambda that calls PutRetentionPolicy
     * after the fact — an extra function, role and three custom resources to express
     * "keep logs for two weeks". Declaring the group directly is both smaller and honest
     * about what it is.
     *
     * Two weeks is enough to investigate an incident without paying to store logs forever.
     */
    const withLogs = (id: string, props: lambdaNodejs.NodejsFunctionProps) =>
      new NodejsFunction(this, id, {
        ...defaults,
        ...props,
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.TWO_WEEKS,
          // Logs are disposable; keeping orphaned groups after a destroy is just clutter.
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });

    const api = withLogs('Api', {
      entry: join(serverRoot, 'src/handlers/api.ts'),
      handler: 'handler',
      memorySize: 512,
      // Long enough to absorb a cold start plus an scrypt verification, short enough that
      // a stuck request releases its database connection promptly.
      timeout: Duration.seconds(20),
      reservedConcurrentExecutions: CONNECTION_BUDGET.api,
    });

    const websocket = withLogs('WebSocket', {
      entry: join(serverRoot, 'src/handlers/ws.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: CONNECTION_BUDGET.websocket,
    });

    const worker = withLogs('Worker', {
      entry: join(serverRoot, 'src/handlers/worker.ts'),
      handler: 'handler',
      memorySize: 512,
      // Tasks are batched at 100 rows each, so a run is short; five minutes is a ceiling
      // for a bad day, not an expectation.
      timeout: Duration.minutes(5),
      reservedConcurrentExecutions: CONNECTION_BUDGET.worker,
    });

    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'zozar-api',
      defaultIntegration: new integrations.HttpLambdaIntegration('ApiIntegration', api),
    });

    const wsApi = new apigw.WebSocketApi(this, 'WebSocketApi', {
      apiName: 'zozar-realtime',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('Connect', websocket),
        // The handler authenticates the token and returns 401 to refuse the handshake, so
        // an unauthenticated socket is never established.
        returnResponse: true,
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('Disconnect', websocket),
      },
      defaultRouteOptions: {
        // Not named 'Default'. CDK drops construct ids called `Default` and `Resource`
        // when deriving a logical id, so an integration named 'Default' collapses to the
        // same id as the route itself ($default-Route/Default/Resource and
        // $default-Route/Resource both become WebSocketApidefaultRoute...), and synth
        // fails with a duplicate logical id.
        integration: new integrations.WebSocketLambdaIntegration('DefaultIntegration', websocket),
        returnResponse: true,
      },
    });

    const wsStage = new apigw.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: wsApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // The API and the worker both push events to open sockets, so both need the callback
    // endpoint and permission to post to connections.
    for (const fn of [api, worker]) {
      fn.addEnvironment('WS_ENDPOINT', `https://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${wsStage.stageName}`);
      wsStage.grantManagementApiAccess(fn);
    }

    media.grantReadWrite(api);
    // The worker only ever deletes expired voice notes; it has no reason to upload.
    media.grantRead(worker);
    media.grantDelete(worker);

    /**
     * Read access to exactly this deployment's parameters, by prefix, rather than to all
     * of Parameter Store.
     *
     * In Learner Lab mode the role is immutable, so `addToRolePolicy` is a no-op: it
     * returns false and nothing is added to any policy. Parameter Store has no resource
     * policy, so there is no other side of the relationship to express this on — unlike
     * the S3 grants above, which land in the bucket policy. The same is true of
     * `wsStage.grantManagementApiAccess`, which is principal-only and is therefore
     * dropped entirely in lab mode.
     *
     * The call is kept because it is correct and necessary outside the lab. Inside the
     * lab the functions depend instead on LabRole's own permissions: `ssm:GetParameter`
     * for the secrets, `execute-api:ManageConnections` for the socket pushes, and writes
     * to CloudWatch Logs, which this stack also stops granting — CDK attaches
     * `AWSLambdaBasicExecutionRole` only to a role it creates itself, never to one handed
     * to it as `role`.
     *
     * Those are runtime dependencies, not deploy-time ones: if LabRole is missing one the
     * deploy still succeeds, and a secrets or socket failure then surfaces as an
     * AccessDenied in the function's log group. The exception is the logs permission
     * itself: without it the function produces no log events at all, so an empty log
     * group is a symptom rather than proof that nothing ran. There is no workaround from
     * inside this stack — granting the role anything would require the IAM write the lab
     * denies.
     */
    const readSecrets = new iam.PolicyStatement({
      actions: ['ssm:GetParameter', 'ssm:GetParameters'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter${props.parameterPrefix}/*`,
      ],
    });
    for (const fn of [api, websocket, worker]) {
      fn.addToRolePolicy(readSecrets);
    }

    /** Five minutes is the resolution of the escalation promise: a missed wake is noticed
     * within five minutes of its grace period lapsing. */
    new events.Rule(this, 'WorkerSchedule', {
      description: 'Materialises alarms, escalates missed wakes, delivers pushes, sweeps expired data',
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new targets.LambdaFunction(worker, { retryAttempts: 2 })],
    });

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint, description: 'HTTP API base URL' });
    new CfnOutput(this, 'WebSocketUrl', { value: wsStage.url, description: 'WebSocket URL for the app' });
    new CfnOutput(this, 'MediaBucket', { value: media.bucketName, description: 'Private media bucket' });
    new CfnOutput(this, 'ConnectionBudget', {
      value: JSON.stringify(CONNECTION_BUDGET),
      description: 'Reserved concurrency per function; must stay within Aiven free tier 20 connections',
    });
  }
}
