self.addEventListener('push',e=>{const d=e.data?.json()||{};e.waitUntil(self.registration.showNotification(d.title||'Pulse',{body:d.body||'New message',icon:'/icon.svg'}))});
