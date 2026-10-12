const settings = window.SUPABASE_CONFIG;
const configurationReady = Boolean(
    settings &&
    /^https:\/\/[^/]+$/i.test(settings.url) &&
    !settings.url.includes("YOUR_") &&
    settings.anonKey &&
    !settings.anonKey.includes("YOUR_")
);
const client = configurationReady && window.supabase
    ? window.supabase.createClient(settings.url, settings.anonKey)
    : null;

const authPanel = document.getElementById("authPanel");
const adminWorkspace = document.getElementById("adminWorkspace");
const eventForm = document.getElementById("eventForm");
const eventList = document.getElementById("eventList");
const eventIdInput = document.getElementById("eventId");
const statusMessage = document.getElementById("formStatus");
const authStatus = document.getElementById("authStatus");
const dateInput = document.getElementById("eventDate");
const posterInput = document.getElementById("eventPoster");
const posterPreview = document.getElementById("posterPreview");
const inviteList = document.getElementById("inviteList");
const signOutButton = document.getElementById("signOutButton");
const deleteConfirmation = document.getElementById("deleteConfirmation");
const deleteConfirmationMessage = document.getElementById("deleteConfirmationMessage");
const confirmDeleteButton = document.getElementById("confirmDeleteButton");
const cancelDeleteButton = document.getElementById("cancelDeleteButton");
let savedEvents = [];
let signedInUser = null;
let posterPreviewUrl = "";
let pendingDeleteEvent = null;
let pendingDeleteButton = null;

function showMessage(element, message, isError = false){
    element.textContent = message;
    element.classList.toggle("error", isError);
}

function createTextElement(tag, className, text){
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
}

function localDateString(date){
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function formatDate(dateString){
    return new Intl.DateTimeFormat("en", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    }).format(new Date(`${dateString}T00:00:00`));
}

function publicPosterUrl(path){
    return path ? client.storage.from("event-posters").getPublicUrl(path).data.publicUrl : "";
}

function setAuthControls(isAdmin){
    authPanel.hidden = isAdmin;
    adminWorkspace.hidden = !isAdmin;
    signOutButton.hidden = !isAdmin;
}

async function refreshAdminAccess(session){
    signedInUser = session?.user || null;
    if(!signedInUser){
        setAuthControls(false);
        return;
    }

    const {data, error} = await client.rpc("is_admin");
    if(error){
        console.error("Unable to check admin access.", error);
        setAuthControls(false);
        showMessage(authStatus, "Could not verify admin access. Check the Supabase setup and try again.", true);
        return;
    }
    if(data !== true){
        await client.auth.signOut();
        signedInUser = null;
        setAuthControls(false);
        showMessage(authStatus, "This email is not approved for the admin dashboard. Ask an existing admin to add it to Admin signup settings.", true);
        return;
    }

    setAuthControls(true);
    showMessage(authStatus, "");
    await Promise.all([loadEvents(), loadAdminInvites()]);
}

async function loadEvents(){
    const {data, error} = await client
        .from("events")
        .select("id,title,description,event_date,event_time,location,poster_path,created_at,updated_at")
        .order("event_date", {ascending:true})
        .order("event_time", {ascending:true, nullsFirst:false});

    if(error){
        console.error("Unable to load events in the admin dashboard.", error);
        eventList.replaceChildren(
            createTextElement("p", "empty", "Events could not be loaded. Check database policies and reconnect.")
        );
        showMessage(statusMessage, "Could not load events from Supabase.", true);
        return;
    }

    savedEvents = data;
    renderDashboard();
}

