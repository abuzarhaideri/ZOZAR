import {
  DeleteObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const UPLOAD_URL_TTL_SECONDS = 300;
export const DOWNLOAD_URL_TTL_SECONDS = 900;

/** Caps enforced after upload, since a presigned PUT cannot constrain body size without
 * forcing the client to commit to an exact Content-Length up front. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_VOICE_BYTES = 10 * 1024 * 1024;

export type ObjectHead = { contentType: string | null; contentLength: number };

/**
 * The storage operations the routes need, as an interface.
 *
 * Routes depend on this rather than on the S3 SDK directly so their authorization and
 * validation logic can be tested without a bucket. Presigning is local crypto and works
 * offline, but HeadObject is a real network call, and the interesting cases to test —
 * a client committing a key it does not own, or an object that is too large — should not
 * require AWS to exercise.
 */
export type MediaStorage = {
  presignUpload(key: string, contentType: string): Promise<string>;
  presignDownload(key: string): Promise<string>;
  /** Null when the object does not exist. */
  head(key: string): Promise<ObjectHead | null>;
  remove(key: string): Promise<void>;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let client: S3Client | undefined;

function s3(): S3Client {
  // Created at module scope so a warm Lambda container reuses the connection pool and the
  // resolved credentials rather than re-resolving them per invocation.
  client ??= new S3Client({ region: requireEnv('AWS_REGION') });
  return client;
}

function s3Storage(): MediaStorage {
  const bucket = () => requireEnv('S3_BUCKET');

  return {
    async presignUpload(key, contentType) {
      // ContentType is part of the signature, so a client cannot upload a different type
      // than it declared and then have the object served back as, say, text/html.
      return getSignedUrl(
        s3(),
        new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS },
      );
    },

    async presignDownload(key) {
      return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      });
    },

    async head(key) {
      try {
        const result = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
        return { contentType: result.ContentType ?? null, contentLength: result.ContentLength ?? 0 };
      } catch (error) {
        // A missing object is an expected outcome — the client may commit a key it never
        // finished uploading — so it is reported as null rather than thrown.
        if (error instanceof NotFound || error instanceof NoSuchKey) return null;
        if (isNotFoundStatus(error)) return null;
        throw error;
      }
    },

    async remove(key) {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    },
  };
}

/** HeadObject answers 404 with an empty body, which older SDK paths surface as a plain
 * status rather than a typed NotFound. */
function isNotFoundStatus(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return status === 404;
}

let override: MediaStorage | undefined;
let resolved: MediaStorage | undefined;

export function getStorage(): MediaStorage {
  if (override) return override;
  resolved ??= s3Storage();
  return resolved;
}

/** Test seam. Production code never calls this; passing null restores the S3 implementation. */
export function setStorageForTests(implementation: MediaStorage | null): void {
  override = implementation ?? undefined;
}
