import { io, Socket } from 'socket.io-client';
import Constants from 'expo-constants';

// Must match apiClient.ts URL resolution exactly, else Socket.IO connects to
// a different host than REST — cause of the connect_error / reconnect loop
// seen in EAS builds where only EXPO_PUBLIC_API_URL is set.
const API_BASE_URL: string =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'https://whacky-wriggly-brunch.ngrok-free.dev/v1';

// Strip /v1 (or any /vN) suffix — Socket.IO connects to the server root
const SOCKET_URL = API_BASE_URL.replace(/\/v\d+\/?$/, '');
console.log('[Socket] resolved URL:', SOCKET_URL);

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  // If already connected with same token, reuse
  if (socket?.connected) return socket;

  // Clean up stale socket before creating a new one
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  console.log('[Socket] connecting');

  // Use Socket.IO's default transport order (polling → upgrade to websocket).
  // Forcing websocket-only caused the flood of "[Socket] connect error:
  // websocket error" whenever the initial WS handshake failed (Render cold
  // start, ngrok blip, corporate proxy) — no polling fallback was allowed.
  socket = io(SOCKET_URL, {
    auth: { token },
    autoConnect: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => console.log('[Socket] connected'));
  socket.on('disconnect', (reason) => console.log('[Socket] disconnected', reason));
  socket.on('connect_error', (err) => console.log('[Socket] connect error:', err.message));

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    console.log('[Socket] disconnecting');
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}
