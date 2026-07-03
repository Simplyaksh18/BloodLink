import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  InternalError,
} from '../../src/utils/ApiError';

describe('ApiError classes', () => {
  it('BadRequestError has statusCode 400', () => {
    const err = new BadRequestError('bad');
    expect(err.statusCode).toBe(400);
    expect(err.isOperational).toBe(true);
  });

  it('UnauthorizedError has statusCode 401', () => {
    expect(new UnauthorizedError().statusCode).toBe(401);
  });

  it('ForbiddenError has statusCode 403', () => {
    expect(new ForbiddenError().statusCode).toBe(403);
  });

  it('NotFoundError has statusCode 404', () => {
    expect(new NotFoundError().statusCode).toBe(404);
  });

  it('ConflictError has statusCode 409', () => {
    expect(new ConflictError().statusCode).toBe(409);
  });

  it('ValidationError has statusCode 422 and carries errors', () => {
    const errors = [{ field: 'email', message: 'invalid' }];
    const err = new ValidationError('fail', errors);
    expect(err.statusCode).toBe(422);
    expect(err.errors).toEqual(errors);
  });

  it('InternalError has statusCode 500', () => {
    expect(new InternalError().statusCode).toBe(500);
  });
});
