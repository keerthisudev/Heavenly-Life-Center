const seenNotificationStorageKey = "heavenlyLifeCenterSeenEventNotification";
const configuration = window.SUPABASE_CONFIG;
const eventContainer = document.getElementById("upcomingEvents");
const updateStatus = document.getElementById("eventUpdatesStatus");
const notificationList = document.getElementById("eventNotificationList");
const pushButton = document.getElementById("enablePushButton");
const recentPushEvents = new Set();

const weeklyServices = [
    {
        title: "Sunday Worship Service",
        description: "Our main weekly worship gathering for the whole church family.",
        weekday: 0,
        time: "08:30",
        timeLabel: "8:30 AM – 11:00 AM",
        icon: "🕊"
    },
    {
        title: "Friday Evening Service",
        description: "An evening of worship, prayer and spiritual encouragement.",
        weekday: 5,
        time: "19:00",
        timeLabel: "7:00 PM – 8:30 PM",
        icon: "🙏"
    },
    {
        title: "Wednesday Prayer Meeting",
        description: "Come together as a church to pray for families and our community.",
        weekday: 3,
        time: "19:00",
        timeLabel: "7:00 PM",
        icon: "🔥"
    },
    {
        title: "Bible Study",
        description: "Explore God's Word and grow deeper in your understanding of Scripture.",
        weekday: 5,
        time: "19:00",
        timeLabel: "7:00 PM",
        icon: "📖"
    },
    {
        title: "Monthly Fasting Prayer",
        description: "A dedicated time of fasting, prayer and seeking God's guidance.",
        monthly: true,
        timeLabel: "9:00 AM",
        icon: "🌿"
    }
];

const supabaseConfigurationReady = Boolean(
    configuration &&
    /^https:\/\/[^/]+$/i.test(configuration.url) &&
    !configuration.url.includes("YOUR_") &&
    configuration.anonKey &&
    !configuration.anonKey.includes("YOUR_")
);
const supabaseClient = supabaseConfigurationReady && window.supabase
    ? window.supabase.createClient(configuration.url, configuration.anonKey)
    : null;

function getNextOccurrence(event){
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if(event.monthly){
        const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
        const firstSaturday = 1 + ((6 - firstDay.getDay() + 7) % 7);
        date.setDate(firstSaturday);
        const occurrence = new Date(
            date.getFullYear(), date.getMonth(), date.getDate(), 9
        );
        if(occurrence <= now){
            date.setMonth(date.getMonth() + 1, 1);
            date.setDate(1 + ((6 - date.getDay() + 7) % 7));
        }
    }else{
        const daysUntil = (event.weekday - date.getDay() + 7) % 7;
        date.setDate(date.getDate() + daysUntil);
        const [hours, minutes] = event.time.split(":").map(Number);
        const occurrence = new Date(
            date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes
        );
        if(occurrence <= now){
            date.setDate(date.getDate() + 7);
        }
    }

    return date;
}

function formatEventDate(date){
    return new Intl.DateTimeFormat("en", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
    }).format(date);
}

function setUpdateStatus(message, isNew = false){
    updateStatus.textContent = message;
    updateStatus.classList.toggle("is-new", isNew);
}

function addEventPoster(card, event){
    if(!event.posterUrl){
        return;
    }
    const poster = document.createElement("img");
    poster.className = "event-poster";
    poster.src = event.posterUrl;
    poster.alt = `${event.title} event poster`;
    poster.loading = "lazy";
    poster.decoding = "async";
    poster.addEventListener("error", () => poster.remove(), {once:true});
    card.append(poster);
}

