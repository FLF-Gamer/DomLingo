import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PopupApp } from './PopupApp';
import './style.css';

const root = document.querySelector('#root');

if (!root) {
  throw new Error('Popup root element was not found.');
}

createRoot(root).render(
  <StrictMode>
    <PopupApp />
  </StrictMode>,
);
