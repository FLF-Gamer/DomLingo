import { createRoot } from 'react-dom/client';
import { PdfApp } from './PdfApp';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('PDF root element was not found.');
createRoot(root).render(<PdfApp />);