function renderEvent(event){
    const card = document.createElement("article");
    card.className = "card event-card";
    addEventPoster(card, event);

    const date = document.createElement("span");
    date.className = "event-date";
    date.textContent = formatEventDate(event.date);

    const title = document.createElement("h3");
    title.textContent = `${event.icon || "📅"} ${event.title}`;

    const description = document.createElement("p");
    description.textContent = event.description || "";

    const meta = document.createElement("div");
    meta.className = "event-meta";

    if(event.timeLabel){
        const time = document.createElement("span");
        time.textContent = `🕒 ${event.timeLabel}`;
        meta.append(time);
    }

    if(event.location){
        const location = document.createElement("span");
        location.textContent = `📍 ${event.location}`;
        meta.append(location);
    }

    card.append(date, title, description, meta);
    eventContainer.append(card);
}

function displayEvents(databaseEvents = []){
    const now = new Date();
    const events = weeklyServices.map(event => ({
        ...event,
        date: getNextOccurrence(event)
    }));

    for(const event of databaseEvents){
        const eventDate = new Date(`${event.event_date}T00:00:00`);
        if(Number.isNaN(eventDate.getTime()) || eventDate < new Date(
            now.getFullYear(), now.getMonth(), now.getDate()
        )){
            continue;
        }
        const posterUrl = event.poster_path
            ? supabaseClient.storage.from("event-posters")
                .getPublicUrl(event.poster_path).data.publicUrl
            : "";
        events.push({
            title: event.title,
            description: event.description,
            date: eventDate,
            timeLabel: event.event_time
                ? new Date(`1970-01-01T${event.event_time}`).toLocaleTimeString(
                    "en", {hour:"numeric", minute:"2-digit"}
                )
                : "Time to be announced",
            location: event.location,
            posterUrl,
            icon: "📅"
        });
    }

    events.sort((first, second) => first.date - second.date);
    eventContainer.replaceChildren();
    if(!events.length){
        const emptyMessage = document.createElement("p");
        emptyMessage.className = "card events-empty";
        emptyMessage.textContent = "No upcoming events are currently scheduled.";
        eventContainer.append(emptyMessage);
        return;
    }
    events.forEach(renderEvent);
}

function renderNotifications(notifications, announceLatest = false){
    notificationList.replaceChildren();
    if(!notifications.length){
        return;
    }

    const newest = notifications[0];
    let seenId = "";
    try{
        seenId = localStorage.getItem(seenNotificationStorageKey) || "";
    }catch(error){
        console.error("Unable to read the event notification status.", error);
    }
    const isNew = newest.id !== seenId;

    for(const notification of notifications.slice(0, 3)){
        const item = document.createElement("div");
        item.className = "event-notification";
        const action = notification.action === "deleted"
            ? "was removed"
            : notification.action === "updated"
                ? "was updated"
                : "was added";
        item.textContent = `${notification.event_title} ${action} · ${formatEventDate(
            new Date(`${notification.event_date}T00:00:00`)
        )}`;
        notificationList.append(item);
    }

    if(isNew && announceLatest){
        setUpdateStatus(`New church update: ${newest.event_title}`, true);
        showToast(`Church event ${newest.action}: ${newest.event_title}`);
        if(typeof Notification !== "undefined" &&
           Notification.permission === "granted" &&
           document.visibilityState === "visible"){
            try{
                new Notification("Heavenly Life Center", {
                    body: `${newest.event_title} ${newest.action}. Open the events section for details.`,
                    icon: "assets/logo.jpg",
                    tag: newest.id
                });
            }catch(error){
                console.error("Unable to show the church event notification.", error);
            }
        }
    }else if(!announceLatest && isNew){
        setUpdateStatus("Recent event updates", true);
    }

    if(announceLatest || !seenId){
        try{
            localStorage.setItem(seenNotificationStorageKey, newest.id);
        }catch(error){
            console.error("Unable to save the event notification status.", error);
        }
    }
}

