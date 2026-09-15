import { ValidationError } from 'class-validator';

export interface FieldError {
  field: string;
  issue: string;
}

export function formatValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  const result: FieldError[] = [];

  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      for (const issue of Object.values(error.constraints)) {
        result.push({ field: path, issue });
      }
    }

    if (error.children && error.children.length > 0) {
      result.push(...formatValidationErrors(error.children, path));
    }
  }

  return result;
}
