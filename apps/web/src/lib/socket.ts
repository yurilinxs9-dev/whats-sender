import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || '';

let socket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (socket?.connected) return socket;

  // Skip WebSocket in production when no WSS is available
  if (!WS_URL || (typeof window !== 'undefined' && window.location.protocol === 'https:' && WS_URL.startsWith('http:'))) {
    // Return a noop socket-like object to avoid errors
    const noop = io('http://localhost:0', { autoConnect: false }) as Socket;
    return noop;
  }

  socket = io(WS_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
