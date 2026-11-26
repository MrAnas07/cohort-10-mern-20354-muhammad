import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';

// jsdom does not implement the encoding globals, and react-router v7 creates
// a TextEncoder at import time - polyfill them before any test file loads.
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder;
}
