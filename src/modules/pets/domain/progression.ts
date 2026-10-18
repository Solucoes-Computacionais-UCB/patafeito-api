/** XP acumulado necessário para alcançar cada nível: 0, 100, 300, 600... */
export function levelForXp(xpTotal: number): number {
  let level = 1;
  let threshold = 0;

  while (xpTotal >= threshold + level * 100) {
    threshold += level * 100;
    level += 1;
  }

  return level;
}