function renderDashboard(){
    const today = localDateString(new Date());
    const futureEvents = savedEvents.filter(event => event.event_date >= today);
    document.getElementById("upcomingCount").textContent = futureEvents.length;
    document.getElementById("totalCount").textContent = savedEvents.length;
    document.getElementById("nextEvent").textContent =
        futureEvents.length ? formatDate(futureEvents[0].event_date) : "None yet";

    eventList.replaceChildren();
    if(!savedEvents.length){
        eventList.append(createTextElement(
            "p", "empty", "No events yet. Add an event to publish it on the church website."
        ));
        return;
    }

    for(const event of savedEvents){
        const item = document.createElement("article");
        item.className = "event-item";
        const top = document.createElement("div");
        top.className = "event-item-top";
        const details = document.createElement("div");
        details.append(
            createTextElement("h3", "", event.title),
            createTextElement("p", "event-date",
                `${formatDate(event.event_date)}${event.event_time
                    ? ` · ${new Date(`1970-01-01T${event.event_time}`).toLocaleTimeString(
                        "en", {hour:"numeric", minute:"2-digit"}
                    )}`
                    : ""}`)
        );
        const state = createTextElement(
            "span", `event-state${event.event_date < today ? " past" : ""}`,
            event.event_date < today ? "Past event" : "Upcoming"
        );
        details.append(state);
        if(event.description){
            details.append(createTextElement("p", "event-description", event.description));
        }
        if(event.location){
            details.append(createTextElement("p", "event-location", `📍 ${event.location}`));
        }

        const actions = document.createElement("div");
        actions.className = "event-actions";
        const editButton = createTextElement("button", "text-button", "Edit");
        editButton.type = "button";
        editButton.dataset.action = "edit";
        editButton.dataset.id = event.id;
        const deleteButton = createTextElement("button", "text-button delete", "Delete");
        deleteButton.type = "button";
        deleteButton.dataset.action = "delete";
        deleteButton.dataset.id = event.id;
        actions.append(editButton, deleteButton);
        top.append(details, actions);
        item.append(top);

        if(event.poster_path){
            const poster = document.createElement("img");
            poster.className = "event-item-poster";
            poster.src = publicPosterUrl(event.poster_path);
            poster.alt = `${event.title} event poster`;
            poster.loading = "lazy";
            item.append(poster);
        }
        eventList.append(item);
    }
}

async function loadAdminInvites(){
    const {data, error} = await client
        .from("admin_allowlist")
        .select("email,user_id")
        .order("email");

    if(error){
        console.error("Unable to load admin signup settings.", error);
        inviteList.replaceChildren(createTextElement(
            "p", "empty", "Admin signup settings could not be loaded."
        ));
        return;
    }

    inviteList.replaceChildren();
    if(!data.length){
        inviteList.append(createTextElement("p", "empty", "No invited admin emails."));
        return;
    }

    for(const invite of data){
        const row = document.createElement("div");
        row.className = "invite-item";
        const label = invite.user_id
            ? `${invite.email} · account active`
            : `${invite.email} · not signed up`;
        row.append(createTextElement("span", "", label));
        if(invite.user_id !== signedInUser?.id){
            const removeButton = createTextElement("button", "text-button delete", "Revoke");
            removeButton.type = "button";
            removeButton.dataset.email = invite.email;
            removeButton.dataset.action = "revoke-invite";
            row.append(removeButton);
        }
        inviteList.append(row);
    }
}

async function deletePoster(path){
    if(!path){
        return true;
    }
    const {error} = await client.storage.from("event-posters").remove([path]);
    if(error){
        console.error("Unable to remove event poster from storage.", error);
        return false;
    }
    return true;
}

async function publishPush(action, event){
    const {data, error} = await client.functions.invoke("event-push", {
        body:{
            action:"send",
            title:event.title,
            eventAction:action,
            description:event.description || "",
            date:event.event_date,
            posterUrl:event.poster_path ? publicPosterUrl(event.poster_path) : ""
        }
    });
    if(error){
        console.error("The event was saved, but push delivery failed.", error);
        return false;
    }
    return data || {sent:0, failed:0};
}

function resetForm(){
    eventForm.reset();
    eventIdInput.value = "";
    document.getElementById("formHeading").textContent = "Add an event";
    document.getElementById("saveButton").textContent = "Save event";
    document.getElementById("cancelButton").hidden = true;
    document.getElementById("removePosterRow").hidden = true;
    if(posterPreviewUrl){
        URL.revokeObjectURL(posterPreviewUrl);
        posterPreviewUrl = "";
    }
    posterPreview.removeAttribute("src");
    posterPreview.hidden = true;
}

