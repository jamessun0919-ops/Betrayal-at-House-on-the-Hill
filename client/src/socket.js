import { io } from 'socket.io-client';

export function createSocket() {
  const url = import.meta.env.DEV
    ? (import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`)
    : undefined;
  return io(url);
}
