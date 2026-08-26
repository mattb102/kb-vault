// Service worker for the home-screen app. Its only job is notifications:
// show them when they arrive, and focus (or open) the app when one is tapped.
self.addEventListener('push', function (event) {
  var d = { title: 'Vault', body: '', url: '/app' };
  try {
    var j = event.data ? event.data.json() : null;
    if (j) {
      d.title = j.title || d.title;
      d.body = j.body || d.body;
      d.url = j.url || d.url;
    }
  } catch (e) {
    if (event.data) d.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      data: { url: d.url },
      // One tag means a new notification replaces the previous one instead of
      // stacking up a wall of them on the lock screen.
      tag: 'vault-notification'
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/app';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(target) > -1 && 'focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
