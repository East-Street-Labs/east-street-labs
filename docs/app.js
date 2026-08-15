// East Street Labs — tiny hash router (plain JavaScript)

(function () {
    var ROUTES = ["home", "about", "projects", "contact", "privacy"];
    var DEFAULT_ROUTE = "home";

    function currentRoute() {
        var hash = window.location.hash.replace(/^#\/?/, "");
        return ROUTES.indexOf(hash) !== -1 ? hash : DEFAULT_ROUTE;
    }

    function render() {
        var route = currentRoute();

        document.querySelectorAll("[data-route]").forEach(function (section) {
            section.hidden = section.getAttribute("data-route") !== route;
        });

        document.querySelectorAll("[data-link]").forEach(function (link) {
            var isActive = link.getAttribute("data-link") === route;
            link.classList.toggle("active", isActive);
            if (isActive) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });

        window.scrollTo(0, 0);
    }

    window.addEventListener("hashchange", render);
    render();

    // ========================================================
    // Contact form
    //
    // Posted to Web3Forms, which forwards the message to
    // hello@eaststreetlabs.com. Get the key at https://web3forms.com by
    // verifying that address, then paste it below. Publishing the key is
    // safe by design — it can only deliver mail to the verified address.
    // ========================================================

    var ACCESS_KEY = "43d58794-19fd-4415-95a1-0969e215b41d";
    var ENDPOINT = "https://api.web3forms.com/submit";

    var form = document.getElementById("contact-form");
    if (form) {
        var success = document.getElementById("contact-success");
        var error = document.getElementById("contact-error");
        var button = form.querySelector("button[type=submit]");
        var buttonLabel = button ? button.textContent : "";

        function clearFeedback() {
            success.hidden = true;
            error.hidden = true;
        }

        function fail(reason) {
            console.error("Contact form: " + reason);
            error.hidden = false;
        }

        // A leftover "sent" chip is misleading once a new message is started.
        form.addEventListener("input", clearFeedback);

        form.addEventListener("submit", function (event) {
            event.preventDefault();

            // All three fields are required; let the browser report which one.
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }

            clearFeedback();

            if (!ACCESS_KEY) {
                fail("no Web3Forms access key set — see ACCESS_KEY at the top of this file");
                return;
            }

            button.disabled = true;
            button.textContent = "Sending…";

            var data = new FormData(form);
            data.append("access_key", ACCESS_KEY);
            data.append("subject", "New message from eaststreetlabs.com");
            data.append("from_name", "East Street Labs website");

            fetch(ENDPOINT, { method: "POST", body: data })
                .then(function (response) {
                    return response.json().then(function (body) {
                        // Only a confirmed send may show the thank-you text.
                        if (!response.ok || !body.success) {
                            throw new Error(body.message || "HTTP " + response.status);
                        }
                        form.reset();
                        success.hidden = false;
                    });
                })
                .catch(function (err) {
                    // Keep what they typed so it can be retried or copied out.
                    fail(err.message);
                })
                .then(function () {
                    button.disabled = false;
                    button.textContent = buttonLabel;
                });
        });
    }
})();
