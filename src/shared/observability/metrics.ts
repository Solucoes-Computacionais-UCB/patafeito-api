type RouteMetric = { count: number; errors: number; durationMs: number };
const routes = new Map<string, RouteMetric>();

export function recordHttpRequest(route: string, status: number, durationMs: number) {
  const metric = routes.get(route) ?? { count: 0, errors: 0, durationMs: 0 };
  metric.count += 1;
  metric.errors += status >= 500 ? 1 : 0;
  metric.durationMs += durationMs;
  routes.set(route, metric);
}

export function prometheusMetrics() {
  const lines = [
    '# HELP patafeito_http_requests_total Total de requisições HTTP.',
    '# TYPE patafeito_http_requests_total counter',
    '# HELP patafeito_http_request_errors_total Total de respostas HTTP 5xx.',
    '# TYPE patafeito_http_request_errors_total counter',
    '# HELP patafeito_http_request_duration_ms_sum Soma da duração HTTP em milissegundos.',
    '# TYPE patafeito_http_request_duration_ms_sum counter',
  ];
  for (const [route, metric] of routes) {
    const label = route.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    lines.push(`patafeito_http_requests_total{route="${label}"} ${metric.count}`);
    lines.push(`patafeito_http_request_errors_total{route="${label}"} ${metric.errors}`);
    lines.push(`patafeito_http_request_duration_ms_sum{route="${label}"} ${metric.durationMs}`);
  }
  return `${lines.join('\n')}\n`;
}
