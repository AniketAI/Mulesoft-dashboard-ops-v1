import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * Feature 8: Notification bell context.
 *
 * Use `useNotifications().addNotification(n)` from anywhere to push a notification.
 * The bell icon in the Header shows unread count and a dropdown list.
 *
 * Notification shape:
 *   { id, title, body?, type: 'success'|'error'|'warning'|'info', ts, read }
 */

const NotificationContext = createContext(null);

let _nextId = 1;

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);

  const addNotification = useCallback(({ title, body = '', type = 'info' }) => {
    const id = _nextId++;
    setNotifications(prev => [{ id, title, body, type, ts: Date.now(), read: false }, ...prev].slice(0, 50));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{ notifications, addNotification, markAllRead, dismiss, clearAll, unreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>');
  return ctx;
}