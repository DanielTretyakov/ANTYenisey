/**
 * Адрес зала без города: город показывают строкой выше, а DaData пишет его и
 * в адрес — «г Красноярск, ул Партизана Железняка, д 25».
 */
export function streetOf(hall: { address: string | null; city: string | null }): string | null {
  if (!hall.address) return null;
  if (!hall.city) return hall.address;

  const city = hall.city.toLowerCase();

  for (const prefix of [`г ${city}, `, `г. ${city}, `, `${city}, `]) {
    if (hall.address.toLowerCase().startsWith(prefix)) return hall.address.slice(prefix.length);
  }

  return hall.address;
}