async function loadEvents(showLoadedStatus = true){
    if(!supabaseClient){
        displayEvents();
        setUpdateStatus(
            "The live event calendar is not connected yet. Complete the Supabase setup to publish shared events."
        );
        return;
    }

    const today = new Date();
    const dateString = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0")
    ].join("-");
    const {data, error} = await supabaseClient
        .from("events")
        .select("id,title,description,event_date,event_time,location,poster_path")
        .gte("event_date", dateString)
        .order("event_date")
        .order("event_time", {nullsFirst:false});

    if(error){
        console.error("Unable to load church events.", error);
        displayEvents();
        setUpdateStatus("Church events could not be loaded. Please try again later.");
        return;
    }

    displayEvents(data);
    if(showLoadedStatus){
        setUpdateStatus("Showing the latest church events.");
    }
    loadNotifications();
}

async function loadNotifications(announceLatest = false){
    if(!supabaseClient){
        return;
    }
    const {data, error} = await supabaseClient
        .from("event_notifications")
        .select("id,action,event_title,event_date,created_at")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", {ascending:false})
        .limit(10);
    if(error){
        console.error("Unable to load church event notifications.", error);
        return;
    }
    renderNotifications(data, announceLatest);
}

function notifyVisitors(notification){
    const notificationId = notification?.id ||
        `${notification?.title || notification?.event_title}:${notification?.action}`;
    if(!notification || recentPushEvents.has(notificationId)){
        return;
    }
    recentPushEvents.add(notificationId);
    loadNotifications(true);
    loadEvents(false);
}

function decodeVapidKey(base64Key){
    const padding = "=".repeat((4 - base64Key.length % 4) % 4);
    const base64 = (base64Key + padding).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

function updatePushButton(){
    if(!supabaseClient || !("serviceWorker" in navigator) ||
       !("PushManager" in window) || !("Notification" in window)){
        pushButton.hidden = true;
        return;
    }
    pushButton.hidden = Notification.permission === "granted";
    pushButton.textContent = Notification.permission === "denied"
        ? "Notifications blocked in browser settings"
        : "Enable phone notifications";
    pushButton.disabled = Notification.permission === "denied";
}

pushButton.addEventListener("click", async () => {
    if(!supabaseClient || !configuration.vapidPublicKey ||
       configuration.vapidPublicKey.includes("YOUR_")){
        setUpdateStatus("Phone notifications need the Supabase project and VAPID public key configured.");
        return;
    }

    try{
        const permission = await Notification.requestPermission();
        if(permission !== "granted"){
            setUpdateStatus("Allow notifications in your browser settings to receive event alerts.");
            updatePushButton();
            return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: decodeVapidKey(configuration.vapidPublicKey)
        });
        const {error} = await supabaseClient.functions.invoke("event-push", {
            body: {action:"subscribe", subscription}
        });
        if(error){
            throw error;
        }
        setUpdateStatus("Phone notifications are enabled for this device.");
        updatePushButton();
    }catch(error){
        console.error("Unable to enable phone event notifications.", error);
        setUpdateStatus("Phone notifications could not be enabled. Please try again.");
    }
});

if(supabaseClient){
    supabaseClient
        .channel("public-church-event-feed")
        .on("postgres_changes", {
            event:"*",
            schema:"public",
            table:"events"
        }, () => loadEvents(false))
        .on("postgres_changes", {
            event:"INSERT",
            schema:"public",
            table:"event_notifications"
        }, payload => notifyVisitors(payload.new))
        .subscribe((status, error) => {
            if(status === "SUBSCRIBED"){
                if(!updateStatus.classList.contains("is-new")){
                    setUpdateStatus("Showing the latest church events. Live updates are on.");
                }
            }else if(status === "CHANNEL_ERROR" || status === "TIMED_OUT"){
                console.error("Unable to subscribe to live church event updates.", error);
                setUpdateStatus("Live event updates are temporarily unavailable. Refresh the page to reconnect.");
            }
        });

    loadEvents();
}else{
    loadEvents();
}
updatePushButton();

if("serviceWorker" in navigator){
    navigator.serviceWorker.addEventListener("message", event => {
        if(event.data?.type === "event-push"){
            notifyVisitors(event.data.notification);
        }
    });
}
