export const MUSCLE_GROUP_PROVIDER = Symbol('MUSCLE_GROUP_PROVIDER');

export interface MuscleGroupProvider {
  // Returns null for an unmapped exercise — never throws.
  getMuscleGroup(exerciseName: string): Promise<string | null>;
}
