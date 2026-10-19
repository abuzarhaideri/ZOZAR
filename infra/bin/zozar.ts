#!/usr/bin/env node
import { App } from 'aws-cdk-lib';

import { ZozarStack } from '../lib/zozar-stack.js';

const app = new App();

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