async function uploadPoster(file){
    if(!file){
        return "";
    }
    const extensions = {
        "image/jpeg":"jpg",
        "image/png":"png",
        "image/webp":"webp"
    };
    if(!extensions[file.type]){
        throw new Error("Please choose a JPG, PNG or WebP image.");
    }
    if(file.size > 10 * 1024 * 1024){
        throw new Error("Event posters must be 10 MB or smaller.");
    }
    const path = `${crypto.randomUUID()}.${extensions[file.type]}`;
    const {error} = await client.storage
        .from("event-posters")
        .upload(path, file, {contentType:file.type, cacheControl:"3600", upsert:false});
    if(error){
        throw error;
    }
    return path;
}

eventForm.addEventListener("submit", async event => {
    event.preventDefault();
    const saveButton = document.getElementById("saveButton");
    saveButton.disabled = true;
    showMessage(statusMessage, "Saving event…");

    let uploadedPath = "";
    try{
        const formData = new FormData(eventForm);
        const id = eventIdInput.value;
        const existingEvent = savedEvents.find(item => item.id === id);
        const selectedPoster = posterInput.files[0];
        if(selectedPoster){
            uploadedPath = await uploadPoster(selectedPoster);
        }
        const shouldRemovePoster = document.getElementById("removePoster").checked;
        const record = {
            title:String(formData.get("title")).trim(),
            description:String(formData.get("description")).trim(),
            event_date:String(formData.get("date")),
            event_time:String(formData.get("time")) || null,
            location:String(formData.get("location")).trim(),
            poster_path:uploadedPath || (shouldRemovePoster ? "" : existingEvent?.poster_path || ""),
            updated_at:new Date().toISOString()
        };
        const query = id
            ? client.from("events").update(record).eq("id", id)
            : client.from("events").insert(record);
        const {data, error} = await query.select().single();
        if(error){
            throw error;
        }
        if(uploadedPath && !data){
            throw new Error("The event was saved, but its updated record could not be read.");
        }

        const posterToRemove = existingEvent?.poster_path &&
            existingEvent.poster_path !== record.poster_path
            ? existingEvent.poster_path
            : "";
        const cleanedUp = await deletePoster(posterToRemove);
        const pushResult = await publishPush(id ? "updated" : "created", record);
        resetForm();
        await loadEvents();

        const messages = ["Event published on the main church website."];
        if(!cleanedUp){
            messages.push("The previous poster could not be removed.");
        }
        if(!pushResult){
            messages.push("The live site will update, but phone push could not be sent.");
        }else if(pushResult.sent === 0){
            messages.push("No visitors have enabled phone notifications yet.");
        }else{
            messages.push(`Phone notifications sent to ${pushResult.sent} device(s).`);
            if(pushResult.failed){
                messages.push(`${pushResult.failed} device(s) could not be reached.`);
            }
        }
        showMessage(statusMessage, messages.join(" "));
    }catch(error){
        console.error("Unable to save church event.", error);
        if(uploadedPath){
            await deletePoster(uploadedPath);
        }
        showMessage(statusMessage, error.message || "Could not save the event. Please try again.", true);
    }finally{
        saveButton.disabled = false;
    }
});

eventList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if(!button){
        return;
    }
    const selectedEvent = savedEvents.find(item => item.id === button.dataset.id);
    if(!selectedEvent){
        showMessage(statusMessage, "That event could not be found. Refresh the dashboard and try again.", true);
        return;
    }

    if(button.dataset.action === "edit"){
        eventIdInput.value = selectedEvent.id;
        document.getElementById("eventTitle").value = selectedEvent.title;
        document.getElementById("eventDescription").value = selectedEvent.description || "";
        dateInput.value = selectedEvent.event_date;
        document.getElementById("eventTime").value = selectedEvent.event_time?.slice(0, 5) || "";
        document.getElementById("eventLocation").value = selectedEvent.location || "";
        document.getElementById("formHeading").textContent = "Edit event";
        document.getElementById("saveButton").textContent = "Update event";
        document.getElementById("cancelButton").hidden = false;
        document.getElementById("removePosterRow").hidden = !selectedEvent.poster_path;
        if(selectedEvent.poster_path){
            posterPreview.src = publicPosterUrl(selectedEvent.poster_path);
            posterPreview.hidden = false;
        }
        showMessage(statusMessage, "");
        document.getElementById("eventTitle").focus();
        return;
    }

    if(button.dataset.action === "delete"){
        pendingDeleteEvent = selectedEvent;
        pendingDeleteButton = button;
        deleteConfirmationMessage.textContent =
            `Are you sure you want to delete "${selectedEvent.title}"? Visitors will see an event update.`;
        deleteConfirmation.showModal();
        cancelDeleteButton.focus();
    }
});

