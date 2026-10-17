const configuration = window.SUPABASE_CONFIG;
const eventContainer = document.getElementById("upcomingEvents");
const updateStatus = document.getElementById("eventUpdatesStatus");

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

function setUpdateStatus(message){
    updateStatus.textContent = message;
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
}

if(supabaseClient){
    supabaseClient
        .channel("public-church-event-feed")
        .on("postgres_changes", {
            event:"*",
            schema:"public",
            table:"events"
        }, () => loadEvents(false))
        .subscribe((status, error) => {
            if(status === "SUBSCRIBED"){
                setUpdateStatus("Showing the latest church events. Live updates are on.");
            }else if(status === "CHANNEL_ERROR" || status === "TIMED_OUT"){
                console.error("Unable to subscribe to live church event updates.", error);
                setUpdateStatus("Live event updates are temporarily unavailable. Refresh the page to reconnect.");
            }
        });

    loadEvents();
}else{
    loadEvents();
}
