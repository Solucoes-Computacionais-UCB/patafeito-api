import { app } from './app.js';
import { env } from './config/env.js';

app.listen(env.PORT, () => console.log(`Patafeito API ouvindo na porta ${env.PORT}`));
