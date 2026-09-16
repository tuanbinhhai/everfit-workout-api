export const MUSCLE_GROUP_PROVIDER = Symbol('MUSCLE_GROUP_PROVIDER');

export interface MuscleGroupProvider {
  // Returns null for an unmapped exercise — never throws.
  getMuscleGroup(exerciseName: string): Promise<string | null>;
  // Returns normalized exercise names mapped to this muscle group (empty if none).
  listExerciseNames(muscleGroup: string): Promise<string[]>;
}
