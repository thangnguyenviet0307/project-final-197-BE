import { Article } from './models/articles/articles.model.js';
import { aiModels } from './models/ai/ai.model.js';
import { attachAiGateway } from './gateways/ai/chat.gateway.js';
import { startAiRetentionWorker } from './services/ai/conversation.service.js';
import { startAiIndexWorker } from './services/ai/knowledge-index.service.js';
import {
  WarrantyRequest,
  StorePolicy,
} from './models/support/support.model.js';
import { PostCategory } from './models/articles/post-categories.model.js';
import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { startImageCleanupWorker } from './services/products/image-cleanup.service.js';
import { startGuestReservationWorker } from './services/orders/guest-reservation.service.js';
import { connectDatabase } from './config/database.js';
import { validateEnvironment } from './config/environment.js';
import mongoose from 'mongoose';
import { CheckoutRequest } from './models/orders/checkout-requests.model.js';
import { GuestContacts } from './models/customers/guest-contacts.model.js';
import { CustomerOtpJob } from './models/customers/customer-otp-jobs.model.js';
import { startCustomerOtpWorker } from './services/customers/customer-otp-worker.service.js';

const PORT = Number(process.env['PORT'] || 5000);

const startServer = async (): Promise<void> => {
  try {
    validateEnvironment();
  } catch (error) {
    // Validation messages contain variable names only, never their secret values.
    if (error instanceof Error)
      console.error(`Invalid server configuration: ${error.message}`);
    throw error;
  }
  await connectDatabase();
  for (const model of aiModels) {
    await model.init();
    await model.createIndexes();
  }
  await CheckoutRequest.init();
  await CheckoutRequest.createIndexes();
  await GuestContacts.init();
  await GuestContacts.createIndexes();
  await CustomerOtpJob.init();
  await CustomerOtpJob.createIndexes();
  await Promise.all([WarrantyRequest.init(), StorePolicy.init()]);
  await WarrantyRequest.createIndexes();
  // Scope index creation to the new editorial collections; never sync/drop unrelated indexes.
  await Promise.all([Article.init(), PostCategory.init()]);
  await Promise.all([Article.createIndexes(), PostCategory.createIndexes()]);

  const stopImageCleanup = startImageCleanupWorker();
  const stopGuestReservations = startGuestReservationWorker();
  const stopCustomerOtp = startCustomerOtpWorker();
  const stopAiRetention = startAiRetentionWorker();
  const stopAiIndex = startAiIndexWorker();
  const stopWorkers = () =>
    Promise.all([
      stopImageCleanup(),
      stopGuestReservations(),
      stopCustomerOtp(),
      stopAiRetention(),
      stopAiIndex(),
    ]);
  const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
  const stopAiGateway = attachAiGateway(server);
  server.on('error', async () => {
    console.error('Cannot listen on configured PORT');
    process.exitCode = 1;
    await stopWorkers();
    await mongoose.disconnect();
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopAiGateway();
    const timeout = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10000);
    timeout.unref();
    server.close(() => {
      void stopWorkers()
        .then(() => mongoose.disconnect())
        .then(
          () => {
            clearTimeout(timeout);
          },
          () => {
            process.exitCode = 1;
          }
        );
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

startServer().catch(() => {
  console.error(
    'Failed to start server; check environment and database configuration'
  );
  process.exit(1);
});
