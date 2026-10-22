import { HTTPException } from 'hono/http-exception';

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
 * Routes depend on this rather than on a vendor SDK directly so their authorization and
 * validation logic can be tested without a bucket, and — as the move off S3 showed — so
 * the backing store can be replaced without touching a single route.
 */
export type MediaStorage = {
  presignUpload(key: string, contentType: string): Promise<string>;
  presignDownload(key: string): Promise<string>;
  /** Null when the object does not exist. */
  head(key: string): Promise<ObjectHead | null>;
  remove(key: string): Promise<void>;
};

/**
 * No media backend is configured.
 *
 * S3 is gone with the rest of AWS, and the Catalyst Stratus implementation that replaces
 * it is not written yet. Until it is, the upload and download routes answer 503 rather
 * than failing deep inside a vendor SDK with a message about a missing AWS region, which
 * is what would otherwise happen and would read like a bug rather than a known gap.
 *
 * 503 and not 500: the capability is absent, not broken, and a client is right to retry
 * it later. Everything else in the API — accounts, alarms, wake confirmations, the
 * trusted-person alert, text chat — is unaffected, because nothing else touches this.
 */
function unavailableStorage(): MediaStorage {
  const unavailable = () =>
    new HTTPException(503, {
      res: Response.json(
        {
          error: {
            code: 'media_unavailable',
            message: 'Photos and voice notes are temporarily unavailable.',
          },
        },
        { status: 503 },
      ),
    });

  return {
    async presignUpload() {
      throw unavailable();
    },
    async presignDownload() {
      throw unavailable();
    },
    async head() {
      throw unavailable();
    },
    async remove() {
      // Deliberately silent. Deletion is called on cleanup paths — replacing a profile
      // photo, sweeping expired voice notes — where throwing would abort the surrounding
      // operation to no purpose. There is nothing stored to delete.
    },
  };
}

let override: MediaStorage | undefined;
let resolved: MediaStorage | undefined;

export function getStorage(): MediaStorage {
  if (override) return override;
  resolved ??= unavailableStorage();
  return resolved;
}

/** Test seam. Production code never calls this; passing null restores the default. */
export function setStorageForTests(implementation: MediaStorage | null): void {
  override = implementation ?? undefined;
}
