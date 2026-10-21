import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * Loads secrets from SSM Parameter Store at cold start.
 *
 * Lambda environment variables would be simpler, but they are plainly readable by anyone
 * holding `lambda:GetFunction`, and they appear in the CloudFormation template, so the
 * database password and the JWT signing key would end up in the deployment history.
 * SecureString parameters keep them encrypted at rest with a policy of their own.
 *
 * Parameter Store standard parameters are free, which is also why this is used instead of
 * Secrets Manager at $0.40 per secret per month.
 *
 * The fetch happens once per container and the promise is cached, so concurrent
 * invocations on a cold start share a single request rather than racing. Values are
 * written into `process.env` so the rest of the code keeps reading configuration one way,
 * whether it is running in Lambda or on a developer machine.
 */

const SECRET_NAMES = [
  'DATABASE_URL',
  'DATABASE_CA_CERT',
  'JWT_SECRET',
  'FIREBASE_SERVICE_ACCOUNT',
] as const;

let pending: Promise<void> | undefined;

export function loadSecrets(): Promise<void> {
  pending ??= fetchSecrets();
  return pending;
}

async function fetchSecrets(): Promise<void> {
  const prefix = process.env.SSM_PARAMETER_PREFIX?.trim();
  // No prefix means local development or a test run: configuration already comes from
  // the environment, so there is nothing to fetch.
  if (!prefix) return;

  const client = new SSMClient({ region: process.env.AWS_REGION });
  const names = SECRET_NAMES.map((name) => `${prefix}/${name}`);

  // GetParameters takes up to ten names, which covers this set in one call.
  const result = await client.send(new GetParametersCommand({ Names: names, WithDecryption: true }));

  for (const parameter of result.Parameters ?? []) {
    const key = parameter.Name?.slice(prefix.length + 1);
    if (key && parameter.Value !== undefined) process.env[key] = parameter.Value;
  }

  // Missing parameters are reported by name but not thrown on here: FIREBASE_SERVICE_ACCOUNT
  // is only needed by the worker, so the API should still start without it. Whatever is
  // genuinely required fails loudly at its own point of use.
  if (result.InvalidParameters?.length) {
    console.warn('[config] parameters not found in SSM', { names: result.InvalidParameters });
  }
}

/** Test seam, so one test's load cannot satisfy another's. */
export function resetSecretsCacheForTests(): void {
  pending = undefined;
}