cancelDeleteButton.addEventListener("click", () => {
    deleteConfirmation.close();
});

deleteConfirmation.addEventListener("close", () => {
    pendingDeleteEvent = null;
    const buttonToRestore = pendingDeleteButton;
    pendingDeleteButton = null;
    if(buttonToRestore?.isConnected){
        buttonToRestore.focus();
    }
});

confirmDeleteButton.addEventListener("click", async () => {
    const selectedEvent = pendingDeleteEvent;
    if(!selectedEvent){
        deleteConfirmation.close();
        return;
    }

    pendingDeleteEvent = null;
    pendingDeleteButton = null;
    deleteConfirmation.close();
    confirmDeleteButton.disabled = true;
    showMessage(statusMessage, "Deleting event…");

    try{
        const {error} = await client.from("events").delete().eq("id", selectedEvent.id);
        if(error){
            throw error;
        }
        const cleanedUp = await deletePoster(selectedEvent.poster_path);
        const pushResult = await publishPush("deleted", selectedEvent);
        if(eventIdInput.value === selectedEvent.id){
            resetForm();
        }
        await loadEvents();
        const message = [
            "Event deleted from the main website.",
            cleanedUp ? "" : "Its poster could not be removed.",
            pushResult
                ? pushResult.sent
                    ? `Phone notifications sent to ${pushResult.sent} device(s).`
                    : "No visitors have enabled phone notifications yet."
                : "Phone push could not be sent."
        ].filter(Boolean).join(" ");
        showMessage(statusMessage, message, !pushResult || !cleanedUp);
    }catch(error){
        console.error("Unable to delete church event.", error);
        showMessage(statusMessage, "Could not delete the event. Please try again.", true);
    }finally{
        confirmDeleteButton.disabled = false;
    }
});

posterInput.addEventListener("change", () => {
    const file = posterInput.files[0];
    if(!file){
        if(!eventIdInput.value){
            posterPreview.hidden = true;
        }
        return;
    }
    if(!["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
       file.size > 10 * 1024 * 1024){
        posterInput.value = "";
        showMessage(statusMessage, "Choose a JPG, PNG or WebP image no larger than 10 MB.", true);
        return;
    }
    if(posterPreviewUrl){
        URL.revokeObjectURL(posterPreviewUrl);
    }
    posterPreviewUrl = URL.createObjectURL(file);
    posterPreview.src = posterPreviewUrl;
    posterPreview.hidden = false;
});

document.getElementById("cancelButton").addEventListener("click", () => {
    resetForm();
    showMessage(statusMessage, "");
});

document.getElementById("removePoster").addEventListener("change", event => {
    if(event.target.checked && !posterInput.files.length){
        posterPreview.hidden = true;
    }else if(event.target.checked && posterInput.files.length){
        posterPreview.hidden = false;
    }else{
        const existingEvent = savedEvents.find(item => item.id === eventIdInput.value);
        if(existingEvent?.poster_path && !posterInput.files.length){
            posterPreview.src = publicPosterUrl(existingEvent.poster_path);
            posterPreview.hidden = false;
        }
    }
});

document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    if(!client){
        showMessage(authStatus, "Add the Supabase URL and publishable key to supabase-config.js first.", true);
        return;
    }
    const formData = new FormData(event.currentTarget);
    const {data, error} = await client.auth.signInWithPassword({
        email:String(formData.get("email")).trim(),
        password:String(formData.get("password"))
    });
    if(error){
        showMessage(authStatus, error.message, true);
        return;
    }
    await refreshAdminAccess(data.session);
});

