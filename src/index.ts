import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import { errorHandler } from './middlewares/error.middleware';
import { logger } from './utils/logger';
import v1Routes from './routes/v1';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));



app.use('/api/v1', v1Routes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Server is running at http://localhost:${env.PORT}`);
});
