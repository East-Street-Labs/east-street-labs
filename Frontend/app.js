// East Street Labs — tiny hash router (plain JavaScript)

(function () {
    var ROUTES = ["home", "about", "solutions", "contact"];
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

    // Contact form — no backend yet; show the success chip instead.
    var form = document.getElementById("contact-form");
    if (form) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
            form.reset();
            var success = document.getElementById("contact-success");
            if (success) {
                success.hidden = false;
            }
        });
    }
})();
