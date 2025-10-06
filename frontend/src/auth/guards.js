// FRONTEND: src/auth/guards.js
import React from 'react';
import { Navigate } from 'react-router-dom';

export const getToken = () => localStorage.getItem('token');
export const getRole  = () => (localStorage.getItem('role') || '').toLowerCase();

export function RequireAuth({ children }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

export function RequireRole({ role, redirect = '/' , children }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  if (getRole() !== String(role).toLowerCase()) return <Navigate to={redirect} replace />;
  return children;
}
