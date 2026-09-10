export function initSignal(): void;
export function normalizeVerdict(value?: unknown): string;
export function signalFeedback(verdict?: string): void;
export function applyPreferences(next?: {
  theme?: string;
  reduced?: boolean;
  sound?: boolean;
}): { theme: string; reduced: boolean; sound: boolean };
