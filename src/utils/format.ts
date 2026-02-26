/**
 * Formats seconds into a human-readable uptime string.
 */
export function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / (24 * 3600));
    const hours = Math.floor((seconds % (24 * 3600)) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    const dayLabel = days === 1 ? 'day' : 'days';
    const hourLabel = hours === 1 ? 'hour' : 'hours';
    const minLabel = mins === 1 ? 'minute' : 'minutes';

    if (days > 0) {
        return `${days} ${dayLabel}, ${hours} ${hourLabel}`;
    }
    return `${hours} ${hourLabel}, ${mins} ${minLabel}`;
}
