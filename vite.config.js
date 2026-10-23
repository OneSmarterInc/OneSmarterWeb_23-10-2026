import process from 'node:process'
import {
  defineConfig,
  loadEnv,
} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const agentApiPlugin = () => ({
  name: 'agent-api-dev-server',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/agents/')) {
        return next();
      }

      const currentEnv = loadEnv(server.config.mode || 'development', process.cwd(), '');
      Object.assign(process.env, currentEnv);

      try {
        const url = new URL(req.url, 'http://localhost');
        let handler;
        if (url.pathname === '/api/agents/mira/chat') {
          handler = (await import('./api/agents/mira/chat.js')).default;
        } else if (url.pathname === '/api/agents/theo/chat') {
          handler = (await import('./api/agents/theo/chat.js')).default;
        } else if (url.pathname === '/api/agents/elena/chat') {
          handler = (await import('./api/agents/elena/chat.js')).default;
        } else if (url.pathname === '/api/agents/ravi/chat') {
          handler = (await import('./api/agents/ravi/chat.js')).default;
        } else if (url.pathname === '/api/agents/selene/chat') {
          handler = (await import('./api/agents/selene/chat.js')).default;
        } else if (url.pathname === '/api/agents/cafe/restoration') {
          handler = (await import('./api/agents/cafe/restoration.js')).default;
        } else if (url.pathname === '/api/agents/cafe/generate') {
          handler = (await import('./api/agents/cafe/generate.js')).default;
        } else if (url.pathname === '/api/agents/cafe/reply') {
          handler = (await import('./api/agents/cafe/reply.js')).default;
        } else {
          return next();
        }

        let body = '';
        for await (const chunk of req) {
          body += chunk;
        }
        try {
          req.body = body ? JSON.parse(body) : {};
        } catch {
          req.body = {};
        }

        res.status = (code) => {
          res.statusCode = code;
          return res;
        };
        res.json = (data) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(data));
          return res;
        };

        await handler(req, res);
      } catch (err) {
        console.error('API Error:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'internal_error', message: err.message }));
      }
    });
  },
});

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [
      agentApiPlugin(),
      react(),
      tailwindcss(),
    ],
  };
})