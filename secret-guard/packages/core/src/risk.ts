import type { Decision, RiskLevel } from "./types.js";

export function levelForScore(score: number): RiskLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

export function decisionForLevel(level: RiskLevel): Decision {
  if (level === "CRITICAL" || level === "HIGH") return "BLOCK";
  if (level === "MEDIUM") return "WARN";
  return "ALLOW";
}

export function boundedScore(score: number): number {
  if (!Number.isFinite(score)) return 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}
