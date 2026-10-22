import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

// `src/shared/http/` em desenvolvimento e `dist/shared/http/` após o build: ambos
// ficam a três níveis da raiz do projeto, onde vive `docs/openapi.yaml`.
const openApiPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/openapi.yaml');

export function createDocsRouter() {
  const document = parse(readFileSync(openApiPath, 'utf8')) as swaggerUi.JsonObject;
  const router = Router();
  router.get('/openapi.yaml', (_req, res) => res.type('text/yaml').send(readFileSync(openApiPath, 'utf8')));
  router.get('/openapi.json', (_req, res) => res.json(document));
  router.use('/', swaggerUi.serve, swaggerUi.setup(document, {
    customSiteTitle: 'Patafeito API',
    swaggerOptions: { displayRequestDuration: true, persistAuthorization: true },
  }));
  return router;
}
