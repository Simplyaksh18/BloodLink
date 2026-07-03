export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: unknown;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, errors?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Bad request', errors?: unknown) {
    super(message, 400, errors);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

export class ValidationError extends ApiError {
  constructor(message = 'Validation failed', errors?: unknown) {
    super(message, 422, errors);
  }
}

export class InternalError extends ApiError {
  constructor(message = 'Internal server error') {
    super(message, 500);
  }
}
