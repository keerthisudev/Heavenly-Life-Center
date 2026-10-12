import { createClient } from "supabase";
import webpush from "web-push";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const siteUrl = Deno.env.get("SITE_URL")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT")!;

const corsHeaders = {
    "Access-Control-Allow-Origin": siteUrl,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
};

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {persistSession:false, autoRefreshToken:false}
});

Deno.serve(async request => {
    if(request.method === "OPTIONS"){
        return new Response("ok", {headers:corsHeaders});
    }
    if(request.method !== "POST"){
        return jsonResponse({error:"Method not allowed."}, 405);
    }

    const origin = request.headers.get("origin");
    if(origin !== siteUrl){
        return jsonResponse({error:"This website is not allowed to manage notifications."}, 403);
    }

    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if(contentType !== "application/json"){
        return jsonResponse({error:"A JSON request body is required."}, 415);
    }

    const contentLength = Number(request.headers.get("content-length"));
    if(Number.isFinite(contentLength) && contentLength > 16384){
        return jsonResponse({error:"Request body is too large."}, 413);
    }

    let body: Record<string, unknown>;
    try{
        body = await readJsonBody(request);
    }catch(error){
        if(error instanceof RangeError){
            return jsonResponse({error:"Request body is too large."}, 413);
        }
        if(!(error instanceof SyntaxError)){
            throw error;
        }
        return jsonResponse({error:"Invalid request body."}, 400);
    }

    if(body.action === "subscribe"){
        const subscription = body.subscription as PushSubscriptionShape | undefined;
        if(!subscription || !isSupportedPushEndpoint(subscription.endpoint) ||
           !isBase64UrlKey(subscription.keys?.p256dh, 87) ||
           !isBase64UrlKey(subscription.keys?.auth, 22)){
            return jsonResponse({error:"Invalid push subscription."}, 400);
        }
        const {error} = await serviceClient
            .from("push_subscriptions")
            .upsert({
                endpoint:subscription.endpoint,
                subscription,
                updated_at:new Date().toISOString()
            });
        if(error){
            console.error("Unable to save a push subscription.", error);
            return jsonResponse({error:"Could not save the phone notification subscription."}, 500);
        }
        return jsonResponse({success:true});
    }

    if(body.action === "unsubscribe"){
        if(typeof body.endpoint !== "string" ||
           !isSupportedPushEndpoint(body.endpoint)){
            return jsonResponse({error:"Invalid push subscription endpoint."}, 400);
        }
        const {error} = await serviceClient
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", body.endpoint);
        if(error){
            console.error("Unable to remove a push subscription.", error);
            return jsonResponse({error:"Could not remove the phone notification subscription."}, 500);
        }
        return jsonResponse({success:true});
    }

    if(body.action !== "send"){
        return jsonResponse({error:"Unknown notification action."}, 400);
    }

    const authHeader = request.headers.get("authorization") || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if(!accessToken){
        return jsonResponse({error:"Admin sign-in is required to send notifications."}, 401);
    }
    const callerClient = createClient(supabaseUrl, anonKey, {
        auth:{persistSession:false, autoRefreshToken:false},
        global:{headers:{Authorization:`Bearer ${accessToken}`}}
    });
    const {data:userData, error:userError} = await callerClient.auth.getUser(accessToken);
    if(userError || !userData.user){
        return jsonResponse({error:"Admin sign-in has expired."}, 401);
    }
    const {data:isAdmin, error:adminError} = await callerClient.rpc("is_admin");
    if(adminError || isAdmin !== true){
        return jsonResponse({error:"Only invited admins can send event notifications."}, 403);
    }

    const title = boundedText(body.title, 120);
    const eventAction = body.eventAction;
    const description = boundedText(body.description, 180);
    const date = boundedText(body.date, 30);
    const posterUrl = safePosterUrl(body.posterUrl);
    if(!title || !["created", "updated", "deleted"].includes(String(eventAction))){
        return jsonResponse({error:"The event notification is incomplete."}, 400);
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const {data:subscriptions, error:subscriptionError} = await serviceClient
        .from("push_subscriptions")
        .select("endpoint,subscription");
    if(subscriptionError){
        console.error("Unable to read push subscriptions.", subscriptionError);
        return jsonResponse({error:"Could not load phone notification subscriptions."}, 500);
    }

    const actionLabel = eventAction === "created"
        ? "New church event"
        : eventAction === "updated"
            ? "Church event updated"
            : "Church event cancelled";
    const notification = {
        title:actionLabel,
        body:description ? `${title} · ${description}` : `${title}${date ? ` · ${date}` : ""}`,
        icon:new URL("assets/logo.jpg", `${siteUrl}/`).href,
        badge:new URL("assets/logo.jpg", `${siteUrl}/`).href,
        image:posterUrl || undefined,
        tag:`church-event-${crypto.randomUUID()}`,
        data:{url:"./index.html#events", title, action:eventAction}
    };
    const results = await Promise.allSettled(subscriptions.map(async row => {
        if(!isSupportedPushEndpoint(row.endpoint)){
            return {expired:true};
        }
        try{
            await webpush.sendNotification(row.subscription, JSON.stringify(notification));
            return {expired:false};
        }catch(error){
            const statusCode = (error as {statusCode?:number}).statusCode;
            if(statusCode === 404 || statusCode === 410){
                return {expired:true};
            }
            throw error;
        }
    }));

    let sent = 0;
    const expiredEndpoints: string[] = [];
    let failed = 0;
    results.forEach((result, index) => {
        if(result.status === "fulfilled"){
            if(result.value.expired){
                expiredEndpoints.push(subscriptions[index].endpoint);
            }else{
                sent++;
            }
        }else{
            failed++;
            console.error("A phone event notification could not be delivered.", result.reason);
        }
    });

    if(expiredEndpoints.length){
        const {error} = await serviceClient
            .from("push_subscriptions")
            .delete()
            .in("endpoint", expiredEndpoints);
        if(error){
            console.error("Unable to clean up expired push subscriptions.", error);
        }
    }

    return jsonResponse({success:true, sent, failed});
});

function jsonResponse(payload:Record<string, unknown>, status = 200){
    return new Response(JSON.stringify(payload), {
        status,
        headers:{
            ...corsHeaders,
            "Content-Type":"application/json; charset=utf-8",
            "Cache-Control":"no-store",
            "X-Content-Type-Options":"nosniff"
        }
    });
}

async function readJsonBody(request:Request): Promise<Record<string, unknown>>{
    const reader = request.body?.getReader();
    if(!reader){
        throw new SyntaxError("Request body is missing.");
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    while(true){
        const {done, value} = await reader.read();
        if(done){
            break;
        }
        size += value.byteLength;
        if(size > 16384){
            await reader.cancel();
            throw new RangeError("Request body is too large.");
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for(const chunk of chunks){
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if(!isRecord(parsed)){
        throw new SyntaxError("Request body must be a JSON object.");
    }
    return parsed;
}

function isRecord(value:unknown): value is Record<string, unknown>{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64UrlKey(value:unknown, expectedLength:number): value is string{
    return typeof value === "string" &&
        value.length === expectedLength &&
        /^[A-Za-z0-9_-]+$/.test(value);
}

function boundedText(value:unknown, maximum:number){
    return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safePosterUrl(value:unknown){
    if(typeof value !== "string"){
        return "";
    }
    try{
        const url = new URL(value);
        if(url.protocol !== "https:" || url.origin !== supabaseUrl){
            return "";
        }
        return url.href;
    }catch{
        return "";
    }
}

function isSupportedPushEndpoint(value:unknown): value is string{
    if(typeof value !== "string" || value.length > 2048){
        return false;
    }
    try{
        const endpoint = new URL(value);
        const hostname = endpoint.hostname.toLowerCase();
        return endpoint.protocol === "https:" &&
            !endpoint.username &&
            !endpoint.password &&
            !endpoint.port && (
            hostname === "fcm.googleapis.com" ||
            hostname === "web.push.apple.com" ||
            hostname === "updates.push.services.mozilla.com" ||
            hostname.endsWith(".push.services.mozilla.com")
        );
    }catch{
        return false;
    }
}

interface PushSubscriptionShape{
    endpoint:string;
    keys?:{
        auth?:string;
        p256dh?:string;
    };
}
