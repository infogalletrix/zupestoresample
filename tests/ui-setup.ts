import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;
window.scrollTo = vi.fn();
