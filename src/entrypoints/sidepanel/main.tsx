import { createRoot } from 'react-dom/client';
import { PdfPanelApp } from './PdfPanelApp';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('PDF panel root element was not found.');
createRoot(root).render(<PdfPanelApp />);
