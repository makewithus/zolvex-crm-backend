import { PrismaClient, MediaType, MediaCategory } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

/**
 * MediaService
 * Abstracts file storage and URL management to ensure business logic does not depend on the underlying storage mechanism (Local, S3, R2, etc).
 */

export const uploadJobMedia = async (
  job_id: string,
  user_id: string,
  file: any, // Assuming multer for uploads
  category: MediaCategory,
  type: MediaType = 'Image'
) => {
  // 1. Storage Abstract Logic (Placeholder for S3)
  // Currently, we assume the file is saved locally via multer, and we just store the URL.
  // In the future, this is where we call S3Client.putObject.
  const fileUrl = `/uploads/jobs/${file.filename}`;

  // 2. Database Record
  const media = await prisma.jobMedia.create({
    data: {
      job_id,
      url: fileUrl,
      type,
      category,
      uploaded_by: user_id,
    }
  });

  return media;
};
