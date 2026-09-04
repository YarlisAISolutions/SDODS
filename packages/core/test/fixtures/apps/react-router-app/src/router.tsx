import { createBrowserRouter } from 'react-router-dom';
export const router = createBrowserRouter([
  { path: '/', element: <div data-cy="home" /> },
  { path: '/customers', element: <div data-cy="customers" /> },
  { path: '/customers/:customerId', element: <div data-cy="customer" /> },
  { path: '/settings/profile', element: <div data-cy="profile" /> },
]);
