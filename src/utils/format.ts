export function formatDuration(seconds: number): string {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  const pad = (value: number, length = 2) => value.toString().padStart(length, "0");
  return `${pad(hours)}:${pad(min)}:${pad(sec)},${pad(ms, 3)}`;
}
