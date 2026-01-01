import type { Severity } from "../types";

export function severityRank(s: Severity): number {
  if (s === "critical") return 3;
  if (s === "risk") return 2;
  if (s === "watch") return 1;
  return 0;
}

export function severityColor(s: Severity): "green" | "amber" | "red" {
  if (s === "watch") return "amber";
  if (s === "risk" || s === "critical") return "red";
  return "green";
}
