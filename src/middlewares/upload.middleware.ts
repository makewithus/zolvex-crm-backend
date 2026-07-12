import multer from 'multer';
import { AppError } from '../utils/AppError';

/**
 * UPLOAD MIDDLEWARE — Phase 12A
 *
 * Uses memoryStorage so that multer keeps the file as a Buffer in memory
 * rather than writing to disk. This is required for Cloudflare R2 uploads
 * (or any cloud storage), where we stream the buffer directly to the SDK.
 *
 * In development, the buffer is stored in the placeholder path by MediaService.
 * In production, the buffer is sent to R2 by MediaService.
 *
 * NEVER use diskStorage in a production deployment — it writes to the
 * ephemeral filesystem on Render/Railway, which is wiped on restart.
 *
 * Limits:
 *   - Images only (MIME type: image/*)
 *   - Max 5 MB per file
 *   - Max 10 files per request (batch photo uploads)
 */
const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new AppError('Only image files are allowed (JPEG, PNG, WEBP)', 400));
  }
};

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize:  5 * 1024 * 1024, // 5 MB per file
    files:     10,               // max 10 files per request
  },
  fileFilter,
});
