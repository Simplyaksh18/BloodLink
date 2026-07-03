import { Response } from 'express';
import { PaginatedResponse } from '../types';

export class ApiResponse {
  static success<T>(res: Response, data: T, message = 'Success', statusCode = 200): Response {
    return res.status(statusCode).json({ success: true, data, message });
  }

  static paginated<T>(
    res: Response,
    items: T[],
    pagination: Omit<PaginatedResponse<T>, 'data'>,
    message = 'Success'
  ): Response {
    const payload: PaginatedResponse<T> = { data: items, ...pagination };
    return res.status(200).json({ success: true, data: payload, message });
  }

  static created<T>(res: Response, data: T, message = 'Created'): Response {
    return res.status(201).json({ success: true, data, message });
  }

  static noContent(res: Response): Response {
    return res.status(204).send();
  }
}
