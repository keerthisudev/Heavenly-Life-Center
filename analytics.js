const measurementId = "G-REPLACE_WITH_YOUR_MEASUREMENT_ID";

if (/^G-[A-Z0-9]+$/.test(measurementId)) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
        window.dataLayer.push(arguments);
    };

    window.gtag("js", new Date());
    window.gtag("config", measurementId);

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);
}
