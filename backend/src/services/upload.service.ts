import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getS3Client, S3_BUCKET } from '../config/aws';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

export async function uploadFile(
  filePath: string,
  originalName: string,
  mimeType: string,
  documentType: string,
  userId: string
): Promise<{ url: string; documentId: string }> {
  const documentId = uuidv4();
  const ext = path.extname(originalName) || '.' + mimeType.split('/')[1];
  const key = `documents/${userId}/${documentType}/${documentId}${ext}`;

  if (env.USE_DUMMY_DATA || !env.AWS_ACCESS_KEY_ID) {
    const url = `https://storage.bloodlink.app/${key}`;
    logger.info('[DEV] Skipping actual S3 upload', { key, url });
    try { fs.unlinkSync(filePath); } catch {}
    return { url, documentId };
  }

  const fileBuffer = fs.readFileSync(filePath);

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
      Metadata: { userId, documentType, originalName },
    })
  );

  fs.unlinkSync(filePath);

  const url = `https://${S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
  return { url, documentId };
}
