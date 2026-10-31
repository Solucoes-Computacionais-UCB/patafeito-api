import { app } from './app.js';
import { docsEnabled, env } from './config/env.js';
import { startScheduler } from './jobs/scheduler.js';

// Escuta em todas as interfaces para que um aparelho na mesma rede alcance a API.
app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Patafeito API ouvindo na porta ${env.PORT}`);
  if (docsEnabled) console.log(`Documentação (Swagger UI): http://localhost:${env.PORT}/docs`);
});

// Rotinas de prazos, penalidades e alertas (fase 4). Os testes importam só o app, sem o agendador.
if (env.NODE_ENV !== 'test') startScheduler();
