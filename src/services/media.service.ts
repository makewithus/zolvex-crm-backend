import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { PrismaClient, MediaType, MediaCategory } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { PROVIDER_MODE } from '../config/env';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

/**
 * MEDIA SERVICE — Phase 12A (R2 Migration)
 *
 * Single owner of ALL file storage. No controller or service writes to disk.
 *
 * Storage strategy by mode:
 *   mock/sandbox/maps — multer memoryStorage buffer → NOT uploaded to R2.
 *                       URL is a placeholder: /dev-media/<filename>
 *                       (acceptable for development — photos not served)
 *   production        — multer memoryStorage buffer → uploaded to Cloudflare R2.
 *                       URL is the public R2 URL: R2_PUBLIC_URL/<key>
 *
 * Switching to production = set PROVIDER_MODE=production and add R2 env vars.
 * Zero changes to controllers, routes, or business services.
 */

// ── R2 Client (lazy singleton — only created when needed) ──────────────────

let _r2Client: S3Client | null = null;

function getR2Client(): S3Client {
  if (_r2Client) return _r2Client;

  const endpoint  = process.env.R2_ENDPOINT;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;

  if (!endpoint || !accessKey || !secretKey || !accountId) {
    throw new AppError('R2 credentials are not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ACCOUNT_ID.', 500);
  }

  _r2Client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId:     accessKey,
      secretAccessKey: secretKey,
    },
  });

  return _r2Client;
}

// ── Internal: upload a buffer to R2 ────────────────────────────────────────

async function uploadToR2(
  buffer: Buffer,
  key: string,
  mimeType: string,
): Promise<string> {
  const bucket    = process.env.R2_BUCKET!;
  const publicUrl = process.env.R2_PUBLIC_URL!;
  const client    = getR2Client();

  await client.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
  }));

  const url = `${publicUrl.replace(/\/$/, '')}/${key}`;
  logger.info(`[MediaService] Uploaded to R2: ${key}`);
  return url;
}

// ── Internal: delete a file from R2 ────────────────────────────────────────

export async function deleteFromR2(key: string): Promise<void> {
  const hasR2Keys = !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET);
  if (PROVIDER_MODE !== 'production' || !hasR2Keys) return; // No-op in dev or fallback mode
  
  try {
    const bucket = process.env.R2_BUCKET!;
    const client = getR2Client();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    logger.info(`[MediaService] Deleted from R2: ${key}`);
  } catch (err) {
    logger.error(`[MediaService] Failed to delete from R2: ${key}`, err);
  }
}

// ── Internal: generate a deterministic, collision-safe storage key ──────────

function buildStorageKey(prefix: string, originalName: string): string {
  const ext    = originalName.substring(originalName.lastIndexOf('.')) || '.jpg';
  const ts     = Date.now();
  const rand   = Math.floor(Math.random() * 1e6).toString().padStart(6, '0');
  return `${prefix}/${ts}-${rand}${ext}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Upload a job photo (before/after) and persist a JobMedia record.
 *
 * @param job_id         UUID of the Job
 * @param user_id        UUID of the user performing the upload
 * @param file           Multer file object (memoryStorage — has .buffer + .mimetype)
 * @param category       MediaCategory enum value ('Before' | 'After' | 'Other')
 * @param type           MediaType enum value (default: 'Image')
 */
export const uploadJobMedia = async (
  job_id: string,
  user_id: string,
  file: Express.Multer.File,
  category: MediaCategory,
  type: MediaType = 'Image',
) => {
  let url: string;

  const hasR2Keys = !!(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_BUCKET);

  if (PROVIDER_MODE === 'production' && hasR2Keys) {
    const key = buildStorageKey(`jobs/${job_id}`, file.originalname);
    url = await uploadToR2(file.buffer, key, file.mimetype);
  } else {
    // Development mode OR production mode without keys — fallback to local storage
    const uploadDir = path.join(process.cwd(), 'uploads', 'dev-jobs', job_id);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const ext = file.originalname.substring(file.originalname.lastIndexOf('.')) || '.jpg';
    const filename = `${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
    const filePath = path.join(uploadDir, filename);
    
    fs.writeFileSync(filePath, file.buffer);
    
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    url = `${backendUrl}/uploads/dev-jobs/${job_id}/${filename}`;
    logger.info(`[MediaService] DEV mode — file saved locally: ${filePath}`);
  }

  const media = await prisma.jobMedia.create({
    data: {
      job_id,
      url,
      type,
      category,
      uploaded_by: user_id,
    },
  });

  return media;
};
