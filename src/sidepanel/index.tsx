import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<SidePanel />);
} else {
  console.error('Root element not found');
}
