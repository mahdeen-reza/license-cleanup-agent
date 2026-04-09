import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from './middleware/auth';
import authRouter from './routes/auth';
import meRouter from './routes/me';
import systemsRouter from './routes/systems';
import { createAnalysisRouter } from './routes/analysis';
import { createOnboardingRouter } from './routes/onboarding';
import chatRouter from './routes/chat';
import actioningRouter from './routes/actioning';
import sporadicFlagsRouter from './routes/sporadicFlags';
import userHistoryRouter from './routes/userHistory';
import adminRouter from './routes/admin';

const app = express();
const port = parseInt(process.env.PORT ?? '8000', 10);

// ─── Security headers ────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(helmet());

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ─── File upload (memory storage — CSVs never written to disk) ───────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max per file — HR exports can be large
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted.'));
    }
  },
});

// ─── Health check (unauthenticated — used by load balancer / depends_on) ─────
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('ok');
});

// ─── Public routes (before auth middleware) ──────────────────────────────────
app.use('/api/auth', authRouter);

// ─── Auth middleware — applied globally to all remaining routes ──────────────
app.use(authMiddleware);

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/me', meRouter);
app.use('/api/systems', systemsRouter);
app.use('/api/systems', createOnboardingRouter(upload));
app.use('/api/analysis', createAnalysisRouter(upload));
app.use('/api/analysis', actioningRouter);
app.use('/api/sporadic-flags', sporadicFlagsRouter);
app.use('/api/user-history', userHistoryRouter);
app.use('/api', chatRouter);
app.use('/api/admin', adminRouter);

// ─── React frontend — static serving in production ───────────────────────────
// Vite outputs to frontend/dist/. In development, use `cd frontend && npm run dev`
// instead — Vite's dev server proxies /api/* to :8000. This block only activates
// in production (inside the Docker image) once frontend/dist/ has been built.
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(distPath));

// SPA fallback — any non-API route returns index.html so React handles routing.
// Must use app.use() not app.get('*') — Express 5 dropped bare wildcard support.
app.use((_req: Request, res: Response) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ─── Global error handler — prevents stack trace leaks ──────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV ?? 'not set'}`);
});
