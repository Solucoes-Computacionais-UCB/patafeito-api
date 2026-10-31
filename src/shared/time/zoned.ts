/** Fuso padrão enquanto o usuário não escolhe outro (`users.timezone`). */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Diferença, em ms, entre o relógio local do fuso e o UTC naquele instante. */
function offsetMs(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Meia-noite local de (ano, mês, dia) como instante UTC. A segunda passada acerta mudanças de horário de verão. */
function localMidnight(year: number, month: number, day: number, timeZone: string) {
  const wall = Date.UTC(year, month, day);
  const first = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(first), timeZone));
}

/** Data local de `now` no fuso: campos UTC de um Date deslocado. */
function localDate(now: Date, timeZone: string) {
  return new Date(now.getTime() + offsetMs(now, timeZone));
}

/** Início (inclusivo) e fim (exclusivo) do dia local que contém `now`. */
export function dayBounds(now: Date, timeZone = DEFAULT_TIMEZONE) {
  const local = localDate(now, timeZone);
  const [year, month, day] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()];
  return { start: localMidnight(year, month, day, timeZone), end: localMidnight(year, month, day + 1, timeZone) };
}

/** Início (inclusivo) e fim (exclusivo) da semana ISO (segunda a domingo) que contém `now`. */
export function weekBounds(now: Date, timeZone = DEFAULT_TIMEZONE) {
  const local = localDate(now, timeZone);
  const monday = local.getUTCDate() - ((local.getUTCDay() + 6) % 7);
  const [year, month] = [local.getUTCFullYear(), local.getUTCMonth()];
  return { start: localMidnight(year, month, monday, timeZone), end: localMidnight(year, month, monday + 7, timeZone) };
}

/** Data local `AAAA-MM-DD` de `instant` no fuso. */
export function localDateKey(instant: Date, timeZone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Hora local (0–23) de `instant` no fuso. */
export function localHour(instant: Date, timeZone = DEFAULT_TIMEZONE) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(instant));
}

/** Soma dias a uma data `AAAA-MM-DD`, sem passar por fuso. */
export function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Meia-noite local (como instante UTC) da data `AAAA-MM-DD` no fuso. */
export function startOfLocalDate(dateKey: string, timeZone = DEFAULT_TIMEZONE) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return localMidnight(year, month - 1, day, timeZone);
}

/** Meia-noite local do dia 1 do mês que contém `now`. */
export function monthStart(now: Date, timeZone = DEFAULT_TIMEZONE) {
  const local = localDate(now, timeZone);
  return localMidnight(local.getUTCFullYear(), local.getUTCMonth(), 1, timeZone);
}
