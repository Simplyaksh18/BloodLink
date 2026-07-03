import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { JwtPayload } from '../types';

let io: Server | null = null;

export function initSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      credentials: true,
    },
    // Allow both polling and websocket — React Native handles both fine
    transports: ['websocket', 'polling'],
  });

  // JWT auth middleware — runs before every connection
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      (socket as any).userId = payload.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket as any).userId as string;
    socket.join(`user:${userId}`);
    console.log(`[Socket] connected userId: ${userId} | socketId: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`[Socket] disconnected userId: ${userId} | socketId: ${socket.id}`);
    });
  });

  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
  if (event === 'notification:new') {
    console.log(`[Socket] emitted notification:new userId: ${userId}`);
  } else if (event === 'notification:unread-count') {
    console.log(`[Socket] emitted unread-count userId: ${userId}`);
  } else if (event === 'request:updated') {
    console.log(`[Socket] emitted request:updated userId: ${userId}`);
  } else if (event === 'message:new') {
    console.log(`[Socket] emitted message:new userId: ${userId}`);
  }
}
