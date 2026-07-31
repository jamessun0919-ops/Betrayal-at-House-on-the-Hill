import { io } from 'socket.io-client';

export function createSocket() {
  const url = import.meta.env.DEV
    ? (import.meta.env.VITE_SERVER_URL || 'http://localhost:3001')
    : undefined;
  return io(url);
}
