importScripts("./supabase-config.js");

const CACHE_NAME = "heavenly-life-center-v3";
const APP_SHELL = [
    "./",
    "./index.html",
    "./events.js",
    "./site.js",
    "./supabase-config.js",
    "./manifest.webmanifest",
    "./assets/logo.jpg",
    "./assets/worship.jpg",
    "./assets/church-welcome.svg"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    if(event.request.method !== "GET"){
        return;
    }

    const requestUrl = new URL(event.request.url);
    if(requestUrl.origin !== self.location.origin){
        return;
    }

    if(
        requestUrl.pathname.endsWith("/admin.html") ||
        requestUrl.pathname.endsWith("/admin.js")
    ){
        event.respondWith(fetch(event.request));
        return;
    }

    if(event.request.mode === "navigate"){
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if(response.ok){
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(
                            cache => cache.put(event.request, copy)
                        );
                    }
                    return response;
                })
                .catch(() => caches.match(event.request).then(
                    response => response || caches.match("./index.html")
                ))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(response => response || fetch(event.request))
    );
});

self.addEventListener("push", event => {
    let notification;
    try{
        notification = event.data?.json();
    }catch(error){
        console.error("Unable to read a church event push notification.", error);
        return;
    }
    if(!notification?.title || !notification?.body){
        return;
    }

    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
        });
        const visibleClient = clients.find(client => client.visibilityState === "visible");
        if(visibleClient){
            visibleClient.postMessage({
                type: "event-push",
                notification: notification.data
            });
            return;
        }
        await self.registration.showNotification(notification.title, {
            body: notification.body,
            icon: notification.icon || "./assets/logo.jpg",
            badge: notification.badge || "./assets/logo.jpg",
            image: notification.image || undefined,
            tag: notification.tag || "church-event",
            data: notification.data || {url:"./index.html#events"},
            renotify: true
        });
    })());
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const path = event.notification.data?.url || "./index.html#events";
    const target = new URL(path, self.location.origin).href;
    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
        });
        const existingClient = clients.find(client => client.url.startsWith(self.location.origin));
        if(existingClient){
            await existingClient.focus();
            existingClient.navigate(target);
            return;
        }
        await self.clients.openWindow(target);
    })());
});

self.addEventListener("pushsubscriptionchange", event => {
    if(!self.SUPABASE_CONFIG?.url || !self.SUPABASE_CONFIG?.anonKey ||
       !self.SUPABASE_CONFIG?.vapidPublicKey){
        return;
    }
    event.waitUntil((async () => {
        const endpoint = event.oldSubscription?.endpoint;
        if(endpoint){
            await fetch(`${self.SUPABASE_CONFIG.url}/functions/v1/event-push`, {
                method:"POST",
                headers:{
                    "Content-Type":"application/json",
                    "apikey":self.SUPABASE_CONFIG.anonKey
                },
                body:JSON.stringify({action:"unsubscribe", endpoint})
            });
        }
        const subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly:true,
            applicationServerKey:decodeVapidKey(self.SUPABASE_CONFIG.vapidPublicKey)
        });
        await fetch(`${self.SUPABASE_CONFIG.url}/functions/v1/event-push`, {
            method:"POST",
            headers:{
                "Content-Type":"application/json",
                "apikey":self.SUPABASE_CONFIG.anonKey
            },
            body:JSON.stringify({action:"subscribe", subscription})
        });
    })());
});

function decodeVapidKey(base64Key){
    const padding = "=".repeat((4 - base64Key.length % 4) % 4);
    const base64 = (base64Key + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}
