import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import { errorHandler } from './middlewares/error.middleware';
import { logger } from './utils/logger';
import v1Routes from './routes/v1';
import { startCronSweeper } from './workers/cronSweeper';
import { startNotificationWorker } from './workers/notificationWorker';
import { registerCustomerAutomations } from './automations/customerAutomations';
import { registerOperationsAutomations } from './automations/operationsAutomations';

const app = express();

app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));

// Register automation handlers BEFORE any routes so events published during
// first-request startup are always captured (defensive ordering)
registerCustomerAutomations();   // Sprint 9.2: Booking Reminder, Invoice Scan, Payment Receipt
registerOperationsAutomations(); // Sprint 9.3: Job Alerts, Lead Follow-up, Escalations

app.use('/api/v1', v1Routes);
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Server is running at http://localhost:${env.PORT}`);

  // Start the background cron sweeper LAST — handlers must be registered first
  startCronSweeper();
  
  // Phase 10: Start Notification Worker
  startNotificationWorker();
});

