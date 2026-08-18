CTFd.plugin.run((_CTFd) => {
    const $ = _CTFd.lib.$;

    // ── Layer 1: Bootstrap modal event interceptor ─────────────────────────
    // Fires BEFORE Bootstrap shows #challenge-create-options.
    // For sandbox challenges: cancel the modal and redirect to the challenge
    // detail page instead. Bootstrap 3/4 checks e.isDefaultPrevented() on the
    // "show.bs.modal" event and aborts if true.
    //
    // Remove any previous sandbox handler first (in case loadChalTemplate
    // is called multiple times when the user switches challenge types).
    $('#challenge-create-options')
        .off('show.bs.modal.sandbox')
        .on('show.bs.modal.sandbox', function (e) {
            // Check if this page is currently rendering a sandbox create form
            var typeInput = document.getElementById('chaltype') ||
                            document.querySelector('#create-chal-entry-div input[name="type"]');
            if (!typeInput || typeInput.value !== 'sandbox') return;

            // Prevent Bootstrap from showing the modal
            e.preventDefault();
            e.stopImmediatePropagation();

            // The challenge was already created by challenge.js before .modal()
            // was called. Grab the challenge_id it stored in the modal.
            var challengeIdEl = document.querySelector('#challenge-create-options #challenge_id');
            var challengeId = challengeIdEl ? challengeIdEl.value : null;

            if (challengeId) {
                var basePath = (typeof window.CHALLENGE_AFTER_CREATE_REDIRECT === 'string' && window.CHALLENGE_AFTER_CREATE_REDIRECT)
                    ? window.CHALLENGE_AFTER_CREATE_REDIRECT
                    : '/admin/challenges/';
                window.location = _CTFd.config.urlRoot + basePath + challengeId;
            }
        });

    // ── DOM helpers ────────────────────────────────────────────────────────
    function el(id) { return document.getElementById(id); }
    function removeClass(id, cls) { var e = el(id); if (e) e.classList.remove(cls); }

    // ── Sync hidden KYPO metadata fields ──────────────────────────────────
    // Điểm KHÔNG lấy từ KYPO nữa — admin tự nhập trong ô Score.
    // Chọn instance chỉ để lưu metadata (kypo_instance_id, access_token, type).
    function syncHiddenFields(inst) {
        el("kypo-instance-id").value = inst ? inst.id : "";
        el("kypo-access-token").value = inst ? (inst.access_token || "") : "";
        el("kypo-instance-type").value = inst ? (inst.instance_type || "") : "";
    }

    function instanceLabel(inst) {
        return "[" + (inst.instance_type || "linear").toUpperCase() + "] " + inst.title;
    }

    // ── Searchable combobox ──────────────────────────────────────────────
    // One input both filters the list and, once something is picked, shows
    // that pick as its value - no separate search box + listbox pair.
    function initCombobox(input, menu, onSelect) {
        var instances = [];
        var matches = [];
        var selected = null;
        var activeIndex = -1;

        function closeMenu() {
            menu.classList.add("d-none");
            menu.innerHTML = "";
            matches = [];
            activeIndex = -1;
        }

        function highlight() {
            var items = menu.querySelectorAll(".kypo-combobox-item");
            items.forEach(function (it, i) { it.classList.toggle("active", i === activeIndex); });
            if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: "nearest" });
        }

        function choose(inst) {
            selected = inst;
            input.value = inst ? instanceLabel(inst) : "";
            closeMenu();
            onSelect(inst);
        }

        function openMenu(filterText) {
            var q = (filterText || "").toLowerCase();
            matches = instances.filter(function (inst) {
                return instanceLabel(inst).toLowerCase().indexOf(q) > -1;
            });
            activeIndex = -1;
            menu.innerHTML = "";

            if (matches.length === 0) {
                var empty = document.createElement("div");
                empty.className = "list-group-item text-muted small";
                empty.textContent = "No matching instance";
                menu.appendChild(empty);
            } else {
                matches.forEach(function (inst) {
                    var item = document.createElement("button");
                    item.type = "button";
                    item.className = "list-group-item list-group-item-action py-2 kypo-combobox-item";
                    if (selected && String(selected.id) === String(inst.id)) item.classList.add("active");
                    item.textContent = instanceLabel(inst);
                    // mousedown (not click) + preventDefault keeps focus on the
                    // input, so it never blurs and there's nothing to race.
                    item.addEventListener("mousedown", function (e) {
                        e.preventDefault();
                        choose(inst);
                    });
                    menu.appendChild(item);
                });
            }
            menu.classList.remove("d-none");
        }

        input.addEventListener("focus", function () {
            openMenu("");
            input.select();
        });
        input.addEventListener("input", function () { openMenu(input.value); });
        input.addEventListener("blur", function () {
            // Anything left in the box that was never actually chosen from the
            // list isn't a valid value - snap back to the real selection (or
            // empty) so the field's `required` can't pass on stray text.
            input.value = selected ? instanceLabel(selected) : "";
            closeMenu();
        });
        input.addEventListener("keydown", function (e) {
            if (menu.classList.contains("d-none")) return;
            if (e.key === "ArrowDown") {
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, matches.length - 1);
                highlight();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                highlight();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (matches[activeIndex]) choose(matches[activeIndex]);
            } else if (e.key === "Escape") {
                closeMenu();
            }
        });

        return {
            setInstances: function (list) { instances = list || []; },
            clear: function () { choose(null); }
        };
    }

    var combobox = initCombobox(el("kypo-instance-search"), el("kypo-instance-dropdown"), syncHiddenFields);

    // ── Populate the instance list ────────────────────────────────────────
    function loadInstances() {
        var loading = el("kypo-instance-loading");
        var input = el("kypo-instance-search");
        var group = el("kypo-refresh-container");
        var errorEl = el("kypo-instance-error");

        if (!loading || !input) return;

        combobox.clear();
        combobox.setInstances([]);
        if (group) group.style.display = "none";
        if (errorEl) errorEl.classList.add("d-none");
        loading.style.display = "";

        fetch("/api/v1/kypo/instances", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json", "CSRF-Token": _CTFd.csrftoken },
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                loading.style.display = "none";

                if (data.success && data.data && data.data.length > 0) {
                    var instances = data.data.filter(function (inst) {
                        return (inst.instance_type || "linear") !== "adaptive";
                    });
                    combobox.setInstances(instances);
                    if (group) group.style.display = "block";
                } else {
                    removeClass("kypo-instance-error", "d-none");
                }

                if (data.errors && data.errors.length > 0) {
                    console.warn("[KYPO] Partial errors:", data.errors);
                }
            })
            .catch(function (err) {
                if (loading) loading.style.display = "none";
                removeClass("kypo-instance-error", "d-none");
                console.error("[KYPO] Failed to fetch instances:", err);
            });
    }

    loadInstances();

    // ── Refresh button ────────────────────────────────────────────────────
    var refreshBtn = el("kypo-refresh-btn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", function () {
            var icon = this.querySelector("i");
            if (icon) icon.classList.add("fa-spin");
            loadInstances();
            setTimeout(function () {
                if (icon) icon.classList.remove("fa-spin");
            }, 800);
        });
    }
});
