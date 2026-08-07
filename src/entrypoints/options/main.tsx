import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { OptionsApp } from './OptionsApp';
import './style.css';

const root = document.querySelector('#root');

if (!root) {
  throw new Error('Options root element was not found.');
}

createRoot(root).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>,
);
