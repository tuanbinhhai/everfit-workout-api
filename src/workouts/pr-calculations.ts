export function calculateVolume(weightKg: number, reps: number): number {
  return weightKg * reps;
}

export function calculateEpley1Rm(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}
