import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const accountId = process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const bucketName = process.env.R2_BUCKET || 'tonkho-photos';

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

/**
 * Tạo URL PUT có chữ ký (presigned PUT) để trình duyệt upload trực tiếp lên R2.
 */
export async function getPresignedUploadUrl(photoKey: string, contentType = 'image/jpeg'): Promise<string> {
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID hoặc R2_SECRET_ACCESS_KEY chưa được cấu hình.');
  }

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: photoKey,
    ContentType: contentType,
  });

  return await getSignedUrl(r2Client, command, { expiresIn: 600 }); // Hiệu lực 10 phút
}
