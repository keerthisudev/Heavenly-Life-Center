const menuBtn = document.getElementById("menuBtn");
const navLinks = document.getElementById("navLinks");

menuBtn.addEventListener("click", () => {
    navLinks.classList.toggle("open");
    menuBtn.textContent = navLinks.classList.contains("open") ? "✕" : "☰";
});

document.querySelectorAll(".navlinks a").forEach(link => {
    link.addEventListener("click", () => {
        navLinks.classList.remove("open");
        menuBtn.textContent = "☰";
    });
});

const languageBtn = document.getElementById("languageBtn");
languageBtn.addEventListener("click", () => {
    document.body.classList.toggle("malayalam");
    languageBtn.textContent = document.body.classList.contains("malayalam")
        ? "English"
        : "മലയാളം";
});

const prayerForm = document.getElementById("prayerForm");
prayerForm.addEventListener("submit", event => {
    event.preventDefault();
    const name = document.getElementById("pname").value;
    const contact = document.getElementById("pcontact").value;
    const message = document.getElementById("pmessage").value;
    const subject = encodeURIComponent("Prayer Request - Heavenly Life Center");
    const body = encodeURIComponent(
        `Prayer Request\n\nName:\n${name}\n\nPhone / Email:\n${contact}\n\nPrayer Request:\n${message}`
    );

    window.location.href = `mailto:keerthi@sowibo.com?subject=${subject}&body=${body}`;
    showToast("Prayer request prepared successfully.");
});

function showToast(message){
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.style.display = "block";
    setTimeout(() => {
        toast.style.display = "none";
    }, 3500);
}

document.addEventListener("click", event => {
    if(
        window.innerWidth <= 800 &&
        !navLinks.contains(event.target) &&
        !menuBtn.contains(event.target)
    ){
        navLinks.classList.remove("open");
        menuBtn.textContent = "☰";
    }
});

if("serviceWorker" in navigator){
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(error => {
            console.error("The church app could not be installed for offline use.", error);
        });
    });
}
