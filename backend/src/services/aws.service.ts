import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, S3_BUCKET } from '../config/aws';
import { env } from '../config/env';
import { logger } from '../config/logger';
import {
  PRESIGNED_URL_EXPIRY_SECONDS,
  DOCUMENT_VIEW_URL_EXPIRY_SECONDS,
} from '../types/verification.types';

export function buildS3Key(userId: string, documentType: string, fileName: string): string {
  const timestamp = Date.now();
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `verification/${userId}/${documentType}/${timestamp}-${safe}`;
}

export function buildArchiveKey(originalKey: string): string {
  return `archived/${originalKey}`;
}

export async function generatePresignedUploadUrl(
  s3Key: string,
  contentType: string
): Promise<string> {
  if (env.USE_DUMMY_DATA || !env.AWS_ACCESS_KEY_ID) {
    logger.info('[DEV] Skipping real S3 presigned URL generation', { s3Key });
    return `https://storage.bloodlink.app/mock-upload?key=${encodeURIComponent(s3Key)}`;
  }

  const cmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    ContentType: contentType,
  });

  return getSignedUrl(getS3Client(), cmd, { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS });
}

export async function generatePresignedViewUrl(s3Key: string): Promise<string> {
  if (env.USE_DUMMY_DATA || !env.AWS_ACCESS_KEY_ID) {
    return `https://storage.bloodlink.app/mock-view?key=${encodeURIComponent(s3Key)}`;
  }

  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: DOCUMENT_VIEW_URL_EXPIRY_SECONDS });
}

export async function archiveDocument(s3Key: string): Promise<void> {
  if (env.USE_DUMMY_DATA || !env.AWS_ACCESS_KEY_ID) {
    logger.info('[DEV] Skipping real S3 archive', { s3Key });
    return;
  }

  try {
    // S3 does not have a rename operation — copy then delete
    const { CopyObjectCommand } = await import('@aws-sdk/client-s3');
    const archiveKey = buildArchiveKey(s3Key);
    await getS3Client().send(
      new CopyObjectCommand({
        Bucket: S3_BUCKET,
        CopySource: `${S3_BUCKET}/${s3Key}`,
        Key: archiveKey,
      })
    );
    await getS3Client().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    logger.info('Document archived', { from: s3Key, to: archiveKey });
  } catch (err) {
    logger.error('Failed to archive document', { s3Key, err });
  }
}