document.getElementById("signupForm").addEventListener("submit", async event => {
    event.preventDefault();
    if(!client){
        showMessage(authStatus, "Add the Supabase URL and publishable key to supabase-config.js first.", true);
        return;
    }
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email")).trim().toLowerCase();
    const password = String(formData.get("password"));
    const {data, error} = await client.auth.signUp({
        email,
        password,
        options:{emailRedirectTo:new URL("admin.html", window.location.href).href}
    });
    if(error){
        showMessage(authStatus, error.message, true);
        return;
    }
    if(data.session){
        await refreshAdminAccess(data.session);
        return;
    }
    showMessage(authStatus, "Sign-up submitted. Verify the invited email address, then sign in. Only emails on the admin invite list receive dashboard access.");
});

document.getElementById("showSignupButton").addEventListener("click", () => {
    document.getElementById("loginForm").hidden = true;
    document.getElementById("signupForm").hidden = false;
    document.getElementById("signupToggleText").hidden = true;
    document.getElementById("loginToggleText").hidden = false;
    document.getElementById("authHeading").textContent = "Create an admin account";
    showMessage(authStatus, "");
});

document.getElementById("showLoginButton").addEventListener("click", () => {
    document.getElementById("signupForm").hidden = true;
    document.getElementById("loginForm").hidden = false;
    document.getElementById("loginToggleText").hidden = true;
    document.getElementById("signupToggleText").hidden = false;
    document.getElementById("authHeading").textContent = "Admin sign in";
    showMessage(authStatus, "");
});

document.getElementById("inviteForm").addEventListener("submit", async event => {
    event.preventDefault();
    const emailInput = document.getElementById("inviteEmail");
    const email = emailInput.value.trim().toLowerCase();
    const {error} = await client.from("admin_allowlist").insert({email});
    if(error){
        console.error("Unable to add an admin signup invite.", error);
        showMessage(statusMessage,
            error.code === "23505" ? "That email is already on the invite list." :
                "Could not add the admin invite. Please try again.", true);
        return;
    }
    emailInput.value = "";
    await loadAdminInvites();
    showMessage(statusMessage, "Admin signup enabled for that email address.");
});

inviteList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action='revoke-invite']");
    if(!button || button.dataset.email === signedInUser?.email){
        return;
    }
    if(!window.confirm(`Remove admin access for ${button.dataset.email}?`)){
        return;
    }
    const {error} = await client
        .from("admin_allowlist")
        .delete()
        .eq("email", button.dataset.email);
    if(error){
        console.error("Unable to revoke admin access.", error);
        showMessage(statusMessage, "Could not revoke admin access. Please try again.", true);
        return;
    }
    await loadAdminInvites();
    showMessage(statusMessage, "Admin invite/access revoked.");
});

signOutButton.addEventListener("click", async () => {
    const {error} = await client.auth.signOut();
    if(error){
        console.error("Unable to sign out admin.", error);
        showMessage(statusMessage, "Could not sign out. Please try again.", true);
        return;
    }
    signedInUser = null;
    savedEvents = [];
    setAuthControls(false);
    showMessage(authStatus, "You have signed out.");
});

let installPrompt;
const installButton = document.getElementById("installButton");
window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
});
installButton.addEventListener("click", async () => {
    if(!installPrompt){
        showMessage(authStatus, "To install, open your browser menu and choose “Add to Home Screen” or “Install app”.");
        return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
});

if(!client){
    showMessage(authStatus, "The shared event database is not configured. Follow supabase/SETUP.md to connect the church Supabase project.", true);
}else{
    client.auth.onAuthStateChange((_event, session) => {
        queueMicrotask(() => refreshAdminAccess(session));
    });
    client.auth.getSession().then(({data, error}) => {
        if(error){
            console.error("Unable to restore admin sign-in.", error);
            showMessage(authStatus, "Could not restore your sign-in. Please sign in again.", true);
            return;
        }
        refreshAdminAccess(data.session);
    });
}

if("serviceWorker" in navigator){
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(error => {
            console.error("The church app could not be installed for offline use.", error);
            showMessage(authStatus, "Offline app setup failed. The dashboard still works online.", true);
        });
    });
}
