#!/usr/bin/env node
import { App, CliCredentialsStackSynthesizer } from 'aws-cdk-lib';

import { ZozarStack } from '../lib/zozar-stack.js';

const app = new App();

/**
 * Learner Lab mode, selected with `-c lab=true`.
 *
 * The owner's only AWS access is an AWS Academy Learner Lab, which denies every IAM write
 * and therefore cannot be CDK-bootstrapped: there is no way to create the file-publishing
 * and deployment roles that the default synthesizer expects to assume. Two things change
 * as a result, and nothing else does:
 *
 * 1. `CliCredentialsStackSynthesizer` uploads assets and calls CloudFormation with the
 *    CLI's own credentials rather than assuming bootstrap roles, so no bootstrap is
 *    needed. The asset bucket is created by hand once; see docs/DEPLOYMENT.md.
 * 2. The three Lambdas run as the lab's pre-existing `LabRole` instead of declaring roles
 *    of their own.
 *
 * The lab deployment is a separate stack (`Zozar-lab`) with its own parameter prefix, so
 * it can never be confused with a real `Zozar-prod`.
 */
const labContext = app.node.tryGetContext('lab');
const isLab = labContext === 'true' || labContext === true;

// `-c lab=true` arrives as the string 'true'; a boolean is accepted too for a context file
// or a programmatic app. Any other spelling is rejected rather than quietly treated as
// "not the lab": that would synthesise Zozar-prod, which declares IAM roles the lab
// forbids and expects a bootstrap that does not exist, and the student would be reading
// the wrong error.
if (!isLab && labContext !== undefined && labContext !== 'false' && labContext !== false) {
  throw new Error(
    `Unrecognised context lab=${String(labContext)}. Pass -c lab=true to deploy the ` +
      'Learner Lab stack, or omit it entirely for Zozar-prod.',
  );
}

if (isLab) {
  const labRoleArn = app.node.tryGetContext('labRoleArn');
  const assetsBucket = app.node.tryGetContext('assetsBucket');
  const region = process.env.CDK_DEFAULT_REGION;

  // Fail here rather than synthesising something that would deploy to the wrong place or
  // fail halfway through. The deploy script supplies all three.
  if (!labRoleArn) {
    throw new Error(
      'lab=true requires -c labRoleArn=<arn of the lab execution role, e.g. arn:aws:iam::123456789012:role/LabRole>',
    );
  }
  if (!assetsBucket) {
    throw new Error(
      'lab=true requires -c assetsBucket=<name of the hand-created asset bucket, e.g. zozar-cdk-assets-123456789012>',
    );
  }
  if (!region) {
    // Note that the CDK CLI fills CDK_DEFAULT_REGION in from the active AWS profile, so
    // this fires only when neither the environment nor the profile names a region. The
    // deploy script sets it explicitly rather than relying on either.
    throw new Error(
      'lab=true requires CDK_DEFAULT_REGION to be set (the lab pins a region; there is no safe default to fall back on)',
    );
  }

  new ZozarStack(app, 'Zozar-lab', {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
    parameterPrefix: '/zozar/lab',
    lambdaRoleArn: labRoleArn,
    description: 'ZO-ZAR serverless API, realtime and scheduled worker',
    tags: { Project: 'zozar', Environment: 'lab' },
    // No bootstrap in the lab: publish assets and deploy with the CLI's own credentials.
    // An empty bucketPrefix keeps asset keys at the bucket root, matching what the
    // hand-created bucket is set up for.
    synthesizer: new CliCredentialsStackSynthesizer({
      fileAssetsBucketName: assetsBucket,
      bucketPrefix: '',
    }),
  });
} else {
  /**
   * Region is pinned to ap-south-1 for proximity to users in India. Aiven's free plan picks
   * its own region, so the hop from Lambda to the database is not tunable from here; see
   * docs/ARCHITECTURE.md.
   */
  const environment = app.node.tryGetContext('env') ?? 'prod';

  new ZozarStack(app, `Zozar-${environment}`, {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION ?? 'ap-south-1',
    },
    parameterPrefix: `/zozar/${environment}`,
    description: 'ZO-ZAR serverless API, realtime and scheduled worker',
    tags: { Project: 'zozar', Environment: environment },
  });
}
