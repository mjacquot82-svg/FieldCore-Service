const listenersByEvent = new Map();

export function on(eventName, listener) {
  if (typeof listener !== 'function') return;
  if (!listenersByEvent.has(eventName)) listenersByEvent.set(eventName, new Set());
  listenersByEvent.get(eventName).add(listener);
}

export function off(eventName, listener) {
  listenersByEvent.get(eventName)?.delete(listener);
}

export function emit(eventName, payload = {}) {
  const listeners = listenersByEvent.get(eventName);
  if (!listeners?.size) return;

  [...listeners].forEach((listener) => {
    listener(payload);
  });
}
