import heroSlideRoutes from './routes/v1/storefront/hero-slides.route.js';
import aiRoutes from './routes/v1/ai/ai.route.js';
import { observeRisk } from './services/ai/risk.service.js';
import supportRoutes from './routes/v1/support/support.route.js';
import articleRoutes from './routes/v1/articles/articles.route.js';
import customerAuthRoutes from './routes/v1/customers/customer-auth.route.js';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import createError from 'http-errors';
import cors from 'cors';
import { frontendOrigins } from './utils/auth/auth-cookie.js';
import path from 'node:path';

import brandRoutes from './routes/v1/brands/brands.route.js';
import productRoutes from './routes/v1/products/products.route.js';
import storefrontRoutes from './routes/v1/storefront/storefront.route.js';
import categoriesRouter from './routes/v1/categories/categories.route.js';
import orderRoutes from './routes/v1/orders/orders.route.js';
import customerRoutes from './routes/v1/customers/customers.route.js';
import userRoutes from './routes/v1/users/users.route.js';
import authRoutes from './routes/v1/auth/auth.route.js';
import { errorMiddleware } from './middlewares/shared/error.middleware.js';
import { trustedProxyAddresses } from './utils/shared/trusted-proxy.js';

const app: Express = express();
app.set('trust proxy', trustedProxyAddresses());

app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !origin || frontendOrigins().includes(origin)),
    credentials: true,
  })
);
// A 100,000-character article can exceed 100 KB in UTF-8 (or JSON escapes).
// Keep the larger, bounded budget scoped to editorial requests.
app.use('/api/v1/articles', express.json({ limit: '1mb' }));
// Six 30,000-character policy sections need room for JSON-escaped Unicode.
app.use('/api/v1/support', express.json({ limit: '2mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(observeRisk);
app.use('/api/v1/ai', aiRoutes);
app.use(express.static(path.resolve(process.cwd(), 'public')));

app.get('/', (_req: Request, res: Response) => {
  res.send('Hello World!');
});

app.use('/api/v1/hero-slides', heroSlideRoutes);
app.use('/api/v1/support', supportRoutes);
app.use('/api/v1/articles', articleRoutes);
app.use('/api/v1/brands', brandRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/storefront', storefrontRoutes);
app.use('/api/v1/categories', categoriesRouter);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/customer-auth', customerAuthRoutes);

app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(createError(404, 'Not Found'));
});

app.use(errorMiddleware);

export default app;
