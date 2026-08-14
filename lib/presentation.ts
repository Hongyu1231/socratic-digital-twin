export function formatEnglishDate(value: string | null | undefined) {
  if (!value) return "—";
  const legacyDate = value.match(/^(\d{4})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5$/);
  const date = legacyDate
    ? new Date(Date.UTC(Number(legacyDate[1]), Number(legacyDate[2]) - 1, Number(legacyDate[3])))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function displayDatasetName(value: string) {
  return value.replace(/<DATE_[^>]+>/g, "protected date");
}
