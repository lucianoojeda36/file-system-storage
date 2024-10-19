import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import s3Client from './config/aws';
import logger from './config/logger';
import { Readable } from 'stream';
import multer from 'multer';

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.get('/download/:filename', async (req: Request, res: Response) => {
  const { filename } = req.params;
  const bucketName = process.env.AWS_S3_BUCKET_NAME;

  if (!bucketName) {
    logger.error('Bucket name is not defined in environment variables');
    res.status(500).send('Internal server error');
  }

  const params = {
    Bucket: bucketName,
    Key: filename,
  };

  try {
    const command = new GetObjectCommand(params);
    const data = await s3Client.send(command);
    const stream = data.Body;

    if (stream instanceof Readable) {
      res.writeHead(200, {
        'Content-Type': data.ContentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename=${filename}`,
      });
      stream.pipe(res);
      stream.on('error', (err) => {
        logger.error('Error retrieving file from S3:', err);
        res.status(500).send('Error reading file');
      });
    } else {
      logger.error('No readable stream returned from S3');
      res.status(404).send('File not found');
    }
  } catch (error) {
    logger.error('Error:', error);
    res.status(500).send('Error processing request');
  }
});

app.get('/list-files', async (req: Request, res: Response) => {
  const bucketName = process.env.AWS_S3_BUCKET_NAME;

  if (!bucketName) {
    logger.error('Bucket name is not defined in environment variables');
    res.status(500).send('Internal server error');
  }

  const params = {
    Bucket: bucketName,
  };

  try {
    const command = new ListObjectsV2Command(params);
    const data = await s3Client.send(command);

    if (data.Contents) {
      const fileList = data.Contents.map((file) => ({
        fileName: file.Key,
        lastModified: file.LastModified,
        size: file.Size,
      }));

      res.status(200).json(fileList);
    } else {
      res.status(404).send('No files found');
    }
  } catch (error) {
    logger.error('Error listing files:', error);
    res.status(500).send('Error listing files');
  }
});

app.post(
  '/upload',
  upload.single('file'),
  async (req: Request, res: Response) => {
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    if (!bucketName) {
      logger.error('Bucket name is not defined in environment variables');
      res.status(500).send('Internal server error');
    }

    const file = req.file as Express.Multer.File;

    if (!file) {
      res.status(400).send('No file uploaded');
    }

    const params = {
      Bucket: bucketName,
      Key: file.originalname,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    try {
      const command = new PutObjectCommand(params);
      await s3Client.send(command);
      res.status(200).send('File uploaded successfully');
    } catch (error) {
      logger.error('Error uploading file:', error);
      res.status(500).send('Error uploading file');
    }
  },
);

app.post(
  '/upload-multiple',
  upload.array('files', 10),
  async (req: Request, res: Response) => {
    const bucketName = process.env.AWS_S3_BUCKET_NAME;

    if (!bucketName) {
      logger.error('Bucket name is not defined in environment variables');
      res.status(500).send('Internal server error');
    }

    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).send('No files uploaded');
    }

    try {
      const uploadPromises = files.map((file) => {
        const params = {
          Bucket: bucketName,
          Key: file.originalname,
          Body: file.buffer,
          ContentType: file.mimetype,
        };

        const command = new PutObjectCommand(params);
        return s3Client.send(command);
      });

      await Promise.all(uploadPromises);
      res.status(200).send('All files uploaded successfully');
    } catch (error) {
      logger.error('Error uploading files:', error);
      res.status(500).send('Error uploading files');
    }
  },
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
