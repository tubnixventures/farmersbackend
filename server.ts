/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getRequestListener } from '@hono/node-server';
import dotenv from 'dotenv';
import { app as honoApp, seedInitialPlatformData } from './src/backend/app.ts';
import { dbManager } from './src/backend/db/mongo.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const expressApp = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Initialize Database & Seed Baseline Data
  await seedInitialPlatformData();
  await dbManager.init();

  // Bridge Hono Cloudflare Worker App into Express for seamless Node / Dev / Production support
  const honoHandler = getRequestListener(honoApp.fetch);

  // Mount API & R2 endpoints to Hono (retaining full /api path)
  expressApp.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      return honoHandler(req, res);
    }
    next();
  });

  // Vite middleware in development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    expressApp.use(vite.middlewares);
  } else {
    // Serve static production build
    const distPath = path.resolve(__dirname, 'dist');
    expressApp.use(express.static(distPath));
    expressApp.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  expressApp.listen(PORT, '0.0.0.0', () => {
    console.log(`[FarmersWorld Backend] Server running at http://0.0.0.0:${PORT}`);
    console.log(`[Architecture] Hono + MongoDB + Cloudflare Workers edge architecture active`);
  });
}

startServer().catch((err) => {
  console.error('[FarmersWorld Backend] Fatal Startup Error:', err);
  process.exit(1);
});
