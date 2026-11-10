import '@testing-library/jest-dom';

// Polyfill ResizeObserver for React Flow in jsdom
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Polyfill DOMMatrixReadOnly for React Flow zoom/pan transforms
if (typeof global.DOMMatrixReadOnly === 'undefined') {
  // @ts-expect-error Mock minimal DOMMatrix
  global.DOMMatrixReadOnly = class DOMMatrixReadOnly {
    m22 = 1;
    constructor(transform?: string | number[]) {
      if (Array.isArray(transform)) {
        this.m22 = transform[3] || 1;
      }
    }
  };
}
