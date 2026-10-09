import { handlers } from './tasks.js';

self.onmessage = (ev) => {
  const { id, type, payload } = ev.data;
  try {
    const progress = (text) => self.postMessage({ id, kind: 'progress', text });
    const { result, transfer } = handlers[type](payload, progress);
    self.postMessage({ id, kind: 'done', result }, transfer || []);
  } catch (e) {
    self.postMessage({ id, kind: 'error', message: e && e.message ? e.message : String(e) });
  }
};
