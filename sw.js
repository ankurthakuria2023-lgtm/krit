self.addEventListener('push', event => {
 let data = {};
 try { data = event.data ? event.data.json() : {}; } catch { data = { message: event.data?.text() || 'You have a little something 💌' }; }
 const title = data.title || 'A little something 💌';
 const options = { body: data.message || 'Someone sent you a message 🌷', icon: './icon.svg', badge: './icon.svg', data: { url: data.url || './#messenger' }, tag: data.tag || 'little-something', renotify: true };
 event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => { event.notification.close(); const target = new URL(event.notification.data?.url || './#messenger', self.location.origin).href; event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => { for (const client of list) { if (client.url.startsWith(self.location.origin) && 'focus' in client) { client.navigate(target); return client.focus(); } } return clients.openWindow(target); })); });
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
