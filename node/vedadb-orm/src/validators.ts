/**
 * VedaDB ORM Validators
 */

export interface Validator {
  validate: (value: any) => boolean;
  message: string;
}

/**
 * Value must not be null or undefined.
 */
export function required(): Validator {
  return {
    validate: (value: any) => value !== null && value !== undefined && value !== '',
    message: 'Value is required',
  };
}

/**
 * String must be at least `n` characters long.
 */
export function minLength(n: number): Validator {
  return {
    validate: (value: any) => typeof value === 'string' && value.length >= n,
    message: `Must be at least ${n} characters`,
  };
}

/**
 * String must be at most `n` characters long.
 */
export function maxLength(n: number): Validator {
  return {
    validate: (value: any) => typeof value === 'string' && value.length <= n,
    message: `Must be at most ${n} characters`,
  };
}

/**
 * Numeric value must be at least `n`.
 */
export function minValue(n: number): Validator {
  return {
    validate: (value: any) => typeof value === 'number' && value >= n,
    message: `Must be at least ${n}`,
  };
}

/**
 * Numeric value must be at most `n`.
 */
export function maxValue(n: number): Validator {
  return {
    validate: (value: any) => typeof value === 'number' && value <= n,
    message: `Must be at most ${n}`,
  };
}

/**
 * Value must match the given regular expression.
 */
export function regex(pattern: RegExp): Validator {
  return {
    validate: (value: any) => typeof value === 'string' && pattern.test(value),
    message: `Must match pattern ${pattern}`,
  };
}

/**
 * Value must be a valid email address.
 */
export function isEmail(): Validator {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return {
    validate: (value: any) => typeof value === 'string' && emailRegex.test(value),
    message: 'Must be a valid email address',
  };
}

/**
 * Value must be one of the given choices.
 */
export function oneOf(...choices: any[]): Validator {
  return {
    validate: (value: any) => choices.includes(value),
    message: `Must be one of: ${choices.join(', ')}`,
  };
}

/**
 * Custom validator with a user-supplied function and message.
 */
export function custom(fn: (value: any) => boolean, message: string): Validator {
  return {
    validate: fn,
    message,
  };
}
